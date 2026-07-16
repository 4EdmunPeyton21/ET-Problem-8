'use strict';

/**
 * backend/src/agents/query-agent.js
 *
 * Industrial Knowledge Query Agent.
 *
 * Uses Groq (primary) or Gemini (secondary) with tool calling to answer
 * questions about equipment, maintenance, procedures, and compliance.
 *
 * TOOL CALLING LOOP:
 *   1. Send user question + tools list to LLM
 *   2. LLM responds with tool_calls (what it needs to look up)
 *   3. We execute each tool call (graph query / vector search / doc retrieval)
 *   4. Send results back to LLM
 *   5. Repeat until LLM gives a final text answer (no more tool calls)
 *
 * Usage:
 *   const agent = new QueryAgent(graphManager);
 *   const result = await agent.query('Why did PUMP-XYZ fail in January 2024?');
 */

require('dotenv').config();

const {
    getGroqKey,
    getActiveProvider,
    extractConfidence,
    extractCitations,
    truncate,
    formatQueryResults,
    buildAgentResponse,
    sleep,
    parseEquipmentId,
    getSimilarIncidents,
    queryGraph,
    vectorSearch,
    indexDocument,
} = require('./agent-utils');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GROQ_MODEL      = process.env.GROQ_MODEL   || 'llama-3.3-70b-versatile';
const GEMINI_MODEL    = process.env.GEMINI_MODEL  || 'gemini-2.0-flash';
const MAX_TOOL_ROUNDS = 5;   // prevent infinite tool-calling loops

// ---------------------------------------------------------------------------
// Tool Definitions
// ---------------------------------------------------------------------------

/**
 * OpenAI-compatible tool definitions (also used by Groq).
 * Each tool corresponds to an action the agent can request.
 */
const TOOL_DEFINITIONS = [
    {
        type: 'function',
        function: {
            name: 'graph_query',
            description: 'Query the Neo4j knowledge graph for industrial data. Use this to look up equipment history, incidents, procedures, compliance status, or relationships between assets.',
            parameters: {
                type: 'object',
                properties: {
                    equipment_id: {
                        type: 'string',
                        description: 'Equipment ID or name to query (e.g. "PUMP-XYZ", "Centrifugal Pump", "MOTOR-HYD-001")',
                    },
                    query_type: {
                        type: 'string',
                        enum: ['equipment_history', 'recent_incidents', 'all_equipment', 'equipment_by_type', 'graph_snapshot', 'root_cause'],
                        description: 'Type of query to execute against the knowledge graph',
                    },
                    extra_param: {
                        type: 'string',
                        description: 'Optional extra parameter: number of days for recent_incidents, type string for equipment_by_type, incident ID for root_cause',
                    },
                },
                required: ['query_type'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'vector_search',
            description: 'Perform semantic search on ingested industrial documents (manuals, SOPs, incident reports, compliance checklists). Use for full-text context, procedures, and regulation text.',
            parameters: {
                type: 'object',
                properties: {
                    query_text: {
                        type: 'string',
                        description: 'The natural language query to search for in documents',
                    },
                    top_k: {
                        type: 'integer',
                        description: 'Number of top results to return (default: 5)',
                        default: 5,
                    },
                },
                required: ['query_text'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'document_retrieval',
            description: 'Retrieve the full text content of a specific document by its ID. Use this to read a specific SOP, incident report, or OEM manual.',
            parameters: {
                type: 'object',
                properties: {
                    document_id: {
                        type: 'string',
                        description: 'Document ID or filename to retrieve (e.g. "DOC-001", "sop_42a_pump_startup.txt")',
                    },
                },
                required: ['document_id'],
            },
        },
    },
];

// Gemini-compatible function declarations (converted from OpenAI format)
const GEMINI_FUNCTION_DECLARATIONS = TOOL_DEFINITIONS.map(t => ({
    name:        t.function.name,
    description: t.function.description,
    parameters:  t.function.parameters,
}));

// ---------------------------------------------------------------------------
// QueryAgent Class
// ---------------------------------------------------------------------------

class QueryAgent {

    /**
     * @param {GraphManager}  graphManager   - instance of GraphManager
     * @param {Object|null}   vectorClient   - optional vector DB client (Pinecone, etc.)
     * @param {Object|null}   llmClient      - optional pre-configured LLM client
     */
    constructor(graphManager, vectorClient = null, llmClient = null) {
        this.graphManager = graphManager;
        this.vectorClient = vectorClient;
        this.llmClient    = llmClient;
        this.provider     = getActiveProvider();

        console.log(`[QueryAgent] Initialized with provider: ${this.provider || 'none (offline mode)'}`);
    }

    // ── Tool Definitions ─────────────────────────────────────────────────────

    /**
     * Returns the tool definitions array (OpenAI format).
     * Used by Groq and other OpenAI-compatible providers.
     */
    getTools() {
        return TOOL_DEFINITIONS;
    }

    // ── Tool Execution ────────────────────────────────────────────────────────

    /**
     * Routes a tool call to the correct handler and returns a result string.
     *
     * @param {string} toolName  - 'graph_query' | 'vector_search' | 'document_retrieval'
     * @param {Object} toolInput - Parameters from the LLM
     * @returns {Promise<string>} Stringified result to send back to the LLM
     */
    async executeToolCall(toolName, toolInput) {
        console.log(`[QueryAgent] Executing tool: ${toolName}`, toolInput);

        try {
            switch (toolName) {
                case 'graph_query':
                    return await this._handleGraphQuery(toolInput);

                case 'vector_search':
                    return await this._handleVectorSearch(toolInput);

                case 'document_retrieval':
                    return await this._handleDocumentRetrieval(toolInput);

                default:
                    return `Unknown tool: ${toolName}`;
            }
        } catch (error) {
            console.error(`[QueryAgent] Tool "${toolName}" failed:`, error.message);
            return `Tool execution failed: ${error.message}`;
        }
    }

    // ── Tool Handlers ─────────────────────────────────────────────────────────

    async _handleGraphQuery({ equipment_id, query_type, extra_param }) {
        const gm = this.graphManager;
        if (!gm) return 'Graph database not available.';

        switch (query_type) {
            case 'equipment_history': {
                if (!equipment_id) return 'equipment_id is required for equipment_history query.';
                const history = await gm.queryEquipmentHistory(equipment_id);
                if (!history) return `No equipment found with ID or name: ${equipment_id}`;
                return JSON.stringify({
                    equipment:  history.equipment,
                    failures:   history.failures,
                    procedures: history.procedures,
                    parameters: history.parameters,
                }, null, 2);
            }

            case 'recent_incidents': {
                const days     = parseInt(extra_param) || 30;
                const incidents = await gm.getRecentIncidents(days);
                if (incidents.length === 0) return `No incidents found in the last ${days} days.`;
                return formatQueryResults(incidents, `No incidents in the last ${days} days.`);
            }

            case 'all_equipment': {
                const equipment = await gm.getAllEquipment();
                if (equipment.length === 0) return 'No equipment nodes found in the graph.';
                return formatQueryResults(equipment);
            }

            case 'equipment_by_type': {
                const type = extra_param || equipment_id || '';
                if (!type) return 'Provide a type string in extra_param.';
                const results = await gm.getEquipmentByType(type);
                if (results.length === 0) return `No equipment found of type: ${type}`;
                return formatQueryResults(results);
            }

            case 'graph_snapshot': {
                const snapshot = await gm.getGraphSnapshot();
                return `Graph contains ${snapshot.nodes.length} nodes and ${snapshot.links.length} relationships.`;
            }

            case 'root_cause': {
                const incidentId = extra_param || equipment_id;
                if (!incidentId) return 'Provide an incident ID in extra_param or equipment_id.';
                const paths = await gm.findRootCause(incidentId);
                if (paths.length === 0) return `No root cause paths found for incident: ${incidentId}`;
                return JSON.stringify(paths, null, 2);
            }

            default:
                return `Unknown query_type: ${query_type}`;
        }
    }

    async _handleVectorSearch({ query_text, top_k = 5 }) {
        // Use vectorSearch from agent-utils (supports real vectorClient or in-memory fallback)
        try {
            const results = await vectorSearch(query_text, this.vectorClient, top_k);

            if (results.length > 0) {
                return `Found ${results.length} semantically similar document(s):\n` +
                    results.map((r, i) =>
                        `${i + 1}. [score: ${r.score.toFixed(3)}] ${r.documentId}\n   ${truncate(r.text, 200)}`
                    ).join('\n\n');
            }
        } catch (err) {
            console.warn('[QueryAgent] vectorSearch error:', err.message);
        }

        // Secondary fallback: entity name text search in the graph
        if (this.graphManager) {
            try {
                const session = this.graphManager._session();
                const res = await session.run(
                    `MATCH (n)
                     WHERE toLower(n.name) CONTAINS toLower($q)
                        OR toLower(n.title) CONTAINS toLower($q)
                     RETURN labels(n)[0] AS type, n.name AS name, n.equipmentId AS id
                     LIMIT $k`,
                    { q: query_text, k: top_k }
                );
                await session.close();
                if (res.records.length === 0) return `No matches found for: "${query_text}"`;
                const rows = res.records.map(r => ({ type: r.get('type'), name: r.get('name'), id: r.get('id') }));
                return `Found ${rows.length} graph entity matches:\n` + formatQueryResults(rows);
            } catch (err) {
                return `Graph text search failed: ${err.message}`;
            }
        }

        return 'No indexed documents found. Upload and ingest documents first.';
    }

    async _handleDocumentRetrieval({ document_id }) {
        if (!document_id) return 'document_id is required.';

        // Try graph first — look up Document node by documentId or filename
        if (this.graphManager) {
            try {
                const session = this.graphManager._session();
                const res = await session.run(
                    `MATCH (d:Document)
                     WHERE d.documentId = $id OR d.filename = $id OR d.name = $id
                     RETURN d LIMIT 1`,
                    { id: document_id }
                );
                await session.close();

                if (res.records.length > 0) {
                    const props = res.records[0].get('d').properties;
                    return JSON.stringify(props, null, 2);
                }
            } catch (err) {
                console.warn('[QueryAgent] Document graph lookup failed:', err.message);
            }
        }

        return `Document "${document_id}" not found. Ensure it has been ingested.`;
    }

    // ── Main Query Method (Groq) ──────────────────────────────────────────────

    /**
     * Run the full tool-calling loop with Groq.
     *
     * @param {string} userQuestion
     * @returns {Promise<{answer, confidence, citations}>}
     */
    async _queryWithGroq(userQuestion) {
        const Groq = require('groq-sdk');
        const client = new Groq({ apiKey: getGroqKey() });

        const systemPrompt = `You are an expert industrial knowledge assistant for a manufacturing plant management system.
You have access to tools to query a Neo4j knowledge graph containing equipment data, maintenance records, incident reports, SOPs, and compliance regulations.

Guidelines:
- Always use the graph_query tool first to get factual data before answering.
- Use vector_search when you need context from documents or manuals.
- Cite specific equipment IDs, dates, and parameter values in your answer.
- If data is insufficient, say so clearly — do not hallucinate.
- Format your answer clearly with sections where appropriate.`;

        // Build initial messages
        const messages = [
            { role: 'system', content: systemPrompt },
            { role: 'user',   content: userQuestion },
        ];

        let toolRounds = 0;

        while (toolRounds < MAX_TOOL_ROUNDS) {
            const response = await client.chat.completions.create({
                model:       GROQ_MODEL,
                temperature: 0.2,
                max_tokens:  2000,
                tools:       TOOL_DEFINITIONS,
                tool_choice: 'auto',
                messages,
            });

            const message     = response.choices[0].message;
            const finishReason = response.choices[0].finish_reason;

            // Append assistant message to history
            messages.push(message);

            // If no more tool calls → we have our final answer
            if (finishReason !== 'tool_calls' || !message.tool_calls?.length) {
                return message.content || 'No answer generated.';
            }

            // Execute each tool call in parallel
            const toolResults = await Promise.all(
                message.tool_calls.map(async (toolCall) => {
                    const toolInput  = JSON.parse(toolCall.function.arguments || '{}');
                    const toolResult = await this.executeToolCall(toolCall.function.name, toolInput);
                    return {
                        role:         'tool',
                        tool_call_id: toolCall.id,
                        content:      truncate(toolResult, 3000),
                    };
                })
            );

            // Append tool results and loop again
            messages.push(...toolResults);
            toolRounds++;

            // Brief pause to avoid hammering the API
            await sleep(500);
        }

        return 'Maximum tool call rounds reached. Please rephrase your question.';
    }

    // ── Main Query Method (Gemini) ────────────────────────────────────────────

    /**
     * Run the full tool-calling loop with Gemini.
     *
     * @param {string} userQuestion
     * @returns {Promise<string>}
     */
    async _queryWithGemini(userQuestion) {
        const { GoogleGenerativeAI } = require('@google/generative-ai');
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

        const model = genAI.getGenerativeModel({
            model: GEMINI_MODEL,
            tools: [{ functionDeclarations: GEMINI_FUNCTION_DECLARATIONS }],
            systemInstruction: `You are an expert industrial knowledge assistant. Use tools to query the knowledge graph and answer questions about equipment, maintenance, incidents, and compliance.`,
        });

        const chat    = model.startChat();
        let   message = userQuestion;
        let   rounds  = 0;

        while (rounds < MAX_TOOL_ROUNDS) {
            const result  = await chat.sendMessage(message);
            const response = result.response;
            const parts    = response.candidates?.[0]?.content?.parts || [];

            // Find any function call parts
            const fnCalls = parts.filter(p => p.functionCall);

            if (fnCalls.length === 0) {
                // No more tool calls — extract text
                return parts.filter(p => p.text).map(p => p.text).join('');
            }

            // Execute tool calls and build function response parts
            const toolResponseParts = await Promise.all(
                fnCalls.map(async (part) => {
                    const name   = part.functionCall.name;
                    const args   = part.functionCall.args || {};
                    const result = await this.executeToolCall(name, args);
                    return {
                        functionResponse: {
                            name,
                            response: { result: truncate(result, 3000) },
                        },
                    };
                })
            );

            // Send results back as next message
            message = toolResponseParts;
            rounds++;
            await sleep(4200); // Gemini rate limit buffer
        }

        return 'Maximum tool call rounds reached. Please rephrase your question.';
    }

    // ── Public Query Entry Point ──────────────────────────────────────────────

    /**
     * Answer an industrial knowledge question using tool calling.
     *
     * Automatically chooses Groq → Gemini based on available API keys.
     * Falls back to a graph-only offline mode if no LLM key is set.
     *
     * @param {string} userQuestion
     * @returns {Promise<{answer: string, confidence: string, citations: string[], provider: string}>}
     */
    async query(userQuestion) {
        if (!userQuestion || userQuestion.trim() === '') {
            return buildAgentResponse('Please provide a question.', 'LOW');
        }

        console.log(`\n[QueryAgent] Question: ${userQuestion}`);
        console.log(`[QueryAgent] Provider: ${this.provider}`);

        try {
            let rawAnswer;

            if (this.provider === 'groq') {
                rawAnswer = await this._queryWithGroq(userQuestion);
            } else if (this.provider === 'gemini') {
                rawAnswer = await this._queryWithGemini(userQuestion);
            } else {
                // Offline mode — just query the graph directly without an LLM
                rawAnswer = await this._offlineFallback(userQuestion);
            }

            const confidence = extractConfidence(rawAnswer);
            const citations  = extractCitations(rawAnswer);

            console.log(`[QueryAgent] Answer generated. Confidence: ${confidence}, Citations: ${citations.length}`);

            return buildAgentResponse(rawAnswer, confidence, citations, {
                question: userQuestion,
            });

        } catch (error) {
            console.error('[QueryAgent] Query failed:', error.message);
            return buildAgentResponse(
                `An error occurred while processing your question: ${error.message}`,
                'LOW',
                [],
                { error: error.message }
            );
        }
    }

    // ── Offline Fallback ─────────────────────────────────────────────────────

    /**
     * When no LLM API key is available, answer directly using the graph.
     * Returns a structured summary rather than a natural language answer.
     *
     * @param {string} userQuestion
     * @returns {Promise<string>}
     */
    async _offlineFallback(userQuestion) {
        const lower = userQuestion.toLowerCase();

        // Try to parse an equipment ID from the question
        const eqId = parseEquipmentId(userQuestion);

        if (eqId && (lower.includes('fail') || lower.includes('incident') || lower.includes('broke'))) {
            const similar = await getSimilarIncidents(userQuestion, eqId, this.graphManager);
            if (similar.length > 0) {
                const rows = similar.slice(0, 5).map(s => ({
                    incident:   s.incident.name || s.incident.incidentId,
                    similarity: s.similarityScore,
                }));
                return `Similar incidents for "${eqId}":\n${formatQueryResults(rows)}`;
            }
        }

        if (eqId) {
            const history = await this.graphManager?.queryEquipmentHistory(eqId);
            if (history) {
                return [
                    `Equipment: ${history.equipment?.name || eqId}`,
                    `Failures (${history.failures.length}): ${history.failures.map(f => f.name).join(', ') || 'none'}`,
                    `Procedures (${history.procedures.length}): ${history.procedures.map(p => p.name).join(', ') || 'none'}`,
                    `Parameters (${history.parameters.length}): ${history.parameters.map(p => p.name).join(', ') || 'none'}`,
                ].join('\n');
            }
        }

        if (lower.includes('incident') || lower.includes('failure') || lower.includes('recent')) {
            const incidents = await this.graphManager?.getRecentIncidents(30) || [];
            if (incidents.length === 0) return 'No recent incidents found in the graph.';
            return `Recent incidents (last 30 days):\n${formatQueryResults(incidents)}`;
        }

        if (lower.includes('equipment') || lower.includes('pump') || lower.includes('machine')) {
            const equipment = await this.graphManager?.getAllEquipment() || [];
            if (equipment.length === 0) return 'No equipment nodes found in the graph.';
            return `Equipment in system:\n${formatQueryResults(equipment)}`;
        }

        return 'Offline mode: Set GROQ_API_KEY or GEMINI_API_KEY in .env for natural language answers.';
    }
}

module.exports = { QueryAgent };

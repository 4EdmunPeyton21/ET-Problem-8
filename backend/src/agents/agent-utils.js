'use strict';

/**
 * backend/src/agents/agent-utils.js
 *
 * Shared utility functions used across all AI agents.
 *
 * Includes:
 *  - Lightweight deterministic 384-dim embeddings (no external model needed)
 *  - In-memory cosine-similarity vector store (Pinecone-compatible interface)
 *  - Citation formatting, equipment ID parsing, graph query helpers
 */

require('dotenv').config();

// ---------------------------------------------------------------------------
// API Key Validators
// ---------------------------------------------------------------------------

function getGroqKey() {
    const key = process.env.GROQ_API_KEY || '';
    return key.startsWith('gsk_') && key.length > 20 ? key : null;
}

function getGeminiKey() {
    const key = process.env.GEMINI_API_KEY || '';
    return key.length > 20 && !key.includes('...') ? key : null;
}

function getActiveProvider() {
    if (getGroqKey())   return 'groq';
    if (getGeminiKey()) return 'gemini';
    return null;
}

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// Embedding Engine
// ---------------------------------------------------------------------------

/** In-memory embedding cache: text → Float32Array(384) */
const _embeddingCache = new Map();

/** In-memory vector store: [{ id, vector, text, metadata }] */
const _vectorStore = [];

/**
 * Generate a deterministic 384-dimensional embedding vector for text.
 *
 * Uses a character n-gram hashing trick — fast, no API calls, no model files.
 * For production, swap this with Groq/Gemini embedding API or @xenova/transformers.
 *
 * @param {string} text
 * @returns {Float32Array} 384-dim normalized vector
 */
async function getEmbedding(text) {
    if (!text || text.trim() === '') return new Float32Array(384).fill(0);

    const normalized = text.toLowerCase().trim();
    if (_embeddingCache.has(normalized)) {
        return _embeddingCache.get(normalized);
    }

    const DIM    = 384;
    const vector = new Float32Array(DIM);

    // ── Bag-of-character-trigrams with polynomial rolling hash ────────────────
    for (let i = 0; i < normalized.length - 2; i++) {
        const trigram = normalized.substring(i, i + 3);
        let   hash    = 0;
        for (let j = 0; j < trigram.length; j++) {
            hash = (Math.imul(31, hash) + trigram.charCodeAt(j)) >>> 0;
        }
        const slot = hash % DIM;
        vector[slot] += 1.0;
    }

    // ── Add token-level features (word unigrams) ──────────────────────────────
    const tokens = normalized.split(/\s+/);
    for (const token of tokens) {
        let hash = 5381;
        for (let j = 0; j < token.length; j++) {
            hash = (Math.imul(33, hash) ^ token.charCodeAt(j)) >>> 0;
        }
        vector[hash % DIM] += 2.0; // weight word features more than char trigrams
    }

    // ── L2-normalize so cosine similarity works correctly ────────────────────
    let magnitude = 0;
    for (let i = 0; i < DIM; i++) magnitude += vector[i] * vector[i];
    magnitude = Math.sqrt(magnitude) || 1;
    for (let i = 0; i < DIM; i++) vector[i] /= magnitude;

    _embeddingCache.set(normalized, vector);
    return vector;
}

// ---------------------------------------------------------------------------
// Vector Store & Search
// ---------------------------------------------------------------------------

/**
 * Add a document to the in-memory vector store.
 *
 * @param {string} documentId
 * @param {string} text
 * @param {Object} metadata
 */
async function indexDocument(documentId, text, metadata = {}) {
    const vector = await getEmbedding(text);
    // Remove existing entry for this ID if present (upsert behaviour)
    const existing = _vectorStore.findIndex(e => e.id === documentId);
    if (existing !== -1) _vectorStore.splice(existing, 1);
    _vectorStore.push({ id: documentId, vector, text, metadata });
}

/**
 * Compute cosine similarity between two Float32Arrays.
 *
 * @param {Float32Array} a
 * @param {Float32Array} b
 * @returns {number} Score in [-1, 1] (1 = identical direction)
 */
function cosineSimilarity(a, b) {
    let dot = 0;
    for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
    return dot; // vectors are already L2-normalised by getEmbedding()
}

/**
 * Perform semantic (vector) search across indexed documents.
 *
 * If a real vectorClient (Pinecone, Weaviate, etc.) is provided, delegates to it.
 * Otherwise uses the in-memory store as fallback.
 *
 * @param {string}      query
 * @param {Object|null} vectorClient  - Optional real vector DB client
 * @param {number}      topK          - Number of results to return
 * @returns {Promise<Array<{documentId, text, score, metadata}>>}
 */
async function vectorSearch(query, vectorClient = null, topK = 5) {
    if (!query || query.trim() === '') return [];

    // ── Delegate to real vector client if provided ────────────────────────────
    if (vectorClient) {
        try {
            const queryVector = await getEmbedding(query);
            const results     = await vectorClient.query({
                vector:          Array.from(queryVector),
                topK,
                includeMetadata: true,
            });
            return (results.matches || results).map(m => ({
                documentId: m.id,
                text:       m.metadata?.text || '',
                score:      m.score,
                metadata:   m.metadata || {},
            }));
        } catch (err) {
            console.warn('[agent-utils] vectorClient search failed, falling back to in-memory:', err.message);
        }
    }

    // ── In-memory cosine similarity search ───────────────────────────────────
    if (_vectorStore.length === 0) {
        return [];
    }

    const queryVector = await getEmbedding(query);
    const scored      = _vectorStore.map(entry => ({
        documentId: entry.id,
        text:       entry.text,
        score:      cosineSimilarity(queryVector, entry.vector),
        metadata:   entry.metadata,
    }));

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK).filter(r => r.score > 0.1);
}

// ---------------------------------------------------------------------------
// Citation Formatting
// ---------------------------------------------------------------------------

/**
 * Enrich citation references in text with page/source attribution.
 *
 * Input:  "See [DOC-001] for details."
 * Output: "See [DOC-001, Page 3 — maintenance_log_pump.txt] for details."
 *
 * @param {string} text        - Agent response text
 * @param {Object} references  - Map of docId → { page, filename, source }
 * @returns {string}
 */
function formatCitations(text, references = {}) {
    if (!text) return text;

    return text.replace(/\[([A-Z]{2,6}-[A-Z0-9-]+)\]/g, (match, id) => {
        const ref = references[id];
        if (!ref) return match;

        const parts = [id];
        if (ref.page)     parts.push(`Page ${ref.page}`);
        if (ref.filename) parts.push(ref.filename);
        else if (ref.source) parts.push(ref.source);

        return `[${parts.join(', ')}]`;
    });
}

// ---------------------------------------------------------------------------
// Equipment ID Parsing
// ---------------------------------------------------------------------------

/**
 * Extract equipment tag IDs from natural language user text.
 *
 * Handles patterns like:
 *   "PUMP-XYZ", "Pump Unit XYZ", "pump xyz", "P-201", "V-101", "motor M-03"
 *
 * @param {string} text
 * @returns {string|null} Extracted equipment ID, or null if none found
 */
function parseEquipmentId(text) {
    if (!text) return null;

    // Priority 1: Formal tag IDs (e.g. PUMP-XYZ-2019, V-101, P-201A)
    const formalTag = text.match(/\b([A-Z]{1,6}-[A-Z0-9]{2,8}(?:-[A-Z0-9]{1,6})?)\b/);
    if (formalTag) return formalTag[1];

    // Priority 2: "Pump Unit XYZ", "Valve Unit 101", "motor unit M03"
    // Captures: type + Unit + ID → forms "TYPE-ID"
    const unitPattern = text.match(/\b(pump|motor|valve|compressor|blower|vessel|tank)\s+unit\s+([A-Z0-9-]{2,})\b/i);
    if (unitPattern) {
        const type = unitPattern[1].toUpperCase().substring(0, 4); // e.g. PUMP
        const id   = unitPattern[2].toUpperCase();
        return `${type}-${id}`;
    }

    // Priority 3: "motor M-03", "pump XYZ", "compressor C12"
    const shortPattern = text.match(/\b(?:pump|motor|valve|compressor|unit|vessel|tank)\s+([A-Z0-9-]{2,})\b/i);
    if (shortPattern) return shortPattern[1].toUpperCase();

    // Priority 4: Named equipment WITH a trailing tag e.g. "Centrifugal Pump PUMP-XYZ" or "Air Compressor C-12"
    const namedEquip = text.match(/\b(Centrifugal Pump|Air Compressor|Heat Exchanger|Ball Valve|Check Valve|Drive Motor)\s+([A-Z0-9-]{2,})\b/i);
    if (namedEquip && namedEquip[2]) {
        return namedEquip[2].trim();
    }

    return null;
}

// ---------------------------------------------------------------------------
// Similar Incidents Finder
// ---------------------------------------------------------------------------

/**
 * Find incidents in the graph that are similar to a given symptom.
 * Combines graph query + cosine similarity on symptom text.
 *
 * @param {string}       symptom      - Description of the problem (e.g. "cavitation noise")
 * @param {string|null}  equipmentId  - Optional — narrow to this equipment
 * @param {GraphManager} graphManager - GraphManager instance
 * @returns {Promise<Array<{incident, similarityScore}>>}
 */
async function getSimilarIncidents(symptom, equipmentId, graphManager) {
    if (!graphManager) return [];

    try {
        const session = graphManager._session();

        // Fetch all incident nodes (with optional equipment filter)
        let cypher, params;
        if (equipmentId) {
            cypher = `
                MATCH (e:Equipment)-[:FAILED_DUE_TO|FAILED_AT]->(i:Incident)
                WHERE e.equipmentId = $eqId OR e.name = $eqId
                RETURN i
                LIMIT 100
            `;
            params = { eqId: equipmentId };
        } else {
            cypher = 'MATCH (i:Incident) RETURN i LIMIT 100';
            params = {};
        }

        const result    = await session.run(cypher, params);
        await session.close();

        const incidents = result.records.map(r => r.get('i').properties);
        if (incidents.length === 0) return [];

        // Score each incident by cosine similarity to the symptom
        const queryVec  = await getEmbedding(symptom);
        const scored    = await Promise.all(
            incidents.map(async (inc) => {
                const incText  = [inc.name, inc.description, inc.title].filter(Boolean).join(' ');
                const incVec   = await getEmbedding(incText);
                const score    = cosineSimilarity(queryVec, incVec);
                return { incident: inc, similarityScore: Math.round(score * 100) / 100 };
            })
        );

        scored.sort((a, b) => b.similarityScore - a.similarityScore);
        return scored.filter(s => s.similarityScore > 0.05);

    } catch (err) {
        console.error('[agent-utils] getSimilarIncidents failed:', err.message);
        return [];
    }
}

// ---------------------------------------------------------------------------
// Graph Query Helper
// ---------------------------------------------------------------------------

/**
 * Execute a pre-defined graph query by type and return structured results.
 *
 * @param {GraphManager} graphManager
 * @param {string}       equipmentId
 * @param {'failures'|'procedures'|'timeline'|'compliance'} queryType
 * @returns {Promise<Object>}
 */
async function queryGraph(graphManager, equipmentId, queryType) {
    if (!graphManager) return { error: 'GraphManager not available.' };

    const session = graphManager._session();

    try {
        let cypher, params;

        switch (queryType) {
            case 'failures':
                cypher = `
                    MATCH (e:Equipment)-[r:FAILED_DUE_TO|FAILED_AT]->(i:Incident)
                    WHERE e.equipmentId = $id OR e.name = $id
                    OPTIONAL MATCH (i)-[:OCCURRED_ON]->(d)
                    RETURN i.name AS incident, i.severity AS severity,
                           d.name AS date, r.evidence AS evidence
                    ORDER BY d.name DESC
                `;
                params = { id: equipmentId };
                break;

            case 'procedures':
                cypher = `
                    MATCH (e:Equipment)-[:REQUIRES]->(p:Procedure)
                    WHERE e.equipmentId = $id OR e.name = $id
                    OPTIONAL MATCH (p)-[:COMPLIES_WITH]->(reg)
                    RETURN p.name AS procedure, p.frequency AS frequency,
                           collect(reg.name) AS regulations
                `;
                params = { id: equipmentId };
                break;

            case 'timeline':
                cypher = `
                    MATCH (e:Equipment)
                    WHERE e.equipmentId = $id OR e.name = $id
                    OPTIONAL MATCH (e)-[:FAILED_DUE_TO|FAILED_AT]->(i:Incident)-[:OCCURRED_ON]->(d)
                    OPTIONAL MATCH (e)-[:MEASURED_PARAMETER|HAS_PARAMETER]->(p:Parameter)
                    RETURN i.name AS incident, d.name AS date,
                           collect(p.name + '=' + p.value) AS parameters
                    ORDER BY d.name DESC
                `;
                params = { id: equipmentId };
                break;

            case 'compliance':
                cypher = `
                    MATCH (e:Equipment)-[:REQUIRES]->(proc:Procedure)-[:COMPLIES_WITH]->(reg:Regulation)
                    WHERE e.equipmentId = $id OR e.name = $id
                    RETURN proc.name AS procedure, reg.name AS regulation,
                           reg.standard AS standard
                `;
                params = { id: equipmentId };
                break;

            default:
                return { error: `Unknown queryType: ${queryType}. Use: failures, procedures, timeline, compliance` };
        }

        const result = await session.run(cypher, params);
        const rows   = result.records.map(r => {
            const obj = {};
            r.keys.forEach(key => {
                const val = r.get(key);
                obj[key]  = Array.isArray(val) ? val.join(', ') : (val ?? '');
            });
            return obj;
        });

        return { queryType, equipmentId, results: rows, count: rows.length };

    } catch (err) {
        console.error(`[agent-utils] queryGraph(${queryType}) failed:`, err.message);
        return { error: err.message };
    } finally {
        await session.close();
    }
}

// ---------------------------------------------------------------------------
// Text Helpers
// ---------------------------------------------------------------------------

/**
 * Extract confidence level from an agent's response text.
 *
 * @param {string} text
 * @returns {'HIGH'|'MEDIUM'|'LOW'}
 */
function extractConfidence(text) {
    if (!text) return 'LOW';
    const lower = text.toLowerCase();
    if (lower.includes('high confidence') || lower.includes('clearly') || lower.includes('definitively')) return 'HIGH';
    if (lower.includes('low confidence')  || lower.includes('uncertain') || lower.includes('unclear'))    return 'LOW';
    if (lower.includes('likely') || lower.includes('probably') || lower.includes('appears to'))          return 'MEDIUM';
    const hasData = /\b\d+(?:\.\d+)?\s*(?:bar|psi|°C|rpm|L\/min|kW)\b/i.test(text) || /\b[A-Z]+-[A-Z0-9-]+\b/.test(text);
    if (hasData)         return 'HIGH';
    if (text.length > 400) return 'MEDIUM';
    return 'LOW';
}

/**
 * Extract document citation references from agent response text.
 *
 * @param {string} text
 * @returns {string[]} Array of unique citation strings
 */
function extractCitations(text) {
    if (!text) return [];
    const found = new Set();
    const patterns = [/\[DOC-[A-Z0-9-]+\]/gi, /\[INC-[A-Z0-9-]+\]/gi, /\[SOP-[A-Z0-9-]+\]/gi, /\[REG-[A-Z0-9-]+\]/gi, /\[[A-Z]{2,6}-[A-Z0-9-]{2,}\]/gi];
    for (const p of patterns) (text.match(p) || []).forEach(m => found.add(m));
    return Array.from(found);
}

/**
 * Truncate text to max length with ellipsis.
 *
 * @param {string} text
 * @param {number} maxLen
 * @returns {string}
 */
function truncate(text, maxLen = 500) {
    if (!text || text.length <= maxLen) return text;
    return text.substring(0, maxLen).trimEnd() + ' ...';
}

/**
 * Format result rows as a Markdown table.
 *
 * @param {Array}  rows
 * @param {string} noDataMsg
 * @returns {string}
 */
function formatQueryResults(rows, noDataMsg = 'No data found.') {
    if (!rows || rows.length === 0) return noDataMsg;
    const keys    = Object.keys(rows[0]);
    const header  = '| ' + keys.join(' | ') + ' |';
    const divider = '|' + keys.map(() => '---|').join('');
    const body    = rows.map(row => '| ' + keys.map(k => String(row[k] ?? '')).join(' | ') + ' |').join('\n');
    return [header, divider, body].join('\n');
}

/**
 * Build a standardized agent response envelope.
 *
 * @param {string}   answer
 * @param {string}   confidence
 * @param {string[]} citations
 * @param {Object}   metadata
 * @returns {Object}
 */
function buildAgentResponse(answer, confidence = 'MEDIUM', citations = [], metadata = {}) {
    return {
        answer,
        confidence,
        citations,
        timestamp: new Date().toISOString(),
        provider:  getActiveProvider(),
        ...metadata,
    };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
    // API utils
    getGroqKey,
    getGeminiKey,
    getActiveProvider,
    sleep,

    // Embedding & vector search
    getEmbedding,
    indexDocument,
    vectorSearch,
    cosineSimilarity,

    // Citation & text
    formatCitations,
    extractConfidence,
    extractCitations,
    truncate,
    formatQueryResults,
    buildAgentResponse,

    // Domain helpers
    parseEquipmentId,
    getSimilarIncidents,
    queryGraph,
};

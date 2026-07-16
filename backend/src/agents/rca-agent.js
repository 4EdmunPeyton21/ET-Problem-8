'use strict';

/**
 * backend/src/agents/rca-agent.js
 *
 * Root Cause Analysis (RCA) Agent for Industrial Equipment Failures.
 *
 * Given a symptom description (e.g. "pump overheating and vibration"),
 * this agent:
 *   1. Fetches the equipment's full failure history from Neo4j
 *   2. Searches historical incidents using vector similarity
 *   3. Uses Groq/Gemini to reason about probable root causes
 *   4. Returns a structured RCA report with diagnostic steps
 *
 * MODES:
 *  1. Groq   — primary (llama-3.3-70b-versatile)
 *  2. Gemini — secondary fallback
 *  3. Heuristic — rule-based fallback when no API key is available
 *
 * Usage:
 *   const agent = new RCAAgent(graphManager, vectorClient);
 *   const result = await agent.analyzeIncident('pump overheating and vibration', 'PUMP-XYZ');
 */

require('dotenv').config();

const {
    getGroqKey,
    getGeminiKey,
    getActiveProvider,
    sleep,
    vectorSearch,
    getEmbedding,
    cosineSimilarity,
    extractConfidence,
    getSimilarIncidents,
} = require('./agent-utils');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GROQ_MODEL   = process.env.GROQ_MODEL   || 'llama-3.3-70b-versatile';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash';

const LIKELIHOOD_LEVELS = ['HIGH', 'MEDIUM', 'LOW'];
const CONFIDENCE_LEVELS = ['HIGH', 'MEDIUM', 'LOW'];

// ---------------------------------------------------------------------------
// Domain Knowledge Base (used by heuristic fallback)
// ---------------------------------------------------------------------------

const HEURISTIC_CAUSES = [
    {
        symptoms: ['overheating', 'high temperature', 'heat', 'thermal'],
        causes: [
            { cause: 'Insufficient lubrication or lubricant degradation', likelihood: 'HIGH', evidence: 'High temperature is a classic sign of lubrication failure in rotating equipment.' },
            { cause: 'Bearing wear or failure', likelihood: 'HIGH', evidence: 'Failing bearings generate excess friction, leading to rapid heat buildup.' },
            { cause: 'Blocked cooling passages or fouled heat exchanger', likelihood: 'MEDIUM', evidence: 'Reduced cooling flow forces operating temperature above design limits.' },
            { cause: 'Motor overload or voltage imbalance', likelihood: 'MEDIUM', evidence: 'Electrical anomalies increase stator winding temperature.' },
        ],
        diagnostic: ['Check lubricant level and condition (colour, viscosity)', 'Measure bearing temperature with IR thermometer', 'Inspect cooling water flow and heat exchanger fins', 'Record operating current vs. nameplate rating'],
        preventive: ['Implement oil analysis programme (quarterly)', 'Install bearing temperature sensors with DCS alarm', 'Clean heat exchanger fins every 6 months'],
    },
    {
        symptoms: ['vibration', 'noise', 'oscillation', 'shaking', 'resonance'],
        causes: [
            { cause: 'Rotor imbalance (mass or geometric)', likelihood: 'HIGH', evidence: 'Imbalance is the most common cause of 1× vibration at running speed.' },
            { cause: 'Bearing defect (inner race, outer race, or rolling element)', likelihood: 'HIGH', evidence: 'Bearing defects produce characteristic sub-harmonic vibration signatures.' },
            { cause: 'Misalignment between pump and driver', likelihood: 'HIGH', evidence: 'Misalignment typically shows 2× or high axial vibration components.' },
            { cause: 'Loose foundation bolts or structural resonance', likelihood: 'MEDIUM', evidence: 'Structure-borne resonance amplifies otherwise normal vibration.' },
            { cause: 'Cavitation (pump specific)', likelihood: 'MEDIUM', evidence: 'Cavitation produces random broadband vibration and crackling noise.' },
        ],
        diagnostic: ['Record vibration spectrum (FFT) at bearing pedestals', 'Check coupling alignment with dial indicator or laser tool', 'Inspect foundation bolts torque', 'Check inlet suction pressure for cavitation signs'],
        preventive: ['Establish vibration baseline at commissioning', 'Implement ISO 10816-1 alarm and shutdown limits in DCS', 'Quarterly alignment checks after any maintenance'],
    },
    {
        symptoms: ['cavitation', 'low flow', 'pressure drop', 'suction', 'noise crackling'],
        causes: [
            { cause: 'Insufficient NPSH available (NPSHa < NPSHr)', likelihood: 'HIGH', evidence: 'Cavitation occurs when suction pressure drops below vapour pressure of the fluid.' },
            { cause: 'Clogged or partially closed suction valve', likelihood: 'HIGH', evidence: 'Restriction on suction side reduces inlet pressure and triggers cavitation.' },
            { cause: 'Air ingress through suction line leaks', likelihood: 'MEDIUM', evidence: 'Air pockets cause intermittent flow loss and characteristic crackling.' },
            { cause: 'Pump operating far right of curve (high flow)', likelihood: 'MEDIUM', evidence: 'Running beyond BEP reduces internal pressure and promotes cavitation.' },
        ],
        diagnostic: ['Measure suction and discharge pressure with calibrated gauge', 'Check suction line for air leaks (listen with ultrasound probe)', 'Compare actual flow with rated flow on pump curve', 'Inspect and clear suction strainer/filter'],
        preventive: ['Install low-suction-pressure shutdown interlock', 'Implement quarterly strainer cleaning schedule', 'Monitor flow vs. pump curve in SCADA'],
    },
    {
        symptoms: ['leakage', 'seal failure', 'fluid loss', 'drip', 'wet'],
        causes: [
            { cause: 'Mechanical seal face wear or damage', likelihood: 'HIGH', evidence: 'Seal faces degrade over time, especially with dry running or abrasive fluids.' },
            { cause: 'O-ring or gasket deterioration', likelihood: 'HIGH', evidence: 'Elastomer degradation causes static seal failure at flange joints.' },
            { cause: 'Shaft deflection causing seal misalignment', likelihood: 'MEDIUM', evidence: 'Excessive bearing wear allows shaft to deflect, opening seal gap.' },
            { cause: 'Excessive vibration damaging seal faces', likelihood: 'MEDIUM', evidence: 'Vibration-induced fretting erodes soft seal face material.' },
        ],
        diagnostic: ['Identify leak source (shaft seal, flange, or body)', 'Check seal flush plan flow and temperature', 'Measure shaft runout', 'Review seal installation date vs. MTBF'],
        preventive: ['Implement seal flush monitoring with flow switch', 'Log MTBF per seal type and switch to longer-life design', 'Train maintenance staff on mechanical seal handling'],
    },
    {
        symptoms: ['corrosion', 'rust', 'erosion', 'pitting', 'deterioration', 'degradation'],
        causes: [
            { cause: 'Corrosive process fluid or contamination', likelihood: 'HIGH', evidence: 'pH excursion or chloride contamination rapidly attacks carbon steel.' },
            { cause: 'Erosion by particulate-laden fluid', likelihood: 'HIGH', evidence: 'Hard particles erode impeller leading edge and casing wear ring.' },
            { cause: 'Galvanic corrosion from dissimilar metals', likelihood: 'MEDIUM', evidence: 'Electrochemical cell forms where different metals contact in electrolyte.' },
            { cause: 'Inadequate corrosion-resistant coating or material selection', likelihood: 'MEDIUM', evidence: 'Material not rated for the operating fluid or temperature range.' },
        ],
        diagnostic: ['Sample process fluid for pH, chloride, and particulate content', 'Perform ultrasonic wall thickness measurement on casing', 'Inspect coating integrity with holiday detector', 'Review material compatibility with current process conditions'],
        preventive: ['Implement ISO 4406 oil cleanliness monitoring', 'Install corrosion coupons in process lines', 'Specify material of construction based on fluid compatibility data'],
    },
];

// ---------------------------------------------------------------------------
// RCAAgent Class
// ---------------------------------------------------------------------------

class RCAAgent {

    /**
     * @param {GraphManager}  graphManager  - Neo4j graph manager instance
     * @param {Object|null}   vectorClient  - Optional real vector DB client
     * @param {Object|null}   llmClient     - Optional pre-configured LLM client
     */
    constructor(graphManager, vectorClient = null, llmClient = null) {
        this.graphManager = graphManager;
        this.vectorClient = vectorClient;
        this.llmClient    = llmClient;
        this.provider     = getActiveProvider();

        console.log(`[RCAAgent] Initialized. Provider: ${this.provider || 'heuristic'}`);
    }

    // ── Data Gathering ────────────────────────────────────────────────────────

    /**
     * Pull the full failure history for a piece of equipment from Neo4j.
     *
     * @param {string} equipmentId
     * @returns {Promise<Object>}
     */
    async _getEquipmentHistory(equipmentId) {
        if (!this.graphManager || !equipmentId) return null;

        try {
            return await this.graphManager.queryEquipmentHistory(equipmentId);
        } catch (err) {
            console.warn('[RCAAgent] Could not query equipment history:', err.message);
            return null;
        }
    }

    /**
     * Query Neo4j for all historical incidents with their RCA documents.
     *
     * @param {string|null} equipmentId  - Optional filter by equipment
     * @returns {Promise<Array>}
     */
    async _getHistoricalRCADocs(equipmentId = null) {
        if (!this.graphManager) return [];

        const session = this.graphManager._session();
        try {
            const cypher = equipmentId
                ? `MATCH (e:Equipment)-[:FAILED_DUE_TO|FAILED_AT]->(i:Incident)
                   WHERE e.equipmentId = $id OR e.name = $id
                   OPTIONAL MATCH (doc:Document)-[:DOCUMENTS]->(i)
                   OPTIONAL MATCH (i)-[:OCCURRED_ON]->(d)
                   RETURN i.name AS incidentName, i.incidentId AS incidentId,
                          i.description AS description, i.severity AS severity,
                          d.name AS date, doc.documentId AS docId, doc.filename AS docFile
                   ORDER BY d.name DESC LIMIT 20`
                : `MATCH (e:Equipment)-[:FAILED_DUE_TO|FAILED_AT]->(i:Incident)
                   OPTIONAL MATCH (doc:Document)-[:DOCUMENTS]->(i)
                   OPTIONAL MATCH (i)-[:OCCURRED_ON]->(d)
                   RETURN i.name AS incidentName, i.incidentId AS incidentId,
                          i.description AS description, i.severity AS severity,
                          e.name AS equipment, d.name AS date,
                          doc.documentId AS docId, doc.filename AS docFile
                   ORDER BY d.name DESC LIMIT 30`;

            const result = await session.run(cypher, equipmentId ? { id: equipmentId } : {});
            return result.records.map(r => {
                const obj = {};
                r.keys.forEach(k => { obj[k] = r.get(k) ?? null; });
                return obj;
            });
        } catch (err) {
            console.warn('[RCAAgent] Could not query historical RCA docs:', err.message);
            return [];
        } finally {
            await session.close();
        }
    }

    // ── Similar Incidents ────────────────────────────────────────────────────

    /**
     * Find top-K historical incidents most similar to the given symptom text.
     * Uses vector cosine similarity with a graph-text fallback.
     *
     * @param {string}      symptomText  - Free-text symptom description
     * @param {string|null} equipmentId  - Optional equipment filter
     * @param {number}      topK         - Number of results to return
     * @returns {Promise<Array<{incidentId, date, symptoms, rootCause, rcaLink, similarityScore}>>}
     */
    async getSimilarIncidents(symptomText, equipmentId = null, topK = 5) {
        // ── Try vector store first (agent-utils implementation) ───────────────
        try {
            const vsResults = await vectorSearch(symptomText, this.vectorClient, topK * 2);
            if (vsResults.length > 0) {
                return vsResults
                    .filter(r => r.metadata?.type === 'incident' || r.documentId?.toLowerCase().includes('inc'))
                    .slice(0, topK)
                    .map(r => ({
                        incidentId:      r.documentId,
                        date:            r.metadata?.date || null,
                        symptoms:        r.metadata?.symptoms || [r.text?.substring(0, 100)],
                        rootCause:       r.metadata?.rootCause || null,
                        rcaLink:         r.metadata?.rcaLink || null,
                        similarityScore: Math.round(r.score * 100) / 100,
                    }));
            }
        } catch (err) {
            console.warn('[RCAAgent] Vector search failed:', err.message);
        }

        // ── Fallback: graph cosine similarity via getSimilarIncidents util ────
        const graphSimilar = await getSimilarIncidents(symptomText, equipmentId, this.graphManager);
        if (graphSimilar.length > 0) {
            return graphSimilar.slice(0, topK).map(s => ({
                incidentId:      s.incident.incidentId || s.incident.name,
                date:            s.incident.date       || s.incident.createdAt || null,
                symptoms:        [s.incident.name, s.incident.description].filter(Boolean),
                rootCause:       s.incident.rootCause  || null,
                rcaLink:         s.incident.documentId || null,
                similarityScore: s.similarityScore,
            }));
        }

        // ── Last resort: keyword overlap on historical RCA docs ───────────────
        const histDocs  = await this._getHistoricalRCADocs(equipmentId);
        if (histDocs.length === 0) return [];

        const queryVec  = await getEmbedding(symptomText);
        const scored    = await Promise.all(histDocs.map(async doc => {
            const docText = [doc.incidentName, doc.description].filter(Boolean).join(' ');
            const docVec  = await getEmbedding(docText);
            return {
                incidentId:      doc.incidentId || doc.incidentName,
                date:            doc.date,
                symptoms:        [doc.incidentName, doc.description].filter(Boolean),
                rootCause:       doc.description || null,
                rcaLink:         doc.docId       || null,
                similarityScore: Math.round(cosineSimilarity(queryVec, docVec) * 100) / 100,
            };
        }));

        scored.sort((a, b) => b.similarityScore - a.similarityScore);
        return scored.filter(s => s.similarityScore > 0.05).slice(0, topK);
    }

    // ── LLM Reasoning ────────────────────────────────────────────────────────

    /** Build the structured prompt for RCA reasoning */
    _buildRCAPrompt(symptomDescription, equipmentId, equipmentHistory, similarIncidents) {
        const historyText = equipmentHistory
            ? `Equipment "${equipmentHistory.equipment?.name || equipmentId}":
  Status:     ${equipmentHistory.equipment?.status || 'unknown'}
  Location:   ${equipmentHistory.equipment?.location || 'unknown'}
  Past failures (${equipmentHistory.failures.length}): ${equipmentHistory.failures.map(f => f.name).join(', ') || 'none'}
  Procedures  (${equipmentHistory.procedures.length}): ${equipmentHistory.procedures.map(p => p.name).join(', ') || 'none'}
  Parameters  (${equipmentHistory.parameters.length}): ${equipmentHistory.parameters.map(p => `${p.name}=${p.value}${p.unit || ''}`).join(', ') || 'none'}`
            : `No equipment history available for "${equipmentId}".`;

        const similarText = similarIncidents.length > 0
            ? similarIncidents.map((inc, i) =>
                `  ${i + 1}. [score:${inc.similarityScore}] ${inc.incidentId || 'UNKNOWN'} (${inc.date || 'no date'})\n` +
                `     Symptoms:   ${Array.isArray(inc.symptoms) ? inc.symptoms.join(', ') : inc.symptoms}\n` +
                `     Root Cause: ${inc.rootCause || 'not recorded'}\n` +
                `     RCA Doc:    ${inc.rcaLink || 'none'}`
            ).join('\n\n')
            : '  No similar historical incidents found in the knowledge graph.';

        return `REPORTED SYMPTOMS:
${symptomDescription}

EQUIPMENT HISTORY:
${historyText}

SIMILAR HISTORICAL INCIDENTS (sorted by similarity):
${similarText}

Based on the symptoms, equipment history, and similar past incidents, perform a Root Cause Analysis.
Return ONLY the JSON object described in the system prompt.`;
    }

    /**
     * Reason with Groq about root causes.
     */
    async _reasonWithGroq(symptomDescription, equipmentId, equipmentHistory, similarIncidents) {
        const Groq   = require('groq-sdk');
        const client = new Groq({ apiKey: getGroqKey() });

        const systemPrompt = `You are a senior Root Cause Analysis (RCA) engineer specializing in industrial rotating equipment (pumps, compressors, motors, valves).

Given:
- Reported symptoms from a plant operator
- Equipment's historical failure record
- Similar past incidents from the knowledge graph

Your task: Identify the most probable root causes, ranked by likelihood.

Return ONLY valid JSON with this exact schema:
{
  "symptoms": ["extracted symptom 1", "symptom 2"],
  "similarHistoricalIncidents": [
    {
      "incidentId": "string",
      "date": "ISO string or null",
      "symptoms": ["symptom 1"],
      "rootCause": "string or null",
      "rcaLink": "document ID or null",
      "similarityScore": 0.0
    }
  ],
  "probableRootCauses": [
    {
      "cause": "specific root cause description",
      "likelihood": "HIGH|MEDIUM|LOW",
      "evidence": "why this cause fits the symptoms and history"
    }
  ],
  "diagnosticSteps": [
    "Step 1: specific diagnostic action with expected finding",
    "Step 2: ..."
  ],
  "preventiveMeasures": [
    "Preventive action 1 with frequency and method"
  ],
  "confidenceLevel": "HIGH|MEDIUM|LOW"
}

Be specific and technical. Reference equipment IDs, parameters, and standards where relevant.`;

        const userPrompt = this._buildRCAPrompt(symptomDescription, equipmentId, equipmentHistory, similarIncidents);

        let delay = 4000;
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                const response = await client.chat.completions.create({
                    model:           GROQ_MODEL,
                    temperature:     0.15,
                    max_tokens:      2000,
                    response_format: { type: 'json_object' },
                    messages: [
                        { role: 'system', content: systemPrompt },
                        { role: 'user',   content: userPrompt   },
                    ],
                });
                return JSON.parse(response.choices[0].message.content);
            } catch (error) {
                const is429 = error.message?.includes('429') || error.message?.includes('rate_limit');
                if (is429 && attempt < 3) {
                    console.warn(`[RCAAgent] Groq rate limited. Waiting ${delay / 1000}s...`);
                    await sleep(delay);
                    delay *= 2;
                } else {
                    throw error;
                }
            }
        }
    }

    /**
     * Reason with Gemini about root causes (secondary fallback).
     */
    async _reasonWithGemini(symptomDescription, equipmentId, equipmentHistory, similarIncidents) {
        const { GoogleGenerativeAI } = require('@google/generative-ai');
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({
            model: GEMINI_MODEL,
            generationConfig: {
                temperature:      0.15,
                maxOutputTokens:  2000,
                responseMimeType: 'application/json',
            },
            systemInstruction: `You are a senior industrial RCA engineer. Return ONLY a JSON object with keys: symptoms, similarHistoricalIncidents, probableRootCauses, diagnosticSteps, preventiveMeasures, confidenceLevel.`,
        });

        const prompt = this._buildRCAPrompt(symptomDescription, equipmentId, equipmentHistory, similarIncidents);

        let delay = 4200;
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                const result = await model.generateContent(prompt);
                const raw    = result.response.text();
                const start  = raw.indexOf('{');
                const end    = raw.lastIndexOf('}');
                if (start === -1) throw new Error('No JSON object in Gemini response');
                return JSON.parse(raw.substring(start, end + 1));
            } catch (error) {
                const is429 = error.message?.includes('429');
                if (is429 && attempt < 3) {
                    console.warn(`[RCAAgent] Gemini rate limited. Waiting ${delay / 1000}s...`);
                    await sleep(delay);
                    delay *= 2;
                } else { throw error; }
            }
        }
    }

    /**
     * Heuristic RCA when no API key is available.
     * Uses the HEURISTIC_CAUSES knowledge base.
     */
    _heuristicRCA(symptomDescription, similarIncidents) {
        const lower    = symptomDescription.toLowerCase();
        const matched  = [];
        const symptoms = [];

        for (const entry of HEURISTIC_CAUSES) {
            const matchedKeywords = entry.symptoms.filter(kw => lower.includes(kw));
            if (matchedKeywords.length > 0) {
                matched.push({ entry, score: matchedKeywords.length });
                symptoms.push(...matchedKeywords);
            }
        }

        matched.sort((a, b) => b.score - a.score);
        const topEntry  = matched[0]?.entry;

        const causes    = topEntry?.causes        || [{ cause: 'Root cause undetermined — insufficient data', likelihood: 'LOW', evidence: 'No matching symptom patterns found.' }];
        const diag      = topEntry?.diagnostic    || ['Inspect equipment visually', 'Check operating parameters against design spec'];
        const prev      = topEntry?.preventive    || ['Implement predictive maintenance programme'];

        const confidence = matched.length > 1 ? 'MEDIUM' : matched.length === 1 ? 'MEDIUM' : 'LOW';

        return {
            symptoms:                  [...new Set(symptoms)].length > 0 ? [...new Set(symptoms)] : [symptomDescription],
            similarHistoricalIncidents: similarIncidents.slice(0, 5),
            probableRootCauses:        causes,
            diagnosticSteps:           diag,
            preventiveMeasures:        prev,
            confidenceLevel:           confidence,
        };
    }

    // ── Result Normalization ──────────────────────────────────────────────────

    _normalizeResult(raw, symptomDescription, similarIncidents) {
        const likelihood = v => LIKELIHOOD_LEVELS.includes(v) ? v : 'MEDIUM';
        const confidence = v => CONFIDENCE_LEVELS.includes(v) ? v : 'MEDIUM';

        const causes = (raw.probableRootCauses || []).map(c => ({
            cause:      String(c.cause      || ''),
            likelihood: likelihood(c.likelihood),
            evidence:   String(c.evidence   || ''),
        }));

        // Sort: HIGH first
        const likeOrder = { HIGH: 0, MEDIUM: 1, LOW: 2 };
        causes.sort((a, b) => likeOrder[a.likelihood] - likeOrder[b.likelihood]);

        return {
            symptoms:                   raw.symptoms || [symptomDescription],
            similarHistoricalIncidents: raw.similarHistoricalIncidents || similarIncidents.slice(0, 5),
            probableRootCauses:         causes,
            diagnosticSteps:            raw.diagnosticSteps   || [],
            preventiveMeasures:         raw.preventiveMeasures || [],
            confidenceLevel:            confidence(raw.confidenceLevel),
            provider:                   this.provider || 'heuristic',
            analysisTimestamp:          new Date().toISOString(),
        };
    }

    // ── Main Public Method ────────────────────────────────────────────────────

    /**
     * Perform a full Root Cause Analysis for a reported symptom.
     *
     * @param {string}      symptomDescription - Free-text symptom (e.g. "pump overheating and vibration")
     * @param {string|null} equipmentId        - Equipment tag (e.g. "PUMP-XYZ"), optional
     * @returns {Promise<Object>} Structured RCA report
     */
    async analyzeIncident(symptomDescription, equipmentId = null) {
        if (!symptomDescription || symptomDescription.trim() === '') {
            throw new Error('symptomDescription is required');
        }

        console.log(`\n[RCAAgent] Analyzing: "${symptomDescription}"`);
        if (equipmentId) console.log(`[RCAAgent] Equipment: ${equipmentId}`);
        console.log(`[RCAAgent] Provider: ${this.provider || 'heuristic'}`);

        // ── Step 1: Gather data in parallel ──────────────────────────────────
        const [equipmentHistory, similarIncidents] = await Promise.all([
            this._getEquipmentHistory(equipmentId),
            this.getSimilarIncidents(symptomDescription, equipmentId, 5),
        ]);

        console.log(`[RCAAgent] Found: ${similarIncidents.length} similar incidents, history: ${equipmentHistory ? 'yes' : 'no'}`);

        // ── Step 2: Reason about root causes ─────────────────────────────────
        let rawResult;
        try {
            if (this.provider === 'groq') {
                rawResult = await this._reasonWithGroq(symptomDescription, equipmentId, equipmentHistory, similarIncidents);
            } else if (this.provider === 'gemini') {
                rawResult = await this._reasonWithGemini(symptomDescription, equipmentId, equipmentHistory, similarIncidents);
            } else {
                rawResult = this._heuristicRCA(symptomDescription, similarIncidents);
            }
        } catch (error) {
            console.error('[RCAAgent] LLM reasoning failed, falling back to heuristic:', error.message);
            rawResult = this._heuristicRCA(symptomDescription, similarIncidents);
        }

        // ── Step 3: Normalize and return ─────────────────────────────────────
        const result = this._normalizeResult(rawResult, symptomDescription, similarIncidents);

        console.log(`[RCAAgent] Done. ${result.probableRootCauses.length} root causes, confidence: ${result.confidenceLevel}`);
        return result;
    }
}

module.exports = { RCAAgent };

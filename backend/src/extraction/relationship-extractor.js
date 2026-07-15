'use strict';

/**
 * backend/src/extraction/relationship-extractor.js
 *
 * Extracts semantic relationships between industrial entities.
 *
 * MODES (checked in order):
 *  1. Groq   — GROQ_API_KEY set (primary — fast, 30 RPM free tier)
 *  2. Gemini — GEMINI_API_KEY set (secondary)
 *  3. Rule-based — heuristic fallback
 *
 * Export: async function extractRelationships(text, entities)
 */

require('dotenv').config();

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GROQ_MODEL   = process.env.GROQ_MODEL   || 'llama-3.3-70b-versatile';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
const MIN_CONFIDENCE = 0.7;

const RELATIONSHIP_TYPES = [
    'OPERATES_IN',        // Equipment → Location
    'REQUIRES',           // Equipment → Procedure
    'FAILED_DUE_TO',      // Equipment → Incident
    'CERTIFIED_BY',       // Personnel → Procedure
    'COMPLIES_WITH',      // Procedure → Regulation
    'REFERENCES',         // Document → Document
    'OCCURRED_ON',        // Incident → Date
    'MEASURED_PARAMETER', // Equipment → Parameter
];

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

// ---------------------------------------------------------------------------
// Rate-limiting helpers
// ---------------------------------------------------------------------------

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const GROQ_DELAY_MS   = 2100;
const GEMINI_DELAY_MS = 4200;

async function withRetry(fn, label, retries = 3) {
    let delay = 5000;
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            return await fn();
        } catch (error) {
            const is429 = error.message && (error.message.includes('429') || error.message.includes('rate_limit'));
            if (is429 && attempt < retries) {
                console.warn(`[rel-extractor] ${label} rate limited. Waiting ${delay / 1000}s (attempt ${attempt}/${retries - 1})...`);
                await sleep(delay);
                delay *= 2;
            } else { throw error; }
        }
    }
}

// ---------------------------------------------------------------------------
// System Prompt
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are an expert industrial knowledge graph builder.
Your task is to identify meaningful semantic relationships between provided industrial entities based on the given text.

Valid relationship types (use ONLY these):
- OPERATES_IN       → Equipment operates or is located in a Location
- REQUIRES          → Equipment or Process requires a Procedure
- FAILED_DUE_TO     → Equipment or Component failed because of an Incident/root cause
- CERTIFIED_BY      → Personnel is certified or authorized for a Procedure
- COMPLIES_WITH     → Procedure or Equipment complies with a Regulation
- REFERENCES        → A Document references another Document or Regulation
- OCCURRED_ON       → An Incident occurred on a specific Date
- MEASURED_PARAMETER→ Equipment has a measured Parameter with a value

Rules:
1. Source and target must EXACTLY match one of the entity texts provided.
2. Only extract relationships explicitly supported by evidence in the text.
3. Assign confidence between 0.0 and 1.0.
4. Include a short "evidence" snippet (max 20 words) from the text.

Return a JSON object with key "relationships" containing the array. Format:
{"relationships": [
  {"source": "PUMP-XYZ", "relation": "OPERATES_IN", "target": "Unit A", "confidence": 0.97, "evidence": "PUMP-XYZ installed in Unit A Coolant Circulation System"}
]}`;

// ---------------------------------------------------------------------------
// Rule-Based Fallback
// ---------------------------------------------------------------------------

function extractRelationshipsRuleBased(entities) {
    const relationships = [];
    const byLabel = {};
    for (const e of entities) {
        byLabel[e.label] = byLabel[e.label] || [];
        byLabel[e.label].push(e.text);
    }

    const equipment   = byLabel['EQUIPMENT']  || [];
    const locations   = byLabel['LOCATION']   || [];
    const procedures  = byLabel['PROCEDURE']  || [];
    const incidents   = byLabel['INCIDENT']   || [];
    const parameters  = byLabel['PARAMETER']  || [];
    const regulations = byLabel['REGULATION'] || [];
    const personnel   = byLabel['PERSONNEL']  || [];
    const dates       = byLabel['DATE']       || [];

    for (const eq of equipment.slice(0, 3)) {
        for (const loc of locations)
            relationships.push({ source: eq, relation: 'OPERATES_IN', target: loc, confidence: 0.75, evidence: 'Rule-based: co-occurrence' });
        for (const proc of procedures)
            relationships.push({ source: eq, relation: 'REQUIRES', target: proc, confidence: 0.72, evidence: 'Rule-based: co-occurrence' });
        for (const inc of incidents)
            relationships.push({ source: eq, relation: 'FAILED_DUE_TO', target: inc, confidence: 0.73, evidence: 'Rule-based: co-occurrence' });
        for (const param of parameters.slice(0, 5))
            relationships.push({ source: eq, relation: 'MEASURED_PARAMETER', target: param, confidence: 0.71, evidence: 'Rule-based: co-occurrence' });
    }
    for (const proc of procedures)
        for (const reg of regulations)
            relationships.push({ source: proc, relation: 'COMPLIES_WITH', target: reg, confidence: 0.74, evidence: 'Rule-based: co-occurrence' });
    for (const person of personnel.slice(0, 3))
        for (const proc of procedures.slice(0, 2))
            relationships.push({ source: person, relation: 'CERTIFIED_BY', target: proc, confidence: 0.71, evidence: 'Rule-based: co-occurrence' });
    for (const inc of incidents.slice(0, 3))
        for (const date of dates.slice(0, 3))
            relationships.push({ source: inc, relation: 'OCCURRED_ON', target: date, confidence: 0.73, evidence: 'Rule-based: co-occurrence' });

    return relationships;
}

// ---------------------------------------------------------------------------
// Groq Extractor (primary)
// ---------------------------------------------------------------------------

async function extractRelationshipsWithGroq(text, entities, chunkIndex = 0) {
    const Groq = require('groq-sdk');
    const client = new Groq({ apiKey: getGroqKey() });

    if (chunkIndex > 0) await sleep(GROQ_DELAY_MS);

    const entityList = entities.map(e => `"${e.text}" (${e.label})`).join(', ');

    const raw = await withRetry(async () => {
        const response = await client.chat.completions.create({
            model:           GROQ_MODEL,
            temperature:     0.1,
            max_tokens:      1500,
            response_format: { type: 'json_object' },
            messages: [
                { role: 'system', content: SYSTEM_PROMPT },
                {
                    role: 'user',
                    content: `Entities:\n${entityList}\n\nText:\n${text}\n\nReturn a JSON object with key "relationships".`
                },
            ],
        });
        return response.choices[0].message.content;
    }, 'Groq');

    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : (parsed.relationships || []);
}

// ---------------------------------------------------------------------------
// Gemini Extractor (secondary fallback)
// ---------------------------------------------------------------------------

async function extractRelationshipsWithGemini(text, entities, chunkIndex = 0) {
    const { GoogleGenerativeAI } = require('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(getGeminiKey());
    const model = genAI.getGenerativeModel({
        model: GEMINI_MODEL,
        systemInstruction: SYSTEM_PROMPT,
        generationConfig: { temperature: 0.1, maxOutputTokens: 1500, responseMimeType: 'application/json' },
    });

    if (chunkIndex > 0) await sleep(GEMINI_DELAY_MS);

    const entityList = entities.map(e => `"${e.text}" (${e.label})`).join(', ');
    const prompt     = `Entities:\n${entityList}\n\nText:\n${text}`;

    let delay = 4000;
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            const result = await model.generateContent(prompt);
            const raw    = result.response.text();
            const start  = raw.indexOf('[');
            const end    = raw.lastIndexOf(']');
            if (start === -1 || end === -1) return [];
            return JSON.parse(raw.substring(start, end + 1));
        } catch (error) {
            const is429 = error.message && error.message.includes('429');
            if (is429 && attempt < 3) { await sleep(delay); delay *= 2; }
            else throw error;
        }
    }
    return [];
}

// ---------------------------------------------------------------------------
// Validation & Deduplication
// ---------------------------------------------------------------------------

function buildEntitySet(entities) {
    return new Set(entities.map(e => e.text.toLowerCase()));
}

function isValidRelationship(rel, entitySet) {
    if (!rel.source || !rel.relation || !rel.target) return false;
    if (typeof rel.confidence !== 'number' || rel.confidence < MIN_CONFIDENCE) return false;
    if (!RELATIONSHIP_TYPES.includes(rel.relation)) return false;
    return entitySet.has(rel.source.toLowerCase()) && entitySet.has(rel.target.toLowerCase());
}

function deduplicateRelationships(relationships) {
    const seen = new Map();
    for (const rel of relationships) {
        const key = `${rel.source.toLowerCase()}::${rel.relation}::${rel.target.toLowerCase()}`;
        const existing = seen.get(key);
        if (!existing || rel.confidence > existing.confidence) seen.set(key, rel);
    }
    return Array.from(seen.values());
}

// ---------------------------------------------------------------------------
// Main Export
// ---------------------------------------------------------------------------

/**
 * Extract industrial relationships between identified entities.
 * Priority: Groq → Gemini → Rule-based
 *
 * @param {string} text
 * @param {Array}  entities - Output from extractEntities()
 * @returns {Promise<Array<{source, relation, target, confidence, evidence}>>}
 */
async function extractRelationships(text, entities) {
    if (!text || text.trim() === '' || !entities || entities.length === 0) return [];

    const groqKey   = getGroqKey();
    const geminiKey = getGeminiKey();
    const entitySet = buildEntitySet(entities);

    let mode;
    if (groqKey)        mode = 'groq';
    else if (geminiKey) mode = 'gemini';
    else                mode = 'rule-based';

    if (mode === 'rule-based') {
        console.log('[rel-extractor] Rule-based mode (no API key). Set GROQ_API_KEY to upgrade.');
        const raw   = extractRelationshipsRuleBased(entities);
        const valid = raw.filter(r => isValidRelationship(r, entitySet));
        return deduplicateRelationships(valid);
    }

    // Chunk text on word boundaries
    const MAX_CHUNK = 2000;
    const chunks    = [];
    let remaining   = text.trim();
    while (remaining.length > 0) {
        if (remaining.length <= MAX_CHUNK) { chunks.push(remaining); break; }
        let cutAt = remaining.lastIndexOf(' ', MAX_CHUNK);
        if (cutAt === -1) cutAt = MAX_CHUNK;
        chunks.push(remaining.substring(0, cutAt));
        remaining = remaining.substring(cutAt).trim();
    }

    console.log(`[rel-extractor] ${mode === 'groq' ? 'Groq' : 'Gemini'} mode (${mode === 'groq' ? GROQ_MODEL : GEMINI_MODEL}) — ${chunks.length} chunk(s), ${entities.length} entities`);

    const allRelations = [];

    for (let i = 0; i < chunks.length; i++) {
        try {
            let rels = [];
            if (mode === 'groq') {
                rels = await extractRelationshipsWithGroq(chunks[i], entities, i);
            } else {
                rels = await extractRelationshipsWithGemini(chunks[i], entities, i);
            }
            const valid = rels.filter(r => isValidRelationship(r, entitySet));
            console.log(`  chunk ${i + 1}/${chunks.length}: ${rels.length} found, ${valid.length} valid`);
            allRelations.push(...valid);
        } catch (error) {
            console.error(`[rel-extractor] Error on chunk ${i + 1}: ${error.message}`);
            console.warn('[rel-extractor] Falling back to rule-based for this chunk.');
            const rels  = extractRelationshipsRuleBased(entities);
            const valid = rels.filter(r => isValidRelationship(r, entitySet));
            allRelations.push(...valid);
        }
    }

    const deduped = deduplicateRelationships(allRelations);
    deduped.sort((a, b) => a.relation.localeCompare(b.relation));
    console.log(`[rel-extractor] Done — ${deduped.length} unique relationships extracted.`);
    return deduped;
}

module.exports = { extractRelationships, RELATIONSHIP_TYPES, MIN_CONFIDENCE };

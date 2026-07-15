'use strict';

/**
 * backend/src/extraction/ner-pipeline.js
 *
 * Industrial Named Entity Recognition (NER) pipeline.
 *
 * MODES (checked in order):
 *  1. Groq   — GROQ_API_KEY set (primary — fast LPU inference, 30 RPM free tier)
 *  2. Gemini — GEMINI_API_KEY set (secondary)
 *  3. Rule-based — zero-dependency regex fallback
 *
 * Export: async function extractEntities(text, documentContext = {})
 */

require('dotenv').config();

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_CHUNK_SIZE = 2000;
const GROQ_MODEL     = process.env.GROQ_MODEL   || 'llama-3.3-70b-versatile';
const GEMINI_MODEL   = process.env.GEMINI_MODEL || 'gemini-2.0-flash';

const ENTITY_TYPES = [
    'EQUIPMENT', 'PROCEDURE', 'INCIDENT', 'PERSONNEL',
    'PARAMETER',  'REGULATION', 'DATE',    'LOCATION',
];

// ---------------------------------------------------------------------------
// Rule-Based Patterns (zero-dependency fallback)
// ---------------------------------------------------------------------------

const RULE_PATTERNS = [
    {
        label: 'EQUIPMENT',
        patterns: [
            /\b([A-Z]{1,6}[-_][A-Z0-9]{1,8}(?:[-_][A-Z0-9]{1,6})?)\b/g,
            /\b(pump|motor|valve|compressor|boiler|turbine|tank|vessel|heat exchanger|separator|filter|blower|fan|conveyor|reactor)\b/gi,
        ],
    },
    {
        label: 'PARAMETER',
        patterns: [
            /\b(\d+(?:\.\d+)?\s*(?:bar|psi|kPa|MPa|Pa))\b/gi,
            /\b(\d+(?:\.\d+)?\s*(?:°C|°F|K|degC|degF))\b/gi,
            /\b(\d+(?:\.\d+)?\s*(?:L\/min|m3\/hr|GPM|cfm|kg\/s))\b/gi,
            /\b(\d+(?:\.\d+)?\s*(?:rpm|Hz|kHz))\b/gi,
            /\b(\d+(?:\.\d+)?\s*(?:mm\/s|g|m\/s2))\b/gi,
            /\b(\d+(?:\.\d+)?\s*(?:kW|MW|W|kVA|VA|V|A|Amps?))\b/gi,
            /\b(pressure|temperature|flow rate|vibration|voltage|current|power|speed|torque|humidity)\b/gi,
        ],
    },
    {
        label: 'INCIDENT',
        patterns: [
            /\b(cavitation|leakage?|rupture|failure|shutdown|trip|alarm|overheating|corrosion|erosion|crack|fracture|spill|fire|explosion|near.?miss|breakdown|fault)\b/gi,
        ],
    },
    {
        label: 'PROCEDURE',
        patterns: [
            /\bSOP[-\s]?[\w-]+\b/gi,
            /\b(standard operating procedure|inspection checklist|maintenance procedure|startup sequence|shutdown procedure|lockout\/?tagout|LOTO|PTW|permit to work)\b/gi,
        ],
    },
    {
        label: 'REGULATION',
        patterns: [
            /\b(ISO\s*\d+(?:[:\/-]\d+)*(?:[:\/-]\d+)?)\b/gi,
            /\b(OSHA\s*[\d\s.CFR]+)\b/gi,
            /\b(OISD[-\s]?\d+)\b/gi,
            /\b(PESO\s*[\w-]*)\b/gi,
            /\b(Factory Act|Factories Act|BIS\s*\d+|API\s*\d+|ASME\s*[\w-]+|ASTM\s*[A-Z]\d+)\b/gi,
        ],
    },
    {
        label: 'PERSONNEL',
        patterns: [
            /\b(engineer|technician|supervisor|operator|inspector|manager|officer|mechanic|electrician|foreman)\b/gi,
            /\b([A-Z][a-z]+ (?:Kumar|Sharma|Patil|Singh|Mehta|Verma|Gupta|Shah|Patel|Reddy|Nair|Iyer|Rao))\b/g,
        ],
    },
    {
        label: 'LOCATION',
        patterns: [
            /\b(Unit\s+[A-Z]|Plant\s+\d+|Section\s+[A-Z0-9]+|Area\s+[A-Z0-9]+|Zone\s+[A-Z0-9]+|Block\s+[A-Z0-9]+)\b/gi,
            /\b(steel plant|refinery|plant|facility|station|workshop|warehouse|control room|substation)\b/gi,
        ],
    },
    {
        label: 'DATE',
        patterns: [
            /\b(\d{4}-\d{2}-\d{2})\b/g,
            /\b(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\b/g,
            /\b(\d{1,2}\s+(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{2,4})\b/gi,
            /\b(Q[1-4]\s+\d{4})\b/gi,
        ],
    },
];

// ---------------------------------------------------------------------------
// Shared System Prompt
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are an expert industrial NLP system specializing in extracting named entities from industrial, engineering, and maintenance documents.

Extract entities matching exactly these categories:
- EQUIPMENT: pumps, motors, valves, tanks, compressors, turbines — especially tagged IDs like "PUMP-XYZ", "V-101", "P-201"
- PROCEDURE: SOPs, inspection checklists, maintenance procedures, startup/shutdown sequences, lockout/tagout, permit-to-work
- INCIDENT: failures, accidents, near-misses, shutdowns, trips, alarms, leakages, corrosion, cavitation, fires, explosions
- PERSONNEL: technician names, engineer names, roles (e.g., "Rahul Patil", "Senior Inspector", "maintenance technician")
- PARAMETER: pressure, temperature, flow rate, vibration, RPM — always include the numeric value and unit (e.g., "9.8 bar", "65°C", "150 L/min")
- REGULATION: Factory Act clauses, OISD standards, PESO regulations, ISO standards, OSHA codes, ASME codes
- DATE: any date mention — normalize to ISO 8601 format (YYYY-MM-DD) if possible
- LOCATION: facility names, plant areas, units, zones, sections (e.g., "Unit A", "Steel Plant", "Coolant Circulation System")

Return ONLY a valid JSON array. No markdown, no explanation. Format:
[
  {"text": "PUMP-XYZ", "label": "EQUIPMENT", "confidence": 0.98},
  {"text": "9.8 bar", "label": "PARAMETER", "confidence": 0.96},
  {"text": "2024-01-15", "label": "DATE", "confidence": 0.99}
]`;

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

// Groq: 30 RPM free tier → 1 request per 2s is safe
const GROQ_DELAY_MS   = 2100;
// Gemini: 15 RPM free tier → 1 request per 4s
const GEMINI_DELAY_MS = 4200;

async function withRetry(fn, label, retries = 3) {
    let delay = 5000;
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            return await fn();
        } catch (error) {
            const is429 = error.message && (error.message.includes('429') || error.message.includes('rate_limit'));
            if (is429 && attempt < retries) {
                console.warn(`[ner-pipeline] ${label} rate limited. Waiting ${delay / 1000}s (attempt ${attempt}/${retries - 1})...`);
                await sleep(delay);
                delay *= 2;
            } else {
                throw error;
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Groq Extractor (primary)
// ---------------------------------------------------------------------------

async function extractEntitiesWithGroq(chunk, docContext = {}, chunkIndex = 0) {
    const Groq = require('groq-sdk');
    const client = new Groq({ apiKey: getGroqKey() });

    if (chunkIndex > 0) await sleep(GROQ_DELAY_MS);

    const contextNote = Object.keys(docContext).length > 0
        ? `Document context: ${JSON.stringify(docContext)}\n\n` : '';

    const raw = await withRetry(async () => {
        const response = await client.chat.completions.create({
            model:       GROQ_MODEL,
            temperature: 0.1,
            max_tokens:  1000,
            // Groq supports JSON mode via response_format
            response_format: { type: 'json_object' },
            messages: [
                { role: 'system', content: SYSTEM_PROMPT },
                { role: 'user',   content: `${contextNote}Extract all industrial entities from this text. Return a JSON object with key "entities" containing the array:\n\n${chunk}` },
            ],
        });
        return response.choices[0].message.content;
    }, 'Groq');

    // Parse — Groq JSON mode returns {"entities": [...]}
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : (parsed.entities || []);
}

// ---------------------------------------------------------------------------
// Gemini Extractor (secondary fallback)
// ---------------------------------------------------------------------------

async function callGeminiWithRetry(model, prompt, retries = 3) {
    let delay = 4000;
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const result = await model.generateContent(prompt);
            return result.response.text();
        } catch (error) {
            const is429 = error.message && error.message.includes('429');
            if (is429 && attempt < retries) {
                console.warn(`[ner-pipeline] Gemini rate limited. Waiting ${delay / 1000}s (attempt ${attempt}/${retries - 1})...`);
                await sleep(delay);
                delay *= 2;
            } else { throw error; }
        }
    }
}

async function extractEntitiesWithGemini(chunk, docContext = {}, chunkIndex = 0) {
    const { GoogleGenerativeAI } = require('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(getGeminiKey());
    const model = genAI.getGenerativeModel({
        model: GEMINI_MODEL,
        systemInstruction: SYSTEM_PROMPT,
        generationConfig: { temperature: 0.1, maxOutputTokens: 1000, responseMimeType: 'application/json' },
    });

    if (chunkIndex > 0) await sleep(GEMINI_DELAY_MS);

    const contextNote = Object.keys(docContext).length > 0
        ? `Document context: ${JSON.stringify(docContext)}\n\n` : '';

    const raw   = await callGeminiWithRetry(model, `${contextNote}Extract all industrial entities:\n\n${chunk}`);
    const start = raw.indexOf('[');
    const end   = raw.lastIndexOf(']');
    if (start === -1 || end === -1) return [];
    return JSON.parse(raw.substring(start, end + 1));
}

// ---------------------------------------------------------------------------
// Rule-Based Extractor (last resort)
// ---------------------------------------------------------------------------

function extractEntitiesRuleBased(text) {
    const raw = [];
    for (const group of RULE_PATTERNS) {
        for (const pattern of group.patterns) {
            const regex = new RegExp(pattern.source, pattern.flags);
            let match;
            while ((match = regex.exec(text)) !== null) {
                const matchedText = (match[1] || match[0]).trim();
                if (matchedText.length < 2) continue;
                raw.push({ text: matchedText, label: group.label, confidence: 0.75 });
            }
        }
    }
    return raw;
}

// ---------------------------------------------------------------------------
// Deduplication
// ---------------------------------------------------------------------------

function deduplicateEntities(entities) {
    const seen = new Map();
    for (const entity of entities) {
        const key = `${entity.text.toLowerCase()}::${entity.label}`;
        const existing = seen.get(key);
        if (!existing || entity.confidence > existing.confidence) {
            seen.set(key, entity);
        }
    }
    return Array.from(seen.values());
}

// ---------------------------------------------------------------------------
// Main Export
// ---------------------------------------------------------------------------

/**
 * Extract industrial entities from text.
 * Priority: Groq → Gemini → Rule-based
 *
 * @param {string} text
 * @param {Object} documentContext
 * @returns {Promise<Array<{text, label, confidence}>>}
 */
async function extractEntities(text, documentContext = {}) {
    if (!text || text.trim() === '') return [];

    const groqKey   = getGroqKey();
    const geminiKey = getGeminiKey();

    let mode;
    if (groqKey)        mode = 'groq';
    else if (geminiKey) mode = 'gemini';
    else                mode = 'rule-based';

    // Chunk text on word boundaries
    const chunks = [];
    let remaining = text.trim();
    while (remaining.length > 0) {
        if (remaining.length <= MAX_CHUNK_SIZE) { chunks.push(remaining); break; }
        let cutAt = remaining.lastIndexOf(' ', MAX_CHUNK_SIZE);
        if (cutAt === -1) cutAt = MAX_CHUNK_SIZE;
        chunks.push(remaining.substring(0, cutAt));
        remaining = remaining.substring(cutAt).trim();
    }

    const modeLabels = {
        'groq':       `[ner-pipeline] Groq mode (${GROQ_MODEL}) — ${chunks.length} chunk(s)`,
        'gemini':     `[ner-pipeline] Gemini mode (${GEMINI_MODEL}) — ${chunks.length} chunk(s)`,
        'rule-based': '[ner-pipeline] Rule-based mode (no API key). Set GROQ_API_KEY to upgrade.',
    };
    console.log(modeLabels[mode]);

    const allEntities = [];

    for (let i = 0; i < chunks.length; i++) {
        try {
            if (mode === 'groq') {
                allEntities.push(...await extractEntitiesWithGroq(chunks[i], documentContext, i));
            } else if (mode === 'gemini') {
                allEntities.push(...await extractEntitiesWithGemini(chunks[i], documentContext, i));
            } else {
                allEntities.push(...extractEntitiesRuleBased(chunks[i]));
            }
        } catch (error) {
            console.error(`[ner-pipeline] Error on chunk ${i + 1}/${chunks.length}: ${error.message}`);
            console.warn('[ner-pipeline] Falling back to rule-based for this chunk.');
            allEntities.push(...extractEntitiesRuleBased(chunks[i]));
        }
    }

    const deduped = deduplicateEntities(allEntities);
    deduped.sort((a, b) => a.label.localeCompare(b.label) || a.text.localeCompare(b.text));
    return deduped;
}

module.exports = { extractEntities, ENTITY_TYPES };

'use strict';

/**
 * backend/src/agents/compliance-agent.js
 *
 * Industrial Compliance Monitoring Agent.
 *
 * Periodically audits the Neo4j knowledge graph against industrial
 * regulations (OISD, Factory Act, PESO, ISO standards) and surfaces
 * compliance gaps using LLM-based reasoning.
 *
 * MODES:
 *  1. Groq   — primary (llama-3.3-70b-versatile)
 *  2. Gemini — secondary fallback
 *  3. Rule-based heuristics — when no API key is set
 *
 * Integration:
 *   const agent = new ComplianceAgent(graphManager, io);
 *   await agent.checkCompliance();         // one-shot audit
 *   agent.monitorCompliance(86400000);     // start 24-hour polling
 */

require('dotenv').config();
const { getGroqKey, getGeminiKey, getActiveProvider, sleep } = require('./agent-utils');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GROQ_MODEL   = process.env.GROQ_MODEL   || 'llama-3.3-70b-versatile';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash';

const GAP_TYPES   = ['OVERDUE', 'MISSING', 'NONCOMPLIANT'];
const SEVERITIES  = ['HIGH', 'MEDIUM', 'LOW'];

/** Industrial standards the agent audits against */
const COMPLIANCE_FRAMEWORK = `
APPLICABLE STANDARDS:
1. OISD (Oil Industry Safety Directorate):
   - OISD-118: Layouts for oil/gas installations
   - OISD-105: Process safety management
   - OISD-116: Fire-fighting equipment

2. Factory Act (India, 1948):
   - Section 7a: Safe plant and systems of work
   - Section 11: Cleanliness and safe environment
   - Section 31: Explosive or inflammable gas precautions
   - Annual inspection mandatory for all pressure vessels

3. PESO (Petroleum & Explosives Safety Organisation):
   - Mandatory pressure vessel certification every 2 years
   - Approval required for all explosive/flammable storage

4. ISO Standards:
   - ISO 4406:  Hydraulic fluid cleanliness (≥ 16/14/11 cleanliness code)
   - ISO 10816-1: Machinery vibration (alarm: >4.5 mm/s, shutdown: >7.1 mm/s)
   - ISO 16/14/11: Oil contamination limit
   - ISO 3448:  Viscosity classification
   - ASME B31.3: Process piping — pressure test every 5 years

INSPECTION FREQUENCY RULES:
- Pressure vessels: certification every 2 years (730 days)
- Safety valves:    inspection every 1 year (365 days)
- Fire extinguishers: inspection every 6 months (180 days)
- Pumps/compressors: quarterly inspection (90 days)
- Electrical panels: annual inspection (365 days)
`;

// ---------------------------------------------------------------------------
// ComplianceAgent Class
// ---------------------------------------------------------------------------

class ComplianceAgent {

    /**
     * @param {GraphManager}     graphManager - Neo4j graph manager instance
     * @param {Object|null}      io           - Socket.io server instance (optional)
     * @param {Object|null}      llmClient    - Optional pre-configured LLM client
     */
    constructor(graphManager, io = null, llmClient = null) {
        this.graphManager  = graphManager;
        this.io            = io;
        this.llmClient     = llmClient;
        this.provider      = getActiveProvider();
        this._monitorTimer = null;
        this._lastResult   = null;

        console.log(`[ComplianceAgent] Initialized. Provider: ${this.provider || 'rule-based'}`);
    }

    // ── Data Gathering from Neo4j ─────────────────────────────────────────────

    /**
     * Pull all compliance-relevant data from the graph.
     * Returns a structured snapshot of the plant's current state.
     */
    async _gatherPlantData() {
        const gm      = this.graphManager;
        const session = gm._session();

        try {
            // All equipment with type and install date
            const equipmentRes = await session.run(`
                MATCH (e:Equipment)
                RETURN e.name          AS name,
                       e.equipmentId   AS id,
                       e.type          AS type,
                       e.status        AS status,
                       e.location      AS location,
                       e.installDate   AS installDate,
                       e.createdAt     AS createdAt
                ORDER BY e.name
            `);

            // All active regulations
            const regRes = await session.run(`
                MATCH (r:Regulation)
                RETURN r.name AS name, r.regId AS id, r.standard AS standard, r.description AS description
            `);

            // All procedures and their compliance linkages
            const procRes = await session.run(`
                MATCH (p:Procedure)
                OPTIONAL MATCH (p)-[:COMPLIES_WITH]->(r:Regulation)
                RETURN p.name AS procedure, p.frequency AS frequency, collect(r.name) AS regulations
            `);

            // Recent incidents (last 180 days)
            const incidentRes = await session.run(`
                MATCH (i:Incident)
                WHERE i.createdAt >= $cutoff
                OPTIONAL MATCH (e:Equipment)-[:FAILED_DUE_TO|FAILED_AT]->(i)
                RETURN i.name AS incident, i.severity AS severity,
                       i.createdAt AS date, collect(e.name) AS equipment
                ORDER BY i.createdAt DESC
                LIMIT 50
            `, { cutoff: new Date(Date.now() - 180 * 86400000).toISOString() });

            // Parameters / measurements
            const paramRes = await session.run(`
                MATCH (e:Equipment)-[:MEASURED_PARAMETER|HAS_PARAMETER]->(p:Parameter)
                RETURN e.name AS equipment, p.name AS parameter, p.value AS value, p.unit AS unit
                LIMIT 100
            `);

            return {
                equipment:  equipmentRes.records.map(r => this._recordToObj(r)),
                regulations: regRes.records.map(r => this._recordToObj(r)),
                procedures: procRes.records.map(r => this._recordToObj(r)),
                incidents:  incidentRes.records.map(r => this._recordToObj(r)),
                parameters: paramRes.records.map(r => this._recordToObj(r)),
                snapshotAt: new Date().toISOString(),
            };

        } finally {
            await session.close();
        }
    }

    /** Convert a Neo4j record to a plain object */
    _recordToObj(record) {
        const obj = {};
        record.keys.forEach(key => {
            const val = record.get(key);
            obj[key]  = Array.isArray(val) ? val.filter(Boolean).join(', ') : (val ?? null);
        });
        return obj;
    }

    // ── LLM Compliance Reasoning ─────────────────────────────────────────────

    /**
     * Ask Groq to reason about compliance gaps.
     *
     * @param {Object} plantData - Snapshot from _gatherPlantData()
     * @returns {Promise<Object>} Raw LLM response text
     */
    async _reasonWithGroq(plantData) {
        const Groq   = require('groq-sdk');
        const client = new Groq({ apiKey: getGroqKey() });

        const systemPrompt = `You are a senior industrial compliance expert specializing in Indian manufacturing regulations.
Your task is to analyze the current state of a plant's equipment, procedures, and incidents against the applicable regulatory framework and identify compliance gaps.

${COMPLIANCE_FRAMEWORK}

Output ONLY a valid JSON object with this exact schema:
{
  "gaps": [
    {
      "requirementId": "string (e.g. OISD-118, FACTORY-ACT-7A, ISO-4406)",
      "requirement": "string (full requirement description)",
      "currentState": "string (what we found in the data)",
      "gap": "OVERDUE|MISSING|NONCOMPLIANT",
      "severity": "HIGH|MEDIUM|LOW",
      "recommendedAction": "string (specific action to take)",
      "affectedEquipment": ["array", "of", "equipment", "names"],
      "daysOverdue": null
    }
  ],
  "complianceScore": 0.0,
  "summary": "One paragraph summary of compliance status",
  "lastAudit": "ISO date string"
}

Be specific and realistic. Only raise gaps that are genuinely supported by the data. Do not fabricate data.`;

        const userMessage = `Analyze this plant data for compliance gaps:

EQUIPMENT (${plantData.equipment.length} items):
${JSON.stringify(plantData.equipment.slice(0, 20), null, 2)}

ACTIVE REGULATIONS (${plantData.regulations.length} items):
${JSON.stringify(plantData.regulations.slice(0, 15), null, 2)}

PROCEDURES (${plantData.procedures.length} items):
${JSON.stringify(plantData.procedures.slice(0, 15), null, 2)}

RECENT INCIDENTS (last 180 days, ${plantData.incidents.length} items):
${JSON.stringify(plantData.incidents.slice(0, 10), null, 2)}

MEASUREMENTS (${plantData.parameters.length} items):
${JSON.stringify(plantData.parameters.slice(0, 20), null, 2)}

Today's date: ${new Date().toISOString().substring(0, 10)}

Return the JSON compliance audit report.`;

        let delay = 4000;
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                const response = await client.chat.completions.create({
                    model:           GROQ_MODEL,
                    temperature:     0.1,
                    max_tokens:      2000,
                    response_format: { type: 'json_object' },
                    messages: [
                        { role: 'system', content: systemPrompt },
                        { role: 'user',   content: userMessage  },
                    ],
                });
                return JSON.parse(response.choices[0].message.content);
            } catch (error) {
                const is429 = error.message?.includes('429') || error.message?.includes('rate_limit');
                if (is429 && attempt < 3) {
                    console.warn(`[ComplianceAgent] Groq rate limited. Waiting ${delay / 1000}s...`);
                    await sleep(delay);
                    delay *= 2;
                } else {
                    throw error;
                }
            }
        }
    }

    /**
     * Ask Gemini to reason about compliance gaps (secondary fallback).
     *
     * @param {Object} plantData
     * @returns {Promise<Object>}
     */
    async _reasonWithGemini(plantData) {
        const { GoogleGenerativeAI } = require('@google/generative-ai');
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({
            model: GEMINI_MODEL,
            generationConfig: {
                temperature:      0.1,
                maxOutputTokens:  2000,
                responseMimeType: 'application/json',
            },
            systemInstruction: `You are a senior industrial compliance expert. Analyze plant data against OISD, Factory Act, PESO, and ISO standards. Return only valid JSON matching the specified schema.\n\n${COMPLIANCE_FRAMEWORK}`,
        });

        const prompt = `Analyze this plant data and return a JSON compliance audit report with schema:
{"gaps":[{"requirementId":"string","requirement":"string","currentState":"string","gap":"OVERDUE|MISSING|NONCOMPLIANT","severity":"HIGH|MEDIUM|LOW","recommendedAction":"string","affectedEquipment":[],"daysOverdue":null}],"complianceScore":0.0,"summary":"string","lastAudit":"ISO date"}

Equipment: ${JSON.stringify(plantData.equipment.slice(0, 15))}
Regulations: ${JSON.stringify(plantData.regulations.slice(0, 10))}
Procedures: ${JSON.stringify(plantData.procedures.slice(0, 10))}
Incidents: ${JSON.stringify(plantData.incidents.slice(0, 8))}
Parameters: ${JSON.stringify(plantData.parameters.slice(0, 15))}
Today: ${new Date().toISOString().substring(0, 10)}`;

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
                    console.warn(`[ComplianceAgent] Gemini rate limited. Waiting ${delay / 1000}s...`);
                    await sleep(delay);
                    delay *= 2;
                } else {
                    throw error;
                }
            }
        }
    }

    /**
     * Rule-based heuristic compliance check (no API key needed).
     * Applies fixed inspection frequency rules to equipment and procedures.
     *
     * @param {Object} plantData
     * @returns {Object}
     */
    _ruleBasedCompliance(plantData) {
        const gaps  = [];
        const today = Date.now();

        const INSPECTION_RULES = [
            { type: 'pressure vessel', days: 730, reg: 'PESO', severity: 'HIGH',   label: 'Pressure Vessel Certification' },
            { type: 'pump',            days: 90,  reg: 'OISD', severity: 'MEDIUM', label: 'Quarterly Pump Inspection' },
            { type: 'compressor',      days: 90,  reg: 'OISD', severity: 'MEDIUM', label: 'Quarterly Compressor Inspection' },
            { type: 'safety valve',    days: 365, reg: 'FACTORY-ACT-7A', severity: 'HIGH', label: 'Annual Safety Valve Check' },
        ];

        for (const equipment of plantData.equipment) {
            const typeLower = (equipment.type || equipment.name || '').toLowerCase();
            for (const rule of INSPECTION_RULES) {
                if (!typeLower.includes(rule.type.split(' ')[0])) continue;

                const createdAt = equipment.installDate || equipment.createdAt;
                if (!createdAt) {
                    gaps.push({
                        requirementId:     rule.reg,
                        requirement:       `${rule.label} every ${rule.days} days`,
                        currentState:      `No install/inspection date recorded for ${equipment.name || equipment.id}`,
                        gap:               'MISSING',
                        severity:          rule.severity,
                        recommendedAction: `Record install date and schedule ${rule.label} for ${equipment.name || equipment.id}`,
                        affectedEquipment: [equipment.name || equipment.id],
                        daysOverdue:       null,
                    });
                    continue;
                }

                const lastDate   = new Date(createdAt).getTime();
                const daysAgo    = Math.floor((today - lastDate) / 86400000);
                const daysOverdue = daysAgo - rule.days;

                if (daysOverdue > 0) {
                    gaps.push({
                        requirementId:     rule.reg,
                        requirement:       `${rule.label} every ${rule.days} days`,
                        currentState:      `Last recorded: ${createdAt} (${daysAgo} days ago)`,
                        gap:               'OVERDUE',
                        severity:          rule.severity,
                        recommendedAction: `Schedule ${rule.label} immediately for ${equipment.name || equipment.id}`,
                        affectedEquipment: [equipment.name || equipment.id],
                        daysOverdue:       daysOverdue,
                    });
                }
            }
        }

        // Check procedures for missing regulation links
        for (const proc of plantData.procedures) {
            if (!proc.regulations || proc.regulations === '') {
                gaps.push({
                    requirementId:     'FACTORY-ACT-7A',
                    requirement:       'All procedures must be linked to applicable regulations',
                    currentState:      `Procedure "${proc.procedure}" has no compliance links`,
                    gap:               'MISSING',
                    severity:          'LOW',
                    recommendedAction: `Link "${proc.procedure}" to its governing regulation in the knowledge graph`,
                    affectedEquipment: [],
                    daysOverdue:       null,
                });
            }
        }

        const totalChecks = plantData.equipment.length * INSPECTION_RULES.length;
        const passed      = Math.max(0, totalChecks - gaps.length);
        const score       = totalChecks > 0 ? Math.round((passed / totalChecks) * 100) / 100 : 1.0;

        return {
            gaps,
            complianceScore: score,
            summary:         `Rule-based audit: ${gaps.length} gap(s) found across ${plantData.equipment.length} equipment items. Score: ${(score * 100).toFixed(0)}%.`,
            lastAudit:       new Date().toISOString(),
        };
    }

    // ── Result Normalization ──────────────────────────────────────────────────

    /**
     * Validate and normalize raw LLM output to conform to the expected schema.
     *
     * @param {Object} raw
     * @returns {Object}
     */
    _normalizeResult(raw) {
        const gaps = (raw.gaps || []).map(g => ({
            requirementId:     String(g.requirementId || 'UNKNOWN'),
            requirement:       String(g.requirement   || ''),
            currentState:      String(g.currentState  || ''),
            gap:               GAP_TYPES.includes(g.gap) ? g.gap : 'NONCOMPLIANT',
            severity:          SEVERITIES.includes(g.severity) ? g.severity : 'MEDIUM',
            recommendedAction: String(g.recommendedAction || ''),
            affectedEquipment: Array.isArray(g.affectedEquipment) ? g.affectedEquipment : [],
            daysOverdue:       typeof g.daysOverdue === 'number' ? g.daysOverdue : null,
        }));

        // Sort: HIGH first, then MEDIUM, then LOW; within same severity by daysOverdue desc
        gaps.sort((a, b) => {
            const sOrder = { HIGH: 0, MEDIUM: 1, LOW: 2 };
            if (sOrder[a.severity] !== sOrder[b.severity]) return sOrder[a.severity] - sOrder[b.severity];
            return (b.daysOverdue || 0) - (a.daysOverdue || 0);
        });

        const score = typeof raw.complianceScore === 'number'
            ? Math.min(1, Math.max(0, raw.complianceScore))
            : 1 - (gaps.filter(g => g.severity === 'HIGH').length * 0.15 +
                   gaps.filter(g => g.severity === 'MEDIUM').length * 0.05 +
                   gaps.filter(g => g.severity === 'LOW').length * 0.02);

        return {
            gaps,
            complianceScore: Math.max(0, Math.round(score * 100) / 100),
            summary:         raw.summary || `${gaps.length} compliance gap(s) identified.`,
            lastAudit:       raw.lastAudit || new Date().toISOString(),
            provider:        this.provider || 'rule-based',
        };
    }

    // ── Public Methods ────────────────────────────────────────────────────────

    /**
     * Run a full compliance audit against the Neo4j knowledge graph.
     *
     * @returns {Promise<{gaps, complianceScore, summary, lastAudit, provider}>}
     */
    async checkCompliance() {
        console.log('\n[ComplianceAgent] Starting compliance audit...');

        try {
            // Step 1: Gather plant state from Neo4j
            let plantData;
            try {
                plantData = await this._gatherPlantData();
                console.log(`[ComplianceAgent] Gathered: ${plantData.equipment.length} equipment, ${plantData.regulations.length} regulations, ${plantData.incidents.length} incidents`);
            } catch (err) {
                console.warn('[ComplianceAgent] Neo4j unavailable — using empty plant data:', err.message);
                plantData = { equipment: [], regulations: [], procedures: [], incidents: [], parameters: [], snapshotAt: new Date().toISOString() };
            }

            // Step 2: Reason about compliance gaps
            let rawResult;
            if (this.provider === 'groq') {
                console.log(`[ComplianceAgent] Reasoning with Groq (${GROQ_MODEL})...`);
                rawResult = await this._reasonWithGroq(plantData);
            } else if (this.provider === 'gemini') {
                console.log(`[ComplianceAgent] Reasoning with Gemini (${GEMINI_MODEL})...`);
                rawResult = await this._reasonWithGemini(plantData);
            } else {
                console.log('[ComplianceAgent] Rule-based mode (no API key)...');
                rawResult = this._ruleBasedCompliance(plantData);
            }

            // Step 3: Normalize and validate output
            const result = this._normalizeResult(rawResult);
            this._lastResult = result;

            // Step 4: Summary log
            const highCount   = result.gaps.filter(g => g.severity === 'HIGH').length;
            const medCount    = result.gaps.filter(g => g.severity === 'MEDIUM').length;
            const lowCount    = result.gaps.filter(g => g.severity === 'LOW').length;

            console.log(`[ComplianceAgent] Audit complete:`);
            console.log(`  Score:  ${(result.complianceScore * 100).toFixed(0)}%`);
            console.log(`  Gaps:   HIGH=${highCount}, MEDIUM=${medCount}, LOW=${lowCount}`);

            // Step 5: Alert on HIGH severity gaps
            for (const gap of result.gaps.filter(g => g.severity === 'HIGH')) {
                await this.alertOnGap(gap);
            }

            // Step 6: Emit result to connected frontend clients via Socket.io
            if (this.io) {
                this.io.emit('compliance:update', {
                    ...result,
                    timestamp: new Date().toISOString(),
                });
                console.log('[ComplianceAgent] Emitted compliance:update to Socket.io clients');
            }

            return result;

        } catch (error) {
            console.error('[ComplianceAgent] checkCompliance failed:', error.message);
            throw error;
        }
    }

    /**
     * Start recurring compliance monitoring.
     * Runs checkCompliance() every `interval` milliseconds (default: 24 hours).
     *
     * @param {number} interval - Milliseconds between audits (default: 86400000 = 24h)
     */
    monitorCompliance(interval = 86_400_000) {
        if (this._monitorTimer) {
            console.warn('[ComplianceAgent] monitorCompliance already running. Call stopMonitoring() first.');
            return;
        }

        const intervalMinutes = Math.round(interval / 60000);
        console.log(`[ComplianceAgent] Starting compliance monitor (every ${intervalMinutes} minutes)`);

        // Run immediately on start
        this.checkCompliance().catch(err =>
            console.error('[ComplianceAgent] Initial monitor check failed:', err.message)
        );

        // Schedule recurring checks
        this._monitorTimer = setInterval(async () => {
            console.log('[ComplianceAgent] Scheduled compliance check triggered');
            try {
                await this.checkCompliance();
            } catch (err) {
                console.error('[ComplianceAgent] Scheduled check failed:', err.message);
            }
        }, interval);

        // Prevent the timer from blocking Node.js process exit
        if (this._monitorTimer.unref) this._monitorTimer.unref();
    }

    /**
     * Stop recurring compliance monitoring.
     */
    stopMonitoring() {
        if (this._monitorTimer) {
            clearInterval(this._monitorTimer);
            this._monitorTimer = null;
            console.log('[ComplianceAgent] Monitoring stopped.');
        }
    }

    /**
     * Format and emit an alert for a HIGH-severity compliance gap.
     *
     * @param {Object} gap - A single gap object from checkCompliance()
     */
    async alertOnGap(gap) {
        const overduePart  = gap.daysOverdue ? ` (${gap.daysOverdue} days overdue)` : '';
        const equipPart    = gap.affectedEquipment?.length
            ? `\n   Equipment:  ${gap.affectedEquipment.join(', ')}`
            : '';

        const alert = [
            `🚨 COMPLIANCE ALERT [${gap.severity}]`,
            `   Standard:   ${gap.requirementId}`,
            `   Type:       ${gap.gap}${overduePart}`,
            `   Issue:      ${gap.requirement}`,
            `   State:      ${gap.currentState}`,
            equipPart,
            `   Action:     ${gap.recommendedAction}`,
        ].filter(Boolean).join('\n');

        console.log('\n' + alert);

        // Emit alert to frontend via Socket.io
        if (this.io) {
            this.io.emit('compliance:alert', {
                severity:          gap.severity,
                gap:               gap.gap,
                requirementId:     gap.requirementId,
                requirement:       gap.requirement,
                currentState:      gap.currentState,
                recommendedAction: gap.recommendedAction,
                affectedEquipment: gap.affectedEquipment,
                daysOverdue:       gap.daysOverdue,
                timestamp:         new Date().toISOString(),
            });
        }

        // ── Optional: Extend here for email/Slack integration ─────────────────
        // await sendSlackAlert(gap);
        // await sendEmail({ to: 'safety@plant.com', subject: 'Compliance Alert', body: alert });
    }

    /**
     * Returns the most recent compliance result without running a new audit.
     *
     * @returns {Object|null}
     */
    getLastResult() {
        return this._lastResult;
    }
}

module.exports = { ComplianceAgent };

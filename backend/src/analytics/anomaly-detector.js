'use strict';

/**
 * backend/src/analytics/anomaly-detector.js
 *
 * Detects anomalous maintenance patterns in equipment history.
 *
 * Pipeline:
 *   Neo4j graph query → feature extraction → Python IsolationForest/Z-score
 *   → classify type → calculate severity → generate recommendation
 *
 * Anomaly types:
 *   FREQUENT_FAILURES  — failures happening faster than expected MTBF
 *   EXTENDED_REPAIR    — repair time (MTTR) unusually long
 *   HIGH_COST          — repair cost is an outlier
 *   UNUSUAL_TECHNICIAN — abnormal number of different technicians involved
 *   CASCADING_FAILURE  — multiple failures within a tight window
 *
 * Usage:
 *   const { AnomalyDetector } = require('./anomaly-detector');
 *   const detector = new AnomalyDetector(graphManager);
 *   const anomalies = await detector.detectAnomalies('PUMP-XYZ');
 */

require('dotenv').config();

const path    = require('path');
const { spawn } = require('child_process');

const PYTHON_SCRIPT = path.resolve(__dirname, '../../scripts/anomaly-detect.py');

// ── Anomaly classification constants ─────────────────────────────────────────

const ANOMALY_TYPES = {
    FREQUENT_FAILURES:   'FREQUENT_FAILURES',
    EXTENDED_REPAIR:     'EXTENDED_REPAIR',
    HIGH_COST:           'HIGH_COST',
    UNUSUAL_TECHNICIAN:  'UNUSUAL_TECHNICIAN',
    CASCADING_FAILURE:   'CASCADING_FAILURE',
    PARAMETER_OUTLIER:   'PARAMETER_OUTLIER',
};

const SEVERITY = {
    CRITICAL: 'CRITICAL',
    HIGH:     'HIGH',
    MEDIUM:   'MEDIUM',
    LOW:      'LOW',
};

// Industry baseline thresholds (configurable via env)
const THRESHOLDS = {
    MTBF_CRITICAL_DAYS:   parseInt(process.env.MTBF_CRITICAL_DAYS)   || 14,   // < 14 days between failures = CRITICAL
    MTBF_HIGH_DAYS:       parseInt(process.env.MTBF_HIGH_DAYS)       || 30,
    MTTR_CRITICAL_HOURS:  parseInt(process.env.MTTR_CRITICAL_HOURS)  || 72,   // > 72h repair = CRITICAL
    MTTR_HIGH_HOURS:      parseInt(process.env.MTTR_HIGH_HOURS)      || 48,
    COST_CRITICAL_FACTOR: parseFloat(process.env.COST_CRITICAL_FACTOR) || 3.0, // > 3× median = CRITICAL
    COST_HIGH_FACTOR:     parseFloat(process.env.COST_HIGH_FACTOR)     || 2.0,
    CASCADING_DAYS:       parseInt(process.env.CASCADING_DAYS)        || 7,    // 2+ failures within 7 days
};

// ---------------------------------------------------------------------------
// AnomalyDetector Class
// ---------------------------------------------------------------------------

class AnomalyDetector {

    /**
     * @param {GraphManager} graphManager - Neo4j graph manager instance
     */
    constructor(graphManager) {
        this.graphManager = graphManager;
        console.log('[AnomalyDetector] Initialized');
    }

    // ── Data Extraction from Neo4j ──────────────────────────────────────────

    /**
     * Pull structured maintenance history from the graph.
     *
     * @param {string} equipmentId
     * @returns {Promise<Array>} Array of maintenance event records
     */
    async _fetchMaintenanceHistory(equipmentId) {
        const session = this.graphManager._session();
        try {
            // Get all incidents + dates + parameters for this equipment
            const result = await session.run(`
                MATCH (e:Equipment)
                WHERE e.equipmentId = $id OR e.name = $id
                OPTIONAL MATCH (e)-[:FAILED_DUE_TO|FAILED_AT]->(i:Incident)
                OPTIONAL MATCH (i)-[:OCCURRED_ON]->(d)
                OPTIONAL MATCH (e)-[:MEASURED_PARAMETER|HAS_PARAMETER]->(p:Parameter)
                RETURN 
                    e.name          AS equipment,
                    i.incidentId    AS incidentId,
                    i.name          AS incidentName,
                    i.severity      AS severity,
                    i.description   AS description,
                    d.name          AS date,
                    collect(DISTINCT p.name + '=' + p.value) AS parameters
                ORDER BY d.name ASC
            `, { id: equipmentId });

            return result.records.map(r => ({
                equipment:    r.get('equipment'),
                incidentId:   r.get('incidentId'),
                incidentName: r.get('incidentName'),
                severity:     r.get('severity'),
                description:  r.get('description'),
                date:         r.get('date'),
                parameters:   r.get('parameters') || [],
            })).filter(r => r.incidentId !== null);

        } finally {
            await session.close();
        }
    }

    /**
     * Extract feature vectors from raw maintenance records.
     *
     * @param {Array} records - Raw maintenance history
     * @returns {Array} Feature vectors ready for Python
     */
    _extractFeatures(records) {
        if (!records || records.length === 0) return [];

        const features = [];

        // Sort by date to compute time deltas
        const sorted = records
            .filter(r => r.date)
            .sort((a, b) => new Date(a.date) - new Date(b.date));

        for (let i = 0; i < sorted.length; i++) {
            const rec  = sorted[i];
            const prev = sorted[i - 1];

            // MTBF: days since last failure (null for first record)
            let mtbf = null;
            if (prev?.date && rec.date) {
                mtbf = Math.max(0, Math.round(
                    (new Date(rec.date) - new Date(prev.date)) / 86400000
                ));
            }

            // Extract cost and MTTR from parameters if present
            let cost  = 0;
            let mttr  = 0;
            let techCount = 1;

            for (const param of (rec.parameters || [])) {
                const lp = param.toLowerCase();
                const match = param.match(/=([0-9.]+)/);
                const val   = match ? parseFloat(match[1]) : 0;

                if (lp.includes('cost'))         cost  = val;
                if (lp.includes('repair_time') || lp.includes('mttr')) mttr = val;
                if (lp.includes('technician'))    techCount = Math.max(techCount, Math.ceil(val));
            }

            // Severity score (for weighting)
            const severityScore = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 }[rec.severity] || 1;

            features.push({
                index:           i,
                incidentId:      rec.incidentId,
                incidentName:    rec.incidentName,
                date:            rec.date,
                severity:        rec.severity,
                description:     rec.description,
                mtbf:            mtbf !== null ? mtbf : 999, // 999 = first record / no prior
                mttr:            mttr,
                cost:            cost,
                failureCount:    1,
                technicianCount: techCount,
                severityScore:   severityScore,
            });
        }

        // Add a failureCount feature: rolling 30-day window
        for (let i = 0; i < features.length; i++) {
            const current  = new Date(features[i].date);
            const windowMs = 30 * 86400000;
            features[i].failureCount = features.filter(f => {
                const d = new Date(f.date);
                return d <= current && current - d <= windowMs;
            }).length;
        }

        return features;
    }

    // ── Python Subprocess Communication ──────────────────────────────────────

    /**
     * Spawn anomaly-detect.py, write features JSON to stdin, parse stdout.
     *
     * @param {Array}  features     - Feature vectors
     * @param {string} equipmentId
     * @returns {Promise<Object>} Python script output
     */
    async runPythonScript(features, equipmentId) {
        return new Promise((resolve, reject) => {
            // New compact protocol: send {features:[...]} receive {anomalies:[bool,...]}
            const payload = JSON.stringify({ features, equipmentId });

            const pythonCmds = ['python', 'python3'];

            const trySpawn = (cmdIndex) => {
                if (cmdIndex >= pythonCmds.length) {
                    return reject(new Error('Python not found. Install Python 3.8+ to enable anomaly detection.'));
                }

                const proc = spawn(pythonCmds[cmdIndex], [PYTHON_SCRIPT], {
                    stdio: ['pipe', 'pipe', 'pipe'],
                });

                let stdout = '';
                let stderr = '';

                proc.stdout.on('data', chunk => { stdout += chunk.toString(); });
                proc.stderr.on('data', chunk => { stderr += chunk.toString(); });

                proc.on('close', (code) => {
                    if (stderr.trim()) {
                        console.warn('[AnomalyDetector] Python stderr:', stderr.trim());
                    }

                    if (code !== 0) {
                        if (stderr.includes('not recognized') || stderr.includes('No such file')) {
                            return trySpawn(cmdIndex + 1);
                        }
                        return reject(new Error(`Python exited ${code}: ${stderr.substring(0, 200)}`));
                    }

                    try {
                        const result = JSON.parse(stdout.trim());

                        if (result.error && !result.anomalies) {
                            return reject(new Error(`Python error: ${result.error}`));
                        }

                        // Map boolean array → indexed result objects (compatible with classify pipeline)
                        const booleans = result.anomalies || [];
                        const enriched = booleans.map((isAnomaly, i) => ({
                            index:     i,
                            isAnomaly: Boolean(isAnomaly),
                            score:     isAnomaly ? -0.5 : 0,   // synthetic score for classifier
                            zscores:   {},
                            reason:    isAnomaly ? 'IsolationForest flagged as outlier' : '',
                        }));

                        resolve({
                            equipmentId,
                            model:        'isolation_forest',
                            totalRecords: features.length,
                            anomalyCount: enriched.filter(a => a.isAnomaly).length,
                            anomalies:    enriched,
                        });

                    } catch (parseErr) {
                        reject(new Error(`Failed to parse Python output: ${stdout.substring(0, 200)}`));
                    }
                });

                proc.on('error', (err) => {
                    if (err.code === 'ENOENT') return trySpawn(cmdIndex + 1);
                    reject(err);
                });

                proc.stdin.write(payload);
                proc.stdin.end();
            };

            trySpawn(0);
        });
    }

    // ── Classification Helpers ────────────────────────────────────────────────

    /**
     * Classify the anomaly type based on which features are anomalous.
     *
     * @param {Object} feature  - Original feature vector
     * @param {Object} zscores  - Z-scores per field from Python
     * @returns {string} ANOMALY_TYPES value
     */
    classifyAnomaly(feature, zscores = {}) {
        // Priority order: most dangerous first
        const fCost  = zscores.cost            || 0;
        const fMtbf  = zscores.mtbf            || 0;
        const fMttr  = zscores.mttr            || 0;
        const fCount = zscores.failureCount    || 0;
        const fTech  = zscores.technicianCount || 0;

        // Check cascading: multiple failures in short window
        if (feature.mtbf < THRESHOLDS.CASCADING_DAYS && feature.failureCount >= 3) {
            return ANOMALY_TYPES.CASCADING_FAILURE;
        }

        // Rank by highest z-score
        const ranked = [
            { type: ANOMALY_TYPES.HIGH_COST,           score: fCost  },
            { type: ANOMALY_TYPES.FREQUENT_FAILURES,   score: fMtbf + fCount },
            { type: ANOMALY_TYPES.EXTENDED_REPAIR,     score: fMttr  },
            { type: ANOMALY_TYPES.UNUSUAL_TECHNICIAN,  score: fTech  },
        ].sort((a, b) => b.score - a.score);

        return ranked[0].type;
    }

    /**
     * Calculate severity from anomaly score, feature values, and type.
     *
     * @param {Object} feature   - Feature vector
     * @param {string} type      - Anomaly type
     * @param {number} score     - Isolation Forest score (more negative = worse)
     * @returns {string} SEVERITY value
     */
    calculateSeverity(feature, type, score) {
        // Use IsolationForest score as primary signal (< -0.5 = very anomalous)
        if (score < -0.7)     return SEVERITY.CRITICAL;
        if (score < -0.5)     return SEVERITY.HIGH;
        if (score < -0.3)     return SEVERITY.MEDIUM;

        // Domain-specific overrides
        if (type === ANOMALY_TYPES.FREQUENT_FAILURES) {
            if (feature.mtbf < THRESHOLDS.MTBF_CRITICAL_DAYS) return SEVERITY.CRITICAL;
            if (feature.mtbf < THRESHOLDS.MTBF_HIGH_DAYS)     return SEVERITY.HIGH;
        }
        if (type === ANOMALY_TYPES.EXTENDED_REPAIR) {
            if (feature.mttr > THRESHOLDS.MTTR_CRITICAL_HOURS) return SEVERITY.CRITICAL;
            if (feature.mttr > THRESHOLDS.MTTR_HIGH_HOURS)     return SEVERITY.HIGH;
        }
        if (type === ANOMALY_TYPES.CASCADING_FAILURE) return SEVERITY.CRITICAL;

        return SEVERITY.LOW;
    }

    /**
     * Generate a plain-language corrective recommendation for each anomaly type.
     *
     * @param {Object} feature - Feature vector
     * @param {string} type    - Anomaly type
     * @returns {string}
     */
    getRecommendation(feature, type) {
        switch (type) {
            case ANOMALY_TYPES.FREQUENT_FAILURES:
                return `MTBF is ${feature.mtbf} days — well below expected baseline. ` +
                       `Inspect root cause via RCA, check lubrication schedule and bearing wear.`;

            case ANOMALY_TYPES.EXTENDED_REPAIR:
                return `Repair time (MTTR ${feature.mttr}h) is unusually long. ` +
                       `Review spare parts availability and technician skill gap.`;

            case ANOMALY_TYPES.HIGH_COST:
                return `Repair cost is an outlier. Evaluate procurement strategy, ` +
                       `consider predictive maintenance to avoid emergency-rate repairs.`;

            case ANOMALY_TYPES.UNUSUAL_TECHNICIAN:
                return `Abnormal number of technicians involved suggests escalations or rework. ` +
                       `Review skill certification and work order clarity for this equipment.`;

            case ANOMALY_TYPES.CASCADING_FAILURE:
                return `${feature.failureCount} failures within ${THRESHOLDS.CASCADING_DAYS} days detected. ` +
                       `Immediate shutdown inspection recommended. Possible systemic failure.`;

            case ANOMALY_TYPES.PARAMETER_OUTLIER:
                return `Operating parameters deviate from established norms. ` +
                       `Cross-check sensor calibration and process condition limits.`;

            default:
                return 'Anomalous pattern detected. Review maintenance logs and escalate to engineering.';
        }
    }

    // ── Main Public Method ────────────────────────────────────────────────────

    /**
     * Detect anomalies in the maintenance history of a piece of equipment.
     *
     * @param {string} equipmentId - Equipment tag (e.g. 'PUMP-XYZ')
     * @returns {Promise<Array<{
     *   incidentId, incidentName, date, type, severity,
     *   recommendation, score, zscores, reason, feature
     * }>>}
     */
    async detectAnomalies(equipmentId) {
        if (!equipmentId) throw new Error('equipmentId is required');

        console.log(`\n[AnomalyDetector] Analyzing: ${equipmentId}`);

        // ── Step 1: Fetch maintenance history ─────────────────────────────────
        let records;
        try {
            records = await this._fetchMaintenanceHistory(equipmentId);
        } catch (err) {
            console.warn('[AnomalyDetector] Neo4j unavailable:', err.message);
            records = [];
        }

        console.log(`[AnomalyDetector] Records found: ${records.length}`);

        if (records.length === 0) {
            console.log(`[AnomalyDetector] No maintenance history for "${equipmentId}"`);
            return [];
        }

        // ── Step 2: Extract feature vectors ───────────────────────────────────
        const features = this._extractFeatures(records);
        console.log(`[AnomalyDetector] Feature vectors extracted: ${features.length}`);

        // ── Step 3: Run Python anomaly detection ───────────────────────────────
        let pythonResult;
        try {
            pythonResult = await this.runPythonScript(features, equipmentId);
            console.log(`[AnomalyDetector] Python model: ${pythonResult.model}, anomalies: ${pythonResult.anomalyCount}`);
        } catch (err) {
            console.error('[AnomalyDetector] Python script failed:', err.message);
            // Fall back: flag records with severity CRITICAL or HIGH from Neo4j
            pythonResult = {
                anomalies: features
                    .filter(f => f.severity === 'CRITICAL' || f.severity === 'HIGH')
                    .map(f => ({
                        index:     f.index,
                        isAnomaly: true,
                        score:     -0.5,
                        zscores:   {},
                        reason:    `Severity ${f.severity} from graph`,
                    })),
            };
        }

        // ── Step 4: Classify and enrich each anomaly ───────────────────────────
        const anomalyResults = [];

        for (const pyAnomaly of (pythonResult.anomalies || [])) {
            if (!pyAnomaly.isAnomaly) continue;

            const feature  = features[pyAnomaly.index] || {};
            const type     = this.classifyAnomaly(feature, pyAnomaly.zscores || {});
            const severity = this.calculateSeverity(feature, type, pyAnomaly.score);
            const recommendation = this.getRecommendation(feature, type);

            anomalyResults.push({
                equipmentId,
                incidentId:     feature.incidentId,
                incidentName:   feature.incidentName,
                date:           feature.date,
                type,
                severity,
                recommendation,
                score:          pyAnomaly.score,
                zscores:        pyAnomaly.zscores || {},
                reason:         pyAnomaly.reason  || '',
                feature: {
                    mtbf:           feature.mtbf,
                    mttr:           feature.mttr,
                    cost:           feature.cost,
                    failureCount:   feature.failureCount,
                    technicianCount: feature.technicianCount,
                },
            });
        }

        // Sort: CRITICAL first, then by score (most anomalous first)
        const sOrder = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
        anomalyResults.sort((a, b) =>
            sOrder[a.severity] - sOrder[b.severity] || a.score - b.score
        );

        console.log(`[AnomalyDetector] Done. ${anomalyResults.length} anomalies detected.`);
        return anomalyResults;
    }
}

module.exports = { AnomalyDetector, ANOMALY_TYPES, SEVERITY, THRESHOLDS };

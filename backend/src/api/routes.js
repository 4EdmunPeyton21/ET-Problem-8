'use strict';

/**
 * backend/src/api/routes.js
 *
 * Express REST API routes for the Industrial Knowledge Intelligence system.
 * Matches all prompt specifications for document uploading, polling, and metadata retrieval.
 *
 * Endpoints:
 *   POST   /api/documents/upload        — Upload using 'file' field, saved as {documentId}.{ext}, queued
 *   GET    /api/documents/:documentId/status — Get job progress, status, entitiesExtracted, and errors
 *   GET    /api/documents/:documentId   — Get document node metadata from Neo4j
 *   GET    /api/documents               — List all documents in the graph
 *   GET    /api/graph/snapshot          — Full graph for D3.js visualization
 *   GET    /api/equipment               — List all equipment nodes
 *   GET    /api/equipment/:id/history   — Equipment failure + procedure history
 *   GET    /api/incidents/recent        — Recent incidents (last N days)
 *   POST   /api/rca/analyze             — Run Root Cause Analysis
 *   GET    /api/compliance/check        — Run compliance audit
 *   GET    /api/compliance/last         — Get last cached compliance audit
 *   GET    /api/health                  — Health check
 */

const express  = require('express');
const multer   = require('multer');
const path     = require('path');
const fs       = require('fs');

const { enqueueDocument, getJobStatus } = require('../workers/ingestion-worker');
const { getGraphManager }               = require('../graph/graph-manager');

const router = express.Router();

// ---------------------------------------------------------------------------
// Multer File Upload Setup (Target: uploads/{documentId}.{ext})
// ---------------------------------------------------------------------------

const UPLOAD_DIR = path.resolve(__dirname, '../../uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const ALLOWED_MIMES = new Set([
    'application/pdf',
    'message/rfc822',
    'text/plain',
    'image/png', 'image/jpeg', 'image/jpg', 'image/tiff',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
    filename:    (req, file, cb) => {
        // Pre-generate the unique documentId
        const documentId = `DOC-${Date.now()}-${Math.random().toString(36).substring(2, 7).toUpperCase()}`;
        const ext = path.extname(file.originalname).toLowerCase();
        
        // Attach documentId to request object for use in the route handler
        req.documentId = documentId;
        
        cb(null, `${documentId}${ext}`);
    },
});

const fileFilter = (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const allowedExts = new Set(['.pdf', '.eml', '.msg', '.txt', '.png', '.jpg', '.jpeg', '.tiff', '.csv', '.xls', '.xlsx']);
    if (ALLOWED_MIMES.has(file.mimetype) || allowedExts.has(ext)) {
        cb(null, true);
    } else {
        cb(new Error(`File type not supported: ${file.mimetype} (${ext})`), false);
    }
};

const upload = multer({
    storage,
    fileFilter,
    limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB max
});

// ---------------------------------------------------------------------------
// Helper: lazy-load agents
// ---------------------------------------------------------------------------

let _rcaAgent         = null;
let _complianceAgent  = null;

function getRCAAgent() {
    if (!_rcaAgent) {
        const { RCAAgent } = require('../agents/rca-agent');
        _rcaAgent = new RCAAgent(getGraphManager());
    }
    return _rcaAgent;
}

function getComplianceAgent() {
    if (!_complianceAgent) {
        const { ComplianceAgent } = require('../agents/compliance-agent');
        const io = router._io || null;
        _complianceAgent = new ComplianceAgent(getGraphManager(), io);
    }
    return _complianceAgent;
}

// ---------------------------------------------------------------------------
// Health Check
// ---------------------------------------------------------------------------

router.get('/health', async (_req, res) => {
    const gm    = getGraphManager();
    const alive = await gm.ping().catch(() => false);
    res.json({
        status:    alive ? 'healthy' : 'degraded',
        neo4j:     alive ? 'connected' : 'unreachable',
        timestamp: new Date().toISOString(),
    });
});

// ---------------------------------------------------------------------------
// Document Upload Route (POST /api/documents/upload)
// ---------------------------------------------------------------------------

/**
 * POST /api/documents/upload
 * Accepts multipart/form-data with 'file' field.
 * Saves file to backend/uploads/{documentId}.{ext}
 * Creates document record in Neo4j (Document node)
 * Adds to ingestionQueue
 * Returns { documentId, status: 'queued' }
 */
router.post('/documents/upload', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No document file provided. Use field name "file".' });
        }

        const documentId = req.documentId;
        const fileInfo   = {
            filePath:     req.file.path,
            filename:     req.file.filename,
            originalName: req.file.originalname,
            mimetype:     req.file.mimetype,
            size:         req.file.size,
        };

        console.log(`[routes] Upload received. Saving to: ${fileInfo.filename} (${fileInfo.originalName})`);

        // 1. Create document record in Neo4j (Document node)
        const gm = getGraphManager();
        await gm.insertEntity('Document', {
            documentId:   documentId,
            filename:     fileInfo.filename,
            originalName: fileInfo.originalName,
            mimetype:     fileInfo.mimetype,
            size:         fileInfo.size,
            status:       'queued',
        });

        // 2. Add to ingestionQueue (using documentId as forced job ID)
        await enqueueDocument(fileInfo, documentId);

        // 3. Return target payload
        res.status(202).json({
            documentId,
            status: 'queued',
        });

    } catch (error) {
        console.error('[routes] Ingestion queue upload error:', error.message);
        res.status(500).json({ error: error.message || 'Upload failed.' });
    }
});

// Multer error handler
router.use((err, _req, res, _next) => {
    if (err instanceof multer.MulterError || err.message?.includes('not supported')) {
        return res.status(400).json({ error: err.message });
    }
    _next(err);
});

// ---------------------------------------------------------------------------
// Document Job Status (GET /api/documents/:documentId/status)
// ---------------------------------------------------------------------------

/**
 * GET /api/documents/:documentId/status
 * Returns job progress: { progress: 0-100, status, entitiesExtracted, errors }
 */
router.get('/documents/:documentId/status', async (req, res) => {
    try {
        const jobId     = req.params.documentId;
        const jobStatus = await getJobStatus(jobId);

        if (jobStatus.status === 'not_found') {
            // Check if it already exists as fully completed in Neo4j
            const gm      = getGraphManager();
            const session = gm._session();
            const result  = await session.run(
                'MATCH (d:Document {documentId: $id}) RETURN d LIMIT 1',
                { id: jobId }
            );
            await session.close();

            if (result.records.length > 0) {
                // If it is in the database, return completed with 100% progress
                return res.json({
                    progress: 100,
                    status: 'completed',
                    entitiesExtracted: 0, // database metadata query would be needed for exact count
                    errors: [],
                });
            }

            return res.status(404).json({ error: `Document job "${jobId}" not found.` });
        }

        // Map Bull status to target contract
        res.json({
            progress:          jobStatus.progress,
            status:            jobStatus.status, // queued, active, completed, failed
            entitiesExtracted: jobStatus.result?.entitiesExtracted || 0,
            errors:            jobStatus.result?.errors || (jobStatus.failReason ? [jobStatus.failReason] : []),
        });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ---------------------------------------------------------------------------
// Document Metadata Retrieval (GET /api/documents/:documentId)
// ---------------------------------------------------------------------------

/**
 * GET /api/documents/:documentId
 * Returns document metadata from Neo4j
 */
router.get('/documents/:documentId', async (req, res) => {
    try {
        const gm      = getGraphManager();
        const session = gm._session();
        const result  = await session.run(
            'MATCH (d:Document {documentId: $id}) RETURN d LIMIT 1',
            { id: req.params.documentId }
        );
        await session.close();

        if (result.records.length === 0) {
            return res.status(404).json({ error: `Document "${req.params.documentId}" not found.` });
        }

        res.json(result.records[0].get('d').properties);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ---------------------------------------------------------------------------
// Additional Library & Agent routes
// ---------------------------------------------------------------------------

/**
 * GET /api/documents
 * List all Document nodes in the graph.
 */
router.get('/documents', async (_req, res) => {
    try {
        const session = getGraphManager()._session();
        const result  = await session.run(
            'MATCH (d:Document) RETURN d ORDER BY d.createdAt DESC LIMIT 100'
        );
        await session.close();
        res.json(result.records.map(r => r.get('d').properties));
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/graph/snapshot
 */
router.get('/graph/snapshot', async (_req, res) => {
    try {
        const snapshot = await getGraphManager().getGraphSnapshot();
        res.json(snapshot);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/graph/equipment/:id/visualization
 * Returns D3-ready { nodes, links } for the equipment subgraph.
 */
router.get('/graph/equipment/:id/visualization', async (req, res) => {
    try {
        const { exportGraphForVisualization } = require('../graph/queries');
        const graph = await exportGraphForVisualization(getGraphManager(), req.params.id);
        res.json(graph);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/equipment
 */
router.get('/equipment', async (req, res) => {
    try {
        const gm  = getGraphManager();
        const equipment = req.query.type
            ? await gm.getEquipmentByType(req.query.type)
            : await gm.getAllEquipment();
        res.json({ count: equipment.length, equipment });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/equipment/:id/history
 */
router.get('/equipment/:id/history', async (req, res) => {
    try {
        const history = await getGraphManager().queryEquipmentHistory(req.params.id);
        if (!history) {
            return res.status(404).json({ error: `Equipment "${req.params.id}" not found.` });
        }
        res.json(history);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/incidents/recent
 */
router.get('/incidents/recent', async (req, res) => {
    try {
        const days      = parseInt(req.query.days) || 30;
        const incidents = await getGraphManager().getRecentIncidents(days);
        res.json({ days, count: incidents.length, incidents });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/rca/analyze
 */
router.post('/rca/analyze', async (req, res) => {
    try {
        const { symptomDescription, equipmentId } = req.body;
        if (!symptomDescription) {
            return res.status(400).json({ error: 'symptomDescription is required.' });
        }
        const result = await getRCAAgent().analyzeIncident(symptomDescription, equipmentId || null);
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/compliance/check
 */
router.get('/compliance/check', async (_req, res) => {
    try {
        const result = await getComplianceAgent().checkCompliance();
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/compliance/last
 */
router.get('/compliance/last', (_req, res) => {
    const last = getComplianceAgent().getLastResult();
    if (!last) return res.status(404).json({ error: 'No compliance audit has been run yet.' });
    res.json(last);
});

// ---------------------------------------------------------------------------
// Anomaly Detection
// ---------------------------------------------------------------------------

let _anomalyDetector = null;
function getAnomalyDetector() {
    if (!_anomalyDetector) {
        const { AnomalyDetector } = require('../analytics/anomaly-detector');
        _anomalyDetector = new AnomalyDetector(getGraphManager());
    }
    return _anomalyDetector;
}

/**
 * GET /api/anomalies
 * Runs anomaly detection across ALL equipment in the graph and returns
 * a combined list sorted by severity (CRITICAL first).
 */
router.get('/anomalies', async (_req, res) => {
    try {
        const gm      = getGraphManager();
        const session = gm._session();
        // Fetch all distinct equipment IDs from the graph
        const result  = await session.run(
            `MATCH (e:Equipment) RETURN e.equipmentId AS id, e.name AS name LIMIT 200`
        );
        await session.close();

        const equipmentList = result.records.map(r => ({
            id:   r.get('id') || r.get('name'),
            name: r.get('name'),
        })).filter(e => e.id);

        if (equipmentList.length === 0) {
            return res.json({ count: 0, anomalies: [], equipmentScanned: 0 });
        }

        const detector = getAnomalyDetector();

        // Run detection for each equipment (sequentially to avoid overloading Python)
        const allAnomalies = [];
        for (const eq of equipmentList) {
            try {
                const found = await detector.detectAnomalies(eq.id);
                allAnomalies.push(...found);
            } catch (e) {
                console.warn(`[routes] Anomaly detection failed for ${eq.id}:`, e.message);
            }
        }

        // Sort CRITICAL → HIGH → MEDIUM → LOW
        const ORDER = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
        allAnomalies.sort((a, b) =>
            (ORDER[a.severity] ?? 9) - (ORDER[b.severity] ?? 9)
        );

        res.json({
            count:            allAnomalies.length,
            equipmentScanned: equipmentList.length,
            anomalies:        allAnomalies,
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/anomalies/:equipmentId
 * Runs Isolation Forest anomaly detection on the equipment's maintenance history.
 */
router.get('/anomalies/:equipmentId', async (req, res) => {
    try {
        const anomalies = await getAnomalyDetector().detectAnomalies(req.params.equipmentId);
        res.json({
            equipmentId: req.params.equipmentId,
            count:       anomalies.length,
            anomalies,
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ---------------------------------------------------------------------------
// Email Thread
// ---------------------------------------------------------------------------

/**
 * GET /api/emails/thread/:threadId
 * Returns all Email nodes belonging to a thread, sorted oldest→newest,
 * plus any linked Incident node.
 *
 * Email node properties expected in Neo4j:
 *   threadId, messageId, sender, recipients, subject, body, sentAt,
 *   direction ('sent' | 'received'), attachments
 *
 * Falls back to mock data when the graph has no Email nodes (dev mode).
 */
router.get('/emails/thread/:threadId', async (req, res) => {
    const { threadId } = req.params;
    try {
        const gm      = getGraphManager();
        const session = gm._session();

        const [emailResult, incidentResult] = await Promise.all([
            session.run(
                `MATCH (e:Email {threadId: $threadId})
                 RETURN e ORDER BY e.sentAt ASC`,
                { threadId }
            ),
            session.run(
                `MATCH (e:Email {threadId: $threadId})-[:LINKED_TO|RELATED_TO]->(i:Incident)
                 RETURN i LIMIT 1`,
                { threadId }
            ),
        ]);
        await session.close();

        const emails = emailResult.records.map(r => r.get('e').properties);

        // Return mock data for development when graph is empty
        if (emails.length === 0) {
            const mock = getMockThread(threadId);
            return res.json(mock);
        }

        const linkedIncident = incidentResult.records.length > 0
            ? incidentResult.records[0].get('i').properties
            : null;

        res.json({ threadId, emails, linkedIncident });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/** Development mock — returns a realistic email thread for any threadId */
function getMockThread(threadId) {
    const now = Date.now();
    return {
        threadId,
        linkedIncident: {
            incidentId:  'INC-2024-0042',
            name:        'Pump XYZ Bearing Failure',
            severity:    'HIGH',
            description: 'High-frequency vibration detected on Pump XYZ. Investigation ongoing.',
        },
        emails: [
            {
                messageId:  'msg-001',
                threadId,
                sender:     'ops.supervisor@plant.com',
                recipients: ['maintenance@plant.com'],
                subject:    `[ALERT] Abnormal vibration — Pump XYZ`,
                body:       `Team,\n\nWe've just received an automated alert regarding abnormal vibration levels on Pump XYZ (P-204) in Building 3.\n\nThe vibration reading is 12.4 mm/s — our threshold is 8 mm/s.\n\nPlease assign a technician immediately for inspection.\n\nBest,\nOps Supervisor`,
                sentAt:     new Date(now - 86400000 * 3).toISOString(),
                direction:  'received',
                attachments: [],
            },
            {
                messageId:  'msg-002',
                threadId,
                sender:     'maintenance@plant.com',
                recipients: ['ops.supervisor@plant.com'],
                subject:    `Re: [ALERT] Abnormal vibration — Pump XYZ`,
                body:       `Acknowledged. Assigning Technician R. Sharma for on-site inspection at 14:00 today.\n\nWill update once inspection is complete.\n\nMaintenance Team`,
                sentAt:     new Date(now - 86400000 * 2.8).toISOString(),
                direction:  'sent',
                attachments: [],
            },
            {
                messageId:  'msg-003',
                threadId,
                sender:     'r.sharma@plant.com',
                recipients: ['maintenance@plant.com', 'ops.supervisor@plant.com'],
                subject:    `Re: [ALERT] Abnormal vibration — Pump XYZ`,
                body:       `Inspection complete. Findings:\n\n1. Bearing wear on the drive-end (DE) is significant — estimated 60% degraded.\n2. Lubrication level was critically low (40% below spec).\n3. Seal integrity is still good.\n\nRecommendation: Schedule bearing replacement within 48 hours. Immediate lubrication top-up done on-site.\n\nAttaching inspection report.\n\n— R. Sharma`,
                sentAt:     new Date(now - 86400000 * 2).toISOString(),
                direction:  'received',
                attachments: ['inspection_report_pump_xyz.pdf'],
            },
            {
                messageId:  'msg-004',
                threadId,
                sender:     'ops.supervisor@plant.com',
                recipients: ['procurement@plant.com', 'maintenance@plant.com'],
                subject:    `Re: [ALERT] Abnormal vibration — Pump XYZ`,
                body:       `Procurement,\n\nPlease expedite the order for SKF 6205-2RS1 bearings (qty: 2) for Pump XYZ.\n\nThis is a HIGH priority. We need delivery within 24 hours.\n\nOps Supervisor`,
                sentAt:     new Date(now - 86400000 * 1.5).toISOString(),
                direction:  'sent',
                attachments: [],
            },
            {
                messageId:  'msg-005',
                threadId,
                sender:     'procurement@plant.com',
                recipients: ['ops.supervisor@plant.com'],
                subject:    `Re: [ALERT] Abnormal vibration — Pump XYZ`,
                body:       `Confirmed. Order placed with FastBearings Ltd (Order #FB-9921).\n\nEstimated delivery: Tomorrow by 10:00 AM.\n\nProcurement Team`,
                sentAt:     new Date(now - 86400000 * 1).toISOString(),
                direction:  'received',
                attachments: ['po_fb9921.pdf'],
            },
            {
                messageId:  'msg-006',
                threadId,
                sender:     'r.sharma@plant.com',
                recipients: ['maintenance@plant.com', 'ops.supervisor@plant.com'],
                subject:    `Re: [ALERT] Abnormal vibration — Pump XYZ`,
                body:       `Bearing replacement completed successfully. Pump XYZ is back online.\n\nPost-replacement vibration reading: 4.2 mm/s — within normal range.\n\nMarking incident as RESOLVED.\n\n— R. Sharma`,
                sentAt:     new Date(now - 3600000 * 2).toISOString(),
                direction:  'received',
                attachments: ['completion_report.pdf'],
            },
        ],
    };
}

module.exports = router;


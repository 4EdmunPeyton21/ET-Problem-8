'use strict';

/**
 * backend/src/api/routes.js
 *
 * Express REST API routes for the Industrial Knowledge Intelligence system.
 *
 * Endpoints:
 *   POST   /api/documents/upload     — Upload and queue a document for ingestion
 *   GET    /api/documents/status/:jobId — Poll ingestion job progress
 *   GET    /api/documents            — List all documents in the graph
 *   GET    /api/graph/snapshot       — Full graph for D3.js visualization
 *   GET    /api/equipment            — List all equipment nodes
 *   GET    /api/equipment/:id/history— Equipment failure + procedure history
 *   GET    /api/incidents/recent     — Recent incidents (last N days)
 *   POST   /api/rca/analyze          — Run Root Cause Analysis
 *   GET    /api/compliance/check     — Run compliance audit
 *   GET    /api/health               — Health check
 */

const express  = require('express');
const multer   = require('multer');
const path     = require('path');
const fs       = require('fs');

const { enqueueDocument, getJobStatus } = require('../workers/ingestion-worker');
const { getGraphManager }               = require('../graph/graph-manager');

const router = express.Router();

// ---------------------------------------------------------------------------
// Multer File Upload Setup
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
    filename:    (_req, file, cb) => {
        const ts     = Date.now();
        const rand   = Math.random().toString(36).substring(2, 8);
        const safe   = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
        cb(null, `${ts}-${rand}-${safe}`);
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
// Helper: lazy-load agents (avoids circular init issues)
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

/**
 * GET /api/health
 * Returns service status and Neo4j connectivity.
 */
router.get('/health', async (_req, res) => {
    const gm    = getGraphManager();
    const alive = await gm.ping().catch(() => false);
    res.json({
        status:    alive ? 'healthy' : 'degraded',
        neo4j:     alive ? 'connected' : 'unreachable',
        timestamp: new Date().toISOString(),
        version:   process.env.npm_package_version || '1.0.0',
    });
});

// ---------------------------------------------------------------------------
// Document Upload
// ---------------------------------------------------------------------------

/**
 * POST /api/documents/upload
 *
 * Accepts: multipart/form-data with field name "document"
 * Returns: { jobId, filename, queuePosition, status }
 *
 * The file is saved to disk and a Bull job is added to the ingestion queue.
 * Progress can be polled via GET /api/documents/status/:jobId
 * or received in real-time via Socket.io event "ingestion:progress".
 */
router.post('/documents/upload', upload.single('document'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No document file provided. Use field name "document".' });
        }

        const fileInfo = {
            filePath:     req.file.path,
            filename:     req.file.filename,
            originalName: req.file.originalname,
            mimetype:     req.file.mimetype,
            size:         req.file.size,
        };

        console.log('[routes] File received:', fileInfo.originalName, `(${(fileInfo.size / 1024).toFixed(1)} KB)`);

        // Add to Bull ingestion queue
        const { jobId, bullJobId, queuePosition } = await enqueueDocument(fileInfo);

        res.status(202).json({
            message:       'Document uploaded and queued for processing.',
            jobId,
            bullJobId,
            filename:      req.file.originalname,
            size:          req.file.size,
            mimetype:      req.file.mimetype,
            queuePosition,
            status:        'queued',
            pollUrl:       `/api/documents/status/${jobId}`,
            socketEvent:   'ingestion:progress',
        });

    } catch (error) {
        console.error('[routes] Upload error:', error.message);
        res.status(500).json({ error: error.message || 'Upload failed.' });
    }
});

// Multer error handler (file type / size violations)
router.use((err, _req, res, _next) => {
    if (err instanceof multer.MulterError || err.message?.includes('not supported')) {
        return res.status(400).json({ error: err.message });
    }
    _next(err);
});

// ---------------------------------------------------------------------------
// Job Status Polling
// ---------------------------------------------------------------------------

/**
 * GET /api/documents/status/:jobId
 * Returns the current status and progress (0-100) of an ingestion job.
 */
router.get('/documents/status/:jobId', async (req, res) => {
    try {
        const status = await getJobStatus(req.params.jobId);
        if (status.status === 'not_found') {
            return res.status(404).json({ error: `Job "${req.params.jobId}" not found.` });
        }
        res.json(status);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ---------------------------------------------------------------------------
// Document Library
// ---------------------------------------------------------------------------

/**
 * GET /api/documents
 * Returns all Document nodes in the graph.
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

// ---------------------------------------------------------------------------
// Graph Visualization
// ---------------------------------------------------------------------------

/**
 * GET /api/graph/snapshot
 * Returns nodes and links in D3.js-compatible format.
 * Query params: ?limit=500
 */
router.get('/graph/snapshot', async (req, res) => {
    try {
        const snapshot = await getGraphManager().getGraphSnapshot();
        res.json(snapshot);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ---------------------------------------------------------------------------
// Equipment
// ---------------------------------------------------------------------------

/**
 * GET /api/equipment
 * Returns all equipment nodes. Optional query param: ?type=pump
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
 * Returns the full failure, procedure, and parameter history for one equipment.
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

// ---------------------------------------------------------------------------
// Incidents
// ---------------------------------------------------------------------------

/**
 * GET /api/incidents/recent
 * Returns recent incidents. Optional query param: ?days=30
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

// ---------------------------------------------------------------------------
// Root Cause Analysis
// ---------------------------------------------------------------------------

/**
 * POST /api/rca/analyze
 * Body: { symptomDescription: string, equipmentId?: string }
 * Returns: Full RCA report with similar incidents, probable causes, steps.
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

// ---------------------------------------------------------------------------
// Compliance
// ---------------------------------------------------------------------------

/**
 * GET /api/compliance/check
 * Runs a full compliance audit. This may take 5-15 seconds.
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
 * Returns the cached result from the last compliance audit without re-running.
 */
router.get('/compliance/last', (_req, res) => {
    const last = getComplianceAgent().getLastResult();
    if (!last) return res.status(404).json({ error: 'No compliance audit has been run yet.' });
    res.json(last);
});

module.exports = router;

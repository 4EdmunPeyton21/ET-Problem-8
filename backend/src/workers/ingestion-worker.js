'use strict';

/**
 * backend/src/workers/ingestion-worker.js
 *
 * Bull-based background worker that processes uploaded documents through
 * the full ingestion pipeline:
 *
 *   File → Parser → NER → Relationships → Neo4j Graph
 *
 * Progress events (0-100) are emitted via Socket.io so the frontend
 * can display a live progress bar.
 *
 * Queue name: 'ingestion'
 * Export:     ingestionQueue (Bull queue instance)
 *
 * Usage:
 *   const { ingestionQueue } = require('./ingestion-worker');
 *   await ingestionQueue.add({ filePath, filename, mimetype, jobId });
 */

require('dotenv').config();

const Bull        = require('bull');
const path        = require('path');
const fs          = require('fs');
const { extractEntities }      = require('../extraction/ner-pipeline');
const { extractRelationships } = require('../extraction/relationship-extractor');
const { getGraphManager }      = require('../graph/graph-manager');

// ---------------------------------------------------------------------------
// Queue Setup
// ---------------------------------------------------------------------------

const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

const ingestionQueue = new Bull('ingestion', REDIS_URL, {
    defaultJobOptions: {
        attempts:  3,
        backoff:   { type: 'exponential', delay: 3000 },
        removeOnComplete: 50,   // keep last 50 completed jobs
        removeOnFail:     100,
    },
});

// ---------------------------------------------------------------------------
// Mime → Parser Mapping
// ---------------------------------------------------------------------------

const MIME_PARSERS = {
    'application/pdf':                    'pdf',
    'message/rfc822':                     'email',
    'text/plain':                         'text',
    'application/vnd.ms-excel':           'spreadsheet',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'spreadsheet',
    'image/png':                          'diagram',
    'image/jpeg':                         'diagram',
    'image/jpg':                          'diagram',
    'image/tiff':                         'diagram',
};

const EXT_PARSERS = {
    '.pdf':  'pdf',
    '.eml':  'email',
    '.msg':  'email',
    '.txt':  'text',
    '.csv':  'spreadsheet',
    '.xls':  'spreadsheet',
    '.xlsx': 'spreadsheet',
    '.png':  'diagram',
    '.jpg':  'diagram',
    '.jpeg': 'diagram',
    '.tiff': 'diagram',
};

function resolveParser(mimetype, filename) {
    if (MIME_PARSERS[mimetype]) return MIME_PARSERS[mimetype];
    const ext = path.extname(filename || '').toLowerCase();
    return EXT_PARSERS[ext] || 'text';
}

// ---------------------------------------------------------------------------
// Parser Dispatcher
// ---------------------------------------------------------------------------

async function parseDocument(filePath, parserType, filename) {
    switch (parserType) {
        case 'pdf': {
            const { parsePDF } = require('../ingestion/pdf-parser');
            const result       = await parsePDF(filePath);
            return result.text || result.content || JSON.stringify(result);
        }
        case 'email': {
            const { parseEmail } = require('../ingestion/email-parser');
            const result         = await parseEmail(filePath);
            return [result.subject, result.body, result.text].filter(Boolean).join('\n\n');
        }
        case 'spreadsheet': {
            const { parseSpreadsheet } = require('../ingestion/spreadsheet-parser');
            const result               = await parseSpreadsheet(filePath);
            if (Array.isArray(result)) return result.map(r => JSON.stringify(r)).join('\n');
            return result.text || JSON.stringify(result);
        }
        case 'diagram': {
            const { parseDiagram } = require('../ingestion/diagram-parser');
            const result           = await parseDiagram(filePath);
            return result.text || result.ocrText || JSON.stringify(result);
        }
        case 'text':
        default: {
            return fs.readFileSync(filePath, 'utf-8');
        }
    }
}

// ---------------------------------------------------------------------------
// Pipeline Progress Helper
// ---------------------------------------------------------------------------

/**
 * Emit a progress update through both the Bull job and Socket.io.
 *
 * @param {Bull.Job} job       - Active Bull job
 * @param {number}   pct       - Progress percentage 0-100
 * @param {string}   stage     - Human-readable stage label
 * @param {Object}   io        - Socket.io server (may be null)
 * @param {string}   jobId     - Unique job ID for the socket room
 */
async function emitProgress(job, pct, stage, io = null, jobId = null) {
    await job.progress(pct);
    console.log(`[ingestion-worker] Job ${job.id} — ${pct}% — ${stage}`);

    if (io && jobId) {
        io.emit('ingestion:progress', {
            jobId,
            progress: pct,
            stage,
            timestamp: new Date().toISOString(),
        });
    }
}

// ---------------------------------------------------------------------------
// Core Pipeline Processor
// ---------------------------------------------------------------------------

/**
 * Full ingestion pipeline for a single document.
 *
 * Job data shape:
 * {
 *   filePath:     string  — absolute path to the uploaded file
 *   filename:     string  — stored filename (with unique prefix)
 *   originalName: string  — original filename from user
 *   mimetype:     string  — MIME type detected by multer
 *   jobId:        string  — correlation ID for socket events
 * }
 */
async function processIngestionJob(job) {
    const { filePath, filename, originalName, mimetype, jobId } = job.data;

    // io may be injected after queue creation (see attachSocketIO)
    const io         = ingestionQueue._io || null;
    const errors     = [];
    let   text       = '';
    let   entities   = [];
    let   relationships = [];

    try {
        // ── Stage 1: Parse document (10%) ─────────────────────────────────────
        await emitProgress(job, 5, 'Parsing document…', io, jobId);

        const parserType = resolveParser(mimetype, originalName || filename);
        console.log(`[ingestion-worker] Parsing "${originalName}" as ${parserType}`);

        try {
            text = await parseDocument(filePath, parserType, originalName || filename);
            if (!text || text.trim().length < 10) {
                throw new Error(`Parser returned empty text for ${parserType}`);
            }
        } catch (parseErr) {
            // Fallback: try reading as plain text
            console.warn('[ingestion-worker] Parser failed, trying plain text:', parseErr.message);
            errors.push(`Parser warning: ${parseErr.message}`);
            text = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8') : '';
        }

        await emitProgress(job, 10, `Document parsed (${text.length} chars)`, io, jobId);

        // ── Stage 2: NER — Extract entities (30%) ────────────────────────────
        await emitProgress(job, 15, 'Extracting entities (NER)…', io, jobId);

        try {
            entities = await extractEntities(text, {
                filename:     originalName || filename,
                documentType: parserType,
            });
        } catch (nerErr) {
            console.error('[ingestion-worker] NER failed:', nerErr.message);
            errors.push(`NER error: ${nerErr.message}`);
            entities = [];
        }

        await emitProgress(job, 30, `NER complete — ${entities.length} entities`, io, jobId);

        // ── Stage 3: Extract relationships (50%) ──────────────────────────────
        await emitProgress(job, 35, 'Extracting relationships…', io, jobId);

        try {
            if (entities.length > 0) {
                relationships = await extractRelationships(text, entities);
            }
        } catch (relErr) {
            console.error('[ingestion-worker] Relationship extraction failed:', relErr.message);
            errors.push(`Relationship error: ${relErr.message}`);
            relationships = [];
        }

        await emitProgress(job, 50, `Relationships extracted — ${relationships.length} found`, io, jobId);

        // ── Stage 4: Save to Neo4j graph (70%) ────────────────────────────────
        await emitProgress(job, 55, 'Saving to knowledge graph…', io, jobId);

        let entitiesInserted     = 0;
        let relationshipsInserted = 0;

        try {
            const gm = getGraphManager();

            // Insert the Document node itself
            await gm.insertEntity('Document', {
                documentId:   jobId || filename,
                filename:     filename,
                originalName: originalName || filename,
                mimetype:     mimetype || 'unknown',
                parserType,
                charCount:    text.length,
                status:       'ingested',
            });

            await emitProgress(job, 60, 'Document node created…', io, jobId);

            // Bulk-insert entities
            const entResult = await gm.ingestEntities(entities);
            entitiesInserted = entResult.inserted;

            await emitProgress(job, 65, `${entitiesInserted} entity nodes saved…`, io, jobId);

            // Bulk-insert relationships
            const relResult = await gm.ingestRelationships(relationships);
            relationshipsInserted = relResult.inserted;

            await emitProgress(job, 70, `${relationshipsInserted} relationships saved…`, io, jobId);

        } catch (graphErr) {
            console.error('[ingestion-worker] Graph insertion failed:', graphErr.message);
            errors.push(`Graph error: ${graphErr.message}`);
        }

        // ── Stage 5: Complete (100%) ──────────────────────────────────────────
        await emitProgress(job, 100, 'Ingestion complete!', io, jobId);

        const result = {
            status:                 'completed',
            jobId,
            filename:               originalName || filename,
            parserType,
            textLength:             text.length,
            entitiesExtracted:      entities.length,
            entitiesInserted,
            relationshipsExtracted: relationships.length,
            relationshipsInserted,
            errors,
            completedAt:            new Date().toISOString(),
        };

        // Final socket notification
        if (io && jobId) {
            io.emit('ingestion:complete', result);
        }

        console.log('[ingestion-worker] Job complete:', JSON.stringify(result, null, 2));
        return result;

    } catch (fatalErr) {
        const result = {
            status:     'failed',
            jobId,
            filename:   originalName || filename,
            error:      fatalErr.message,
            errors:     [...errors, fatalErr.message],
            failedAt:   new Date().toISOString(),
        };

        console.error('[ingestion-worker] Fatal error:', fatalErr.message);

        if (io && jobId) {
            io.emit('ingestion:failed', result);
        }

        return result; // return instead of throw so Bull marks completed (not failed) — errors are in result
    }
}

// ---------------------------------------------------------------------------
// Register processor with Bull
// ---------------------------------------------------------------------------

ingestionQueue.process(async (job) => {
    return processIngestionJob(job);
});

// Queue event listeners
ingestionQueue.on('completed', (job, result) => {
    console.log(`[ingestion-worker] ✅ Job ${job.id} completed. Entities: ${result?.entitiesExtracted}, Rels: ${result?.relationshipsExtracted}`);
});

ingestionQueue.on('failed', (job, err) => {
    console.error(`[ingestion-worker] ❌ Job ${job.id} failed: ${err.message}`);
});

ingestionQueue.on('error', (err) => {
    console.error('[ingestion-worker] Queue error:', err.message);
});

ingestionQueue.on('stalled', (job) => {
    console.warn(`[ingestion-worker] ⚠️  Job ${job.id} stalled — will retry`);
});

// ---------------------------------------------------------------------------
// Socket.io injection helper
// ---------------------------------------------------------------------------

/**
 * Attach a Socket.io server instance so the worker can push live updates.
 * Call this from server.js after creating the io instance.
 *
 * @param {import('socket.io').Server} io
 */
function attachSocketIO(io) {
    ingestionQueue._io = io;
    console.log('[ingestion-worker] Socket.io attached — real-time progress enabled');
}

// ---------------------------------------------------------------------------
// Queue Manager Helpers (used by routes.js)
// ---------------------------------------------------------------------------

/**
 * Add a document to the ingestion queue.
 *
 * @param {Object} fileInfo - { filePath, filename, originalName, mimetype }
 * @returns {Promise<{jobId, queuePosition}>}
 */
async function enqueueDocument(fileInfo) {
    const jobId = `DOC-${Date.now()}-${Math.random().toString(36).substring(2, 7).toUpperCase()}`;

    const job = await ingestionQueue.add(
        { ...fileInfo, jobId },
        { jobId } // use jobId as Bull job ID for easy lookup
    );

    const counts = await ingestionQueue.getJobCounts();

    return {
        jobId,
        bullJobId:     job.id,
        queuePosition: counts.waiting + 1,
    };
}

/**
 * Get the current status and progress of a job by its jobId.
 *
 * @param {string} jobId
 * @returns {Promise<Object>}
 */
async function getJobStatus(jobId) {
    // Search by Bull job ID (we used jobId as the Bull job id)
    const job = await ingestionQueue.getJob(jobId);
    if (!job) {
        // Try to find by scanning recent jobs
        const jobs = await ingestionQueue.getJobs(['completed', 'failed', 'active', 'waiting']);
        const found = jobs.find(j => j.data?.jobId === jobId);
        if (!found) return { status: 'not_found', jobId };
        return _jobToStatus(found);
    }
    return _jobToStatus(job);
}

async function _jobToStatus(job) {
    const state    = await job.getState();
    const progress = job._progress || 0;
    return {
        jobId:      job.data?.jobId,
        bullJobId:  job.id,
        status:     state,
        progress,
        result:     job.returnvalue || null,
        failReason: job.failedReason || null,
        createdAt:  new Date(job.timestamp).toISOString(),
    };
}

module.exports = {
    ingestionQueue,
    enqueueDocument,
    getJobStatus,
    attachSocketIO,
};

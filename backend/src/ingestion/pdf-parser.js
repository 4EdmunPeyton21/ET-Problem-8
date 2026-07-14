'use strict';

const fs = require('fs');
const { pathToFileURL } = require('url');
const path = require('path');
const Tesseract = require('tesseract.js');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const PARSE_TIMEOUT_MS = 30_000; // 30 seconds max per PDF
const MIN_TEXT_CHARS_PER_PAGE = 30; // below this → treat page as scanned image

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Race a promise against a timeout.
 */
function withTimeout(promise, ms, label = 'operation') {
    const timer = new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`Timeout: ${label} exceeded ${ms}ms`)), ms)
    );
    return Promise.race([promise, timer]);
}

/**
 * Heuristic table detector.
 *
 * Looks for blocks of lines where ≥3 tokens per line are separated by two or
 * more whitespace characters (column alignment). Returns each table as a
 * 2-D array (array of row arrays).
 *
 * @param {string} text - raw text from a single PDF page
 * @returns {Array<Array<Array<string>>>} - array of tables
 */
function detectTables(text) {
    const tables = [];
    const lines = text.split(/\r?\n/);

    let currentTable = [];

    for (const line of lines) {
        // A "table row" has ≥ 2 columns separated by 2+ spaces or a tab
        const columns = line.split(/\t|  +/).map(c => c.trim()).filter(Boolean);

        if (columns.length >= 3) {
            currentTable.push(columns);
        } else {
            if (currentTable.length >= 2) {
                // Only keep tables with ≥ 2 data rows
                tables.push(currentTable);
            }
            currentTable = [];
        }
    }

    // Flush last table if we were still inside one
    if (currentTable.length >= 2) {
        tables.push(currentTable);
    }

    return tables;
}

/**
 * Run Tesseract OCR on a single page image canvas.
 * pageData should be an ImageData-compatible object from pdf.js render.
 * We write a PNG to a temp buffer so tesseract can process it.
 *
 * @param {Uint8ClampedArray} pixels  RGBA pixel data
 * @param {number}            width
 * @param {number}            height
 * @returns {Promise<string>}
 */
async function ocrPixels(pixels, width, height) {
    // Build a minimal PNG from raw RGBA data using the 'pngjs' or fall back to
    // a plain Uint8ClampedArray accepted by Tesseract.js >= 4
    const { data: { text } } = await Tesseract.recognize(
        { data: pixels, width, height },
        'eng',
        { logger: () => {} } // silence progress
    );
    return text.trim();
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Parse a PDF file, extract text (native or OCR), detect tables.
 *
 * @param {string} filePath  - Absolute or relative path to the PDF file
 * @returns {Promise<{
 *   fullText: string,
 *   tables:   Array,
 *   pages:    number,
 *   errors:   Array<string>
 * }>}
 */
async function parsePDF(filePath) {
    const errors = [];

    // ── Validate file ────────────────────────────────────────────────────────
    if (!filePath || typeof filePath !== 'string') {
        throw new TypeError('parsePDF requires a valid file path string.');
    }

    const resolvedPath = path.resolve(filePath);

    if (!fs.existsSync(resolvedPath)) {
        throw new Error(`File not found: ${resolvedPath}`);
    }

    const stat = fs.statSync(resolvedPath);
    if (stat.size === 0) {
        throw new Error(`File is empty: ${resolvedPath}`);
    }

    // ── Load pdfjs-dist (Node-compatible) ────────────────────────────────────
    const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.mjs');

    // Set worker path using a file:// URL (required for Windows Node compatibility)
    pdfjsLib.GlobalWorkerOptions.workerSrc = pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs')).toString();

    // ── Core parse logic ─────────────────────────────────────────────────────
    const parseTask = async () => {
        const dataBuffer = fs.readFileSync(resolvedPath);

        let pdf;
        try {
            const loadingTask = pdfjsLib.getDocument({
                data: new Uint8Array(dataBuffer),
                verbosity: 0,          // silence pdfjs console output
            });
            pdf = await loadingTask.promise;
        } catch (err) {
            throw new Error(`Corrupted or unreadable PDF: ${err.message}`);
        }

        const numPages = pdf.numPages;
        const pageTexts = [];
        const allTables = [];

        for (let pageNum = 1; pageNum <= numPages; pageNum++) {
            let page;
            try {
                page = await pdf.getPage(pageNum);
            } catch (err) {
                errors.push(`Page ${pageNum}: failed to load — ${err.message}`);
                pageTexts.push('');
                continue;
            }

            // ── 1. Try native text extraction ─────────────────────────────
            let pageText = '';
            try {
                const textContent = await page.getTextContent();
                pageText = textContent.items
                    .map(item => ('str' in item ? item.str : ''))
                    .join(' ')
                    .replace(/ {2,}/g, ' ')
                    .trim();
            } catch (err) {
                errors.push(`Page ${pageNum}: text extraction error — ${err.message}`);
            }

            // ── 2. Fall back to OCR if page is image-only ─────────────────
            if (pageText.length < MIN_TEXT_CHARS_PER_PAGE) {
                try {
                    const viewport = page.getViewport({ scale: 2.0 }); // 2× for better OCR

                    // In Node we use a minimal canvas shim.
                    // If 'canvas' package is available use it; otherwise skip OCR.
                    let canvasMod;
                    try { canvasMod = require('canvas'); } catch { canvasMod = null; }

                    if (canvasMod) {
                        const canvas = canvasMod.createCanvas(viewport.width, viewport.height);
                        const ctx = canvas.getContext('2d');

                        await page.render({
                            canvasContext: ctx,
                            viewport,
                        }).promise;

                        const imageData = ctx.getImageData(0, 0, viewport.width, viewport.height);
                        const ocrText = await ocrPixels(
                            imageData.data,
                            viewport.width,
                            viewport.height
                        );

                        if (ocrText.length > pageText.length) {
                            pageText = ocrText;
                        }
                    } else {
                        errors.push(
                            `Page ${pageNum}: scanned page detected but 'canvas' package not installed — OCR skipped.`
                        );
                    }
                } catch (err) {
                    errors.push(`Page ${pageNum}: OCR failed — ${err.message}`);
                }
            }

            pageTexts.push(pageText);

            // ── 3. Detect tables within this page ─────────────────────────
            const pageTables = detectTables(pageText);
            pageTables.forEach(table =>
                allTables.push({ page: pageNum, data: table })
            );
        }

        return {
            fullText: pageTexts.join('\n\n').trim(),
            tables:   allTables,
            pages:    numPages,
            errors,
        };
    };

    // ── Wrap with timeout ────────────────────────────────────────────────────
    try {
        return await withTimeout(
            parseTask(),
            PARSE_TIMEOUT_MS,
            `parsePDF(${path.basename(filePath)})`
        );
    } catch (err) {
        // Return a graceful degraded result rather than crashing the caller
        const isTimeout = err.message.startsWith('Timeout:');
        return {
            fullText: '',
            tables:   [],
            pages:    0,
            errors:   [isTimeout ? err.message : `Fatal: ${err.message}`],
        };
    }
}

module.exports = { parsePDF };

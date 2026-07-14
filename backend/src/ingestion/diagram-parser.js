'use strict';

const fs = require('fs');
const path = require('path');
const Tesseract = require('tesseract.js');
const sharp = require('sharp');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SUPPORTED_FORMATS = new Set(['.png', '.jpg', '.jpeg', '.tif', '.tiff', '.bmp', '.webp']);

// Minimum confidence % for a word to be included in the labels array.
// Words below this threshold are still included in rawText but flagged as low confidence.
const MIN_WORD_CONFIDENCE = 30;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Get image metadata (width, height, format) using sharp.
 * @param {string} imagePath
 * @returns {Promise<{ width: number, height: number, format: string }>}
 */
async function getImageMetadata(imagePath) {
    try {
        const meta = await sharp(imagePath).metadata();
        return {
            width: meta.width || null,
            height: meta.height || null,
            format: meta.format || path.extname(imagePath).replace('.', '') || 'unknown',
        };
    } catch {
        // Graceful fallback — return what we can from the extension
        return {
            width: null,
            height: null,
            format: path.extname(imagePath).replace('.', '') || 'unknown',
        };
    }
}

/**
 * Clean an OCR'd word string — removes surrounding whitespace and
 * stray punctuation-only fragments that Tesseract often hallucinates
 * on diagram backgrounds.
 * @param {string} word
 * @returns {string}
 */
function cleanWord(word) {
    return word.trim().replace(/^[^\w#%°]+$/, '');
}

// ---------------------------------------------------------------------------
// Main Export
// ---------------------------------------------------------------------------

/**
 * Parse an industrial diagram or image using Tesseract OCR.
 * Extracts all visible text labels and their bounding box positions.
 *
 * @param {string} imagePath  Absolute or relative path to the image file
 * @returns {Promise<{
 *   labels: Array<{
 *     text: string,
 *     confidence: number,
 *     bbox: { x0: number, y0: number, x1: number, y1: number }
 *   }>,
 *   rawText: string,
 *   imageMetadata: { width: number|null, height: number|null, format: string }
 * }>}
 */
async function parseDiagram(imagePath) {
    // ── Validate input ───────────────────────────────────────────────────────
    if (!imagePath || typeof imagePath !== 'string') {
        throw new TypeError('parseDiagram requires a valid image file path string.');
    }

    const resolvedPath = path.resolve(imagePath);

    if (!fs.existsSync(resolvedPath)) {
        throw new Error(`Image file not found: ${resolvedPath}`);
    }

    const ext = path.extname(resolvedPath).toLowerCase();
    if (!SUPPORTED_FORMATS.has(ext)) {
        throw new Error(
            `Unsupported image format: "${ext}". Supported: ${[...SUPPORTED_FORMATS].join(', ')}`
        );
    }

    const stat = fs.statSync(resolvedPath);
    if (stat.size === 0) {
        throw new Error(`Image file is empty: ${resolvedPath}`);
    }

    // ── Read image metadata in parallel with OCR ─────────────────────────────
    const performOCR = async () => {
        const worker = await Tesseract.createWorker('eng');
        try {
            return await worker.recognize(resolvedPath, {}, { blocks: true });
        } finally {
            await worker.terminate();
        }
    };

    const [imageMetadata, ocrResult] = await Promise.all([
        getImageMetadata(resolvedPath),
        performOCR(),
    ]);

    // ── Process word-level results ───────────────────────────────────────────
    const { data } = ocrResult;

    // Tesseract returns a hierarchy: blocks → paragraphs → lines → words
    // We flatten to word level to get individual label positions.
    const labels = [];

    for (const block of data.blocks || []) {
        for (const para of block.paragraphs || []) {
            for (const line of para.lines || []) {
                for (const word of line.words || []) {
                    const cleaned = cleanWord(word.text);
                    if (!cleaned) continue; // skip empty / punctuation-only fragments

                    labels.push({
                        text: cleaned,
                        confidence: Math.round(word.confidence),  // 0–100
                        bbox: {
                            x0: word.bbox.x0,
                            y0: word.bbox.y0,
                            x1: word.bbox.x1,
                            y1: word.bbox.y1,
                        },
                    });
                }
            }
        }
    }

    // ── Build rawText ─────────────────────────────────────────────────────────
    // Use Tesseract's full text output (preserves line structure better than
    // manually joining words).
    const rawText = (data.text || '').trim();

    // ── Sort labels top-to-bottom, left-to-right (reading order) ─────────────
    labels.sort((a, b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0);

    // ── Summary stats ─────────────────────────────────────────────────────────
    const highConfLabels = labels.filter(l => l.confidence >= MIN_WORD_CONFIDENCE);
    const avgConfidence =
        labels.length > 0
            ? Math.round(labels.reduce((s, l) => s + l.confidence, 0) / labels.length)
            : 0;

    return {
        labels,                  // All words with position + confidence
        rawText,                 // Full concatenated OCR text (line-aware)
        imageMetadata: {
            ...imageMetadata,
            totalWords: labels.length,
            highConfidenceWords: highConfLabels.length,
            averageConfidence: avgConfidence,
        },
    };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = { parseDiagram };

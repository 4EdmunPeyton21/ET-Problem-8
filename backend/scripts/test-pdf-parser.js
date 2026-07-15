const fs = require('fs');
const path = require('path');
const { parsePDF } = require('../src/ingestion/pdf-parser');
const { parseEmail, buildEmailThreads } = require('../src/ingestion/email-parser');
const { parseDiagram } = require('../src/ingestion/diagram-parser');

const samplesDir = path.join(__dirname, '../uploads/samples');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function detectTablesFromText(text) {
    const tables = [];
    const lines = text.split(/\r?\n/);
    let currentTable = [];
    for (const line of lines) {
        const columns = line.split(/\t|  +/).map(c => c.trim()).filter(Boolean);
        if (columns.length >= 3) {
            currentTable.push(columns);
        } else {
            if (currentTable.length >= 2) tables.push(currentTable);
            currentTable = [];
        }
    }
    if (currentTable.length >= 2) tables.push(currentTable);
    return tables;
}

// ---------------------------------------------------------------------------
// Per-file test handler
// ---------------------------------------------------------------------------

async function testFile(filePath) {
    const filename = path.basename(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const sep = '='.repeat(55);

    console.log(`\n${sep}`);
    console.log(`Processing: ${filename}  (${ext})`);
    console.log(sep);

    const startTime = Date.now();

    try {
        switch (ext) {

            // ── PDF ──────────────────────────────────────────────────────────
            case '.pdf': {
                console.log('Runner  → PDF Parser');
                const result = await parsePDF(filePath);
                console.log(`Parsed in      ${((Date.now() - startTime) / 1000).toFixed(2)}s`);
                console.log(`Pages:         ${result.pages}`);
                console.log(`Tables Found:  ${result.tables.length}`);
                console.log(`Errors:       `, result.errors);
                if (result.tables.length > 0) {
                    console.log('\n--- Detected Tables (JSON) ---');
                    console.log(JSON.stringify(result.tables, null, 2));
                }
                console.log('\n--- Text Preview (first 300 chars) ---');
                console.log(result.fullText.substring(0, 300) + (result.fullText.length > 300 ? '...' : ''));
                return null;
            }

            // ── EML / MSG ────────────────────────────────────────────────────
            case '.eml':
            case '.msg': {
                console.log('Runner  → Email Parser');
                const email = await parseEmail(filePath);
                console.log(`Parsed in      ${((Date.now() - startTime) / 1000).toFixed(2)}s`);
                console.log(`Message-ID:    ${email.messageId}`);
                console.log(`From:          ${email.from}`);
                console.log(`To:            ${email.to.join(', ')}`);
                console.log(`CC:            ${email.cc.join(', ') || '(none)'}`);
                console.log(`Subject:       ${email.subject}`);
                console.log(`Date:          ${email.date}`);
                console.log(`In-Reply-To:   ${email.inReplyTo || '(none)'}`);
                console.log(`References:    ${email.references.length > 0 ? email.references.join(', ') : '(none)'}`);
                console.log(`Attachments:   ${email.attachments.length}`);
                if (email.attachments.length > 0) {
                    email.attachments.forEach(a =>
                        console.log(`  → [${a.contentType}] ${a.filename} (${a.size} bytes)`)
                    );
                }
                console.log('\n--- Body Preview (first 300 chars) ---');
                console.log(email.body.substring(0, 300) + (email.body.length > 300 ? '...' : ''));
                return email; // Return so thread builder can use it
            }

            // ── Images (OCR) ─────────────────────────────────────────────────
            case '.png':
            case '.jpg':
            case '.jpeg':
            case '.tif':
            case '.tiff':
            case '.bmp':
            case '.webp': {
                console.log('Runner  → Diagram/OCR Parser');
                const ocrResult = await parseDiagram(filePath);
                const meta = ocrResult.imageMetadata;
                console.log(`Parsed in      ${((Date.now() - startTime) / 1000).toFixed(2)}s`);
                console.log(`Format:        ${meta.format}`);
                console.log(`Dimensions:    ${meta.width ?? '?'} × ${meta.height ?? '?'} px`);
                console.log(`Total Words:   ${meta.totalWords}`);
                console.log(`High Conf:     ${meta.highConfidenceWords}  (≥30% confidence)`);
                console.log(`Avg Conf:      ${meta.averageConfidence}%`);

                if (ocrResult.labels.length > 0) {
                    console.log('\n--- Labels with Positions (first 10) ---');
                    ocrResult.labels.slice(0, 10).forEach((l, i) => {
                        console.log(
                            `  [${String(i + 1).padStart(2)}] "${l.text}" ` +
                            `conf=${l.confidence}%  ` +
                            `bbox=(${l.bbox.x0},${l.bbox.y0})→(${l.bbox.x1},${l.bbox.y1})`
                        );
                    });
                    if (ocrResult.labels.length > 10) {
                        console.log(`  ... and ${ocrResult.labels.length - 10} more label(s)`);
                    }
                }

                console.log('\n--- Raw OCR Text Preview (first 300 chars) ---');
                console.log(ocrResult.rawText.substring(0, 300) + (ocrResult.rawText.length > 300 ? '...' : ''));
                return null;
            }

            // ── Plain Text ───────────────────────────────────────────────────
            case '.txt': {
                console.log('Runner  → Plain Text Parser');
                const text = fs.readFileSync(filePath, 'utf-8');
                const tables = detectTablesFromText(text);
                console.log(`Parsed in      ${((Date.now() - startTime) / 1000).toFixed(2)}s`);
                console.log(`Characters:    ${text.length}`);
                console.log(`Tables Found:  ${tables.length}`);
                if (tables.length > 0) {
                    console.log('\n--- Detected Tables (JSON) ---');
                    console.log(JSON.stringify(tables, null, 2));
                }
                console.log('\n--- Text Preview (first 300 chars) ---');
                console.log(text.substring(0, 300) + (text.length > 300 ? '...' : ''));
                return null;
            }

            default:
                console.log(`Unsupported file type: ${ext} — skipping.`);
                return null;
        }
    } catch (err) {
        console.error(`✗ Failed to process ${filename}: ${err.message}`);
        return null;
    }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function runBulkTest() {
    console.log('╔════════════════════════════════════════════════════════╗');
    console.log('║         Multi-Parser Bulk Test Runner                 ║');
    console.log('╚════════════════════════════════════════════════════════╝');
    console.log(`Scanning: ${samplesDir}\n`);

    if (!fs.existsSync(samplesDir)) {
        fs.mkdirSync(samplesDir, { recursive: true });
    }

    const files = fs.readdirSync(samplesDir)
        .map(f => path.join(samplesDir, f))
        .filter(p => fs.statSync(p).isFile());

    if (files.length === 0) {
        console.log('No files found in samples directory.');
        console.log(`Drop your files into:\n  ${samplesDir}`);
        console.log('\nSupported types: .pdf  .eml  .msg  .txt  .png  .jpg  .jpeg');
        console.log('\nThen re-run: node scripts/test-pdf-parser.js');
        return;
    }

    console.log(`Found ${files.length} file(s) to process.`);

    // Process each file
    const parsedEmails = [];
    for (const file of files) {
        const emailResult = await testFile(file);
        if (emailResult) parsedEmails.push(emailResult);
    }

    // ── Email Thread Analysis ────────────────────────────────────────────────
    if (parsedEmails.length > 0) {
        const sep = '='.repeat(55);
        console.log(`\n${sep}`);
        console.log(`EMAIL THREAD ANALYSIS  (${parsedEmails.length} message(s))`);
        console.log(sep);

        const threads = buildEmailThreads(parsedEmails);
        console.log(`Threads Identified: ${threads.length}\n`);

        threads.forEach((t, i) => {
            console.log(`  Thread ${i + 1}: "${t.subject}"`);
            console.log(`    Messages:     ${t.messageCount}`);
            console.log(`    Start:        ${t.startDate}`);
            console.log(`    Last:         ${t.lastDate}`);
            console.log(`    Participants: ${t.participants.join(', ')}`);
            console.log();
        });
    }

    const sep = '='.repeat(55);
    console.log(`\n${sep}`);
    console.log('✓ Bulk processing completed.');
    console.log(sep);
}

runBulkTest();

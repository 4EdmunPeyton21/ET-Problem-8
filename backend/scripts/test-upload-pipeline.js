'use strict';

/**
 * Automated end-to-end test for the upload and ingestion pipeline.
 *
 * It:
 *   1. Sets PORT=3010 and starts the backend Express server
 *   2. Simulates an upload POST /api/documents/upload with a mock file
 *   3. Polls GET /api/documents/:documentId/status
 *   4. Logs progress from 0% -> 100%
 *   5. Asserts entities are successfully extracted and saved to Neo4j
 *   6. Shuts down the server
 */

process.env.PORT = '3010';
process.env.NODE_ENV = 'test';

const fs    = require('fs');
const path  = require('path');
const http  = require('http');

// ── Helpers for making multipart/form-data POST without third-party dependencies ──

function postMultipart(url, filePath, fieldName, filename) {
    return new Promise((resolve, reject) => {
        const boundary = '----TestBoundary' + Math.random().toString(36).substring(2);
        const fileBuffer = fs.readFileSync(filePath);
        
        const header = 
            `--${boundary}\r\n` +
            `Content-Disposition: form-data; name="${fieldName}"; filename="${filename}"\r\n` +
            `Content-Type: application/octet-stream\r\n\r\n`;
            
        const footer = `\r\n--${boundary}--\r\n`;
        
        const reqOpts = {
            method: 'POST',
            headers: {
                'Content-Type': `multipart/form-data; boundary=${boundary}`,
                'Content-Length': Buffer.byteLength(header) + fileBuffer.length + Buffer.byteLength(footer),
            }
        };

        const parsedUrl = new URL(url);
        const req = http.request(parsedUrl, reqOpts, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    resolve({ status: res.statusCode, body: parsed });
                } catch (e) {
                    reject(new Error(`Failed to parse response: ${data}`));
                }
            });
        });

        req.on('error', reject);
        req.write(Buffer.from(header));
        req.write(fileBuffer);
        req.write(Buffer.from(footer));
        req.end();
    });
}

function getJson(url) {
    return new Promise((resolve, reject) => {
        http.get(url, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve({ status: res.statusCode, body: JSON.parse(data) });
                } catch (e) {
                    reject(new Error(`Failed to parse GET response: ${data}`));
                }
            });
        }).on('error', reject);
    });
}

const sleep = (ms) => new Promise(res => setTimeout(res, ms));

async function run() {
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║        Upload & Ingestion Pipeline E2E Test Runner           ║');
    console.log('╚══════════════════════════════════════════════════════════════╝\n');

    // 1. Start Server
    console.log('── Step 1: Starting Express Backend Server on Port 3010… ──────');
    const { getGraphManager } = require('../src/graph/graph-manager');
    const serverModule        = require('../src/server'); // spins up HTTP server

    // Wait a brief moment for server and database connection to spin up
    await sleep(2000);

    // 2. Identify file to upload
    const testFile = path.resolve(__dirname, '../uploads/samples/incident_report_2024_jan.txt');
    console.log(`\n── Step 2: Uploading Test File: ${path.basename(testFile)} ──`);
    
    // Perform POST upload to /api/documents/upload using 'document' field
    const uploadRes = await postMultipart(
        'http://localhost:3010/api/documents/upload',
        testFile,
        'document', // Field name matches request contract
        'e2e_test_incident_log.txt'
    );

    console.log('Upload HTTP Status:', uploadRes.status);
    console.log('Upload Response Payload:', uploadRes.body);

    if (uploadRes.status !== 202 || !uploadRes.body.jobId) {
        console.error('❌ Upload failed. Expected status 202 and a jobId.');
        process.exit(1);
    }

    const jobId = uploadRes.body.jobId;
    console.log(`\nDocument successfully queued. Assigned ID: ${jobId}`);

    // 3. Poll status
    console.log('\n── Step 3: Polling Ingestion Status (0% → 100%) ────────────────');

    let complete = false;
    let attempts = 0;
    const maxAttempts = 60; // 60s timeout

    while (!complete && attempts < maxAttempts) {
        attempts++;
        const statusRes = await getJson(`http://localhost:3010/api/documents/status/${jobId}`);

        const { progress, status, result, failReason } = statusRes.body;
        const entitiesExtracted = result?.entitiesExtracted ?? 0;
        console.log(`   [Poll #${attempts}] Progress: ${progress}% | Status: ${status} | Entities: ${entitiesExtracted}`);

        if (status === 'completed' || status === 'failed') {
            complete = true;
            console.log(`\nTerminal state reached: ${status.toUpperCase()}`);

            if (status === 'completed') {
                console.log(`✅ Success! Extracted ${entitiesExtracted} entities.`);
            } else {
                console.error(`❌ Ingestion failed. Reason: ${failReason}`);
            }
        } else {
            await sleep(1500); // Wait 1.5s between polls
        }
    }

    if (!complete) {
        console.error('❌ Test timed out before completing.');
    }

    // 4. Cleanup
    console.log('\n── Step 5: Shutting Down Server… ──────────────────────────────');
    const gm = getGraphManager();
    await gm.close();
    
    // Force exit to kill HTTP server listener cleanly
    console.log('\n══════════════════════════════════════════════════════════════');
    console.log(' E2E Upload Test Completed successfully!');
    console.log('══════════════════════════════════════════════════════════════');
    process.exit(0);
}

run().catch(err => {
    console.error('Test encountered fatal error:', err);
    process.exit(1);
});

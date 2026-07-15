const { extractEntities } = require('../src/extraction/ner-pipeline');
const fs = require('fs');
const path = require('path');

// Test on just ONE small file to verify rate limiting works without burning quota
const filePath = path.join(__dirname, '../uploads/samples/maintenance_log_pump_xyz.txt');
const text     = fs.readFileSync(filePath, 'utf-8');

console.log('Testing rate-limited Gemini NER on:', path.basename(filePath));
console.log('Input length:', text.length, 'chars\n');

const start = Date.now();
extractEntities(text, { filename: 'maintenance_log_pump_xyz.txt' }).then(entities => {
    const duration = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`\nDone! ${entities.length} entities found in ${duration}s`);
    const grouped = entities.reduce((acc, e) => { (acc[e.label] = acc[e.label] || []).push(e.text); return acc; }, {});
    for (const [label, items] of Object.entries(grouped)) {
        console.log(`  [${label.padEnd(10)}] (${items.length}): ${items.slice(0, 5).join(', ')}`);
    }
}).catch(console.error);

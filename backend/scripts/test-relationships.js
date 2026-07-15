const { extractEntities }       = require('../src/extraction/ner-pipeline');
const { extractRelationships }  = require('../src/extraction/relationship-extractor');
const fs   = require('fs');
const path = require('path');

// Use a small file to stay within API quota
const filePath = path.join(__dirname, '../uploads/samples/incident_report_2024_jan.txt');
const text     = fs.readFileSync(filePath, 'utf-8');

console.log('╔════════════════════════════════════════════════════════╗');
console.log('║        Relationship Extractor Test Runner              ║');
console.log('╚════════════════════════════════════════════════════════╝');
console.log('File:', path.basename(filePath));
console.log('Length:', text.length, 'chars\n');

async function run() {
    // Step 1: Extract entities
    console.log('── Step 1: Extracting Entities (NER) ──────────────────');
    const entities = await extractEntities(text.substring(0, 4000), { filename: 'incident_report_2024_jan.txt' });
    console.log(`Entities found: ${entities.length}`);

    // Print grouped summary
    const grouped = entities.reduce((acc, e) => {
        acc[e.label] = acc[e.label] || [];
        acc[e.label].push(e.text);
        return acc;
    }, {});
    for (const [label, items] of Object.entries(grouped)) {
        console.log(`  [${label.padEnd(10)}]: ${items.slice(0, 4).join(', ')}`);
    }

    // Step 2: Extract relationships
    console.log('\n── Step 2: Extracting Relationships ───────────────────');
    const relationships = await extractRelationships(text.substring(0, 4000), entities);

    console.log(`\nRelationships found: ${relationships.length}`);
    console.log('\nGrouped by Relation Type:');

    const relGrouped = relationships.reduce((acc, r) => {
        acc[r.relation] = acc[r.relation] || [];
        acc[r.relation].push(r);
        return acc;
    }, {});

    for (const [relType, rels] of Object.entries(relGrouped)) {
        console.log(`\n  [${relType}] (${rels.length}):`);
        rels.slice(0, 3).forEach(r => {
            console.log(`    "${r.source}" → "${r.target}"  (conf: ${r.confidence})`);
            console.log(`    evidence: ${r.evidence}`);
        });
    }
}

run().catch(console.error);

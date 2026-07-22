'use strict';

/**
 * Seed Neo4j database with extracted entities and relationships
 * from the sample incident report.
 */

const { extractEntities }      = require('../src/extraction/ner-pipeline');
const { extractRelationships } = require('../src/extraction/relationship-extractor');
const { getGraphManager }      = require('../src/graph/graph-manager');
const fs   = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '../uploads/samples/incident_report_2024_jan.txt');

async function run() {
    console.log('╔════════════════════════════════════════════════════════╗');
    console.log('║        Database Seeder (NER + Relations to Neo4j)      ║');
    console.log('╚════════════════════════════════════════════════════════╝');
    console.log('File:', path.basename(filePath));

    if (!fs.existsSync(filePath)) {
        console.error(`Sample file not found at: ${filePath}`);
        process.exit(1);
    }

    const text = fs.readFileSync(filePath, 'utf-8');
    const gm   = getGraphManager();

    try {
        const alive = await gm.ping();
        if (!alive) {
            console.error('Cannot connect to Neo4j. Check if service is running.');
            process.exit(1);
        }

        // Step 1: Extract entities
        console.log('\n── Step 1: Extracting Entities (NER) ──────────────────');
        // Limit to 4000 characters to stay within free tier limits quickly
        const entities = await extractEntities(text.substring(0, 4500), { filename: 'incident_report_2024_jan.txt' });
        console.log(`Entities found: ${entities.length}`);

        // Step 2: Save entities to Neo4j
        console.log('\n── Step 2: Saving Entities to Graph ──────────────────');
        const entityResults = await gm.ingestEntities(entities);
        console.log(`Entities saved: ${entityResults.inserted} inserted, ${entityResults.failed} failed.`);

        // Step 3: Extract relationships
        console.log('\n── Step 3: Extracting Relationships ───────────────────');
        const relationships = await extractRelationships(text.substring(0, 4500), entities);
        console.log(`Relationships found: ${relationships.length}`);

        // Step 4: Save relationships to Neo4j
        console.log('\n── Step 4: Saving Relationships to Graph ──────────────');
        const relResults = await gm.ingestRelationships(relationships);
        console.log(`Relationships saved: ${relResults.inserted} inserted, ${relResults.failed} failed.`);

        console.log('\n✅ Database seeding complete!');

    } catch (err) {
        console.error('Seeding failed:', err);
    } finally {
        await gm.close();
    }
}

run().catch(console.error);

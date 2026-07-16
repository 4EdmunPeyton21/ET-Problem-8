'use strict';

/**
 * Integration test for RCAAgent
 * Test: "Pump overheating and vibration" → finds similar incidents, suggests bearing inspection
 */

const { RCAAgent }    = require('../src/agents/rca-agent');
const { GraphManager } = require('../src/graph/graph-manager');
const { indexDocument } = require('../src/agents/agent-utils');

async function run() {
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║              RCA Agent Integration Test                      ║');
    console.log('╚══════════════════════════════════════════════════════════════╝\n');

    // ── Seed in-memory vector store with sample historical incidents ──────────
    console.log('── Seeding vector store with historical incidents ──────────────');
    await indexDocument('INC-2023-001', 'PUMP-XYZ bearing failure overheating excessive temperature 92 degrees', { type: 'incident', rootCause: 'Bearing wear due to lubrication starvation', date: '2023-06-12', rcaLink: 'DOC-RCA-001' });
    await indexDocument('INC-2023-004', 'centrifugal pump high vibration 6.2 mm/s imbalance rotor shaft', { type: 'incident', rootCause: 'Rotor imbalance after impeller erosion', date: '2023-09-01', rcaLink: 'DOC-RCA-004' });
    await indexDocument('INC-2022-007', 'compressor C-12 overheating 110 degrees oil degradation', { type: 'incident', rootCause: 'Insufficient lubrication - oil change overdue by 45 days', date: '2022-11-15', rcaLink: 'DOC-RCA-007' });
    await indexDocument('INC-2024-001', 'PUMP-XYZ cavitation low suction pressure 0.15 bar impeller erosion', { type: 'incident', rootCause: 'Blocked suction strainer reducing NPSH available', date: '2024-01-11', rcaLink: 'DOC-RCA-012' });
    await indexDocument('INC-2023-009', 'motor overheating vibration 5.8 mm/s misalignment coupling', { type: 'incident', rootCause: 'Pump-motor misalignment after maintenance reassembly', date: '2023-12-03', rcaLink: 'DOC-RCA-009' });
    console.log('✅ 5 historical incidents indexed in vector store\n');

    // ── Connect to Neo4j (optional) ───────────────────────────────────────────
    let graphManager = null;
    try {
        graphManager = new GraphManager();
        const alive  = await graphManager.ping();
        if (!alive) throw new Error('ping failed');
        console.log('✅ Neo4j connected\n');
    } catch (e) {
        console.log('⚠️  Neo4j not available — running without graph history\n');
        graphManager = null;
    }

    // ── Create agent ──────────────────────────────────────────────────────────
    const agent = new RCAAgent(graphManager);
    console.log(`✅ RCAAgent initialized. Provider: ${agent.provider || 'heuristic'}\n`);

    // ── TEST: Pump overheating and vibration ──────────────────────────────────
    const symptom     = 'Pump overheating and vibration';
    const equipmentId = 'PUMP-XYZ';

    console.log(`── Analyzing: "${symptom}" on ${equipmentId} ─────────────────────`);

    const result = await agent.analyzeIncident(symptom, equipmentId);

    // Pretty print
    console.log('\n╔══════════════════════════════╗');
    console.log('║        RCA REPORT            ║');
    console.log('╚══════════════════════════════╝');
    console.log(`Confidence Level:  ${result.confidenceLevel}`);
    console.log(`Provider:          ${result.provider}`);
    console.log(`Timestamp:         ${result.analysisTimestamp}`);

    console.log(`\n📌 Extracted Symptoms (${result.symptoms.length}):`);
    result.symptoms.forEach(s => console.log(`   • ${s}`));

    console.log(`\n🔍 Similar Historical Incidents (${result.similarHistoricalIncidents.length}):`);
    result.similarHistoricalIncidents.forEach((inc, i) => {
        console.log(`   ${i + 1}. [score: ${inc.similarityScore}] ${inc.incidentId || 'unknown'} — ${inc.date || 'no date'}`);
        console.log(`      Root Cause: ${inc.rootCause || 'not recorded'}`);
        if (inc.rcaLink) console.log(`      RCA Link:   ${inc.rcaLink}`);
    });

    console.log(`\n🎯 Probable Root Causes (${result.probableRootCauses.length}):`);
    result.probableRootCauses.forEach((c, i) => {
        const icon = c.likelihood === 'HIGH' ? '🔴' : c.likelihood === 'MEDIUM' ? '🟡' : '🟢';
        console.log(`   ${icon} [${c.likelihood}] ${c.cause}`);
        console.log(`      Evidence: ${c.evidence}`);
    });

    console.log(`\n🔧 Diagnostic Steps (${result.diagnosticSteps.length}):`);
    result.diagnosticSteps.forEach((s, i) => console.log(`   ${i + 1}. ${s}`));

    console.log(`\n🛡️  Preventive Measures (${result.preventiveMeasures.length}):`);
    result.preventiveMeasures.forEach((m, i) => console.log(`   ${i + 1}. ${m}`));

    // ── Validate expected output ──────────────────────────────────────────────
    console.log('\n── Validation ───────────────────────────────────────────────────');
    const hasBearing = result.probableRootCauses.some(c => c.cause.toLowerCase().includes('bearing') || c.evidence.toLowerCase().includes('bearing'));
    const hasSimilar = result.similarHistoricalIncidents.length > 0;
    const hasSteps   = result.diagnosticSteps.length > 0;

    console.log(`${hasBearing ? '✅' : '⚠️ '} Bearing inspection mentioned in root causes`);
    console.log(`${hasSimilar ? '✅' : '⚠️ '} Similar historical incidents found: ${result.similarHistoricalIncidents.length}`);
    console.log(`${hasSteps   ? '✅' : '⚠️ '} Diagnostic steps provided: ${result.diagnosticSteps.length}`);

    if (graphManager) await graphManager.close();

    console.log('\n══════════════════════════════════════════════════════════════════');
    console.log(' RCA Agent test complete!');
    console.log('══════════════════════════════════════════════════════════════════');
}

run().catch(console.error);

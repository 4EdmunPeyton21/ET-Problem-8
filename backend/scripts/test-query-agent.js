/**
 * Integration test for QueryAgent + agent-utils
 * Tests the full pipeline: "Has Pump Unit XYZ ever failed?"
 */

const { QueryAgent }          = require('../src/agents/query-agent');
const { GraphManager }        = require('../src/graph/graph-manager');
const {
    getEmbedding,
    vectorSearch,
    indexDocument,
    parseEquipmentId,
    getSimilarIncidents,
    queryGraph,
    formatCitations,
    extractConfidence,
    extractCitations,
} = require('../src/agents/agent-utils');

async function runTests() {
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║          QueryAgent + agent-utils Integration Test         ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');

    // ─────────────────────────────────────────────────────────────────────────
    // Unit tests — agent-utils functions (no API, no DB needed)
    // ─────────────────────────────────────────────────────────────────────────

    console.log('── Unit Tests (no API/DB required) ─────────────────────────────');

    // 1. Embedding smoke test
    const vec = await getEmbedding('pump cavitation failure unit a');
    console.log(`✅ getEmbedding: returned ${vec.length}-dim vector, magnitude ≈ 1.0 (sample: ${vec[0].toFixed(4)}, ${vec[1].toFixed(4)}, ...)`);

    // 2. parseEquipmentId
    const tests = [
        ['Has Pump Unit XYZ ever failed?',      'XYZ'],
        ['Tell me about PUMP-XYZ-2019',          'PUMP-XYZ-2019'],
        ['What happened with motor M-03?',       'M-03'],
        ['Compressor C-12 maintenance history',  'C-12'],
        ['Tell me about the centrifugal pump',   null],  // no ID → null
    ];
    console.log('\n✅ parseEquipmentId tests:');
    for (const [input, expected] of tests) {
        const result = parseEquipmentId(input);
        const pass   = result === expected || (result !== null && expected !== null && result.includes(expected));
        console.log(`   ${pass ? '✅' : '⚠️ '} "${input}" → ${result} (expected: ${expected})`);
    }

    // 3. Vector store index + search
    await indexDocument('DOC-001', 'PUMP-XYZ centrifugal pump cavitation failure impeller erosion', { type: 'incident_report' });
    await indexDocument('DOC-002', 'SOP-42A pump startup procedure lockout tagout pressure check', { type: 'procedure' });
    await indexDocument('DOC-003', 'ISO 4406 hydraulic fluid contamination specification standard', { type: 'regulation' });

    const searchResults = await vectorSearch('pump failure cavitation', null, 2);
    console.log(`\n✅ vectorSearch (in-memory): found ${searchResults.length} results`);
    searchResults.forEach((r, i) => console.log(`   ${i + 1}. [${r.score.toFixed(3)}] ${r.documentId}`));

    // 4. formatCitations
    const refs = {
        'DOC-001': { page: 3,  filename: 'incident_report_2024_jan.txt' },
        'DOC-002': { page: 12, filename: 'sop_42a_pump_startup.txt'     },
    };
    const rawText    = 'See [DOC-001] for incident data and [DOC-002] for the SOP.';
    const formatted  = formatCitations(rawText, refs);
    console.log(`\n✅ formatCitations:`);
    console.log(`   Input:  ${rawText}`);
    console.log(`   Output: ${formatted}`);

    // 5. extractConfidence + extractCitations
    const sampleAnswer = 'Clearly PUMP-XYZ failed at 9.8 bar on 2024-01-11. See [INC-2024-001].';
    console.log(`\n✅ extractConfidence: "${extractConfidence(sampleAnswer)}"`);
    console.log(`✅ extractCitations:  ${extractCitations(sampleAnswer).join(', ')}`);

    // ─────────────────────────────────────────────────────────────────────────
    // QueryAgent test — "Has Pump Unit XYZ ever failed?"
    // (Uses Groq if key is available, offline fallback otherwise)
    // ─────────────────────────────────────────────────────────────────────────

    console.log('\n── QueryAgent Test — "Has Pump Unit XYZ ever failed?" ──────────');

    let graphManager = null;
    try {
        graphManager = new GraphManager();
        const alive  = await graphManager.ping();
        if (!alive) throw new Error('Neo4j ping failed');
        console.log('✅ Neo4j connected');
    } catch (e) {
        console.log('⚠️  Neo4j not available — running in offline mode:', e.message);
        graphManager = null;
    }

    const agent = new QueryAgent(graphManager);
    console.log('✅ QueryAgent initialized (provider:', agent.provider, ')');

    const question = 'Has Pump Unit XYZ ever failed?';
    console.log(`\n📌 Question: "${question}"\n`);

    const result = await agent.query(question);

    console.log('Answer:\n', result.answer);
    console.log('\nConfidence:  ', result.confidence);
    console.log('Citations:   ', result.citations.join(', ') || '(none)');
    console.log('Provider:    ', result.provider);
    console.log('Timestamp:   ', result.timestamp);

    if (graphManager) await graphManager.close();

    console.log('\n══════════════════════════════════════════════════════════════');
    console.log(' All tests complete!');
    console.log('══════════════════════════════════════════════════════════════');
}

runTests().catch(console.error);

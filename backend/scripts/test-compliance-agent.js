'use strict';

/**
 * Integration test for ComplianceAgent
 * Audits plant database and emits warnings/compliance scores
 */

const { ComplianceAgent } = require('../src/agents/compliance-agent');
const { GraphManager }     = require('../src/graph/graph-manager');

async function run() {
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║           Compliance Agent Integration Test                  ║');
    console.log('╚══════════════════════════════════════════════════════════════╝\n');

    let graphManager = null;
    try {
        graphManager = new GraphManager();
        const alive  = await graphManager.ping();
        if (!alive) throw new Error('ping failed');
        console.log('✅ Neo4j connected\n');
    } catch (e) {
        console.log('⚠️  Neo4j not available — running in rule-based offline mode\n');
        graphManager = null;
    }

    const agent = new ComplianceAgent(graphManager);
    console.log(`✅ ComplianceAgent initialized (provider: ${agent.provider || 'rule-based'})\n`);

    console.log('── Running compliance audit… ──────────────────────────────────');
    const result = await agent.checkCompliance();

    console.log('\n╔══════════════════════════════╗');
    console.log('║      AUDIT REPORT CARD       ║');
    console.log('╚══════════════════════════════╝');
    console.log(`Compliance Score:  ${(result.complianceScore * 100).toFixed(0)}%`);
    console.log(`Provider:          ${result.provider}`);
    console.log(`Audited At:        ${result.lastAudit}`);
    console.log(`Summary:           ${result.summary}`);

    console.log(`\n🚨 Identified Gaps (${result.gaps.length}):`);
    result.gaps.forEach((g, i) => {
        const severityColour = g.severity === 'HIGH' ? '🔴' : g.severity === 'MEDIUM' ? '🟡' : '🟢';
        console.log(`\n   ${i + 1}. ${severityColour} [${g.severity}] ${g.gap}`);
        console.log(`      Requirement:   ${g.requirementId} — ${g.requirement}`);
        console.log(`      Current State: ${g.currentState}`);
        console.log(`      Action:        ${g.recommendedAction}`);
        if (g.affectedEquipment?.length) {
            console.log(`      Equipment:     ${g.affectedEquipment.join(', ')}`);
        }
        if (g.daysOverdue) {
            console.log(`      Overdue by:    ${g.daysOverdue} days`);
        }
    });

    if (graphManager) await graphManager.close();

    console.log('\n══════════════════════════════════════════════════════════════════');
    console.log(' Compliance Agent test complete!');
    console.log('══════════════════════════════════════════════════════════════════');
}

run().catch(console.error);

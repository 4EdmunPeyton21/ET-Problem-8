const { getGraphManager } = require('../src/graph/graph-manager');
require('dotenv').config();

async function runInit() {
    console.log('--- Neo4j Database Initialization ---');
    console.log(`Connecting to Neo4j at: ${process.env.NEO4J_URI || 'bolt://localhost:7687'}...`);
    
    const gm = getGraphManager();

    try {
        // 1. Verify Connection
        const alive = await gm.ping();
        if (!alive) {
            throw new Error('Could not ping Neo4j database. Check that the service is running and credentials are correct.');
        }
        console.log('Connection successful!');

        // 2. Initialize Schema (Constraints & Indexes)
        await gm.initializeSchema();
        
        console.log('\nDatabase initialized successfully!');
        
        // 3. Optional Verification Check
        const session = gm._session();
        try {
            const constraintsRes = await session.run('SHOW CONSTRAINTS');
            console.log('\n--- Active Constraints ---');
            constraintsRes.records.forEach(r => {
                console.log(`- ${r.get('name')} (${r.get('type')})`);
            });

            const indexesRes = await session.run('SHOW INDEXES');
            console.log('\n--- Active Indexes ---');
            indexesRes.records.forEach(r => {
                console.log(`- ${r.get('name')} (${r.get('state')})`);
            });
        } finally {
            await session.close();
        }

    } catch (error) {
        console.error('\nDatabase initialization failed!');
        console.error('Error Details:', error.message);
        console.log('\nTroubleshooting tips:');
        console.log('1. Verify Neo4j is running (docker ps or local service).');
        console.log('2. Check that NEO4J_URI, NEO4J_USER, and NEO4J_PASSWORD in your backend/.env match your instance.');
    } finally {
        await gm.close();
        console.log('\nDatabase connection closed.');
    }
}

runInit();

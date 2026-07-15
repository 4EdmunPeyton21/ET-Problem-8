const { extractEntities } = require('../src/extraction/ner-pipeline');
const fs = require('fs');
const path = require('path');

const samplesDir = path.join(__dirname, '../uploads/samples');

async function runNERTest() {
    console.log('╔════════════════════════════════════════════════════════╗');
    console.log('║           NER Pipeline Test Runner                    ║');
    console.log('╚════════════════════════════════════════════════════════╝');

    // Pick .txt files from the samples directory
    const files = fs.readdirSync(samplesDir)
        .filter(f => f.endsWith('.txt'))
        .map(f => path.join(samplesDir, f));

    if (files.length === 0) {
        console.log('No .txt files found in uploads/samples/');
        return;
    }

    for (const filePath of files) {
        const filename = path.basename(filePath);
        const text = fs.readFileSync(filePath, 'utf-8');

        console.log('\n' + '='.repeat(55));
        console.log('File:         ', filename);
        console.log('Input length: ', text.length, 'chars');
        console.log('='.repeat(55));

        const start = Date.now();
        const entities = await extractEntities(text, { filename, type: 'text_file' });
        const duration = ((Date.now() - start) / 1000).toFixed(2);

        console.log('Entities found:', entities.length, ' | Duration:', duration + 's');
        console.log('\nGrouped by Label:');

        const grouped = entities.reduce((acc, e) => {
            acc[e.label] = acc[e.label] || [];
            acc[e.label].push(e.text);
            return acc;
        }, {});

        for (const [label, items] of Object.entries(grouped)) {
            const preview = items.slice(0, 6).join(', ');
            const more    = items.length > 6 ? ' ...' : '';
            console.log('  [' + label.padEnd(10) + '] (' + items.length + '): ' + preview + more);
        }
    }

    console.log('\n' + '='.repeat(55));
    console.log('NER test complete.');
    console.log('='.repeat(55));
}

runNERTest().catch(console.error);

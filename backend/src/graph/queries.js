'use strict';

/**
 * backend/src/graph/queries.js
 *
 * Reusable Neo4j query helpers for the Industrial Knowledge Intelligence system.
 *
 * Primary export:
 *   exportGraphForVisualization(graphManager, equipmentId)
 *     → { nodes: [...], links: [...] }
 *
 * Node colours (per spec):
 *   Equipment  : #2F5233  (dark green)
 *   Procedure  : #4472C4  (blue)
 *   Incident   : #ED7D31  (orange)
 *   Parameter  : #70AD47  (light green)
 *   Regulation : #FFC7CE  (pink/red)
 *   Document   : #9B59B6  (purple)   ← extra type present in schema
 *   default    : #94A3B8  (slate)
 */

// ── Node type → display colour mapping ───────────────────────────────────────

const TYPE_COLORS = {
    Equipment:  '#2F5233',
    Procedure:  '#4472C4',
    Incident:   '#ED7D31',
    Parameter:  '#70AD47',
    Regulation: '#FFC7CE',
    Document:   '#9B59B6',
    Default:    '#94A3B8',
};

/**
 * Resolve the primary label for a Neo4j node (skip internal Neo4j labels).
 * @param {string[]} labels
 * @returns {string}
 */
function resolveLabel(labels = []) {
    const skip = new Set(['_Migrated', 'Resource', 'Entity']);
    const known = Object.keys(TYPE_COLORS);
    // Prefer a known type label first
    for (const l of labels) {
        if (known.includes(l)) return l;
    }
    // Otherwise return first non-internal label
    for (const l of labels) {
        if (!skip.has(l)) return l;
    }
    return labels[0] || 'Unknown';
}

/**
 * Build a stable node ID string from a Neo4j internal integer.
 * @param {import('neo4j-driver').Integer|number} id
 * @returns {string}
 */
function nodeId(id) {
    if (id && typeof id === 'object' && 'low' in id) {
        // neo4j-driver Integer type
        return `n${id.low}_${id.high}`;
    }
    return `n${id}`;
}

// ── Main export function ──────────────────────────────────────────────────────

/**
 * Export the subgraph around an equipment node into a D3-friendly structure.
 *
 * Strategy:
 *   1. Find the Equipment node matching equipmentId (by .equipmentId OR .name).
 *   2. Traverse ALL relationships up to 2 hops — covers:
 *        Equipment → Incident, Procedure, Parameter, Regulation, Document, …
 *   3. Deduplicate nodes and links.
 *   4. Attach colour, type, createdAt, lastUpdated to each node.
 *
 * @param {import('../graph/graph-manager').GraphManager} graphManager
 * @param {string} equipmentId  Equipment tag or name (e.g. "PUMP-XYZ")
 * @returns {Promise<{nodes: object[], links: object[]}>}
 */
async function exportGraphForVisualization(graphManager, equipmentId) {
    const session = graphManager._session();

    try {
        // ── Cypher: 2-hop neighbourhood ──────────────────────────────────────
        const result = await session.run(
            `
            MATCH (root)
            WHERE (root:Equipment AND (root.equipmentId = $id OR root.name = $id))
               OR (root.name = $id)
            WITH root LIMIT 1

            // Collect all paths up to 2 hops from root
            OPTIONAL MATCH path = (root)-[r1*0..2]-(neighbor)
            WHERE neighbor <> root OR r1 IS NULL

            WITH root,
                 collect(DISTINCT neighbor) AS neighbors,
                 collect(DISTINCT r1)       AS relPaths

            // Also grab direct relationships for each neighbor pair
            OPTIONAL MATCH (a)-[rel]->(b)
            WHERE (a = root OR a IN neighbors)
              AND (b = root OR b IN neighbors)

            RETURN
                root,
                collect(DISTINCT a)   AS allNodes,
                collect(DISTINCT b)   AS bNodes,
                collect(DISTINCT {
                    srcId:  id(a),
                    tgtId:  id(b),
                    relType: type(rel)
                }) AS rels
            `,
            { id: equipmentId }
        );

        if (result.records.length === 0 || !result.records[0].get('root')) {
            return { nodes: [], links: [] };
        }

        const record    = result.records[0];
        const rootNode  = record.get('root');
        const aNodes    = record.get('allNodes') || [];
        const bNodes    = record.get('bNodes')   || [];
        const rawRels   = record.get('rels')     || [];

        // ── Collect all unique Neo4j node objects ─────────────────────────────
        const nodeMap = new Map();   // nodeId → node spec

        const registerNode = (neo4jNode) => {
            if (!neo4jNode || !neo4jNode.identity) return;
            const id    = nodeId(neo4jNode.identity);
            if (nodeMap.has(id)) return;

            const props  = neo4jNode.properties || {};
            const type   = resolveLabel(neo4jNode.labels || []);
            const color  = TYPE_COLORS[type] || TYPE_COLORS.Default;
            const label  = props.name || props.equipmentId || props.documentId
                         || props.incidentId || props.parameterId
                         || props.regulationId || id;

            nodeMap.set(id, {
                id,
                label:       String(label),
                type,
                color,
                // Extra properties for tooltip / filtering
                description: props.description  || null,
                status:      props.status        || null,
                severity:    props.severity      || null,
                value:       props.value         || null,
                createdAt:   props.createdAt     || null,
                lastUpdated: props.lastUpdated   || props.updatedAt || null,
            });
        };

        registerNode(rootNode);
        for (const n of [...aNodes, ...bNodes]) registerNode(n);

        // ── Build link list ───────────────────────────────────────────────────
        const linkSet = new Set();
        const links   = [];

        for (const rel of rawRels) {
            if (!rel || rel.relType === null) continue;

            const src = `n${rel.srcId && 'low' in rel.srcId ? `${rel.srcId.low}_${rel.srcId.high}` : rel.srcId}`;
            const tgt = `n${rel.tgtId && 'low' in rel.tgtId ? `${rel.tgtId.low}_${rel.tgtId.high}` : rel.tgtId}`;
            const key = `${src}→${tgt}→${rel.relType}`;

            if (linkSet.has(key))           continue;
            if (!nodeMap.has(src))          continue;
            if (!nodeMap.has(tgt))          continue;
            if (src === tgt)                continue;

            linkSet.add(key);
            links.push({
                source: src,
                target: tgt,
                label:  rel.relType.replace(/_/g, ' '),
            });
        }

        return {
            nodes: Array.from(nodeMap.values()),
            links,
        };

    } finally {
        await session.close();
    }
}

// ── Additional helper queries (exposed for other modules) ─────────────────────

/**
 * Get all equipment IDs that exist in the graph.
 * @param {object} graphManager
 * @returns {Promise<string[]>}
 */
async function getAllEquipmentIds(graphManager) {
    const session = graphManager._session();
    try {
        const result = await session.run(
            `MATCH (e:Equipment) RETURN e.equipmentId AS eid, e.name AS name LIMIT 500`
        );
        return result.records.map(r => r.get('eid') || r.get('name')).filter(Boolean);
    } finally {
        await session.close();
    }
}

/**
 * Get the full graph snapshot (all nodes + relationships) for global visualization.
 * Used by GET /api/graph/snapshot.
 * @param {object} graphManager
 * @param {number} [limit=200]
 * @returns {Promise<{nodes: object[], links: object[]}>}
 */
async function getFullGraphSnapshot(graphManager, limit = 200) {
    const session = graphManager._session();
    try {
        // A Neo4j session can only run one query at a time — sequence these,
        // don't Promise.all them on the same session.
        const nodeResult = await session.run(`MATCH (n) RETURN n LIMIT $limit`, { limit });
        const relResult  = await session.run(
            `MATCH (a)-[r]->(b) RETURN id(a) AS src, id(b) AS tgt, type(r) AS rel LIMIT $limit`,
            { limit }
        );

        const nodeMap = new Map();
        for (const rec of nodeResult.records) {
            const n     = rec.get('n');
            const id    = nodeId(n.identity);
            const type  = resolveLabel(n.labels || []);
            const props = n.properties || {};
            nodeMap.set(id, {
                id,
                label:       String(props.name || props.equipmentId || props.documentId || id),
                type,
                color:       TYPE_COLORS[type] || TYPE_COLORS.Default,
                createdAt:   props.createdAt   || null,
                lastUpdated: props.lastUpdated || props.updatedAt || null,
            });
        }

        const links = [];
        const seen  = new Set();
        for (const rec of relResult.records) {
            const src = nodeId(rec.get('src'));
            const tgt = nodeId(rec.get('tgt'));
            const rel = rec.get('rel');
            const key = `${src}→${tgt}→${rel}`;
            if (seen.has(key) || !nodeMap.has(src) || !nodeMap.has(tgt)) continue;
            seen.add(key);
            links.push({ source: src, target: tgt, label: rel.replace(/_/g, ' ') });
        }

        return { nodes: Array.from(nodeMap.values()), links };
    } finally {
        await session.close();
    }
}

module.exports = { exportGraphForVisualization, getAllEquipmentIds, getFullGraphSnapshot, TYPE_COLORS };

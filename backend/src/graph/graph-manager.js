'use strict';

/**
 * backend/src/graph/graph-manager.js
 *
 * Neo4j Graph Manager for the Industrial Knowledge Intelligence system.
 * Provides a clean class-based interface for all graph operations.
 *
 * Usage:
 *   const { GraphManager } = require('./graph/graph-manager');
 *   const gm = new GraphManager();
 *   await gm.insertEntity('Equipment', { equipmentId: 'PUMP-XYZ', name: 'PUMP-XYZ' });
 */

const neo4j = require('neo4j-driver');
const path  = require('path');
const fs    = require('fs');
require('dotenv').config();

// ---------------------------------------------------------------------------
// GraphManager Class
// ---------------------------------------------------------------------------

class GraphManager {

    /**
     * @param {string} uri      - Neo4j bolt URI  (default: NEO4J_URI from .env)
     * @param {string} user     - Neo4j username  (default: NEO4J_USER from .env)
     * @param {string} password - Neo4j password  (default: NEO4J_PASSWORD from .env)
     */
    constructor(
        uri      = process.env.NEO4J_URI      || 'bolt://localhost:7687',
        user     = process.env.NEO4J_USER     || 'neo4j',
        password = process.env.NEO4J_PASSWORD || 'testpassword123'
    ) {
        this.uri      = uri;
        this.user     = user;
        this.password = password;
        this.driver   = null;

        this._connect();
    }

    // ── Internal: Connection ──────────────────────────────────────────────────

    _connect() {
        try {
            this.driver = neo4j.driver(
                this.uri,
                neo4j.auth.basic(this.user, this.password),
                {
                    maxConnectionPoolSize:    50,
                    connectionAcquisitionTimeout: 10000,
                    logging: neo4j.logging.console('warn'),
                }
            );
            console.log(`[GraphManager] Driver initialized → ${this.uri}`);
        } catch (error) {
            console.error('[GraphManager] Failed to create driver:', error.message);
            throw error;
        }
    }

    /** Returns a new session (caller is responsible for closing it). */
    _session() {
        if (!this.driver) throw new Error('[GraphManager] Driver not initialized.');
        return this.driver.session();
    }

    /** Run a single Cypher query, handle errors, always close the session. */
    async _run(cypher, params = {}) {
        const session = this._session();
        try {
            const result = await session.run(cypher, params);
            return result.records;
        } catch (error) {
            console.error('[GraphManager] Query error:', error.message);
            console.error('  Cypher:', cypher.trim().split('\n')[0], '...');
            throw error;
        } finally {
            await session.close();
        }
    }

    // ── Schema Initialization ─────────────────────────────────────────────────

    /**
     * Reads and executes the neo4j-init.cypher schema file.
     * Safe to run multiple times — uses IF NOT EXISTS guards.
     */
    async initializeSchema() {
        const schemaPath = path.resolve(__dirname, '../../neo4j-init.cypher');
        if (!fs.existsSync(schemaPath)) {
            console.warn('[GraphManager] Schema file not found at:', schemaPath);
            return;
        }

        // Split on semicolons, ignore comments and empty lines
        const commands = fs.readFileSync(schemaPath, 'utf8')
            .split(';')
            .map(cmd => cmd.trim())
            .filter(cmd => cmd.length > 0 && !cmd.startsWith('//') && !cmd.startsWith('/*'));

        console.log(`[GraphManager] Running schema initialization (${commands.length} statements)...`);
        for (const cmd of commands) {
            try {
                await this._run(cmd);
            } catch (error) {
                // Non-fatal — constraint/index may already exist
                console.warn('[GraphManager] Schema statement skipped:', error.message.split('\n')[0]);
            }
        }
        console.log('[GraphManager] Schema initialization complete.');
    }

    // ── Core Write Operations ─────────────────────────────────────────────────

    /**
     * Insert or update a node (MERGE = upsert — never creates duplicates).
     *
     * @param {string} label      - Neo4j node label (e.g. 'Equipment', 'Incident')
     * @param {Object} properties - Node properties. MUST include the unique ID field
     *                              matching the constraint (equipmentId, incidentId, etc.)
     * @returns {Object|null} The created/updated node properties
     *
     * @example
     *   await gm.insertEntity('Equipment', {
     *     equipmentId: 'PUMP-XYZ',
     *     name: 'PUMP-XYZ',
     *     type: 'Centrifugal Pump',
     *     status: 'OPERATIONAL',
     *     location: 'Unit A'
     *   });
     */
    async insertEntity(label, properties) {
        // Sanitize label to prevent injection
        const safeLabel = label.replace(/[^a-zA-Z0-9]/g, '');

        // Determine the unique ID key based on known label conventions
        const idKey = this._resolveIdKey(safeLabel, properties);

        if (!idKey || properties[idKey] === undefined) {
            console.warn(`[GraphManager] insertEntity: cannot find unique ID for label "${safeLabel}". Properties:`, Object.keys(properties));
        }

        const now = new Date().toISOString();

        // MERGE on the ID key → SET all properties on match/create
        const cypher = `
            MERGE (n:${safeLabel} {${idKey}: $idValue})
            ON CREATE SET n += $props, n.createdAt = $now
            ON MATCH  SET n += $props, n.updatedAt = $now
            RETURN n
        `;

        try {
            const records = await this._run(cypher, {
                idValue: properties[idKey],
                props:   { ...properties },
                now,
            });

            if (records.length > 0) {
                return records[0].get('n').properties;
            }
            return null;
        } catch (error) {
            console.error(`[GraphManager] insertEntity(${safeLabel}) failed:`, error.message);
            return null;
        }
    }

    /**
     * Insert or update a relationship between two nodes (MERGE = upsert).
     *
     * @param {string} sourceId      - Unique ID value of the source node
     * @param {string} relationType  - Relationship type (e.g. 'FAILED_DUE_TO')
     * @param {string} targetId      - Unique ID value of the target node
     * @param {Object} properties    - Optional relationship properties (evidence, confidence, etc.)
     * @returns {boolean} True if successful
     *
     * @example
     *   await gm.insertRelationship('PUMP-XYZ', 'FAILED_DUE_TO', 'Cavitation', {
     *     confidence: 0.95,
     *     evidence: 'centrifugal pump experienced severe cavitation'
     *   });
     */
    async insertRelationship(sourceId, relationType, targetId, properties = {}) {
        const safeRel = relationType.replace(/[^a-zA-Z0-9_]/g, '');
        const now     = new Date().toISOString();

        const cypher = `
            MATCH (a) WHERE a.equipmentId = $sourceId 
                        OR a.incidentId  = $sourceId 
                        OR a.procedureId = $sourceId 
                        OR a.documentId  = $sourceId 
                        OR a.regId       = $sourceId 
                        OR a.personnelId = $sourceId 
                        OR a.name        = $sourceId
            MATCH (b) WHERE b.equipmentId = $targetId 
                        OR b.incidentId  = $targetId 
                        OR b.procedureId = $targetId 
                        OR b.documentId  = $targetId 
                        OR b.regId       = $targetId 
                        OR b.personnelId = $targetId 
                        OR b.name        = $targetId
            MERGE (a)-[r:${safeRel}]->(b)
            ON CREATE SET r += $props, r.createdAt = $now
            ON MATCH  SET r += $props, r.updatedAt = $now
            RETURN type(r) AS relType
        `;

        try {
            const records = await this._run(cypher, {
                sourceId,
                targetId,
                props: { ...properties },
                now,
            });
            return records.length > 0;
        } catch (error) {
            console.error(`[GraphManager] insertRelationship(${sourceId} -[${safeRel}]-> ${targetId}) failed:`, error.message);
            return false;
        }
    }

    // ── Batch Ingest from NER + Relationship Extractor ────────────────────────

    /**
     * Bulk-ingest NER entities into the graph.
     * Maps NER labels (EQUIPMENT, INCIDENT, etc.) → Neo4j node labels.
     *
     * @param {Array} entities - Output from ner-pipeline.extractEntities()
     * @returns {{ inserted: number, failed: number }}
     */
    async ingestEntities(entities) {
        const NER_TO_LABEL = {
            EQUIPMENT:  'Equipment',
            PROCEDURE:  'Procedure',
            INCIDENT:   'Incident',
            PERSONNEL:  'Personnel',
            PARAMETER:  'Parameter',
            REGULATION: 'Regulation',
            DATE:       'DateNode',    // 'Date' is reserved in some Neo4j versions
            LOCATION:   'Location',
        };

        let inserted = 0;
        let failed   = 0;

        for (const entity of entities) {
            const label = NER_TO_LABEL[entity.label] || 'Entity';
            const idKey = this._resolveIdKey(label, {});

            const properties = {
                [idKey]:    entity.text,   // use entity text as the unique ID
                name:       entity.text,
                confidence: entity.confidence,
                sourceType: entity.label,
            };

            const result = await this.insertEntity(label, properties);
            if (result) inserted++;
            else        failed++;
        }

        console.log(`[GraphManager] ingestEntities: ${inserted} inserted, ${failed} failed`);
        return { inserted, failed };
    }

    /**
     * Bulk-ingest relationships into the graph.
     *
     * @param {Array} relationships - Output from relationship-extractor.extractRelationships()
     * @returns {{ inserted: number, failed: number }}
     */
    async ingestRelationships(relationships) {
        let inserted = 0;
        let failed   = 0;

        for (const rel of relationships) {
            const success = await this.insertRelationship(
                rel.source,
                rel.relation,
                rel.target,
                { confidence: rel.confidence, evidence: rel.evidence || '' }
            );
            if (success) inserted++;
            else         failed++;
        }

        console.log(`[GraphManager] ingestRelationships: ${inserted} inserted, ${failed} failed`);
        return { inserted, failed };
    }

    // ── Query Methods ─────────────────────────────────────────────────────────

    /**
     * Return full history for a piece of equipment:
     * all failures, procedures it requires, and measured parameters.
     *
     * @param {string} equipmentId - e.g. 'PUMP-XYZ'
     * @returns {Object} { equipment, failures, procedures, parameters }
     */
    async queryEquipmentHistory(equipmentId) {
        const cypher = `
            MATCH (e:Equipment)
            WHERE e.equipmentId = $id OR e.name = $id
            OPTIONAL MATCH (e)-[:FAILED_DUE_TO|FAILED_AT]->(incident)
            OPTIONAL MATCH (e)-[:REQUIRES]->(proc)
            OPTIONAL MATCH (e)-[:MEASURED_PARAMETER|HAS_PARAMETER]->(param)
            RETURN
                e                             AS equipment,
                collect(DISTINCT incident)    AS failures,
                collect(DISTINCT proc)        AS procedures,
                collect(DISTINCT param)       AS parameters
        `;

        try {
            const records = await this._run(cypher, { id: equipmentId });
            if (records.length === 0) return null;

            const record = records[0];
            return {
                equipment:  record.get('equipment')?.properties  || null,
                failures:   record.get('failures').map(n => n.properties),
                procedures: record.get('procedures').map(n => n.properties),
                parameters: record.get('parameters').map(n => n.properties),
            };
        } catch (error) {
            console.error('[GraphManager] queryEquipmentHistory failed:', error.message);
            return null;
        }
    }

    /**
     * Return incidents from the last N days.
     *
     * @param {number} days - Lookback window (default: 30)
     * @returns {Array} Array of incident node properties
     */
    async getRecentIncidents(days = 30) {
        const cypher = `
            MATCH (i:Incident)
            WHERE i.createdAt >= $cutoff OR i.date >= $cutoffDate
            RETURN i ORDER BY i.createdAt DESC
        `;

        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - days);

        try {
            const records = await this._run(cypher, {
                cutoff:     cutoffDate.toISOString(),
                cutoffDate: cutoffDate.toISOString().substring(0, 10),
            });
            return records.map(r => r.get('i').properties);
        } catch (error) {
            console.error('[GraphManager] getRecentIncidents failed:', error.message);
            return [];
        }
    }

    /**
     * Return all Equipment nodes in the graph.
     *
     * @returns {Array} Array of equipment node properties
     */
    async getAllEquipment() {
        try {
            const records = await this._run(
                'MATCH (e:Equipment) RETURN e ORDER BY e.name'
            );
            return records.map(r => r.get('e').properties);
        } catch (error) {
            console.error('[GraphManager] getAllEquipment failed:', error.message);
            return [];
        }
    }

    /**
     * Return equipment filtered by type.
     *
     * @param {string} type - e.g. 'Centrifugal Pump', 'Compressor'
     * @returns {Array} Array of matching equipment node properties
     */
    async getEquipmentByType(type) {
        try {
            const records = await this._run(
                'MATCH (e:Equipment) WHERE toLower(e.type) CONTAINS toLower($type) RETURN e ORDER BY e.name',
                { type }
            );
            return records.map(r => r.get('e').properties);
        } catch (error) {
            console.error('[GraphManager] getEquipmentByType failed:', error.message);
            return [];
        }
    }

    /**
     * Return the full graph snapshot for frontend visualization.
     * Output format is D3.js / vis.js compatible.
     *
     * @returns {{ nodes: Array, links: Array }}
     */
    async getGraphSnapshot() {
        const cypher = `
            MATCH (n)
            OPTIONAL MATCH (n)-[r]->(m)
            RETURN n, r, m
            LIMIT 500
        `;

        try {
            const records  = await this._run(cypher);
            const nodesMap = new Map();
            const linksMap = new Map();

            records.forEach(record => {
                const srcNode = record.get('n');
                const rel     = record.get('r');
                const tgtNode = record.get('m');

                const toNode = (neo4jNode) => ({
                    id:    neo4jNode.properties.equipmentId
                           || neo4jNode.properties.incidentId
                           || neo4jNode.properties.procedureId
                           || neo4jNode.properties.documentId
                           || neo4jNode.properties.name
                           || neo4jNode.elementId,
                    label: neo4jNode.labels[0] || 'Node',
                    name:  neo4jNode.properties.name || neo4jNode.properties.title || 'Unknown',
                    ...neo4jNode.properties,
                });

                if (srcNode) nodesMap.set(srcNode.elementId, toNode(srcNode));
                if (tgtNode) nodesMap.set(tgtNode.elementId, toNode(tgtNode));

                if (rel && srcNode && tgtNode) {
                    const linkId = `${srcNode.elementId}-${rel.type}-${tgtNode.elementId}`;
                    linksMap.set(linkId, {
                        source:      nodesMap.get(srcNode.elementId)?.id,
                        target:      nodesMap.get(tgtNode.elementId)?.id,
                        type:        rel.type,
                        confidence:  rel.properties.confidence || null,
                        evidence:    rel.properties.evidence   || null,
                    });
                }
            });

            return {
                nodes: Array.from(nodesMap.values()),
                links: Array.from(linksMap.values()),
            };
        } catch (error) {
            console.error('[GraphManager] getGraphSnapshot failed:', error.message);
            return { nodes: [], links: [] };
        }
    }

    /**
     * Root Cause Analysis: trace all causal paths leading to an incident.
     *
     * @param {string} incidentId - Name or ID of the incident node
     * @param {number} depth      - Max relationship hops (default: 5)
     * @returns {Array} Causal path segments
     */
    async findRootCause(incidentId, depth = 5) {
        const cypher = `
            MATCH path = (cause)-[*1..${Math.min(depth, 8)}]->(incident)
            WHERE incident.incidentId = $id OR incident.name = $id
            RETURN path
            LIMIT 50
        `;

        try {
            const records = await this._run(cypher, { id: incidentId });
            return records.map(record => {
                const p = record.get('path');
                return {
                    startNode: p.start.properties.name || p.start.properties.equipmentId,
                    endNode:   p.end.properties.name   || p.end.properties.incidentId,
                    segments:  p.segments.map(seg => ({
                        source:       seg.start.properties.name || seg.start.properties.equipmentId || seg.start.elementId,
                        relationship: seg.relationship.type,
                        target:       seg.end.properties.name   || seg.end.properties.incidentId   || seg.end.elementId,
                    })),
                };
            });
        } catch (error) {
            console.error('[GraphManager] findRootCause failed:', error.message);
            return [];
        }
    }

    // ── Utility ───────────────────────────────────────────────────────────────

    /**
     * Verify the driver can reach the Neo4j server.
     * @returns {boolean}
     */
    async ping() {
        try {
            const info = await this.driver.getServerInfo();
            console.log('[GraphManager] Connected to Neo4j:', info.agent);
            return true;
        } catch (error) {
            console.error('[GraphManager] Ping failed:', error.message);
            return false;
        }
    }

    /**
     * Resolves the unique ID property key for a given node label.
     * Falls back to 'name' for labels not in the standard schema.
     *
     * @private
     */
    _resolveIdKey(label, properties) {
        const ID_KEYS = {
            Equipment:  'equipmentId',
            Procedure:  'procedureId',
            Incident:   'incidentId',
            Document:   'documentId',
            Regulation: 'regId',
            WorkOrder:  'workOrderId',
            Personnel:  'personnelId',
        };
        // If label has a known key, use it. Otherwise fall back to 'name'.
        if (ID_KEYS[label])                         return ID_KEYS[label];
        if (Object.values(ID_KEYS).some(k => properties[k] !== undefined)) {
            return Object.values(ID_KEYS).find(k => properties[k] !== undefined);
        }
        return 'name';
    }

    /**
     * Close the Neo4j driver and release all connections.
     */
    async close() {
        if (this.driver) {
            await this.driver.close();
            this.driver = null;
            console.log('[GraphManager] Driver closed.');
        }
    }
}

// ---------------------------------------------------------------------------
// Singleton helper for use across the app
// ---------------------------------------------------------------------------

let _instance = null;

/**
 * Returns a shared GraphManager singleton.
 * Creates it on first call using environment variables.
 */
function getGraphManager() {
    if (!_instance) {
        _instance = new GraphManager();
    }
    return _instance;
}

module.exports = { GraphManager, getGraphManager };

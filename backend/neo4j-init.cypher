// ============================================================================
// NEO4J SCHEMA INITIALIZATION — INDUSTRIAL KNOWLEDGE GRAPH
// Version: 1.0.0
// Compatible with: Neo4j 5.x
//
// USAGE: Paste each block into Neo4j Browser one at a time,
//        OR run via cypher-shell:
//        cypher-shell -u neo4j -p <password> -f neo4j-init.cypher
// ============================================================================


// ════════════════════════════════════════════════════════════════════════════
// SECTION 1: UNIQUE CONSTRAINTS
// These ensure data integrity and implicitly create backing indexes.
// ════════════════════════════════════════════════════════════════════════════

CREATE CONSTRAINT unique_equipment_id IF NOT EXISTS
FOR (e:Equipment) REQUIRE e.equipmentId IS UNIQUE;

CREATE CONSTRAINT unique_procedure_id IF NOT EXISTS
FOR (p:Procedure) REQUIRE p.procedureId IS UNIQUE;

CREATE CONSTRAINT unique_incident_id IF NOT EXISTS
FOR (i:Incident) REQUIRE i.incidentId IS UNIQUE;

CREATE CONSTRAINT unique_document_id IF NOT EXISTS
FOR (d:Document) REQUIRE d.documentId IS UNIQUE;

CREATE CONSTRAINT unique_regulation_id IF NOT EXISTS
FOR (r:Regulation) REQUIRE r.regId IS UNIQUE;

CREATE CONSTRAINT unique_workorder_id IF NOT EXISTS
FOR (w:WorkOrder) REQUIRE w.workOrderId IS UNIQUE;

CREATE CONSTRAINT unique_personnel_id IF NOT EXISTS
FOR (pe:Personnel) REQUIRE pe.personnelId IS UNIQUE;


// ════════════════════════════════════════════════════════════════════════════
// SECTION 2: PERFORMANCE INDEXES
// Secondary indexes for fast lookup by common query fields.
// ════════════════════════════════════════════════════════════════════════════

// Equipment
CREATE INDEX equipment_name_idx IF NOT EXISTS
FOR (e:Equipment) ON (e.name);

CREATE INDEX equipment_type_idx IF NOT EXISTS
FOR (e:Equipment) ON (e.type);

CREATE INDEX equipment_status_idx IF NOT EXISTS
FOR (e:Equipment) ON (e.status);

CREATE INDEX equipment_location_idx IF NOT EXISTS
FOR (e:Equipment) ON (e.location);

CREATE INDEX equipment_created_idx IF NOT EXISTS
FOR (e:Equipment) ON (e.createdAt);

// Procedure
CREATE INDEX procedure_name_idx IF NOT EXISTS
FOR (p:Procedure) ON (p.name);

CREATE INDEX procedure_type_idx IF NOT EXISTS
FOR (p:Procedure) ON (p.type);

CREATE INDEX procedure_created_idx IF NOT EXISTS
FOR (p:Procedure) ON (p.createdAt);

// Incident
CREATE INDEX incident_date_idx IF NOT EXISTS
FOR (i:Incident) ON (i.date);

CREATE INDEX incident_severity_idx IF NOT EXISTS
FOR (i:Incident) ON (i.severity);

CREATE INDEX incident_created_idx IF NOT EXISTS
FOR (i:Incident) ON (i.createdAt);

// Document
CREATE INDEX document_filename_idx IF NOT EXISTS
FOR (d:Document) ON (d.filename);

CREATE INDEX document_type_idx IF NOT EXISTS
FOR (d:Document) ON (d.type);

CREATE INDEX document_created_idx IF NOT EXISTS
FOR (d:Document) ON (d.createdAt);

// Parameter
CREATE INDEX parameter_name_idx IF NOT EXISTS
FOR (pa:Parameter) ON (pa.name);

CREATE INDEX parameter_timestamp_idx IF NOT EXISTS
FOR (pa:Parameter) ON (pa.timestamp);

CREATE INDEX parameter_created_idx IF NOT EXISTS
FOR (pa:Parameter) ON (pa.createdAt);

// Regulation
CREATE INDEX regulation_standard_idx IF NOT EXISTS
FOR (r:Regulation) ON (r.standard);

CREATE INDEX regulation_created_idx IF NOT EXISTS
FOR (r:Regulation) ON (r.createdAt);

// WorkOrder
CREATE INDEX workorder_status_idx IF NOT EXISTS
FOR (w:WorkOrder) ON (w.status);

CREATE INDEX workorder_created_idx IF NOT EXISTS
FOR (w:WorkOrder) ON (w.createdAt);

// Personnel
CREATE INDEX personnel_role_idx IF NOT EXISTS
FOR (pe:Personnel) ON (pe.role);

CREATE INDEX personnel_created_idx IF NOT EXISTS
FOR (pe:Personnel) ON (pe.createdAt);


// SECTION 3/4 (fixed seed sample data + relationships) removed — it re-ran
// initializeSchema() on every server startup, re-inserting EQUIP-001/PUMP-XYZ,
// EQUIP-002/COMPRESSOR-C12, etc. via MERGE regardless of what real or demo
// data was already in the graph. Use backend/scripts/seed-db.js (real NER
// pipeline) or backend/scripts/demo-seed.cypher (curated one-shot demo data)
// instead — both run explicitly, not on every boot.

// ════════════════════════════════════════════════════════════════════════════
// SECTION 5: VERIFICATION QUERIES
// Run individually to confirm schema was applied correctly.
// ════════════════════════════════════════════════════════════════════════════

// Show all constraints:
// SHOW CONSTRAINTS;

// Show all indexes:
// SHOW INDEXES;

// Show full graph overview:
// MATCH (n)-[r]->(m) RETURN n, r, m LIMIT 100;

// Count nodes by label:
// MATCH (n) RETURN labels(n) AS Label, count(n) AS Count ORDER BY Count DESC;

// Find all incidents for a specific piece of equipment:
// MATCH (e:Equipment {name: 'PUMP-XYZ'})-[:FAILED_AT]->(i:Incident)
// RETURN e.name, i.title, i.severity, i.date ORDER BY i.date DESC;

// Root cause analysis - find all paths leading to an incident:
// MATCH path = (cause)-[*1..5]->(i:Incident {incidentId: 'INC-001'})
// RETURN path;

// ============================================================================
// NEO4J SCHEMA INITIALIZATION FOR INDUSTRIAL KNOWLEDGE GRAPH
// ============================================================================

// ── 1. UNIQUE CONSTRAINTS ───────────────────────────────────────────────────

// Unique constraint on Equipment ID
CREATE CONSTRAINT unique_equipment_id IF NOT EXISTS
FOR (e:Equipment) REQUIRE e.equipmentId IS UNIQUE;

// Unique constraint on Procedure ID
CREATE CONSTRAINT unique_procedure_id IF NOT EXISTS
FOR (p:Procedure) REQUIRE p.procedureId IS UNIQUE;

// Unique constraint on Incident ID
CREATE CONSTRAINT unique_incident_id IF NOT EXISTS
FOR (i:Incident) REQUIRE i.incidentId IS UNIQUE;

// Unique constraint on Document ID
CREATE CONSTRAINT unique_document_id IF NOT EXISTS
FOR (d:Document) REQUIRE d.documentId IS UNIQUE;

// Unique constraint on Regulation ID
CREATE CONSTRAINT unique_regulation_id IF NOT EXISTS
FOR (r:Regulation) REQUIRE r.regId IS UNIQUE;


// ── 2. INDEXES FOR PERFORMANCE ──────────────────────────────────────────────

// Index on Equipment Name
CREATE INDEX equipment_name_idx IF NOT EXISTS
FOR (e:Equipment) ON (e.name);

// Index on Procedure Name
CREATE INDEX procedure_name_idx IF NOT EXISTS
FOR (p:Procedure) ON (p.name);

// Index on Incident Date
CREATE INDEX incident_date_idx IF NOT EXISTS
FOR (i:Incident) ON (i.date);

// Indexes on createdAt across all node types for history/timeline queries
CREATE INDEX equipment_created_idx IF NOT EXISTS
FOR (e:Equipment) ON (e.createdAt);

CREATE INDEX procedure_created_idx IF NOT EXISTS
FOR (p:Procedure) ON (p.createdAt);

CREATE INDEX incident_created_idx IF NOT EXISTS
FOR (i:Incident) ON (i.createdAt);

CREATE INDEX document_created_idx IF NOT EXISTS
FOR (d:Document) ON (d.createdAt);

CREATE INDEX parameter_created_idx IF NOT EXISTS
FOR (pa:Parameter) ON (pa.createdAt);

CREATE INDEX regulation_created_idx IF NOT EXISTS
FOR (r:Regulation) ON (r.createdAt);


// ── 3. DATA SCHEMA DOCUMENTATION (Informational) ────────────────────────────
/*
Node Types & Properties:
- Equipment:  { equipmentId, name, type, status, location, installDate, specs, createdAt }
- Procedure:  { procedureId, name, type (maintenance/inspection/safety), frequency, createdAt }
- Incident:   { incidentId, date, title, description, severity, createdAt }
- Document:   { documentId, filename, uploadedAt, type, createdAt }
- Parameter:  { name, value, unit, timestamp, createdAt }
- Regulation: { regId, title, description, standard, createdAt }

Relationship Types:
- (:Equipment)-[:REQUIRES]->(:Procedure)
- (:Equipment)-[:FAILED_AT]->(:Incident)
- (:Document)-[:DOCUMENTS]->(:Incident)
- (:Procedure)-[:COMPLIES_WITH]->(:Regulation)
- (:Equipment)-[:HAS_PARAMETER]->(:Parameter)
- (:Document)-[:REFERENCES]->(:Document)
- (:WorkOrder)-[:ASSIGNED_TO]->(:Personnel)
*/

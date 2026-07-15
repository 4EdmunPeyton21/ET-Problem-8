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


// ════════════════════════════════════════════════════════════════════════════
// SECTION 3: SEED SAMPLE DATA (Remove in production)
// Demonstrates the graph schema with real-world industrial scenario.
// ════════════════════════════════════════════════════════════════════════════

// ── Equipment ────────────────────────────────────────────────────────────────
MERGE (pump:Equipment {equipmentId: 'EQUIP-001'})
SET pump.name        = 'PUMP-XYZ',
    pump.type        = 'Centrifugal Pump',
    pump.status      = 'OPERATIONAL',
    pump.location    = 'Unit A - Coolant Circulation System',
    pump.installDate = '2019-03-15',
    pump.specs       = 'Grundfos SPM 150-11 | Max Pressure: 12 bar | Flow: 150 L/min',
    pump.createdAt   = datetime();

MERGE (comp:Equipment {equipmentId: 'EQUIP-002'})
SET comp.name        = 'COMPRESSOR-C12',
    comp.type        = 'Reciprocating Compressor',
    comp.status      = 'OPERATIONAL',
    comp.location    = 'Unit B - Air Supply System',
    comp.installDate = '2020-06-01',
    comp.specs       = 'Max Pressure: 32 bar | Vibration limit: 4.5 mm/s RMS',
    comp.createdAt   = datetime();

// ── Procedures ───────────────────────────────────────────────────────────────
MERGE (maint:Procedure {procedureId: 'PROC-001'})
SET maint.name      = 'Pump Startup Sequence SOP-42A',
    maint.type      = 'maintenance',
    maint.frequency = 'Per startup',
    maint.createdAt = datetime();

MERGE (inspect:Procedure {procedureId: 'PROC-002'})
SET inspect.name      = 'Quarterly Pump Inspection',
    inspect.type      = 'inspection',
    inspect.frequency = 'Quarterly',
    inspect.createdAt = datetime();

MERGE (safety:Procedure {procedureId: 'PROC-003'})
SET safety.name      = 'Lockout/Tagout Procedure',
    safety.type      = 'safety',
    safety.frequency = 'Per maintenance event',
    safety.createdAt = datetime();

// ── Incidents ────────────────────────────────────────────────────────────────
MERGE (cav:Incident {incidentId: 'INC-001'})
SET cav.date        = date('2024-01-15'),
    cav.title       = 'Cavitation Event - PUMP-XYZ',
    cav.description = 'Cavitation detected in coolant pump due to inlet blockage. Reduced flow rate, unusual noise observed. Shutdown and flushed inlet.',
    cav.severity    = 'MEDIUM',
    cav.createdAt   = datetime();

MERGE (seal:Incident {incidentId: 'INC-002'})
SET seal.date        = date('2024-03-10'),
    seal.title       = 'Seal Wear - PUMP-XYZ',
    seal.description = 'Minor NBR shaft seal wear detected during Q1 inspection. No leakage. Seal replaced during planned shutdown.',
    seal.severity    = 'LOW',
    seal.createdAt   = datetime();

// ── Documents ────────────────────────────────────────────────────────────────
MERGE (doc1:Document {documentId: 'DOC-001'})
SET doc1.filename   = 'maintenance_log_pump_xyz.txt',
    doc1.uploadedAt = datetime(),
    doc1.type       = 'maintenance_log',
    doc1.createdAt  = datetime();

MERGE (doc2:Document {documentId: 'DOC-002'})
SET doc2.filename   = 'inspection_report_q1_2024.txt',
    doc2.uploadedAt = datetime(),
    doc2.type       = 'inspection_report',
    doc2.createdAt  = datetime();

MERGE (doc3:Document {documentId: 'DOC-003'})
SET doc3.filename   = 'oem_manual_grundfos.txt',
    doc3.uploadedAt = datetime(),
    doc3.type       = 'oem_manual',
    doc3.createdAt  = datetime();

// ── Parameters ───────────────────────────────────────────────────────────────
MERGE (pres:Parameter {name: 'Discharge Pressure', equipmentId: 'EQUIP-001'})
SET pres.value     = 9.8,
    pres.unit      = 'bar',
    pres.timestamp = datetime(),
    pres.createdAt = datetime();

MERGE (temp:Parameter {name: 'Operating Temperature', equipmentId: 'EQUIP-001'})
SET temp.value     = 65,
    temp.unit      = '°C',
    temp.timestamp = datetime(),
    temp.createdAt = datetime();

MERGE (vib:Parameter {name: 'Vibration', equipmentId: 'EQUIP-002'})
SET vib.value     = 3.2,
    vib.unit      = 'mm/s RMS',
    vib.timestamp = datetime(),
    vib.createdAt = datetime();

// ── Regulations ──────────────────────────────────────────────────────────────
MERGE (reg1:Regulation {regId: 'REG-001'})
SET reg1.title       = 'ISO 16/14/11 Fluid Cleanliness',
    reg1.description = 'Hydraulic fluid cleanliness standard for industrial systems',
    reg1.standard    = 'ISO 4406',
    reg1.createdAt   = datetime();

MERGE (reg2:Regulation {regId: 'REG-002'})
SET reg2.title       = 'OSHA Lockout/Tagout Standard',
    reg2.description = 'Control of hazardous energy during equipment servicing',
    reg2.standard    = 'OSHA 29 CFR 1910.147',
    reg2.createdAt   = datetime();

// ── Personnel ────────────────────────────────────────────────────────────────
MERGE (tech1:Personnel {personnelId: 'PERS-001'})
SET tech1.name      = 'Rahul Patil',
    tech1.role      = 'Maintenance Technician',
    tech1.createdAt = datetime();

MERGE (tech2:Personnel {personnelId: 'PERS-002'})
SET tech2.name      = 'Anita Sharma',
    tech2.role      = 'Senior Inspector',
    tech2.createdAt = datetime();

// ── WorkOrders ───────────────────────────────────────────────────────────────
MERGE (wo1:WorkOrder {workOrderId: 'WO-001'})
SET wo1.title       = 'Replace NBR Shaft Seal - PUMP-XYZ',
    wo1.status      = 'COMPLETED',
    wo1.priority    = 'MEDIUM',
    wo1.createdAt   = datetime();


// ════════════════════════════════════════════════════════════════════════════
// SECTION 4: RELATIONSHIPS
// ════════════════════════════════════════════════════════════════════════════

// Equipment REQUIRES Procedure
MATCH (e:Equipment {equipmentId: 'EQUIP-001'}), (p:Procedure {procedureId: 'PROC-001'})
MERGE (e)-[:REQUIRES {note: 'SOP required before every pump startup'}]->(p);

MATCH (e:Equipment {equipmentId: 'EQUIP-001'}), (p:Procedure {procedureId: 'PROC-002'})
MERGE (e)-[:REQUIRES {note: 'Quarterly inspection mandatory'}]->(p);

MATCH (e:Equipment {equipmentId: 'EQUIP-001'}), (p:Procedure {procedureId: 'PROC-003'})
MERGE (e)-[:REQUIRES {note: 'LOTO required before any maintenance'}]->(p);

// Equipment FAILED_AT Incident
MATCH (e:Equipment {equipmentId: 'EQUIP-001'}), (i:Incident {incidentId: 'INC-001'})
MERGE (e)-[:FAILED_AT {detectedBy: 'Vibration sensor + operator report'}]->(i);

MATCH (e:Equipment {equipmentId: 'EQUIP-001'}), (i:Incident {incidentId: 'INC-002'})
MERGE (e)-[:FAILED_AT {detectedBy: 'Q1 Quarterly Inspection'}]->(i);

// Document DOCUMENTS Incident
MATCH (d:Document {documentId: 'DOC-001'}), (i:Incident {incidentId: 'INC-001'})
MERGE (d)-[:DOCUMENTS {section: 'Event 3 - Cavitation'}]->(i);

MATCH (d:Document {documentId: 'DOC-002'}), (i:Incident {incidentId: 'INC-002'})
MERGE (d)-[:DOCUMENTS {section: 'Seal Integrity Finding'}]->(i);

// Procedure COMPLIES_WITH Regulation
MATCH (p:Procedure {procedureId: 'PROC-002'}), (r:Regulation {regId: 'REG-001'})
MERGE (p)-[:COMPLIES_WITH {note: 'Fluid cleanliness checked per ISO 4406'}]->(r);

MATCH (p:Procedure {procedureId: 'PROC-003'}), (r:Regulation {regId: 'REG-002'})
MERGE (p)-[:COMPLIES_WITH {note: 'LOTO procedure follows OSHA 29 CFR 1910.147'}]->(r);

// Equipment HAS_PARAMETER
MATCH (e:Equipment {equipmentId: 'EQUIP-001'}), (pa:Parameter {name: 'Discharge Pressure', equipmentId: 'EQUIP-001'})
MERGE (e)-[:HAS_PARAMETER]->(pa);

MATCH (e:Equipment {equipmentId: 'EQUIP-001'}), (pa:Parameter {name: 'Operating Temperature', equipmentId: 'EQUIP-001'})
MERGE (e)-[:HAS_PARAMETER]->(pa);

MATCH (e:Equipment {equipmentId: 'EQUIP-002'}), (pa:Parameter {name: 'Vibration', equipmentId: 'EQUIP-002'})
MERGE (e)-[:HAS_PARAMETER]->(pa);

// Document REFERENCES Document
MATCH (d1:Document {documentId: 'DOC-001'}), (d2:Document {documentId: 'DOC-003'})
MERGE (d1)-[:REFERENCES {note: 'Maintenance log references OEM manual for seal specs'}]->(d2);

MATCH (d1:Document {documentId: 'DOC-002'}), (d2:Document {documentId: 'DOC-003'})
MERGE (d1)-[:REFERENCES {note: 'Inspection report references OEM spec limits'}]->(d2);

// WorkOrder ASSIGNED_TO Personnel
MATCH (w:WorkOrder {workOrderId: 'WO-001'}), (pe:Personnel {personnelId: 'PERS-001'})
MERGE (w)-[:ASSIGNED_TO {assignedDate: '2024-03-10'}]->(pe);


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

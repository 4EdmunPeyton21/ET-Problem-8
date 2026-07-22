// Demo seed — one coherent PUMP-101 storyline that exercises every page:
// Equipment List/Detail, RCA, Knowledge Graph, Anomaly Alerts, Email Thread.

// ── Equipment ────────────────────────────────────────────────────────────
CREATE (pump:Equipment {equipmentId:'PUMP-101', name:'PUMP-101', type:'Centrifugal Pump', status:'CRITICAL', location:'Unit A - Cooling Water Circuit', createdAt: toString(datetime())})
CREATE (motor:Equipment {equipmentId:'MOTOR-204', name:'MOTOR-204', type:'Drive Motor', status:'OPERATIONAL', location:'Unit B - Drive Skid', createdAt: toString(datetime())})
CREATE (comp:Equipment {equipmentId:'COMP-330', name:'COMP-330', type:'Reciprocating Compressor', status:'WARNING', location:'Unit C - Air Supply', createdAt: toString(datetime())})

// ── PUMP-101 incident history (steady baseline, then a dramatic repeat failure) ──
CREATE (i1:Incident {incidentId:'INC-2023-050', name:'Seal wear check', description:'Routine seal inspection, minor wear within tolerance.', severity:'LOW', createdAt: toString(datetime() - duration({days:200}))})
CREATE (i2:Incident {incidentId:'INC-2023-081', name:'Seal leakage', description:'Mechanical seal wear causing minor fluid loss.', severity:'MEDIUM', createdAt: toString(datetime() - duration({days:145}))})
CREATE (i3:Incident {incidentId:'INC-2023-104', name:'Bearing wear detected', description:'Routine inspection found early-stage bearing wear on drive-end.', severity:'MEDIUM', createdAt: toString(datetime() - duration({days:90}))})
CREATE (i4:Incident {incidentId:'INC-2024-012', name:'Elevated vibration alarm', description:'Vibration reading 9.1 mm/s RMS against 3.5 mm/s baseline.', severity:'HIGH', createdAt: toString(datetime() - duration({days:35}))})
CREATE (i5:Incident {incidentId:'INC-2024-015', name:'Bearing overheating', description:'Bearing temperature reached 88°C. Vibration climbing further.', severity:'HIGH', createdAt: toString(datetime() - duration({days:28}))})
CREATE (i6:Incident {incidentId:'INC-2024-018', name:'Repeat bearing overheating — cascading', description:'Second overheating event just one day later. Vibration 11.8 mm/s RMS, temperature 92°C.', severity:'CRITICAL', createdAt: toString(datetime() - duration({days:27}))})
CREATE (i7:Incident {incidentId:'INC-2024-021', name:'Bearing replacement completed', description:'Emergency relubrication and bearing seal replacement performed. Vibration restored to 3.9 mm/s, temperature 58°C.', severity:'LOW', createdAt: toString(datetime() - duration({days:24}))})

CREATE (pump)-[:FAILED_AT]->(i1)
CREATE (pump)-[:FAILED_AT]->(i2)
CREATE (pump)-[:FAILED_AT]->(i3)
CREATE (pump)-[:FAILED_AT]->(i4)
CREATE (pump)-[:FAILED_AT]->(i5)
CREATE (pump)-[:FAILED_AT]->(i6)
CREATE (pump)-[:FAILED_AT]->(i7)

// Anomaly detector reads incident dates via a connected date node
CREATE (d1:Date {name: toString(date(datetime() - duration({days:200})))})
CREATE (d2:Date {name: toString(date(datetime() - duration({days:145})))})
CREATE (d3:Date {name: toString(date(datetime() - duration({days:90})))})
CREATE (d4:Date {name: toString(date(datetime() - duration({days:35})))})
CREATE (d5:Date {name: toString(date(datetime() - duration({days:28})))})
CREATE (d6:Date {name: toString(date(datetime() - duration({days:27})))})
CREATE (d7:Date {name: toString(date(datetime() - duration({days:24})))})
CREATE (i1)-[:OCCURRED_ON]->(d1)
CREATE (i2)-[:OCCURRED_ON]->(d2)
CREATE (i3)-[:OCCURRED_ON]->(d3)
CREATE (i4)-[:OCCURRED_ON]->(d4)
CREATE (i5)-[:OCCURRED_ON]->(d5)
CREATE (i6)-[:OCCURRED_ON]->(d6)
CREATE (i7)-[:OCCURRED_ON]->(d7)

// ── Procedure + parameters ──────────────────────────────────────────────────
CREATE (proc:Procedure {procedureId:'PROC-77', name:'Monthly Lubrication Check', description:'Standard preventive maintenance procedure for drive-end and non-drive-end bearings.', createdAt: toString(datetime() - duration({days:25}))})
CREATE (pump)-[:REQUIRES]->(proc)

CREATE (p1:Parameter {name:'Vibration', value:11.8, unit:'mm/s', createdAt: toString(datetime() - duration({days:28}))})
CREATE (p2:Parameter {name:'Bearing Temperature', value:92, unit:'°C', createdAt: toString(datetime() - duration({days:28}))})
CREATE (pump)-[:HAS_PARAMETER]->(p1)
CREATE (pump)-[:HAS_PARAMETER]->(p2)

// ── COMP-330: a single, less dramatic incident for contrast ────────────────
CREATE (i8:Incident {incidentId:'INC-2024-005', name:'Discharge pressure drop', description:'Discharge pressure below spec, suspected valve wear.', severity:'MEDIUM', createdAt: toString(datetime() - duration({days:50}))})
CREATE (comp)-[:FAILED_AT]->(i8)

// ── Email thread linked to the cascading-failure incident ──────────────────
CREATE (e1:Email {threadId:'THREAD-INC-2024-018', messageId:'msg-101', sender:'ops.supervisor@plant.com', recipients:['maintenance@plant.com'], subject:'[ALERT] Repeat bearing overheating — PUMP-101', body:'Team,\n\nPUMP-101 has triggered a second overheating alert in 8 days. Vibration is now 11.8 mm/s against an 8 mm/s threshold, temperature 92°C.\n\nThis is the third bearing-related event in a month. Please treat as urgent — possible cascading failure.\n\nOps Supervisor', sentAt: toString(datetime() - duration({days:28, hours:9})), direction:'received', attachments:[]})
CREATE (e2:Email {threadId:'THREAD-INC-2024-018', messageId:'msg-102', sender:'maintenance@plant.com', recipients:['ops.supervisor@plant.com'], subject:'Re: [ALERT] Repeat bearing overheating — PUMP-101', body:'Acknowledged. Pulling maintenance history now — this is the 3rd bearing event in 30 days on this asset, consistent with a lubrication gap. Dispatching R. Sharma for emergency inspection within the hour.', sentAt: toString(datetime() - duration({days:28, hours:8})), direction:'sent', attachments:[]})
CREATE (e3:Email {threadId:'THREAD-INC-2024-018', messageId:'msg-103', sender:'r.sharma@plant.com', recipients:['maintenance@plant.com','ops.supervisor@plant.com'], subject:'Re: [ALERT] Repeat bearing overheating — PUMP-101', body:'Inspection complete. Drive-end bearing ~60% degraded, lubrication 40% below spec. Last recorded lubrication was 47 days ago — well past the 30-day interval.\n\nRecommend immediate relubrication + seal replacement. Doing it on-site now.', sentAt: toString(datetime() - duration({days:27, hours:20})), direction:'received', attachments:['inspection_report_pump101.pdf']})
CREATE (e4:Email {threadId:'THREAD-INC-2024-018', messageId:'msg-104', sender:'r.sharma@plant.com', recipients:['maintenance@plant.com','ops.supervisor@plant.com'], subject:'Re: [ALERT] Repeat bearing overheating — PUMP-101', body:'Bearing seal replaced, full relubrication done. Post-repair vibration: 3.9 mm/s, temperature 58°C — both back within normal range.\n\nAdded PUMP-101 to the automated lubrication reminder system to prevent recurrence. Marking incident RESOLVED.', sentAt: toString(datetime() - duration({days:25})), direction:'received', attachments:['completion_report_pump101.pdf']})
CREATE (e1)-[:LINKED_TO]->(i6)

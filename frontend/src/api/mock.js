// Mock responses shaped to match the real backend contracts exactly
// (backend/src/api/routes.js, graph-manager.js, rca-agent.js, ingestion-worker.js)
// so switching between mock and real API requires no component changes.

const jobStartTimes = new Map();

const MOCK_EQUIPMENT = [
  { equipmentId: 'PUMP-101', name: 'PUMP-101', type: 'Centrifugal Pump', status: 'OPERATIONAL', location: 'Unit A' },
  { equipmentId: 'MOTOR-204', name: 'MOTOR-204', type: 'Drive Motor', status: 'WARNING', location: 'Unit B' },
  { equipmentId: 'COMP-330', name: 'COMP-330', type: 'Compressor', status: 'CRITICAL', location: 'Unit C' },
];

export const mockData = {
  '/equipment': () => ({ count: MOCK_EQUIPMENT.length, equipment: MOCK_EQUIPMENT }),

  '/equipment/:id/history': (params) => {
    const equipment = MOCK_EQUIPMENT.find(e => e.equipmentId === params.id) || {
      equipmentId: params.id, name: params.id, type: 'Unknown', status: 'UNKNOWN', location: 'Unknown',
    };
    return {
      equipment,
      failures: [
        { incidentId: 'INC-2031', name: 'Bearing overheating', description: 'High vibration and temperature spike on drive-end bearing.', severity: 'HIGH', createdAt: new Date(Date.now() - 86400000 * 3).toISOString() },
        { incidentId: 'INC-1987', name: 'Seal leakage', description: 'Mechanical seal wear causing fluid loss.', severity: 'MEDIUM', createdAt: new Date(Date.now() - 86400000 * 40).toISOString() },
      ],
      procedures: [
        { procedureId: 'PROC-77', name: 'Monthly lubrication check', description: 'Standard preventive maintenance procedure.', createdAt: new Date(Date.now() - 86400000 * 10).toISOString() },
      ],
      parameters: [
        { name: 'Flow Rate', value: 120, unit: ' GPM', createdAt: new Date(Date.now() - 86400000 * 5).toISOString() },
        { name: 'Vibration', value: 4.2, unit: ' mm/s', createdAt: new Date(Date.now() - 86400000 * 3).toISOString() },
      ],
    };
  },

  '/rca/analyze': (payload) => ({
    symptoms: [payload.symptomDescription],
    similarHistoricalIncidents: [
      { incidentId: 'INC-1987', date: new Date(Date.now() - 86400000 * 40).toISOString(), symptoms: ['Bearing overheating', 'high vibration'], rootCause: 'Insufficient lubrication', rcaLink: 'DOC-8841', similarityScore: 0.82 },
      { incidentId: 'INC-1522', date: new Date(Date.now() - 86400000 * 120).toISOString(), symptoms: ['Seal leakage'], rootCause: 'Mechanical seal wear', rcaLink: 'DOC-7723', similarityScore: 0.61 },
    ],
    probableRootCauses: [
      { cause: 'Insufficient lubrication or lubricant degradation', likelihood: 'HIGH', evidence: 'High temperature and vibration together are classic signs of lubrication failure in rotating equipment.' },
      { cause: 'Bearing wear or failure', likelihood: 'HIGH', evidence: 'Failing bearings generate excess friction, leading to rapid heat and vibration.' },
      { cause: 'Misalignment between pump and driver', likelihood: 'MEDIUM', evidence: 'Misalignment typically produces elevated vibration at 2x running speed.' },
    ],
    diagnosticSteps: [
      'Check lubricant level and condition (colour, viscosity)',
      'Measure bearing temperature with IR thermometer',
      'Record vibration spectrum (FFT) at bearing pedestals',
      'Check coupling alignment with dial indicator or laser tool',
    ],
    preventiveMeasures: [
      'Implement oil analysis programme (quarterly)',
      'Install bearing temperature sensors with DCS alarm',
      'Establish vibration baseline and ISO 10816-1 alarm limits',
    ],
    confidenceLevel: 'MEDIUM',
    provider: 'mock',
    analysisTimestamp: new Date().toISOString(),
  }),

  '/documents/upload': (formData) => {
    const file = formData.get('document');
    const jobId = `DOC-MOCK-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
    jobStartTimes.set(jobId, Date.now());
    return {
      message: 'Document uploaded and queued for processing.',
      jobId,
      bullJobId: jobId,
      filename: file?.name || 'unknown',
      size: file?.size || 0,
      mimetype: file?.type || 'application/octet-stream',
      queuePosition: 1,
      status: 'queued',
      pollUrl: `/api/documents/status/${jobId}`,
      socketEvent: 'ingestion:progress',
    };
  },

  '/documents/status/:jobId': (params) => {
    const start = jobStartTimes.get(params.jobId) || Date.now();
    const elapsed = Date.now() - start;
    const progress = Math.min(100, Math.floor(elapsed / 300)); // ~30s to complete
    const stage =
      progress >= 100 ? 'Ingestion complete!'
      : progress >= 70 ? 'Saving to knowledge graph…'
      : progress >= 50 ? 'Extracting relationships…'
      : progress >= 30 ? 'Extracting entities (NER)…'
      : progress >= 10 ? 'Document parsed'
      : 'Parsing document…';
    const status = progress >= 100 ? 'completed' : 'active';

    return {
      jobId: params.jobId,
      bullJobId: params.jobId,
      status,
      progress,
      stage,
      result: status === 'completed' ? {
        status: 'completed',
        entitiesExtracted: 45,
        entitiesInserted: 42,
        relationshipsExtracted: 28,
        relationshipsInserted: 26,
        textLength: 5400,
      } : null,
      failReason: null,
      createdAt: new Date(start).toISOString(),
    };
  },

  '/graph/equipment/:id/visualization': (params) => {
    const equipment = MOCK_EQUIPMENT.find(e => e.equipmentId === params.id) || {
      equipmentId: params.id, name: params.id,
    };
    const rootId = `n_${equipment.equipmentId}`;
    return {
      nodes: [
        { id: rootId, label: equipment.name, type: 'Equipment', color: '#2F5233' },
        { id: 'n_inc1', label: 'Bearing overheating', type: 'Incident', color: '#ED7D31', severity: 'HIGH' },
        { id: 'n_proc1', label: 'Monthly lubrication check', type: 'Procedure', color: '#4472C4' },
        { id: 'n_param1', label: 'Vibration', type: 'Parameter', color: '#70AD47', value: 4.2 },
      ],
      links: [
        { source: rootId, target: 'n_inc1', label: 'FAILED AT' },
        { source: rootId, target: 'n_proc1', label: 'REQUIRES' },
        { source: rootId, target: 'n_param1', label: 'HAS PARAMETER' },
      ],
    };
  },

  '/anomalies': () => ({
    count: 2,
    equipmentScanned: MOCK_EQUIPMENT.length,
    anomalies: [
      {
        equipmentId: 'MOTOR-204',
        incidentId: 'INC-1987',
        incidentName: 'Seal leakage',
        date: new Date(Date.now() - 86400000 * 5).toISOString(),
        type: 'FREQUENT_FAILURES',
        severity: 'CRITICAL',
        recommendation: 'MTBF is 9 days — well below expected baseline. Inspect root cause via RCA, check lubrication schedule and bearing wear.',
        score: -0.78,
        feature: { mtbf: 9, mttr: 12, cost: 4200, failureCount: 4, technicianCount: 2 },
      },
      {
        equipmentId: 'COMP-330',
        incidentId: 'INC-2031',
        incidentName: 'Bearing overheating',
        date: new Date(Date.now() - 86400000 * 12).toISOString(),
        type: 'EXTENDED_REPAIR',
        severity: 'HIGH',
        recommendation: 'Repair time (MTTR 68h) is unusually long. Review spare parts availability and technician skill gap.',
        score: -0.55,
        feature: { mtbf: 40, mttr: 68, cost: 3100, failureCount: 1, technicianCount: 3 },
      },
    ],
  }),

  '/emails/thread/:threadId': (params) => {
    const now = Date.now();
    return {
      threadId: params.threadId,
      linkedIncident: {
        incidentId: 'INC-2024-0042',
        name: 'Pump XYZ Bearing Failure',
        severity: 'HIGH',
        description: 'High-frequency vibration detected on Pump XYZ. Investigation ongoing.',
      },
      emails: [
        {
          messageId: 'msg-001', sender: 'ops.supervisor@plant.com', recipients: ['maintenance@plant.com'],
          subject: '[ALERT] Abnormal vibration — Pump XYZ',
          body: 'Automated alert: vibration reading 12.4 mm/s, threshold 8 mm/s. Please assign a technician immediately.',
          sentAt: new Date(now - 86400000 * 3).toISOString(), direction: 'received', attachments: [],
        },
        {
          messageId: 'msg-002', sender: 'maintenance@plant.com', recipients: ['ops.supervisor@plant.com'],
          subject: 'Re: [ALERT] Abnormal vibration — Pump XYZ',
          body: 'Acknowledged. Assigning Technician R. Sharma for on-site inspection at 14:00 today.',
          sentAt: new Date(now - 86400000 * 2.8).toISOString(), direction: 'sent', attachments: [],
        },
        {
          messageId: 'msg-003', sender: 'r.sharma@plant.com', recipients: ['maintenance@plant.com'],
          subject: 'Re: [ALERT] Abnormal vibration — Pump XYZ',
          body: 'Inspection complete. Bearing wear ~60% degraded, lubrication critically low. Recommend replacement within 48h.',
          sentAt: new Date(now - 86400000 * 2).toISOString(), direction: 'received', attachments: ['inspection_report.pdf'],
        },
        {
          messageId: 'msg-004', sender: 'r.sharma@plant.com', recipients: ['maintenance@plant.com'],
          subject: 'Re: [ALERT] Abnormal vibration — Pump XYZ',
          body: 'Bearing replacement completed. Post-replacement vibration reading: 4.2 mm/s — within normal range. Marking RESOLVED.',
          sentAt: new Date(now - 3600000 * 2).toISOString(), direction: 'received', attachments: ['completion_report.pdf'],
        },
      ],
    };
  },
};

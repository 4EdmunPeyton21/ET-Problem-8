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
};

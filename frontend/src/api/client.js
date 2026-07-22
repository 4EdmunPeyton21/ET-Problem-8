import { mockData } from './mock';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';
const USE_MOCK = !import.meta.env.VITE_API_URL;

const simulateDelay = (ms = 800) => new Promise(resolve => setTimeout(resolve, ms));

const matchMockEndpoint = (endpoint) => {
  if (endpoint.startsWith('/rca/analyze')) return '/rca/analyze';
  if (endpoint.startsWith('/documents/upload')) return '/documents/upload';
  if (endpoint.startsWith('/documents/status/')) return '/documents/status/:jobId';
  if (endpoint.startsWith('/documents')) return '/documents';
  if (endpoint.match(/^\/equipment\/[^/]+\/history/)) return '/equipment/:id/history';
  if (endpoint.startsWith('/equipment')) return '/equipment';
  if (endpoint.match(/^\/graph\/equipment\/[^/]+\/visualization/)) return '/graph/equipment/:id/visualization';
  if (endpoint.startsWith('/anomalies')) return '/anomalies';
  if (endpoint.match(/^\/emails\/thread\//)) return '/emails/thread/:threadId';
  return null;
};

export const apiClient = {
  request: async (endpoint, options = {}) => {
    const isFormData = options.body instanceof FormData;

    if (USE_MOCK) {
      await simulateDelay(isFormData ? 300 : 800);
      const mockKey = matchMockEndpoint(endpoint);

      if (mockKey && mockData[mockKey]) {
        // Extract params if needed
        const params = {};
        if (mockKey === '/documents/status/:jobId') {
          params.jobId = endpoint.split('/').pop();
        } else if (mockKey === '/equipment/:id/history') {
          params.id = endpoint.split('/')[2];
        } else if (mockKey === '/graph/equipment/:id/visualization') {
          params.id = endpoint.split('/')[3];
        } else if (mockKey === '/emails/thread/:threadId') {
          params.threadId = endpoint.split('/').pop();
        }

        // FormData bodies (file upload) are passed through as-is; JSON bodies are parsed.
        const payload = isFormData
          ? options.body
          : (options.body ? JSON.parse(options.body) : params);
        return mockData[mockKey](payload);
      }
      throw new Error(`Mock endpoint not found for: ${endpoint}`);
    }

    // Real API fetch — never force JSON content-type on FormData (browser sets the multipart boundary itself)
    const url = `${API_BASE}${endpoint}`;
    const res = await fetch(url, {
      ...options,
      headers: {
        ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
        ...options.headers,
      },
    });

    if (!res.ok) {
      let errorMsg = `API error: ${res.status}`;
      try {
        const errorData = await res.json();
        errorMsg = errorData.error || errorMsg;
      } catch (e) {}
      throw new Error(errorMsg);
    }

    return res.json();
  }
};

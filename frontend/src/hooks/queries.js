import { useEffect } from 'react';
import { useQuery, useQueries, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../api/client';
import { useUIStore } from '../stores/uiStore';
import { useSocket } from './useSocket';

// Bull job states that will never change again — safe to stop polling.
const TERMINAL_STATUSES = new Set(['completed', 'failed']);

export function useEquipment(typeFilter) {
  return useQuery({
    queryKey: ['equipment', typeFilter],
    queryFn: () => {
      const url = typeFilter ? `/equipment?type=${typeFilter}` : '/equipment';
      return apiClient.request(url);
    },
    staleTime: 1000 * 60 * 10, // 10 minutes
  });
}

export function useEquipmentHistory(id) {
  return useQuery({
    queryKey: ['equipmentHistory', id],
    queryFn: () => apiClient.request(`/equipment/${id}/history`),
    enabled: !!id,
    staleTime: 1000 * 60 * 5,
  });
}

export function useRCAAnalysis() {
  const addToast = useUIStore((state) => state.addToast);

  return useMutation({
    mutationFn: (payload) =>
      apiClient.request('/rca/analyze', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    onError: (error) => {
      addToast('error', error.message || 'Failed to analyze symptoms');
    },
  });
}

// ── Document Upload & Live Ingestion Tracking ────────────────────────────────

/**
 * Uploads a single file to POST /api/documents/upload (multipart, field "document"),
 * registers the returned jobId in the UI store, and seeds the per-job status query
 * cache so a JobCard can start polling/reading it immediately.
 */
export function useUploadDocument() {
  const queryClient = useQueryClient();
  const addIngestionJob = useUIStore((state) => state.addIngestionJob);
  const addToast = useUIStore((state) => state.addToast);

  return useMutation({
    mutationFn: (file) => {
      const formData = new FormData();
      formData.append('document', file);
      return apiClient.request('/documents/upload', { method: 'POST', body: formData });
    },
    onSuccess: (data, file) => {
      addIngestionJob({
        jobId: data.jobId,
        filename: data.filename || file.name,
        size: data.size ?? file.size,
        mimetype: data.mimetype || file.type,
        createdAt: new Date().toISOString(),
      });
      queryClient.setQueryData(['jobStatus', data.jobId], {
        jobId: data.jobId,
        status: 'waiting',
        progress: 0,
        stage: 'Queued…',
        result: null,
        failReason: null,
      });
    },
    onError: (error, file) => {
      addToast('error', `Upload failed for "${file?.name}": ${error.message}`);
    },
  });
}

/** Live status for every tracked job at once — powers the stats banner + filtering. */
export function useIngestionJobStatuses(jobs) {
  const queryClient = useQueryClient();
  const results = useQueries({
    queries: jobs.map((job) => ({
      queryKey: ['jobStatus', job.jobId],
      queryFn: async () => {
        const data = await apiClient.request(`/documents/status/${job.jobId}`);
        // Socket.io already covers this on completion; this catches the polling-only fallback.
        if (data.status === 'completed') {
          queryClient.invalidateQueries({ queryKey: ['equipment'] });
          queryClient.invalidateQueries({ queryKey: ['equipmentHistory'] });
        }
        return data;
      },
      refetchInterval: (query) => (TERMINAL_STATUSES.has(query.state.data?.status) ? false : 2000),
    })),
  });

  return jobs.map((job, i) => ({
    ...job,
    ...results[i].data,
    isLoading: results[i].isLoading,
  }));
}

/**
 * Bridges Socket.io "ingestion:progress" / "ingestion:complete" / "ingestion:failed"
 * events directly into the TanStack Query cache, so live updates render instantly
 * instead of waiting for the next 2s poll. Safe to call once near the app root.
 */
export function useIngestionSocketSync() {
  const { socket } = useSocket();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!socket) return;

    const patchJob = (jobId, patch) => {
      queryClient.setQueryData(['jobStatus', jobId], (old) => ({ ...old, jobId, ...patch }));
    };

    const onProgress = (payload) => {
      patchJob(payload.jobId, { status: 'active', progress: payload.progress, stage: payload.stage });
    };
    const onComplete = (payload) => {
      patchJob(payload.jobId, { status: 'completed', progress: 100, stage: 'Ingestion complete!', result: payload });
      // New equipment/history may have been extracted from this document — refresh cached lists.
      queryClient.invalidateQueries({ queryKey: ['equipment'] });
      queryClient.invalidateQueries({ queryKey: ['equipmentHistory'] });
    };
    const onFailed = (payload) => {
      patchJob(payload.jobId, { status: 'failed', stage: 'Failed', failReason: payload.error });
    };

    socket.on('ingestion:progress', onProgress);
    socket.on('ingestion:complete', onComplete);
    socket.on('ingestion:failed', onFailed);

    return () => {
      socket.off('ingestion:progress', onProgress);
      socket.off('ingestion:complete', onComplete);
      socket.off('ingestion:failed', onFailed);
    };
  }, [socket, queryClient]);
}

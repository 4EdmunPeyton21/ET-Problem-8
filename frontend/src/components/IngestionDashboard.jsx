import { useState, useRef } from 'react';
import { useSocket } from '../hooks/useSocket';

export default function IngestionDashboard() {
  const [documents, setDocuments] = useState([]);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);

  // ── 1. Socket.io Event Handlers ─────────────────────────────────────────────
  useSocket({
    'ingestion:progress': (data) => {
      console.log('Socket progress:', data);
      setDocuments((prev) =>
        prev.map((doc) =>
          doc.id === data.jobId
            ? {
                ...doc,
                progress: data.progress,
                status: data.progress === 100 ? 'completed' : 'processing',
                stage: data.stage,
              }
            : doc
        )
      );
    },
    'ingestion:completed': (data) => {
      console.log('Socket completed:', data);
      setDocuments((prev) =>
        prev.map((doc) =>
          doc.id === data.jobId
            ? {
                ...doc,
                progress: 100,
                status: 'completed',
                entitiesCount: data.entitiesExtracted || 0,
                stage: 'Completed successfully',
              }
            : doc
        )
      );
    },
    'ingestion:complete': (data) => {
      console.log('Socket complete:', data);
      setDocuments((prev) =>
        prev.map((doc) =>
          doc.id === data.jobId
            ? {
                ...doc,
                progress: 100,
                status: 'completed',
                entitiesCount: data.entitiesExtracted || 0,
                stage: 'Completed successfully',
              }
            : doc
        )
      );
    },
    'ingestion:error': (data) => {
      console.log('Socket error:', data);
      setDocuments((prev) =>
        prev.map((doc) =>
          doc.id === data.jobId
            ? {
                ...doc,
                status: 'failed',
                error: data.error || 'Extraction failed',
                stage: 'Failed',
              }
            : doc
        )
      );
    },
    'ingestion:failed': (data) => {
      console.log('Socket failed:', data);
      setDocuments((prev) =>
        prev.map((doc) =>
          doc.id === data.jobId
            ? {
                ...doc,
                status: 'failed',
                error: data.error || 'Extraction failed',
                stage: 'Failed',
              }
            : doc
        )
      );
    },
  });

  // ── 2. Fallback HTTP Polling ────────────────────────────────────────────────
  const startPolling = (documentId) => {
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/documents/${documentId}/status`);
        if (!res.ok) {
          clearInterval(interval);
          return;
        }

        const data = await res.json();

        setDocuments((prev) =>
          prev.map((doc) => {
            if (doc.id === documentId) {
              const isTerminal = data.status === 'completed' || data.status === 'failed';
              if (isTerminal) clearInterval(interval);

              return {
                ...doc,
                progress: Math.max(doc.progress, data.progress || 0),
                status: data.status,
                entitiesCount: data.entitiesExtracted || doc.entitiesCount,
                error: data.errors?.length ? data.errors.join(', ') : doc.error,
              };
            }
            return doc;
          })
        );
      } catch (err) {
        console.error('Polling error:', err);
      }
    }, 1500);
  };

  // ── 3. File Upload Handler ──────────────────────────────────────────────────
  const handleUpload = async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    setUploading(true);

    for (const file of files) {
      try {
        const formData = new FormData();
        formData.append('file', file); // Enforce 'file' field per prompt contract

        const res = await fetch('/api/documents/upload', {
          method: 'POST',
          body: formData,
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Upload failed');

        const newDoc = {
          id: data.documentId,
          name: file.name,
          progress: 0,
          status: 'processing',
          entitiesCount: 0,
          error: null,
          stage: 'Queued…',
        };

        setDocuments((prev) => [newDoc, ...prev]);

        // Start fallback poller
        startPolling(data.documentId);
      } catch (err) {
        console.error('Upload error:', err);
        alert(`Failed to upload ${file.name}: ${err.message}`);
      }
    }

    setUploading(false);
    e.target.value = ''; // Reset input
  };

  // ── Helper Icon Resolution ──────────────────────────────────────────────────
  const getStatusIcon = (status) => {
    switch (status) {
      case 'completed': return <span className="text-emerald-500 font-bold">✓</span>;
      case 'failed':    return <span className="text-rose-500 font-bold">✗</span>;
      default:          return <span className="text-amber-500 animate-pulse font-bold">⏳</span>;
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans p-8 flex justify-center">
      <div className="w-full max-w-3xl">
        
        {/* Header */}
        <div className="mb-8 text-center sm:text-left">
          <h1 className="text-3xl font-extrabold tracking-tight text-white mb-2">
            Industrial Ingest
          </h1>
          <p className="text-slate-400 text-sm">
            Drag & drop or upload text logs, procedures, diagrams, or emails to build the Neo4j knowledge graph.
          </p>
        </div>

        {/* Upload Input Control */}
        <div 
          onClick={() => !uploading && fileInputRef.current?.click()}
          className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all duration-200 mb-8 ${
            uploading 
              ? 'border-slate-800 bg-slate-900/30 cursor-not-allowed' 
              : 'border-slate-800 hover:border-slate-700 bg-slate-950'
          }`}
        >
          <input 
            type="file" 
            ref={fileInputRef} 
            onChange={handleUpload} 
            multiple 
            accept=".pdf,.eml,.csv,.txt" 
            className="hidden" 
            disabled={uploading}
          />
          <div className="text-4xl mb-3">📥</div>
          <p className="font-semibold text-slate-300">
            {uploading ? 'Processing files…' : 'Upload industrial logs'}
          </p>
          <p className="text-xs text-slate-500 mt-1">
            Accepts PDF · EML · CSV · TXT (max 50MB)
          </p>
        </div>

        {/* Document Tracker List */}
        <div>
          <h2 className="text-lg font-bold text-slate-300 mb-4 flex items-center gap-2">
            <span>Documents</span>
            {documents.length > 0 && (
              <span className="bg-slate-900 text-slate-400 text-xs px-2 py-0.5 rounded-full font-medium">
                {documents.length}
              </span>
            )}
          </h2>

          {documents.length === 0 ? (
            <div className="text-center py-12 text-slate-600 border border-slate-900 rounded-xl bg-slate-950/20">
              No files uploaded yet. Select files above to begin parsing.
            </div>
          ) : (
            <div className="space-y-4">
              {documents.map((doc) => (
                <div 
                  key={doc.id} 
                  className="bg-slate-900/40 border border-slate-900 rounded-xl p-5 hover:border-slate-800/80 transition-all duration-150"
                >
                  {/* Title & Metadata */}
                  <div className="flex justify-between items-start mb-3">
                    <div className="pr-4">
                      <h3 className="font-semibold text-slate-200 text-sm break-all">
                        {doc.name}
                      </h3>
                      <p className="text-xs text-slate-500 font-mono mt-0.5">{doc.id}</p>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      {doc.entitiesCount > 0 && (
                        <span className="text-[10px] uppercase font-bold tracking-wider text-emerald-400 bg-emerald-950/40 px-2 py-0.5 rounded border border-emerald-900/30">
                          {doc.entitiesCount} entities
                        </span>
                      )}
                      <span className="text-sm">{getStatusIcon(doc.status)}</span>
                    </div>
                  </div>

                  {/* Progress bar */}
                  <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden mb-2">
                    <div 
                      className={`h-full rounded-full transition-all duration-300 ${
                        doc.status === 'completed' 
                          ? 'bg-emerald-500' 
                          : doc.status === 'failed' 
                          ? 'bg-rose-500' 
                          : 'bg-indigo-500'
                      }`}
                      style={{ width: `${doc.progress}%` }}
                    />
                  </div>

                  {/* Footer status stage or errors */}
                  <div className="flex justify-between items-center text-xs text-slate-500">
                    <span>
                      {doc.status === 'completed' && 'Ingestion complete'}
                      {doc.status === 'failed' && <span className="text-rose-400 font-medium">Failed</span>}
                      {doc.status === 'processing' && (doc.stage || 'Ingesting…')}
                    </span>
                    <span>{doc.progress}%</span>
                  </div>

                  {/* Error block */}
                  {doc.error && (
                    <div className="mt-3 bg-rose-950/20 border border-rose-900/20 text-rose-300 text-xs p-3 rounded-lg font-mono break-all">
                      {doc.error}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}

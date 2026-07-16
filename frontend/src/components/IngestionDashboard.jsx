import { useState, useCallback, useRef, useEffect } from 'react';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

// ── Colour helpers ────────────────────────────────────────────────────────────

const STAGE_COLOURS = {
  queued:     '#6366f1',
  active:     '#3b82f6',
  completed:  '#22c55e',
  failed:     '#ef4444',
  waiting:    '#f59e0b',
};

const stageIcon = (status) => ({
  queued:    '⏳',
  active:    '⚙️',
  completed: '✅',
  failed:    '❌',
  waiting:   '🕐',
}[status] || '📄');

function formatBytes(bytes) {
  if (!bytes) return '—';
  if (bytes < 1024)       return `${bytes} B`;
  if (bytes < 1024 ** 2)  return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

// ── Progress Bar ──────────────────────────────────────────────────────────────

function ProgressBar({ progress, status }) {
  const colour = STAGE_COLOURS[status] || '#6366f1';
  return (
    <div style={{ margin: '8px 0' }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between',
        fontSize: '0.75rem', color: '#94a3b8', marginBottom: 4,
      }}>
        <span>{status?.toUpperCase()}</span>
        <span>{progress}%</span>
      </div>
      <div style={{
        background: '#1e293b', borderRadius: 8, height: 8, overflow: 'hidden',
      }}>
        <div style={{
          width: `${progress}%`,
          height: '100%',
          background: colour,
          borderRadius: 8,
          transition: 'width 0.4s ease',
          boxShadow: status === 'active' ? `0 0 8px ${colour}` : 'none',
        }} />
      </div>
    </div>
  );
}

// ── Job Card ──────────────────────────────────────────────────────────────────

function JobCard({ job }) {
  const colour = STAGE_COLOURS[job.status] || '#6366f1';
  return (
    <div style={{
      background: '#0f172a',
      border: `1px solid ${colour}33`,
      borderLeft: `3px solid ${colour}`,
      borderRadius: 10,
      padding: '14px 16px',
      marginBottom: 10,
      transition: 'box-shadow 0.2s',
    }}>
      {/* Header row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
        <div>
          <span style={{ marginRight: 8, fontSize: '1.1rem' }}>{stageIcon(job.status)}</span>
          <span style={{ fontWeight: 600, color: '#e2e8f0', fontSize: '0.9rem' }}>
            {job.originalName || job.filename || job.jobId}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {job.mimetype && (
            <span style={{
              background: '#1e293b', color: '#94a3b8',
              borderRadius: 4, padding: '2px 8px', fontSize: '0.7rem',
            }}>
              {job.mimetype.split('/').pop().toUpperCase()}
            </span>
          )}
          <span style={{
            background: `${colour}22`, color: colour,
            borderRadius: 4, padding: '2px 8px', fontSize: '0.7rem', fontWeight: 600,
          }}>
            {job.status?.toUpperCase()}
          </span>
        </div>
      </div>

      {/* Progress bar */}
      <ProgressBar progress={job.progress || 0} status={job.status} />

      {/* Current stage message */}
      {job.stage && (
        <p style={{ margin: '4px 0 0', fontSize: '0.75rem', color: '#64748b' }}>
          {job.stage}
        </p>
      )}

      {/* Completed stats */}
      {job.status === 'completed' && job.result && (
        <div style={{
          display: 'flex', gap: 16, marginTop: 10,
          paddingTop: 10, borderTop: '1px solid #1e293b',
        }}>
          {[
            { label: 'Entities', value: job.result.entitiesExtracted },
            { label: 'Inserted',  value: job.result.entitiesInserted },
            { label: 'Relations', value: job.result.relationshipsExtracted },
            { label: 'Text',      value: `${((job.result.textLength || 0) / 1000).toFixed(1)}k chars` },
          ].map(({ label, value }) => (
            <div key={label} style={{ textAlign: 'center' }}>
              <div style={{ fontWeight: 700, color: '#22c55e', fontSize: '1rem' }}>{value ?? '—'}</div>
              <div style={{ color: '#475569', fontSize: '0.68rem' }}>{label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Error state */}
      {job.status === 'failed' && job.error && (
        <p style={{ margin: '8px 0 0', color: '#fca5a5', fontSize: '0.75rem', fontFamily: 'monospace' }}>
          {job.error}
        </p>
      )}

      {/* Footer: size + time */}
      <div style={{
        display: 'flex', justifyContent: 'space-between',
        marginTop: 8, color: '#334155', fontSize: '0.7rem',
      }}>
        <span>{formatBytes(job.size)}</span>
        <span>{job.jobId}</span>
      </div>
    </div>
  );
}

// ── Drop Zone ─────────────────────────────────────────────────────────────────

function DropZone({ onFiles, uploading }) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef();

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setDragging(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length) onFiles(files);
  }, [onFiles]);

  const handleChange = (e) => {
    const files = Array.from(e.target.files);
    if (files.length) onFiles(files);
    e.target.value = '';
  };

  return (
    <div
      onClick={() => !uploading && inputRef.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      style={{
        border: `2px dashed ${dragging ? '#6366f1' : '#1e293b'}`,
        borderRadius: 12,
        padding: '36px 24px',
        textAlign: 'center',
        cursor: uploading ? 'not-allowed' : 'pointer',
        background: dragging ? '#6366f108' : 'transparent',
        transition: 'all 0.2s',
        marginBottom: 24,
      }}
    >
      <div style={{ fontSize: '2.5rem', marginBottom: 8 }}>📄</div>
      <p style={{ color: '#94a3b8', margin: '0 0 4px', fontSize: '0.95rem', fontWeight: 500 }}>
        {uploading ? 'Uploading…' : 'Drop documents here or click to browse'}
      </p>
      <p style={{ color: '#475569', margin: 0, fontSize: '0.78rem' }}>
        PDF · EML · TXT · XLSX · PNG · JPG · TIFF — max 50 MB
      </p>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept=".pdf,.eml,.msg,.txt,.png,.jpg,.jpeg,.tiff,.csv,.xls,.xlsx"
        style={{ display: 'none' }}
        onChange={handleChange}
        disabled={uploading}
      />
    </div>
  );
}

// ── Stats Banner ──────────────────────────────────────────────────────────────

function StatsBanner({ jobs }) {
  const completed = jobs.filter(j => j.status === 'completed');
  const failed    = jobs.filter(j => j.status === 'failed');
  const active    = jobs.filter(j => j.status === 'active');

  const totalEntities  = completed.reduce((s, j) => s + (j.result?.entitiesExtracted      || 0), 0);
  const totalRelations = completed.reduce((s, j) => s + (j.result?.relationshipsExtracted  || 0), 0);

  const stats = [
    { label: 'Total Jobs',  value: jobs.length,       colour: '#6366f1' },
    { label: 'Active',      value: active.length,      colour: '#3b82f6' },
    { label: 'Completed',   value: completed.length,   colour: '#22c55e' },
    { label: 'Failed',      value: failed.length,      colour: '#ef4444' },
    { label: 'Entities ✓',  value: totalEntities,      colour: '#a855f7' },
    { label: 'Relations ✓', value: totalRelations,     colour: '#06b6d4' },
  ];

  return (
    <div style={{
      display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 10, marginBottom: 24,
    }}>
      {stats.map(({ label, value, colour }) => (
        <div key={label} style={{
          background: '#0f172a', border: `1px solid ${colour}33`,
          borderRadius: 10, padding: '12px 10px', textAlign: 'center',
        }}>
          <div style={{ fontWeight: 700, fontSize: '1.4rem', color: colour }}>{value}</div>
          <div style={{ color: '#64748b', fontSize: '0.7rem', marginTop: 2 }}>{label}</div>
        </div>
      ))}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function IngestionDashboard() {
  const [jobs, setJobs]         = useState([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError]         = useState(null);
  const pollerRef                 = useRef({});

  // ── Upload files ────────────────────────────────────────────────────────────

  const uploadFiles = useCallback(async (files) => {
    setUploading(true);
    setError(null);

    for (const file of files) {
      try {
        const formData = new FormData();
        formData.append('document', file);

        const res  = await fetch(`${API_BASE}/documents/upload`, { method: 'POST', body: formData });
        const data = await res.json();

        if (!res.ok) throw new Error(data.error || `Upload failed: ${res.status}`);

        // Add job to local state immediately
        const newJob = {
          jobId:        data.jobId,
          bullJobId:    data.bullJobId,
          originalName: file.name,
          filename:     data.filename,
          mimetype:     file.type,
          size:         file.size,
          status:       'queued',
          progress:     0,
          stage:        'Queued…',
          result:       null,
        };

        setJobs(prev => [newJob, ...prev]);

        // Start polling for this job
        startPolling(data.jobId);

      } catch (err) {
        setError(`Upload failed for "${file.name}": ${err.message}`);
      }
    }

    setUploading(false);
  }, []);

  // ── Job progress polling ────────────────────────────────────────────────────

  const startPolling = useCallback((jobId) => {
    if (pollerRef.current[jobId]) return; // already polling

    const interval = setInterval(async () => {
      try {
        const res  = await fetch(`${API_BASE}/documents/status/${jobId}`);
        const data = await res.json();

        if (!res.ok || data.status === 'not_found') {
          clearInterval(interval);
          delete pollerRef.current[jobId];
          return;
        }

        setJobs(prev => prev.map(j =>
          j.jobId === jobId
            ? {
                ...j,
                status:   data.status,
                progress: data.progress || j.progress,
                result:   data.result   || j.result,
                error:    data.failReason,
              }
            : j
        ));

        // Stop polling when terminal state is reached
        if (data.status === 'completed' || data.status === 'failed') {
          clearInterval(interval);
          delete pollerRef.current[jobId];
        }

      } catch {
        // Network errors during polling — silently continue
      }
    }, 2000); // poll every 2 seconds

    pollerRef.current[jobId] = interval;
  }, []);

  // Cleanup pollers on unmount
  useEffect(() => {
    return () => Object.values(pollerRef.current).forEach(clearInterval);
  }, []);

  // ── Filter tabs ─────────────────────────────────────────────────────────────

  const [filter, setFilter] = useState('all');
  const FILTERS = ['all', 'active', 'completed', 'failed', 'queued'];

  const visibleJobs = filter === 'all'
    ? jobs
    : jobs.filter(j => j.status === filter);

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #020617 0%, #0f172a 60%, #1e1b4b 100%)',
      fontFamily: "'Inter', -apple-system, sans-serif",
      color: '#e2e8f0',
      padding: '32px 24px',
    }}>
      <div style={{ maxWidth: 900, margin: '0 auto' }}>

        {/* Header */}
        <div style={{ marginBottom: 32 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
            <span style={{ fontSize: '2rem' }}>🏭</span>
            <h1 style={{ margin: 0, fontSize: '1.6rem', fontWeight: 700, color: '#f1f5f9' }}>
              Document Ingestion Dashboard
            </h1>
          </div>
          <p style={{ margin: 0, color: '#64748b', fontSize: '0.88rem' }}>
            Upload industrial documents (PDFs, emails, spreadsheets, diagrams) — NER extraction and graph ingestion run automatically in the background.
          </p>
        </div>

        {/* Stats banner */}
        {jobs.length > 0 && <StatsBanner jobs={jobs} />}

        {/* Drop zone */}
        <DropZone onFiles={uploadFiles} uploading={uploading} />

        {/* Error banner */}
        {error && (
          <div style={{
            background: '#450a0a', border: '1px solid #ef4444', borderRadius: 8,
            padding: '12px 16px', marginBottom: 16, color: '#fca5a5', fontSize: '0.85rem',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            <span>⚠️ {error}</span>
            <button onClick={() => setError(null)} style={{
              background: 'none', border: 'none', color: '#f87171', cursor: 'pointer', fontSize: '1.1rem',
            }}>×</button>
          </div>
        )}

        {/* Filter tabs */}
        {jobs.length > 0 && (
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            {FILTERS.map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                style={{
                  background: filter === f ? '#6366f1' : '#0f172a',
                  border: `1px solid ${filter === f ? '#6366f1' : '#1e293b'}`,
                  borderRadius: 6, padding: '5px 14px',
                  color: filter === f ? '#fff' : '#94a3b8',
                  fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer',
                  textTransform: 'capitalize', transition: 'all 0.15s',
                }}
              >
                {f} {f !== 'all' && `(${jobs.filter(j => j.status === f).length})`}
              </button>
            ))}
          </div>
        )}

        {/* Job list */}
        {visibleJobs.length === 0 ? (
          <div style={{
            textAlign: 'center', padding: '48px 24px',
            color: '#334155', fontSize: '0.9rem',
          }}>
            {jobs.length === 0
              ? 'No documents uploaded yet. Drop files above to begin.'
              : `No ${filter} jobs.`}
          </div>
        ) : (
          <div>
            {visibleJobs.map(job => (
              <JobCard key={job.jobId} job={job} />
            ))}
          </div>
        )}

        {/* Pipeline legend */}
        <div style={{
          marginTop: 32, padding: '16px 20px',
          background: '#0f172a', border: '1px solid #1e293b', borderRadius: 10,
        }}>
          <p style={{ margin: '0 0 10px', fontSize: '0.8rem', fontWeight: 600, color: '#475569' }}>
            INGESTION PIPELINE
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 0, flexWrap: 'wrap' }}>
            {[
              { pct: '10%',  label: 'Parse Doc',       colour: '#6366f1' },
              { pct: '30%',  label: 'NER Entities',    colour: '#3b82f6' },
              { pct: '50%',  label: 'Relationships',   colour: '#a855f7' },
              { pct: '70%',  label: 'Neo4j Graph',     colour: '#06b6d4' },
              { pct: '100%', label: 'Complete',        colour: '#22c55e' },
            ].map(({ pct, label, colour }, i) => (
              <div key={label} style={{ display: 'flex', alignItems: 'center' }}>
                {i > 0 && <span style={{ color: '#334155', margin: '0 4px', fontSize: '0.75rem' }}>→</span>}
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '0.65rem', color: colour, fontWeight: 700 }}>{pct}</div>
                  <div style={{ fontSize: '0.65rem', color: '#475569' }}>{label}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}

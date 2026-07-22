import { useState, useCallback, useRef } from 'react';
import { UploadCloud, FileText, CheckCircle2, XCircle, Loader2, Clock3 } from 'lucide-react';
import { useUploadDocument, useIngestionJobStatuses, useIngestionSocketSync } from '../hooks/queries';
import { useUIStore } from '../stores/uiStore';
import { EmptyState } from '../components/Common/EmptyState';
import { Skeleton } from '../components/Common/Skeleton';

const ACCEPTED_EXTENSIONS = '.pdf,.eml,.msg,.txt,.png,.jpg,.jpeg,.tiff,.csv,.xls,.xlsx';
const FILTERS = ['all', 'queued', 'active', 'completed', 'failed'];

// Bull reports the initial state as "waiting" — the rest of the app calls it "queued".
const displayStatus = (status) => (status === 'waiting' ? 'queued' : status || 'queued');

const STATUS_META = {
  queued: { icon: Clock3, className: 'text-muted' },
  active: { icon: Loader2, className: 'text-primary animate-spin' },
  completed: { icon: CheckCircle2, className: 'text-success' },
  failed: { icon: XCircle, className: 'text-error' },
};

function formatBytes(bytes) {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

function JobRow({ job }) {
  const status = displayStatus(job.status);
  const meta = STATUS_META[status] || STATUS_META.queued;
  const Icon = meta.icon;

  if (job.isLoading) {
    return (
      <div className="p-4 sm:p-5">
        <Skeleton className="h-5 w-1/3" />
      </div>
    );
  }

  return (
    <div className="pop-in p-4 sm:p-5">
      <div className="flex items-center gap-3.5">
        <Icon className={`size-5 shrink-0 ${meta.className}`} strokeWidth={2} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <h4 className="truncate font-medium text-ink">{job.filename || job.jobId}</h4>
            <span className="shrink-0 font-mono text-xs text-muted">{formatBytes(job.size)}</span>
          </div>

          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2">
            <div
              className={[
                'h-full rounded-full transition-all duration-500 ease-out',
                status === 'completed' ? 'bg-success' : status === 'failed' ? 'bg-error' : 'bg-primary',
              ].join(' ')}
              style={{ width: `${job.progress || 0}%` }}
            />
          </div>
          <div className="mt-1.5 flex justify-between text-xs">
            <span className="text-muted">{job.stage || 'Queued…'}</span>
            <span className="font-mono font-medium text-ink">{job.progress || 0}%</span>
          </div>
        </div>
      </div>

      {status === 'completed' && job.result && (
        <div className="mt-4 grid grid-cols-4 gap-3 border-t border-border pt-4">
          {[
            { label: 'Entities', value: job.result.entitiesExtracted },
            { label: 'Inserted', value: job.result.entitiesInserted },
            { label: 'Relations', value: job.result.relationshipsExtracted },
            { label: 'Text', value: job.result.textLength ? `${(job.result.textLength / 1000).toFixed(1)}k` : '—' },
          ].map(({ label, value }) => (
            <div key={label} className="text-center">
              <div className="font-mono text-sm font-semibold text-success">{value ?? '—'}</div>
              <div className="text-[11px] text-muted">{label}</div>
            </div>
          ))}
        </div>
      )}

      {status === 'failed' && job.failReason && (
        <p className="mt-3 border-t border-border pt-3 font-mono text-xs text-error">{job.failReason}</p>
      )}
    </div>
  );
}

export const IngestionDashboard = () => {
  useIngestionSocketSync();

  const jobs = useUIStore((state) => state.ingestionJobs);
  const filter = useUIStore((state) => state.ingestionFilter);
  const setFilter = useUIStore((state) => state.setIngestionFilter);
  const { mutate: uploadDocument } = useUploadDocument();

  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef(null);

  const liveJobs = useIngestionJobStatuses(jobs);

  const uploadFiles = useCallback((files) => {
    files.forEach((file) => uploadDocument(file));
  }, [uploadDocument]);

  const handleDrag = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') setIsDragging(true);
    else if (e.type === 'dragleave') setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    uploadFiles(Array.from(e.dataTransfer.files));
  }, [uploadFiles]);

  const handleFileChange = (e) => {
    uploadFiles(Array.from(e.target.files));
    e.target.value = '';
  };

  const stats = {
    total: liveJobs.length,
    active: liveJobs.filter((j) => displayStatus(j.status) === 'active').length,
    completed: liveJobs.filter((j) => displayStatus(j.status) === 'completed').length,
    failed: liveJobs.filter((j) => displayStatus(j.status) === 'failed').length,
  };

  const filteredJobs = filter === 'all' ? liveJobs : liveJobs.filter((j) => displayStatus(j.status) === filter);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink">Ingestion</h1>
        <p className="mt-1 text-sm text-muted">Upload documents and watch extraction run against the knowledge graph in real time.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: 'Total', value: stats.total },
          { label: 'Active', value: stats.active, className: 'text-primary' },
          { label: 'Completed', value: stats.completed, className: 'text-success' },
          { label: 'Failed', value: stats.failed, className: 'text-error' },
        ].map(({ label, value, className }) => (
          <div key={label} className="surface p-4">
            <div className={`text-2xl font-semibold ${className || 'text-ink'}`}>{value}</div>
            <div className="text-xs text-muted">{label}</div>
          </div>
        ))}
      </div>

      <div
        onClick={() => fileInputRef.current?.click()}
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
        role="button"
        tabIndex={0}
        className={[
          'flex cursor-pointer flex-col items-center rounded-xl border-2 border-dashed px-6 py-12 text-center transition-colors duration-150',
          isDragging ? 'border-primary bg-primary/5' : 'border-border hover:border-muted',
        ].join(' ')}
      >
        <UploadCloud className="mb-3 size-8 text-muted" strokeWidth={1.5} />
        <p className="font-medium text-ink">Drop documents here, or click to browse</p>
        <p className="mt-1 text-xs text-muted">PDF · EML · TXT · XLSX · PNG · JPG · TIFF — max 50 MB</p>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={ACCEPTED_EXTENSIONS}
          className="hidden"
          onChange={handleFileChange}
        />
      </div>

      <div className="surface overflow-hidden">
        <div className="flex overflow-x-auto border-b border-border">
          {FILTERS.map((tab) => (
            <button
              key={tab}
              onClick={() => setFilter(tab)}
              className={[
                'shrink-0 border-b-2 px-4 py-3 text-sm font-medium capitalize transition-colors duration-150',
                filter === tab ? 'border-primary text-primary' : 'border-transparent text-muted hover:text-ink',
              ].join(' ')}
            >
              {tab}
            </button>
          ))}
        </div>

        <div className="divide-y divide-border">
          {liveJobs.length === 0 && (
            <EmptyState
              icon={FileText}
              title="No documents uploaded yet"
              hint="Drop a file above to see extraction and graph ingestion run in real time."
            />
          )}

          {liveJobs.length > 0 && filteredJobs.length === 0 && (
            <p className="p-8 text-center text-sm text-muted">No {filter} jobs.</p>
          )}

          {filteredJobs.map((job) => (
            <JobRow key={job.jobId} job={job} />
          ))}
        </div>
      </div>
    </div>
  );
};

import { Link } from 'react-router-dom';
import { UploadCloud, Cpu, FileSearch, ChevronRight, FileStack, AlertTriangle } from 'lucide-react';
import { useEquipment } from '../hooks/queries';
import { useUIStore } from '../stores/uiStore';

const ACTIONS = [
  {
    to: '/ingestion',
    icon: UploadCloud,
    title: 'Ingest a document',
    description: 'Upload manuals, P&ID diagrams, or maintenance logs — extraction runs automatically.',
  },
  {
    to: '/equipment',
    icon: Cpu,
    title: 'Browse equipment',
    description: 'Look up an asset and its failure, procedure, and parameter history.',
  },
  {
    to: '/rca',
    icon: FileSearch,
    title: 'Run root cause analysis',
    description: 'Describe a symptom and get ranked probable causes with diagnostic steps.',
  },
];

export const Dashboard = () => {
  const { data } = useEquipment();
  const ingestionJobs = useUIStore((state) => state.ingestionJobs);
  const rcaHistory = useUIStore((state) => state.rcaHistory);

  const equipmentCount = data?.count ?? data?.equipment?.length ?? 0;
  const completedJobs = ingestionJobs.length;
  const recentJobs = ingestionJobs.slice(0, 4);

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <div>
        <h1 className="text-3xl font-semibold text-ink">Welcome back</h1>
        <p className="mt-1 text-muted">Industrial Knowledge Intelligence — plant document intake, asset history, and RCA in one place.</p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {[
          { label: 'Equipment tracked', value: equipmentCount, icon: Cpu },
          { label: 'Documents ingested', value: completedJobs, icon: FileStack },
          { label: 'RCAs run this session', value: rcaHistory.length, icon: AlertTriangle },
        ].map(({ label, value, icon: Icon }) => (
          <div key={label} className="surface flex items-center gap-4 p-4">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-muted">
              <Icon className="size-5" strokeWidth={1.75} />
            </div>
            <div>
              <div className="text-2xl font-semibold text-ink">{value}</div>
              <div className="text-xs text-muted">{label}</div>
            </div>
          </div>
        ))}
      </div>

      <div>
        <h2 className="mb-3 text-sm font-medium text-muted">Quick actions</h2>
        <div className="surface divide-y divide-border">
          {ACTIONS.map(({ to, icon: Icon, title, description }) => (
            <Link
              key={to}
              to={to}
              className="group flex items-center gap-4 p-4 transition-colors duration-150 hover:bg-surface-2 sm:p-5"
            >
              <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/12 text-primary">
                <Icon className="size-5" strokeWidth={1.75} />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="font-medium text-ink">{title}</h3>
                <p className="mt-0.5 truncate text-sm text-muted">{description}</p>
              </div>
              <ChevronRight className="size-4 shrink-0 text-muted transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-ink" />
            </Link>
          ))}
        </div>
      </div>

      {recentJobs.length > 0 && (
        <div>
          <h2 className="mb-3 text-sm font-medium text-muted">Recent uploads</h2>
          <div className="surface divide-y divide-border">
            {recentJobs.map((job) => (
              <div key={job.jobId} className="flex items-center justify-between gap-4 p-4">
                <span className="truncate text-sm text-ink">{job.filename}</span>
                <span className="shrink-0 font-mono text-xs text-muted">{new Date(job.createdAt).toLocaleTimeString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, Activity, Wrench, Gauge, MapPin, Cpu } from 'lucide-react';
import { useEquipmentHistory } from '../hooks/queries';
import { EmptyState } from '../components/Common/EmptyState';
import { Skeleton } from '../components/Common/Skeleton';

function buildTimeline(history) {
  if (!history) return [];

  const failures = (history.failures || []).map((f) => ({
    key: f.incidentId || f.name,
    type: 'failure',
    date: f.createdAt || f.updatedAt,
    title: f.name,
    description: f.description || (f.severity ? `Severity: ${f.severity}` : null),
  }));

  const procedures = (history.procedures || []).map((p) => ({
    key: p.procedureId || p.name,
    type: 'procedure',
    date: p.createdAt || p.updatedAt,
    title: p.name,
    description: p.description || null,
  }));

  const parameters = (history.parameters || []).map((p) => ({
    key: p.name,
    type: 'parameter',
    date: p.createdAt || p.updatedAt,
    title: p.name,
    description: p.value != null ? `Recorded value: ${p.value}${p.unit || ''}` : null,
  }));

  return [...failures, ...procedures, ...parameters].sort(
    (a, b) => new Date(b.date || 0) - new Date(a.date || 0)
  );
}

const TIMELINE_STYLE = {
  failure: { icon: Activity, className: 'bg-error/12 border-error/25 text-error', label: 'Failure' },
  procedure: { icon: Wrench, className: 'bg-info/12 border-info/25 text-info', label: 'Procedure' },
  parameter: { icon: Gauge, className: 'bg-surface-2 border-border text-muted', label: 'Parameter' },
};

const STATUS_STYLE = {
  OPERATIONAL: 'bg-success/12 text-success border-success/25',
  WARNING: 'bg-warning/12 text-warning border-warning/25',
  CRITICAL: 'bg-error/12 text-error border-error/25',
};

export const EquipmentDetail = () => {
  const { id } = useParams();
  const { data: history, isLoading, error } = useEquipmentHistory(id);

  const equipment = history?.equipment;
  const timeline = buildTimeline(history);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link to="/equipment" className="inline-flex items-center gap-1.5 text-sm text-muted transition-colors duration-150 hover:text-ink">
        <ArrowLeft className="size-4" /> Back to Equipment
      </Link>

      {isLoading && (
        <div className="surface space-y-4 p-6">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-4 w-64" />
        </div>
      )}

      {error && <EmptyState icon={Cpu} title="Couldn't load equipment" hint={error.message} />}
      {!isLoading && !error && !equipment && (
        <EmptyState icon={Cpu} title={`Equipment "${id}" not found`} />
      )}

      {equipment && (
        <>
          <div className="surface p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h1 className="text-xl font-semibold text-ink">{equipment.name}</h1>
                <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-muted">
                  <span className="font-mono text-xs">{equipment.equipmentId}</span>
                  <span>{equipment.type || 'Unclassified'}</span>
                  {equipment.location && (
                    <span className="flex items-center gap-1">
                      <MapPin className="size-3.5" /> {equipment.location}
                    </span>
                  )}
                </div>
              </div>
              <span className={`badge ${STATUS_STYLE[(equipment.status || '').toUpperCase()] || 'bg-surface-2 text-muted border-border'}`}>
                {(equipment.status || 'unknown').toLowerCase()}
              </span>
            </div>

            <div className="mt-6 grid grid-cols-3 gap-4 border-t border-border pt-6">
              {[
                { label: 'Failures', value: history.failures?.length || 0, className: 'text-error' },
                { label: 'Procedures', value: history.procedures?.length || 0, className: 'text-info' },
                { label: 'Parameters', value: history.parameters?.length || 0, className: 'text-ink' },
              ].map(({ label, value, className }) => (
                <div key={label} className="text-center">
                  <div className={`text-2xl font-semibold ${className}`}>{value}</div>
                  <div className="mt-1 text-xs text-muted">{label}</div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <h2 className="mb-3 text-sm font-medium text-muted">History timeline</h2>

            {timeline.length === 0 ? (
              <EmptyState title="No history recorded" hint="Failures, procedures, and parameter readings will appear here as documents referencing this equipment are ingested." />
            ) : (
              <ol className="relative ml-2.5 space-y-6 border-l border-border pb-1">
                {timeline.map((entry) => {
                  const style = TIMELINE_STYLE[entry.type];
                  const Icon = style.icon;
                  return (
                    <li key={entry.key} className="relative pl-7">
                      <div className={`absolute -left-[15px] top-0.5 flex size-7 items-center justify-center rounded-full border bg-bg ${style.className}`}>
                        <Icon className="size-3.5" />
                      </div>
                      <div className="surface p-4">
                        <div className="flex items-start justify-between gap-3">
                          <span className={`text-xs font-semibold uppercase tracking-wide ${style.className.split(' ').pop()}`}>
                            {style.label}
                          </span>
                          {entry.date && (
                            <time className="shrink-0 font-mono text-xs text-muted">
                              {new Date(entry.date).toLocaleDateString()}
                            </time>
                          )}
                        </div>
                        <h4 className="mt-1.5 font-medium text-ink">{entry.title}</h4>
                        {entry.description && <p className="mt-1 text-sm text-muted">{entry.description}</p>}
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
        </>
      )}
    </div>
  );
};

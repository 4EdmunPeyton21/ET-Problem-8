import { Link } from 'react-router-dom';
import { AlertOctagon, TrendingDown, Clock, DollarSign, Users, Zap } from 'lucide-react';
import { useAnomalies } from '../hooks/queries';
import { EmptyState } from '../components/Common/EmptyState';
import { SkeletonCard } from '../components/Common/Skeleton';

const SEVERITY_STYLE = {
  CRITICAL: 'border-error/40 bg-error/8',
  HIGH: 'border-warning/40 bg-warning/8',
  MEDIUM: 'border-border bg-surface-2',
  LOW: 'border-border bg-surface-2',
};

const SEVERITY_BADGE = {
  CRITICAL: 'bg-error/12 text-error border-error/25',
  HIGH: 'bg-warning/12 text-warning border-warning/25',
  MEDIUM: 'bg-info/12 text-info border-info/25',
  LOW: 'bg-surface-2 text-muted border-border',
};

const TYPE_META = {
  FREQUENT_FAILURES: { icon: TrendingDown, label: 'Frequent failures' },
  EXTENDED_REPAIR: { icon: Clock, label: 'Extended repair' },
  HIGH_COST: { icon: DollarSign, label: 'High cost' },
  UNUSUAL_TECHNICIAN: { icon: Users, label: 'Unusual technician count' },
  CASCADING_FAILURE: { icon: Zap, label: 'Cascading failure' },
  PARAMETER_OUTLIER: { icon: AlertOctagon, label: 'Parameter outlier' },
};

export const AnomalyAlerts = () => {
  const { data, isLoading, error } = useAnomalies();
  const anomalies = data?.anomalies || [];

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink">Anomaly Alerts</h1>
        <p className="mt-1 text-sm text-muted">
          Isolation Forest-based detection over equipment maintenance history — frequency, repair time, and cost outliers.
        </p>
      </div>

      {!isLoading && !error && (
        <div className="surface flex items-center gap-6 p-4 text-sm">
          <span className="text-muted">
            <span className="font-mono font-semibold text-ink">{data?.equipmentScanned ?? 0}</span> equipment scanned
          </span>
          <span className="text-muted">
            <span className="font-mono font-semibold text-error">{anomalies.length}</span> anomalies found
          </span>
        </div>
      )}

      {isLoading && (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      )}

      {error && <EmptyState icon={AlertOctagon} title="Couldn't run anomaly detection" hint={error.message} />}

      {!isLoading && !error && anomalies.length === 0 && (
        <EmptyState
          icon={AlertOctagon}
          title="No anomalies detected"
          hint="Every scanned equipment's maintenance history looks within normal range. Ingest more incident history to improve detection."
        />
      )}

      <div className="space-y-3">
        {anomalies.map((a, idx) => {
          const meta = TYPE_META[a.type] || TYPE_META.PARAMETER_OUTLIER;
          const Icon = meta.icon;
          return (
            <div key={idx} className={`rounded-xl border p-4 sm:p-5 ${SEVERITY_STYLE[a.severity] || SEVERITY_STYLE.LOW}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <Icon className="size-[18px] shrink-0 text-ink" strokeWidth={1.75} />
                  <div>
                    <Link to={`/equipment/${a.equipmentId}`} className="font-medium text-ink hover:text-primary transition-colors duration-150">
                      {a.equipmentId}
                    </Link>
                    <span className="ml-2 text-xs text-muted">{meta.label}</span>
                  </div>
                </div>
                <span className={`badge shrink-0 ${SEVERITY_BADGE[a.severity] || SEVERITY_BADGE.LOW}`}>{a.severity}</span>
              </div>

              <p className="mt-3 text-sm text-muted">{a.recommendation}</p>

              {a.feature && (
                <div className="mt-4 grid grid-cols-4 gap-3 border-t border-border pt-3">
                  {[
                    { label: 'MTBF', value: a.feature.mtbf != null ? `${a.feature.mtbf}d` : '—' },
                    { label: 'MTTR', value: a.feature.mttr != null ? `${a.feature.mttr}h` : '—' },
                    { label: 'Cost', value: a.feature.cost ? `$${a.feature.cost}` : '—' },
                    { label: 'Failures (30d)', value: a.feature.failureCount ?? '—' },
                  ].map(({ label, value }) => (
                    <div key={label} className="text-center">
                      <div className="font-mono text-xs font-semibold text-ink">{value}</div>
                      <div className="text-[11px] text-muted">{label}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

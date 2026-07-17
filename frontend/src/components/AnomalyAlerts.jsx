import { useState, useEffect, useCallback, useMemo } from 'react';
import { useSocket } from '../hooks/useSocket';

// ── Constants ─────────────────────────────────────────────────────────────────

const SEVERITY_CONFIG = {
  CRITICAL: {
    label:      'CRITICAL',
    dot:        'bg-rose-500',
    badge:      'bg-rose-500/15 text-rose-400 border border-rose-500/30',
    cardBorder: 'border-rose-500/30 hover:border-rose-500/60',
    glow:       'shadow-rose-500/10',
    bar:        'bg-gradient-to-r from-rose-600 to-rose-400',
    text:       'text-rose-400',
    bg:         'bg-rose-500/5',
    icon:       '🔴',
    order:      0,
    pulse:      true,
  },
  HIGH: {
    label:      'HIGH',
    dot:        'bg-orange-400',
    badge:      'bg-orange-500/15 text-orange-400 border border-orange-500/30',
    cardBorder: 'border-orange-500/25 hover:border-orange-500/50',
    glow:       'shadow-orange-500/10',
    bar:        'bg-gradient-to-r from-orange-600 to-orange-400',
    text:       'text-orange-400',
    bg:         'bg-orange-500/5',
    icon:       '🟠',
    order:      1,
    pulse:      false,
  },
  MEDIUM: {
    label:      'MEDIUM',
    dot:        'bg-amber-400',
    badge:      'bg-amber-500/15 text-amber-400 border border-amber-500/30',
    cardBorder: 'border-amber-500/25 hover:border-amber-500/50',
    glow:       'shadow-amber-500/10',
    bar:        'bg-gradient-to-r from-amber-600 to-amber-400',
    text:       'text-amber-400',
    bg:         'bg-amber-500/5',
    icon:       '🟡',
    order:      2,
    pulse:      false,
  },
  LOW: {
    label:      'LOW',
    dot:        'bg-sky-400',
    badge:      'bg-sky-500/15 text-sky-400 border border-sky-500/30',
    cardBorder: 'border-sky-500/20 hover:border-sky-500/40',
    glow:       'shadow-sky-500/5',
    bar:        'bg-gradient-to-r from-sky-600 to-sky-400',
    text:       'text-sky-400',
    bg:         'bg-sky-500/5',
    icon:       '🔵',
    order:      3,
    pulse:      false,
  },
};

const TYPE_LABELS = {
  FREQUENT_FAILURES:  { icon: '⚡', label: 'Frequent Failures' },
  EXTENDED_REPAIR:    { icon: '🔧', label: 'Extended Repair'   },
  HIGH_COST:          { icon: '💸', label: 'High Cost'         },
  UNUSUAL_TECHNICIAN: { icon: '👥', label: 'Unusual Technician'},
  CASCADING_FAILURE:  { icon: '🌊', label: 'Cascading Failure' },
  PARAMETER_OUTLIER:  { icon: '📊', label: 'Parameter Outlier' },
};

const SEVERITY_ORDER = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

// ── Sub-components ────────────────────────────────────────────────────────────

function PulsingDot({ cfg }) {
  if (cfg.pulse) {
    return (
      <span className="relative flex h-2.5 w-2.5 shrink-0">
        <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${cfg.dot} opacity-60`} />
        <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${cfg.dot}`} />
      </span>
    );
  }
  return <span className={`h-2.5 w-2.5 rounded-full ${cfg.dot} shrink-0`} />;
}

function ScoreBar({ score, severity }) {
  const pct = Math.min(100, Math.round(Math.abs(score || 0.5) * 100));
  const cfg = SEVERITY_CONFIG[severity] || SEVERITY_CONFIG.LOW;
  return (
    <div>
      <div className="flex justify-between items-center mb-1">
        <span className="text-[11px] text-slate-500 uppercase tracking-wider">Anomaly Score</span>
        <span className={`text-xs font-bold ${cfg.text}`}>{pct}%</span>
      </div>
      <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-700 ${cfg.bar}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function StatPill({ label, value, highlight }) {
  return (
    <div className="flex flex-col items-center bg-slate-800/60 rounded-lg px-3 py-2 min-w-[64px]">
      <span className={`text-sm font-bold ${highlight ? 'text-rose-400' : 'text-slate-100'}`}>
        {value ?? '—'}
      </span>
      <span className="text-[10px] text-slate-500 uppercase tracking-wide mt-0.5">{label}</span>
    </div>
  );
}

// ── Detail Drawer (drill-in panel) ────────────────────────────────────────────

function DetailDrawer({ anomaly, onClose }) {
  const cfg  = SEVERITY_CONFIG[anomaly.severity] || SEVERITY_CONFIG.LOW;
  const type = TYPE_LABELS[anomaly.type] || { icon: '⚠️', label: anomaly.type };
  const feat = anomaly.feature || {};
  const zsc  = anomaly.zscores || {};

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm" />

      {/* Panel */}
      <div
        className={`relative w-full max-w-xl bg-slate-900 border ${cfg.cardBorder} rounded-2xl
                    shadow-2xl ${cfg.glow} overflow-hidden`}
        onClick={e => e.stopPropagation()}
      >
        {/* Colour strip */}
        <div className={`h-1 w-full ${cfg.bar}`} />

        <div className="p-6">
          {/* Header */}
          <div className="flex justify-between items-start mb-5">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <PulsingDot cfg={cfg} />
                <h2 className="text-lg font-bold text-slate-100">{anomaly.equipmentId}</h2>
              </div>
              <p className="text-xs font-mono text-slate-500">
                {anomaly.incidentId || 'No incident ID'}
                {anomaly.date && ` · ${new Date(anomaly.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`}
              </p>
            </div>
            <div className="flex flex-col items-end gap-1.5">
              <span className={`text-xs font-bold px-2.5 py-1 rounded-lg ${cfg.badge}`}>
                {cfg.icon} {cfg.label}
              </span>
              <span className="text-xs text-slate-400 bg-slate-800 px-2 py-0.5 rounded-md">
                {type.icon} {type.label}
              </span>
            </div>
          </div>

          {/* Feature stats */}
          <div className="flex gap-2 flex-wrap mb-5">
            <StatPill label="MTBF" value={feat.mtbf !== undefined ? `${feat.mtbf}d` : null} highlight={feat.mtbf < 14} />
            <StatPill label="MTTR" value={feat.mttr ? `${feat.mttr}h` : null} highlight={feat.mttr > 48} />
            <StatPill label="Cost" value={feat.cost ? `₹${feat.cost}` : null} highlight={feat.cost > 20000} />
            <StatPill label="Failures/30d" value={feat.failureCount} highlight={feat.failureCount >= 3} />
            <StatPill label="Technicians" value={feat.technicianCount} />
          </div>

          {/* Z-scores */}
          {Object.keys(zsc).length > 0 && (
            <div className="mb-5">
              <p className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold mb-2">
                Z-Score Breakdown
              </p>
              <div className="space-y-1.5">
                {Object.entries(zsc).filter(([, v]) => v > 0).sort(([, a],[, b]) => b - a).map(([key, val]) => (
                  <div key={key} className="flex items-center gap-3">
                    <span className="text-xs text-slate-400 w-32 truncate capitalize">
                      {key.replace(/([A-Z])/g, ' $1')}
                    </span>
                    <div className="flex-1 h-1 bg-slate-800 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${val > 2 ? 'bg-rose-500' : val > 1 ? 'bg-orange-500' : 'bg-slate-500'}`}
                        style={{ width: `${Math.min(100, val * 25)}%` }}
                      />
                    </div>
                    <span className={`text-xs font-mono w-8 text-right ${val > 2 ? 'text-rose-400' : 'text-slate-400'}`}>
                      {val.toFixed(1)}σ
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Anomaly reason */}
          {anomaly.reason && (
            <p className="text-xs text-slate-400 italic mb-4 border-l-2 border-slate-700 pl-3">
              {anomaly.reason}
            </p>
          )}

          {/* Recommendation */}
          <div className={`${cfg.bg} border ${cfg.cardBorder} rounded-xl p-4 mb-5`}>
            <p className="text-[11px] uppercase tracking-wider font-bold text-slate-500 mb-1.5">
              Recommended Action
            </p>
            <p className="text-sm text-slate-200 leading-relaxed">{anomaly.recommendation}</p>
          </div>

          {/* Score bar */}
          <ScoreBar score={anomaly.score} severity={anomaly.severity} />

          {/* Close */}
          <button
            onClick={onClose}
            className="mt-5 w-full py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-sm text-slate-300
                       transition-colors duration-150 font-medium"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Anomaly Card (click to open drawer) ───────────────────────────────────────

function AnomalyCard({ anomaly, onClick }) {
  const cfg  = SEVERITY_CONFIG[anomaly.severity] || SEVERITY_CONFIG.LOW;
  const type = TYPE_LABELS[anomaly.type] || { icon: '⚠️', label: anomaly.type };
  const feat = anomaly.feature || {};

  return (
    <div
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={e => e.key === 'Enter' && onClick()}
      className={`group bg-slate-900/50 border ${cfg.cardBorder} rounded-xl p-4
                  cursor-pointer transition-all duration-200 hover:bg-slate-900/80
                  hover:shadow-lg hover:${cfg.glow} active:scale-[0.99]`}
    >
      <div className="flex items-start justify-between gap-3">
        {/* Left: identifier */}
        <div className="flex items-start gap-3 min-w-0">
          <div className="mt-0.5"><PulsingDot cfg={cfg} /></div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-bold text-slate-100">{anomaly.equipmentId}</span>
              {anomaly.date && (
                <span className="text-[11px] text-slate-500 shrink-0">
                  {new Date(anomaly.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' })}
                </span>
              )}
            </div>
            <p className="text-[11px] font-mono text-slate-500 truncate mt-0.5">
              {anomaly.incidentId || anomaly.incidentName || 'No incident ID'}
            </p>
            {/* Quick feature pills */}
            <div className="flex gap-2 mt-2 flex-wrap">
              {feat.mtbf !== undefined && (
                <span className={`text-[10px] px-1.5 py-0.5 rounded ${feat.mtbf < 14 ? 'bg-rose-500/10 text-rose-400' : 'bg-slate-800 text-slate-400'}`}>
                  MTBF {feat.mtbf}d
                </span>
              )}
              {feat.mttr > 0 && (
                <span className={`text-[10px] px-1.5 py-0.5 rounded ${feat.mttr > 48 ? 'bg-orange-500/10 text-orange-400' : 'bg-slate-800 text-slate-400'}`}>
                  MTTR {feat.mttr}h
                </span>
              )}
              {feat.failureCount >= 3 && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-500/10 text-rose-400">
                  {feat.failureCount} failures/30d
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Right: badges + chevron */}
        <div className="flex flex-col items-end gap-1.5 shrink-0">
          <span className={`text-[11px] font-bold px-2 py-0.5 rounded-md ${cfg.badge}`}>
            {cfg.label}
          </span>
          <span className="text-[10px] text-slate-500 bg-slate-800 px-2 py-0.5 rounded-md whitespace-nowrap">
            {type.icon} {type.label}
          </span>
          <span className="text-slate-600 group-hover:text-slate-400 transition-colors text-xs mt-1">
            Details →
          </span>
        </div>
      </div>

      {/* Recommendation preview */}
      <p className="text-[11px] text-slate-500 mt-3 line-clamp-1 pl-5">
        {anomaly.recommendation}
      </p>
    </div>
  );
}

// ── Stats Summary Bar ─────────────────────────────────────────────────────────

function SummaryBar({ anomalies, onSeverityClick, activeSeverity }) {
  const counts = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
  for (const a of anomalies) if (counts[a.severity] !== undefined) counts[a.severity]++;

  return (
    <div className="grid grid-cols-4 gap-2 mb-6">
      {Object.entries(counts).map(([sev, count]) => {
        const cfg    = SEVERITY_CONFIG[sev];
        const active = activeSeverity === sev;
        return (
          <button
            key={sev}
            onClick={() => onSeverityClick(active ? 'ALL' : sev)}
            className={`rounded-xl p-3 text-center border transition-all duration-150
              ${active
                ? `${cfg.bg} ${cfg.cardBorder} shadow-lg`
                : 'bg-slate-900/50 border-slate-800/60 hover:border-slate-700'
              }`}
          >
            <div className={`text-xl font-black ${cfg.text}`}>{count}</div>
            <div className="text-[10px] uppercase tracking-wider text-slate-500 mt-0.5">
              {cfg.icon} {cfg.label}
            </div>
          </button>
        );
      })}
    </div>
  );
}

// ── Live Alert Toast ──────────────────────────────────────────────────────────

function LiveToast({ alerts, onDismiss }) {
  if (!alerts.length) return null;
  return (
    <div className="fixed top-4 right-4 z-40 space-y-2 max-w-sm w-full pointer-events-none">
      {alerts.map((a, i) => {
        const cfg = SEVERITY_CONFIG[a.severity] || SEVERITY_CONFIG.LOW;
        return (
          <div
            key={i}
            className={`pointer-events-auto flex items-start gap-3 bg-slate-900 border ${cfg.cardBorder}
                        rounded-xl p-3 shadow-xl animate-in slide-in-from-right`}
          >
            <PulsingDot cfg={cfg} />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold text-slate-100">{a.equipmentId}</p>
              <p className="text-[11px] text-slate-400">
                {(TYPE_LABELS[a.type] || {}).icon} {(TYPE_LABELS[a.type] || {}).label || a.type} · {a.severity}
              </p>
            </div>
            <button
              onClick={() => onDismiss(i)}
              className="text-slate-600 hover:text-slate-300 text-xs shrink-0"
            >✕</button>
          </div>
        );
      })}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function AnomalyAlerts() {
  const [allAnomalies,   setAllAnomalies]   = useState([]);
  const [loading,        setLoading]        = useState(false);
  const [scanning,       setScanning]       = useState(false);
  const [error,          setError]          = useState(null);
  const [selectedAnomaly, setSelectedAnomaly] = useState(null);
  const [toasts,         setToasts]         = useState([]);

  // Filters
  const [severityFilter,  setSeverityFilter]  = useState('ALL');
  const [equipmentFilter, setEquipmentFilter] = useState('ALL');
  const [typeFilter,      setTypeFilter]      = useState('ALL');
  const [searchText,      setSearchText]      = useState('');

  // ── Socket.io: live anomaly push ───────────────────────────────────────────
  useSocket({
    'anomaly:detected': (data) => {
      console.log('[AnomalyAlerts] Live event:', data);
      setToasts(prev => [data, ...prev].slice(0, 5));
      setAllAnomalies(prev => [data, ...prev]);
    },
  });

  // ── Fetch ALL equipment anomalies on mount ─────────────────────────────────
  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res  = await fetch('/api/anomalies');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setAllAnomalies(Array.isArray(data.anomalies) ? data.anomalies : []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // ── Scan single equipment ──────────────────────────────────────────────────
  const handleScan = useCallback(async () => {
    if (!searchText.trim()) return fetchAll();
    setScanning(true);
    setError(null);
    try {
      const res  = await fetch(`/api/anomalies/${encodeURIComponent(searchText.trim())}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      const found = Array.isArray(data.anomalies) ? data.anomalies : [];
      // Merge into all without duplicates
      setAllAnomalies(prev => {
        const ids = new Set(found.map(a => a.incidentId));
        return [...found, ...prev.filter(a => !ids.has(a.incidentId))];
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setScanning(false);
    }
  }, [searchText, fetchAll]);

  // ── Derived filter lists ───────────────────────────────────────────────────
  const equipmentOptions = useMemo(() => {
    const set = new Set(allAnomalies.map(a => a.equipmentId).filter(Boolean));
    return ['ALL', ...Array.from(set).sort()];
  }, [allAnomalies]);

  const typeOptions = useMemo(() => {
    const set = new Set(allAnomalies.map(a => a.type).filter(Boolean));
    return ['ALL', ...Array.from(set).sort()];
  }, [allAnomalies]);

  // ── Filtered + sorted anomalies ────────────────────────────────────────────
  const visible = useMemo(() => {
    return allAnomalies
      .filter(a => severityFilter  === 'ALL' || a.severity   === severityFilter)
      .filter(a => equipmentFilter === 'ALL' || a.equipmentId === equipmentFilter)
      .filter(a => typeFilter      === 'ALL' || a.type        === typeFilter)
      .sort((a, b) =>
        (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9)
      );
  }, [allAnomalies, severityFilter, equipmentFilter, typeFilter]);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100" style={{ fontFamily: "'Inter', system-ui, sans-serif" }}>
      {/* Live toasts */}
      <LiveToast alerts={toasts} onDismiss={i => setToasts(p => p.filter((_, j) => j !== i))} />

      {/* Detail drawer */}
      {selectedAnomaly && (
        <DetailDrawer anomaly={selectedAnomaly} onClose={() => setSelectedAnomaly(null)} />
      )}

      <div className="max-w-4xl mx-auto px-6 py-10">

        {/* ── Page Header ── */}
        <div className="flex items-start justify-between mb-8 gap-4">
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight text-white leading-tight">
              Anomaly Alerts
            </h1>
            <p className="text-slate-400 text-sm mt-1.5 max-w-lg">
              ML-powered anomaly detection across all equipment using{' '}
              <span className="text-indigo-400 font-medium">Isolation Forest</span>.
              CRITICAL alerts pulsed in real-time via Socket.io.
            </p>
          </div>
          <button
            onClick={fetchAll}
            disabled={loading}
            className="shrink-0 flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-800 border
                       border-slate-700 hover:bg-slate-700 text-sm text-slate-300 transition-all"
          >
            {loading
              ? <><span className="h-3 w-3 border-2 border-slate-500 border-t-transparent rounded-full animate-spin"/>Scanning…</>
              : <><span>↺</span> Refresh</>
            }
          </button>
        </div>

        {/* ── Error banner ── */}
        {error && (
          <div className="mb-6 bg-rose-950/30 border border-rose-800/40 text-rose-300 text-sm p-4
                          rounded-xl font-mono flex items-start gap-2">
            <span>⚠️</span><span>{error}</span>
          </div>
        )}

        {/* ── Severity Summary (clickable) ── */}
        {allAnomalies.length > 0 && (
          <SummaryBar
            anomalies={allAnomalies}
            activeSeverity={severityFilter}
            onSeverityClick={setSeverityFilter}
          />
        )}

        {/* ── Filters row ── */}
        <div className="flex flex-wrap gap-3 mb-6">
          {/* Equipment search + scan */}
          <div className="flex gap-2 flex-1 min-w-[220px]">
            <input
              type="text"
              value={searchText}
              onChange={e => setSearchText(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleScan()}
              placeholder="Scan equipment (e.g. PUMP-XYZ)"
              className="flex-1 bg-slate-900 border border-slate-800 text-slate-200 text-sm
                         placeholder-slate-600 rounded-xl px-4 py-2.5 focus:outline-none
                         focus:border-indigo-500 transition-colors"
            />
            <button
              onClick={handleScan}
              disabled={scanning || loading}
              className={`px-4 py-2.5 rounded-xl text-sm font-bold transition-all ${
                scanning ? 'bg-slate-800 text-slate-500 cursor-not-allowed'
                         : 'bg-indigo-600 hover:bg-indigo-500 text-white cursor-pointer'
              }`}
            >
              {scanning
                ? <span className="h-3 w-3 border-2 border-slate-400 border-t-transparent rounded-full animate-spin inline-block"/>
                : 'Scan'
              }
            </button>
          </div>

          {/* Equipment dropdown */}
          <select
            value={equipmentFilter}
            onChange={e => setEquipmentFilter(e.target.value)}
            className="bg-slate-900 border border-slate-800 text-slate-300 text-sm rounded-xl
                       px-3 py-2.5 focus:outline-none focus:border-indigo-500 transition-colors"
          >
            {equipmentOptions.map(e => (
              <option key={e} value={e}>{e === 'ALL' ? 'All Equipment' : e}</option>
            ))}
          </select>

          {/* Type dropdown */}
          <select
            value={typeFilter}
            onChange={e => setTypeFilter(e.target.value)}
            className="bg-slate-900 border border-slate-800 text-slate-300 text-sm rounded-xl
                       px-3 py-2.5 focus:outline-none focus:border-indigo-500 transition-colors"
          >
            {typeOptions.map(t => (
              <option key={t} value={t}>
                {t === 'ALL' ? 'All Types' : (TYPE_LABELS[t]?.label || t)}
              </option>
            ))}
          </select>
        </div>

        {/* ── Results count ── */}
        {allAnomalies.length > 0 && (
          <p className="text-xs text-slate-500 mb-4">
            Showing <span className="text-slate-300 font-semibold">{visible.length}</span> of{' '}
            <span className="text-slate-300 font-semibold">{allAnomalies.length}</span> anomalies
            {severityFilter !== 'ALL' || equipmentFilter !== 'ALL' || typeFilter !== 'ALL'
              ? ' (filtered)' : ''}
          </p>
        )}

        {/* ── Anomaly list (CRITICAL first) ── */}
        {loading && allAnomalies.length === 0 ? (
          <div className="text-center py-24">
            <div className="inline-flex items-center gap-3 text-slate-400">
              <span className="h-5 w-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin"/>
              <span>Scanning all equipment for anomalies…</span>
            </div>
          </div>
        ) : visible.length === 0 && allAnomalies.length > 0 ? (
          <div className="text-center py-16 border border-slate-800 rounded-2xl">
            <p className="text-slate-500">No anomalies match your current filters.</p>
          </div>
        ) : visible.length === 0 ? (
          <div className="text-center py-24 border border-slate-800/50 rounded-2xl bg-slate-900/20">
            <div className="text-5xl mb-4">🔍</div>
            <p className="text-slate-400 font-medium text-lg">No anomalies detected</p>
            <p className="text-slate-600 text-sm mt-2">
              All equipment appears to be operating within normal parameters.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {visible.map((anomaly, i) => (
              <AnomalyCard
                key={`${anomaly.incidentId || i}-${anomaly.type}-${anomaly.equipmentId}`}
                anomaly={anomaly}
                onClick={() => setSelectedAnomaly(anomaly)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

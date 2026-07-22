import { useState } from 'react';
import { useRCAAnalysis, useEquipment } from '../hooks/queries';
import { FileSearch, AlertTriangle, Lightbulb, ClipboardList, ShieldCheck, Search, Loader2 } from 'lucide-react';
import { EmptyState } from '../components/Common/EmptyState';

const LIKELIHOOD_STYLE = {
  HIGH: 'border-error/40 bg-error/8',
  MEDIUM: 'border-warning/40 bg-warning/8',
  LOW: 'border-border bg-surface-2',
};

const LIKELIHOOD_TEXT = {
  HIGH: 'text-error',
  MEDIUM: 'text-warning',
  LOW: 'text-muted',
};

const CONFIDENCE_STYLE = {
  HIGH: 'bg-success/12 text-success border-success/25',
  MEDIUM: 'bg-warning/12 text-warning border-warning/25',
  LOW: 'bg-surface-2 text-muted border-border',
};

export const RCAAssistant = () => {
  const [symptom, setSymptom] = useState('');
  const [equipmentId, setEquipmentId] = useState('');
  const [results, setResults] = useState(null);

  const { data: equipmentData } = useEquipment();
  const equipmentList = equipmentData?.equipment || [];
  const { mutate: analyze, isPending } = useRCAAnalysis();

  const handleSubmit = (e) => {
    e.preventDefault();
    if (symptom.length < 10) return;

    setResults(null);
    analyze({ symptomDescription: symptom, equipmentId: equipmentId || undefined }, {
      onSuccess: (data) => setResults(data),
    });
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink">RCA Assistant</h1>
        <p className="mt-1 text-sm text-muted">Describe a symptom to get ranked probable causes from the knowledge graph.</p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-1">
          <form onSubmit={handleSubmit} className="surface space-y-4 p-5">
            <div className="flex items-center gap-2 text-ink">
              <AlertTriangle className="size-[18px] text-warning" strokeWidth={2} />
              <h2 className="font-medium">Report symptom</h2>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted">Equipment (optional)</label>
              <select
                value={equipmentId}
                onChange={(e) => setEquipmentId(e.target.value)}
                className="control"
              >
                <option value="">Select equipment…</option>
                {equipmentList.map((eq) => (
                  <option key={eq.equipmentId} value={eq.equipmentId}>{eq.name} ({eq.equipmentId})</option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted">
                Symptom description <span className="text-error">*</span>
              </label>
              <textarea
                value={symptom}
                onChange={(e) => setSymptom(e.target.value)}
                placeholder="Describe the issue, noises, errors, or abnormal behavior in detail…"
                className="control min-h-[120px] resize-y"
                required
              />
              <p className="mt-1 text-xs text-muted">Minimum 10 characters</p>
            </div>

            <button type="submit" disabled={symptom.length < 10 || isPending} className="btn-primary w-full">
              {isPending ? (
                <><Loader2 className="size-4 animate-spin" /> Analyzing…</>
              ) : (
                <><Search className="size-4" /> Run analysis</>
              )}
            </button>
          </form>
        </div>

        <div className="lg:col-span-2">
          {!results && !isPending && (
            <EmptyState
              icon={FileSearch}
              title="Ready to analyze"
              hint="Enter a symptom on the left to query the knowledge graph for probable causes and past incidents."
            />
          )}

          {isPending && (
            <div className="surface flex min-h-[280px] flex-col items-center justify-center p-8 text-center">
              <Loader2 className="mb-4 size-9 animate-spin text-warning" strokeWidth={1.75} />
              <h3 className="font-medium text-ink">Analyzing knowledge graph…</h3>
              <p className="mt-1.5 max-w-sm text-sm text-muted">Cross-referencing incident history, equipment records, and procedures.</p>
            </div>
          )}

          {results && (
            <div className="pop-in space-y-6">
              <div className="surface p-5 sm:p-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-ink">
                    <Lightbulb className="size-5 text-warning" strokeWidth={1.75} />
                    <h2 className="font-medium">Probable causes</h2>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`badge ${CONFIDENCE_STYLE[results.confidenceLevel] || CONFIDENCE_STYLE.LOW}`}>
                      {results.confidenceLevel?.toLowerCase()} confidence
                    </span>
                    {results.provider && (
                      <span className="badge border-border bg-surface-2 text-muted capitalize">{results.provider}</span>
                    )}
                  </div>
                </div>

                <div className="mt-4 space-y-3">
                  {(results.probableRootCauses || []).map((cause, idx) => (
                    <div key={idx} className={`rounded-lg border p-4 ${LIKELIHOOD_STYLE[cause.likelihood] || LIKELIHOOD_STYLE.LOW}`}>
                      <div className="flex items-start justify-between gap-4">
                        <p className="font-medium text-ink">{cause.cause}</p>
                        <span className={`shrink-0 text-xs font-semibold uppercase tracking-wide ${LIKELIHOOD_TEXT[cause.likelihood] || LIKELIHOOD_TEXT.LOW}`}>
                          {cause.likelihood}
                        </span>
                      </div>
                      {cause.evidence && <p className="mt-2 text-sm text-muted">{cause.evidence}</p>}
                    </div>
                  ))}
                  {(results.probableRootCauses || []).length === 0 && (
                    <p className="text-sm text-muted">No probable causes identified.</p>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                <div className="surface p-5 sm:p-6">
                  <div className="mb-4 flex items-center gap-2 text-ink">
                    <ClipboardList className="size-[18px] text-info" strokeWidth={1.75} />
                    <h3 className="font-medium">Diagnostic steps</h3>
                  </div>
                  <ol className="space-y-3">
                    {(results.diagnosticSteps || []).map((step, idx) => (
                      <li key={idx} className="flex gap-3">
                        <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-info/15 text-[11px] font-semibold text-info">
                          {idx + 1}
                        </span>
                        <p className="text-sm text-muted">{step}</p>
                      </li>
                    ))}
                    {(results.diagnosticSteps || []).length === 0 && (
                      <p className="text-sm text-muted">No diagnostic steps suggested.</p>
                    )}
                  </ol>

                  {(results.preventiveMeasures || []).length > 0 && (
                    <>
                      <div className="mt-6 mb-3 flex items-center gap-2 border-t border-border pt-6 text-ink">
                        <ShieldCheck className="size-[18px] text-success" strokeWidth={1.75} />
                        <h3 className="font-medium">Preventive measures</h3>
                      </div>
                      <ul className="space-y-2">
                        {results.preventiveMeasures.map((measure, idx) => (
                          <li key={idx} className="flex gap-2 text-sm text-muted">
                            <span className="text-success">·</span> {measure}
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </div>

                <div className="surface p-5 sm:p-6">
                  <h3 className="mb-4 font-medium text-ink">Similar past incidents</h3>
                  <div className="space-y-3">
                    {(results.similarHistoricalIncidents || []).map((incident, idx) => (
                      <div key={incident.incidentId || idx} className="rounded-lg border border-border bg-surface-2 p-3">
                        <div className="flex items-center justify-between gap-3">
                          <span className="font-mono text-xs text-muted">
                            {incident.date ? new Date(incident.date).toLocaleDateString() : 'no date'}
                          </span>
                          {typeof incident.similarityScore === 'number' && (
                            <span className="badge border-border bg-bg text-muted">{Math.round(incident.similarityScore * 100)}% match</span>
                          )}
                        </div>
                        <p className="mt-2 text-sm font-medium text-ink">{incident.incidentId || 'Unknown incident'}</p>
                        {Array.isArray(incident.symptoms) && incident.symptoms.length > 0 && (
                          <p className="mt-1 text-xs text-muted">{incident.symptoms.join(', ')}</p>
                        )}
                        {incident.rootCause && (
                          <p className="mt-2 inline-block rounded-md bg-success/10 px-1.5 py-1 text-xs text-success">
                            Root cause: {incident.rootCause}
                          </p>
                        )}
                      </div>
                    ))}
                    {(results.similarHistoricalIncidents || []).length === 0 && (
                      <p className="text-sm text-muted">No similar historical incidents found.</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

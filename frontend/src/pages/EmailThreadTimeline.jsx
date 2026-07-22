import { useState } from 'react';
import { Mail, Paperclip, ArrowUpRight, ArrowDownLeft, AlertTriangle, Search } from 'lucide-react';
import { useEmailThread } from '../hooks/queries';
import { EmptyState } from '../components/Common/EmptyState';
import { Skeleton } from '../components/Common/Skeleton';

const SEVERITY_STYLE = {
  CRITICAL: 'bg-error/12 text-error border-error/25',
  HIGH: 'bg-warning/12 text-warning border-warning/25',
  MEDIUM: 'bg-info/12 text-info border-info/25',
  LOW: 'bg-surface-2 text-muted border-border',
};

export const EmailThreadTimeline = () => {
  const [input, setInput] = useState('');
  const [threadId, setThreadId] = useState('');
  const { data, isLoading, error } = useEmailThread(threadId);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (input.trim()) setThreadId(input.trim());
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink">Email Thread Timeline</h1>
        <p className="mt-1 text-sm text-muted">Trace a maintenance incident's email correspondence chronologically.</p>
      </div>

      <form onSubmit={handleSubmit} className="flex gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Enter a thread ID (e.g. THREAD-INC-2024-0042)…"
            className="control pl-9"
          />
        </div>
        <button type="submit" disabled={!input.trim()} className="btn-primary shrink-0">
          Load thread
        </button>
      </form>

      {!threadId && (
        <EmptyState
          icon={Mail}
          title="No thread loaded"
          hint="Enter a thread ID above to view its email correspondence, linked incident, and resolution timeline."
        />
      )}

      {isLoading && (
        <div className="surface space-y-4 p-6">
          <Skeleton className="h-5 w-1/2" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      )}

      {error && <EmptyState icon={Mail} title="Couldn't load thread" hint={error.message} />}

      {data && (
        <div className="pop-in space-y-6">
          {data.linkedIncident && (
            <div className="flex items-start gap-3 rounded-xl border border-warning/40 bg-warning/8 p-4">
              <AlertTriangle className="mt-0.5 size-[18px] shrink-0 text-warning" strokeWidth={1.75} />
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-medium text-ink">{data.linkedIncident.name}</span>
                  <span className={`badge ${SEVERITY_STYLE[data.linkedIncident.severity] || SEVERITY_STYLE.LOW}`}>
                    {data.linkedIncident.severity}
                  </span>
                </div>
                <p className="mt-1 text-sm text-muted">{data.linkedIncident.description}</p>
              </div>
            </div>
          )}

          <ol className="relative ml-2.5 space-y-5 border-l border-border pb-1">
            {(data.emails || []).map((email) => {
              const sent = email.direction === 'sent';
              return (
                <li key={email.messageId} className="relative pl-7">
                  <div
                    className={`absolute -left-[15px] top-0.5 flex size-7 items-center justify-center rounded-full border bg-bg ${
                      sent ? 'border-info/25 text-info' : 'border-border text-muted'
                    }`}
                  >
                    {sent ? <ArrowUpRight className="size-3.5" /> : <ArrowDownLeft className="size-3.5" />}
                  </div>
                  <div className="surface p-4">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <h4 className="font-medium text-ink">{email.subject}</h4>
                      {email.sentAt && (
                        <time className="shrink-0 font-mono text-xs text-muted">
                          {new Date(email.sentAt).toLocaleString()}
                        </time>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-muted">
                      {email.sender} → {(email.recipients || []).join(', ')}
                    </p>
                    <p className="mt-2.5 whitespace-pre-line text-sm text-muted">{email.body}</p>
                    {email.attachments?.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-2 border-t border-border pt-3">
                        {email.attachments.map((att) => (
                          <span key={att} className="badge border-border bg-surface-2 text-muted">
                            <Paperclip className="size-3" /> {att}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </div>
  );
};

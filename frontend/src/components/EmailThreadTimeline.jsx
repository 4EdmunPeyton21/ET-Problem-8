import { useState, useEffect, useCallback } from 'react';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Get initials from an email address or display name */
function getInitials(sender = '') {
  const name = sender.split('@')[0].replace(/[._-]/g, ' ');
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map(w => w[0].toUpperCase())
    .join('');
}

/** Deterministic colour from sender string (cycles through a palette) */
const AVATAR_PALETTES = [
  { bg: 'bg-indigo-600',  text: 'text-white' },
  { bg: 'bg-violet-600',  text: 'text-white' },
  { bg: 'bg-cyan-700',    text: 'text-white' },
  { bg: 'bg-emerald-700', text: 'text-white' },
  { bg: 'bg-rose-700',    text: 'text-white' },
  { bg: 'bg-amber-600',   text: 'text-white' },
  { bg: 'bg-teal-700',    text: 'text-white' },
  { bg: 'bg-fuchsia-700', text: 'text-white' },
];

function avatarPalette(sender = '') {
  let hash = 0;
  for (let i = 0; i < sender.length; i++) {
    hash = (hash * 31 + sender.charCodeAt(i)) % AVATAR_PALETTES.length;
  }
  return AVATAR_PALETTES[Math.abs(hash) % AVATAR_PALETTES.length];
}

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const diffDays = Math.floor((now - d) / 86400000);

  const time = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });

  if (diffDays === 0) return `Today, ${time}`;
  if (diffDays === 1) return `Yesterday, ${time}`;
  if (diffDays < 7)  return `${diffDays} days ago, ${time}`;
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) + `, ${time}`;
}

function formatFullDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('en-IN', {
    weekday: 'short', day: '2-digit', month: 'short',
    year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true,
  });
}

/** Severity colours for the incident banner */
const SEVERITY_STYLE = {
  CRITICAL: 'text-rose-400 bg-rose-500/10 border-rose-500/30',
  HIGH:     'text-orange-400 bg-orange-500/10 border-orange-500/30',
  MEDIUM:   'text-amber-400 bg-amber-500/10 border-amber-500/30',
  LOW:      'text-sky-400 bg-sky-500/10 border-sky-500/30',
};

// ── Sub-components ────────────────────────────────────────────────────────────

/** Blue pill showing linked incident */
function IncidentBanner({ incident }) {
  const sev = SEVERITY_STYLE[incident.severity] || SEVERITY_STYLE.LOW;
  return (
    <div className="mb-6 bg-indigo-500/5 border border-indigo-500/20 rounded-xl p-4">
      <div className="flex items-start gap-3">
        <div className="h-8 w-8 rounded-lg bg-indigo-600/20 border border-indigo-500/30
                        flex items-center justify-center text-base shrink-0">
          🔗
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <p className="text-xs font-bold text-indigo-400 uppercase tracking-wider">Linked Incident</p>
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${sev}`}>
              {incident.severity}
            </span>
          </div>
          <p className="text-sm font-semibold text-slate-100">{incident.name}</p>
          {incident.incidentId && (
            <p className="text-[11px] font-mono text-indigo-400/70 mt-0.5">{incident.incidentId}</p>
          )}
          {incident.description && (
            <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">{incident.description}</p>
          )}
        </div>
      </div>
    </div>
  );
}

/** Avatar circle with initials */
function Avatar({ sender, size = 'md' }) {
  const palette  = avatarPalette(sender);
  const initials = getInitials(sender);
  const sizeClass = size === 'sm'
    ? 'h-7 w-7 text-[10px]'
    : 'h-9 w-9 text-xs';

  return (
    <div className={`${sizeClass} ${palette.bg} ${palette.text} rounded-full
                    flex items-center justify-center font-bold shrink-0 select-none`}>
      {initials || '?'}
    </div>
  );
}

/** Attachment pill */
function Attachment({ filename }) {
  const ext = filename.split('.').pop().toUpperCase();
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] bg-slate-800 border border-slate-700
                     text-slate-300 px-2 py-1 rounded-lg">
      <span className="text-slate-500">📎</span>
      <span className="truncate max-w-[160px]">{filename}</span>
      <span className="text-slate-500 text-[9px] font-bold">{ext}</span>
    </span>
  );
}

/** Single email card in the timeline */
function EmailCard({ email, index, total }) {
  const [expanded, setExpanded] = useState(false);

  const isSent     = email.direction === 'sent';
  const palette    = avatarPalette(email.sender);
  const bodyLines  = (email.body || '').split('\n').filter(l => l.trim());
  const preview    = bodyLines.slice(0, 2).join(' ').substring(0, 160);
  const hasMore    = email.body && (bodyLines.length > 2 || email.body.length > 160);
  const recipients = Array.isArray(email.recipients) ? email.recipients : [email.recipients].filter(Boolean);
  const isLast     = index === total - 1;

  return (
    <div className="relative flex gap-4">
      {/* ── Vertical timeline line ── */}
      <div className="flex flex-col items-center shrink-0">
        <Avatar sender={email.sender} />
        {!isLast && (
          <div className="w-px flex-1 mt-2 mb-0"
               style={{ background: 'linear-gradient(to bottom, #334155, transparent)' }}
          />
        )}
      </div>

      {/* ── Email card ── */}
      <div
        className={`flex-1 min-w-0 mb-6 rounded-xl border transition-all duration-200 cursor-pointer
                    ${isSent
                      ? 'bg-indigo-950/30 border-indigo-500/20 hover:border-indigo-500/40'
                      : 'bg-slate-900/60 border-slate-800/70 hover:border-slate-700'
                    }
                    ${expanded ? 'shadow-lg' : ''}`}
        style={{ borderLeftWidth: 3, borderLeftColor: isSent ? '#4f46e5' : '#475569' }}
        onClick={() => setExpanded(e => !e)}
        role="button"
        tabIndex={0}
        onKeyDown={e => e.key === 'Enter' && setExpanded(v => !v)}
        aria-expanded={expanded}
      >
        {/* Card header */}
        <div className="px-4 pt-3.5 pb-3">
          <div className="flex items-start justify-between gap-3 mb-2">
            {/* Sender + direction */}
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <span className="text-sm font-bold text-slate-100 truncate">{email.sender}</span>
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide shrink-0 ${
                isSent
                  ? 'bg-indigo-600/20 text-indigo-400 border border-indigo-500/20'
                  : 'bg-slate-800 text-slate-500 border border-slate-700'
              }`}>
                {isSent ? '↑ Sent' : '↓ Recv'}
              </span>
            </div>
            {/* Timestamp */}
            <time className="text-[11px] text-slate-500 shrink-0 tabular-nums">
              {formatDate(email.sentAt)}
            </time>
          </div>

          {/* Subject */}
          <p className="text-[13px] font-semibold text-slate-200 mb-1.5 leading-snug">
            {email.subject}
          </p>

          {/* Recipients (collapsed) */}
          {!expanded && recipients.length > 0 && (
            <p className="text-[11px] text-slate-600 truncate">
              To: {recipients.join(', ')}
            </p>
          )}

          {/* Body preview */}
          {!expanded && (
            <p className="text-xs text-slate-400 mt-2 leading-relaxed line-clamp-2">
              {preview || '(no preview)'}
              {hasMore && <span className="text-indigo-400 ml-1">…</span>}
            </p>
          )}
        </div>

        {/* ── Expanded body ── */}
        {expanded && (
          <div className="border-t border-slate-800/60 px-4 py-3.5">
            {/* Meta row */}
            <div className="flex flex-wrap gap-x-6 gap-y-1 mb-3 text-[11px] text-slate-500">
              <span><span className="text-slate-600">From:</span> {email.sender}</span>
              {recipients.length > 0 && (
                <span><span className="text-slate-600">To:</span> {recipients.join(', ')}</span>
              )}
              <span><span className="text-slate-600">Date:</span> {formatFullDate(email.sentAt)}</span>
            </div>

            {/* Full body */}
            <div className="text-sm text-slate-300 leading-relaxed whitespace-pre-wrap font-mono
                            bg-slate-900/50 rounded-lg px-4 py-3 border border-slate-800/50 text-[12px]">
              {email.body || '(empty body)'}
            </div>

            {/* Attachments */}
            {email.attachments?.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {email.attachments.map((f, i) => (
                  <Attachment key={i} filename={f} />
                ))}
              </div>
            )}

            {/* Collapse hint */}
            <p className="text-[11px] text-slate-600 mt-3 text-right">Click to collapse ↑</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function EmailThreadTimeline({ threadId: propThreadId }) {
  const [inputId,        setInputId]        = useState(propThreadId || '');
  const [activeThreadId, setActiveThreadId] = useState(propThreadId || '');
  const [data,           setData]           = useState(null);   // { emails, linkedIncident }
  const [loading,        setLoading]        = useState(false);
  const [error,          setError]          = useState(null);

  const fetchThread = useCallback(async (id) => {
    if (!id?.trim()) return;
    setLoading(true);
    setError(null);
    setData(null);

    try {
      const res  = await fetch(`/api/emails/thread/${encodeURIComponent(id.trim())}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);

      // Sort oldest → newest (defensive — backend should do this too)
      const emails = (json.emails || []).sort(
        (a, b) => new Date(a.sentAt) - new Date(b.sentAt)
      );
      setData({ emails, linkedIncident: json.linkedIncident || null });
      setActiveThreadId(id.trim());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Auto-fetch when prop provided
  useEffect(() => {
    if (propThreadId) fetchThread(propThreadId);
  }, [propThreadId, fetchThread]);

  const handleKeyDown = (e) => { if (e.key === 'Enter') fetchThread(inputId); };

  const sentCount     = data?.emails.filter(e => e.direction === 'sent').length     ?? 0;
  const receivedCount = data?.emails.filter(e => e.direction === 'received').length ?? 0;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div
      className="min-h-screen bg-slate-950 text-slate-100"
      style={{ fontFamily: "'Inter', system-ui, sans-serif" }}
    >
      <div className="max-w-3xl mx-auto px-6 py-10">

        {/* ── Page header ── */}
        <div className="mb-8">
          <h1 className="text-3xl font-extrabold tracking-tight text-white mb-1.5">
            Email Thread
          </h1>
          <p className="text-slate-400 text-sm">
            Timeline view of all emails in a thread, linked to the knowledge graph.
          </p>
        </div>

        {/* ── Thread ID input ── */}
        <div className="flex gap-3 mb-8">
          <input
            type="text"
            value={inputId}
            onChange={e => setInputId(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Thread ID (e.g. THREAD-001)"
            className="flex-1 bg-slate-900 border border-slate-800 text-slate-200 text-sm
                       placeholder-slate-600 rounded-xl px-4 py-2.5 focus:outline-none
                       focus:border-indigo-500 transition-colors"
          />
          <button
            onClick={() => fetchThread(inputId)}
            disabled={loading || !inputId.trim()}
            className={`px-5 py-2.5 rounded-xl text-sm font-bold transition-all ${
              loading || !inputId.trim()
                ? 'bg-slate-800 text-slate-500 cursor-not-allowed'
                : 'bg-indigo-600 hover:bg-indigo-500 text-white cursor-pointer'
            }`}
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <span className="h-3 w-3 border-2 border-slate-400 border-t-transparent rounded-full animate-spin"/>
                Loading…
              </span>
            ) : 'Load'}
          </button>
        </div>

        {/* ── Error ── */}
        {error && (
          <div className="mb-6 bg-rose-950/30 border border-rose-800/40 text-rose-300 text-sm p-4
                          rounded-xl font-mono flex gap-2 items-start">
            <span>⚠️</span><span>{error}</span>
          </div>
        )}

        {/* ── Thread metadata strip ── */}
        {data && (
          <div className="flex items-center justify-between mb-6 flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <span className="text-slate-500 text-xs">Thread:</span>
              <span className="font-mono text-xs text-indigo-400 bg-indigo-500/10 border border-indigo-500/20
                               px-2 py-0.5 rounded">
                {activeThreadId}
              </span>
            </div>
            <div className="flex items-center gap-3 text-xs text-slate-500">
              <span>
                <span className="text-indigo-400 font-bold">{sentCount}</span> sent
              </span>
              <span className="text-slate-700">·</span>
              <span>
                <span className="text-slate-300 font-bold">{receivedCount}</span> received
              </span>
              <span className="text-slate-700">·</span>
              <span>
                <span className="text-slate-300 font-bold">{data.emails.length}</span> total
              </span>
            </div>
          </div>
        )}

        {/* ── Linked incident banner ── */}
        {data?.linkedIncident && <IncidentBanner incident={data.linkedIncident} />}

        {/* ── Email timeline ── */}
        {data?.emails.length > 0 ? (
          <div>
            {data.emails.map((email, i) => (
              <EmailCard
                key={email.messageId || i}
                email={email}
                index={i}
                total={data.emails.length}
              />
            ))}
          </div>
        ) : data && !loading ? (
          <div className="text-center py-20 border border-slate-800/40 rounded-2xl bg-slate-900/10">
            <div className="text-5xl mb-3 opacity-30">📭</div>
            <p className="text-slate-500 font-medium">No emails found</p>
            <p className="text-slate-700 text-sm mt-1">
              Thread <span className="font-mono">"{activeThreadId}"</span> has no messages.
            </p>
          </div>
        ) : !loading && (
          <div className="text-center py-20 border border-slate-800/40 rounded-2xl bg-slate-900/10">
            <div className="text-5xl mb-3 opacity-20">✉️</div>
            <p className="text-slate-500 font-medium">No thread loaded</p>
            <p className="text-slate-700 text-sm mt-1">Enter a thread ID above to view the timeline.</p>
          </div>
        )}

        {/* ── Loading skeleton ── */}
        {loading && (
          <div className="space-y-4">
            {[1, 2, 3].map(i => (
              <div key={i} className="flex gap-4 animate-pulse">
                <div className="h-9 w-9 rounded-full bg-slate-800 shrink-0" />
                <div className="flex-1 bg-slate-900/60 border border-slate-800 rounded-xl p-4 space-y-2">
                  <div className="flex justify-between">
                    <div className="h-3 w-32 bg-slate-800 rounded" />
                    <div className="h-3 w-20 bg-slate-800 rounded" />
                  </div>
                  <div className="h-3 w-48 bg-slate-800 rounded" />
                  <div className="h-3 w-full bg-slate-800/60 rounded" />
                  <div className="h-3 w-3/4 bg-slate-800/40 rounded" />
                </div>
              </div>
            ))}
          </div>
        )}

      </div>
    </div>
  );
}

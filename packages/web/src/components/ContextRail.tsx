import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { api } from '../api';
import { useApi } from '../hooks';
import { formatDate, kindMeta, timeAgo } from '../utils';
import type { LiveSessionContext } from '../types';

// ── Helpers ───────────────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-dim mb-2">{title}</p>
      {children}
    </div>
  );
}

function EmptyPrompt({ text }: { text: string }) {
  return (
    <div className="flex-1 flex items-center justify-center px-4 py-8">
      <p className="text-[12px] text-dim text-center">{text}</p>
    </div>
  );
}

function CollapseBtn({ onCollapse }: { onCollapse: () => void }) {
  return (
    <button onClick={onCollapse} title="Hide context panel"
      className="text-dim hover:text-secondary transition-colors p-1 rounded shrink-0">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 18l6-6-6-6" />
      </svg>
    </button>
  );
}

function RailHeader({ label, sub, onCollapse }: { label: string; sub?: string; onCollapse?: () => void }) {
  return (
    <div className="px-4 pt-4 pb-3 border-b border-border-subtle flex items-start justify-between gap-2 shrink-0">
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-dim">{label}</p>
        {sub && <p className="text-[12px] text-secondary mt-0.5 font-mono truncate">{sub}</p>}
      </div>
      {onCollapse && <CollapseBtn onCollapse={onCollapse} />}
    </div>
  );
}

// ── Live session context ──────────────────────────────────────────────────────

function truncate(text: string, max: number) {
  return text.length <= max ? text : text.slice(0, max).trimEnd() + '…';
}

function LiveSessionContextPanel({ id }: { id: string }) {
  const [data,    setData]    = useState<LiveSessionContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    api.liveSessionContext(id)
      .then(d => { if (!cancelled) { setData(d); setLoading(false); } })
      .catch(() => { if (!cancelled) { setError(true); setLoading(false); } });
    return () => { cancelled = true; };
  }, [id]);

  if (loading) return <div className="px-4 py-4 text-[12px] text-dim animate-pulse">Loading…</div>;
  if (error)   return <div className="px-4 py-4 text-[12px] text-dim/60">Unable to load context.</div>;
  if (!data)   return null;

  const dirParts = data.cwd.replace(/^\//, '').split('/');
  const cwdShort = dirParts.length > 3 ? '…/' + dirParts.slice(-3).join('/') : data.cwd;

  return (
    <div className="space-y-5 px-4 py-4">
      <Section title="Working Directory">
        <div className="space-y-1.5">
          <p className="text-[12px] font-mono text-secondary break-all leading-relaxed" title={data.cwd}>{cwdShort}</p>
          {data.branch && (
            <div className="flex items-center gap-1.5 text-[11px]">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-teal shrink-0">
                <line x1="6" y1="3" x2="6" y2="15" />
                <circle cx="18" cy="6" r="3" />
                <circle cx="6" cy="18" r="3" />
                <path d="M18 9a9 9 0 0 1-9 9" />
              </svg>
              <span className="font-mono text-teal">{data.branch}</span>
            </div>
          )}
        </div>
      </Section>

      {data.userMessages.length > 0 && (
        <Section title="Recent Messages">
          <div className="space-y-2.5">
            {[...data.userMessages].reverse().map((msg, i) => (
              <div key={msg.id} className={`space-y-0.5 ${i > 0 ? 'opacity-50' : ''}`}>
                <p className="text-[10px] text-dim">{timeAgo(msg.ts)}</p>
                <p className="text-[12px] text-secondary leading-snug">{truncate(msg.text, 140)}</p>
              </div>
            ))}
          </div>
        </Section>
      )}
      {data.userMessages.length === 0 && <p className="text-[12px] text-dim">No messages yet.</p>}
    </div>
  );
}

// ── Task detail ───────────────────────────────────────────────────────────────

interface TaskDetail {
  id: string; running: boolean; enabled: boolean;
  cron?: string; model?: string;
  lastStatus?: string; lastRunAt?: string;
  fileContent: string;
}

function cronHuman(cron: string): string {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return cron;
  const [min, hour] = parts;
  const m = hour.match(/^\*\/(\d+)$/);
  if (m && min !== '*') return `every ${m[1]}h at :${min.padStart(2,'0')}`;
  if (hour !== '*' && min !== '*' && !hour.includes('*')) return `daily at ${hour.padStart(2,'0')}:${min.padStart(2,'0')}`;
  return cron;
}

function TaskContext({ id }: { id: string }) {
  const [task, setTask] = useState<TaskDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/tasks/${id}`)
      .then(r => r.json())
      .then((d: TaskDetail) => { setTask(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [id]);

  if (loading) return <div className="px-4 py-4 text-[12px] text-dim animate-pulse">Loading…</div>;
  if (!task)   return <div className="px-4 py-4 text-[12px] text-dim">Task not found.</div>;

  const body = task.fileContent.replace(/^---[\s\S]*?---\n?/, '').trim();
  const lines = body.split('\n');
  const statusCls = task.running ? 'text-accent' : task.lastStatus === 'success' ? 'text-success' : task.lastStatus === 'failure' ? 'text-danger' : 'text-dim';
  const statusText = task.running ? 'running' : task.lastStatus ?? 'never run';

  return (
    <div className="space-y-4 px-4 py-4">
      <div className="flex items-center gap-3 text-[12px]">
        <span className={`font-medium ${statusCls}`}>{statusText}</span>
        {task.lastRunAt && <span className="text-dim">· {timeAgo(task.lastRunAt)}</span>}
        {!task.enabled && <span className="text-dim">(disabled)</span>}
      </div>
      <div className="space-y-1.5">
        {task.cron && (
          <div className="flex items-center gap-2 text-[11px]">
            <span className="text-dim w-12 shrink-0">schedule</span>
            <span className="font-mono text-secondary">{task.cron}</span>
            <span className="text-dim">({cronHuman(task.cron)})</span>
          </div>
        )}
        {task.model && (
          <div className="flex items-center gap-2 text-[11px]">
            <span className="text-dim w-12 shrink-0">model</span>
            <span className="font-mono text-secondary">{task.model.split('/').pop()}</span>
          </div>
        )}
      </div>
      <div className="border-t border-border-subtle" />
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-dim mb-2">Prompt</p>
        <div className="text-[12px] leading-relaxed text-secondary space-y-1 font-mono whitespace-pre-wrap break-words">
          {lines.map((line, i) => {
            if (line.startsWith('## ') || line.startsWith('# ')) return <p key={i} className="text-primary font-semibold text-[13px] mt-2">{line.replace(/^#+\s/, '')}</p>;
            if (line.startsWith('- ') || line.match(/^\d+\. /)) return <p key={i} className="pl-2">{line}</p>;
            if (line.trim() === '') return <div key={i} className="h-1.5" />;
            return <p key={i}>{line}</p>;
          })}
        </div>
      </div>
      <TaskLogSection taskId={id} />
    </div>
  );
}

function TaskLogSection({ taskId }: { taskId: string }) {
  const [log, setLog]     = useState<string | null>(null);
  const [logPath, setLogPath] = useState<string | null>(null);
  const [open, setOpen]   = useState(false);
  const [loading, setLoading] = useState(false);

  function loadLog() {
    if (log !== null) { setOpen(o => !o); return; }
    setLoading(true);
    fetch(`/api/tasks/${taskId}/log`)
      .then(r => r.ok ? r.json() as Promise<{ log: string; path: string }> : Promise.reject())
      .then(d => { setLog(d.log); setLogPath(d.path); setOpen(true); setLoading(false); })
      .catch(() => { setLog('No log available.'); setOpen(true); setLoading(false); });
  }

  return (
    <div className="border-t border-border-subtle pt-3">
      <button onClick={loadLog} className="text-[11px] text-accent hover:underline flex items-center gap-1.5">
        {loading ? <span className="animate-spin text-[10px]">⟳</span> : (open ? '▾' : '▸')}
        Last run log
      </button>
      {open && log !== null && (
        <div className="mt-2">
          {logPath && <p className="text-[9px] font-mono text-dim/50 truncate mb-1">{logPath.split('/').slice(-1)[0]}</p>}
          <pre className="text-[10px] font-mono text-secondary whitespace-pre-wrap break-all bg-elevated rounded-lg p-2.5 max-h-64 overflow-y-auto leading-relaxed">
            {log || '(empty)'}
          </pre>
        </div>
      )}
    </div>
  );
}

// ── Inbox item detail ─────────────────────────────────────────────────────────

interface ActivityEntry {
  id: string; kind: string; profile: string; summary: string;
  details?: string; createdAt: string; notificationState?: string;
  relatedWorkstreamIds?: string[];
}

function InboxItemContext({ id }: { id: string }) {
  const [entry, setEntry] = useState<ActivityEntry | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/activity/${encodeURIComponent(id)}`)
      .then(r => r.ok ? r.json() : Promise.reject())
      .then((d: ActivityEntry & { read?: boolean }) => {
        setEntry(d);
        setLoading(false);
        // Mark as read when detail opens
        if (!d.read) {
          void fetch(`/api/activity/${encodeURIComponent(id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ read: true }) });
        }
      })
      .catch(() => setLoading(false));
  }, [id]);

  if (loading) return <div className="px-4 py-4 text-[12px] text-dim animate-pulse">Loading…</div>;
  if (!entry)  return <div className="px-4 py-4 text-[12px] text-dim">Not found.</div>;

  const meta = kindMeta(entry.kind);

  return (
    <div className="px-4 py-4 space-y-4 overflow-y-auto">
      {/* Summary */}
      <p className="text-[13px] text-primary leading-snug font-medium">{entry.summary}</p>

      {/* Kind + time */}
      <p className="text-[11px] font-mono">
        <span className={meta.color}>{meta.label}</span>
        <span className="text-dim opacity-40 mx-1.5">·</span>
        <span className="text-dim">{formatDate(entry.createdAt)}</span>
      </p>

      {/* Details */}
      {entry.details && (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-dim mb-1.5">Details</p>
          <pre className="text-[11px] font-mono text-secondary whitespace-pre-wrap break-words leading-relaxed">
            {entry.details}
          </pre>
        </div>
      )}

      {/* Related workstreams */}
      {entry.relatedWorkstreamIds && entry.relatedWorkstreamIds.length > 0 && (
        <div className="border-t border-border-subtle pt-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-dim mb-2">Related</p>
          <div className="space-y-1">
            {entry.relatedWorkstreamIds.map(wsId => (
              <Link key={wsId} to={`/workstreams/${wsId}`} className="block text-[12px] font-mono text-accent hover:underline">
                {wsId}
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Metadata */}
      <div className="border-t border-border-subtle pt-3 space-y-1.5">
        {[
          { label: 'id',      value: entry.id },
          { label: 'profile', value: entry.profile },
          ...(entry.notificationState ? [{ label: 'notify', value: entry.notificationState }] : []),
        ].map(({ label, value }) => (
          <div key={label} className="flex items-baseline gap-3 text-[11px]">
            <span className="text-dim w-14 shrink-0 font-mono">{label}</span>
            <span className="text-secondary font-mono">{value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Workstream detail ─────────────────────────────────────────────────────────

interface WsDetail {
  id: string;
  summary: { objective: string; status: string; blockers: string; updatedAt: string };
  plan: { steps: { text: string; completed: boolean }[] };
  taskCount: number;
  artifactCount: number;
}

function WorkstreamDetailContext({ id }: { id: string }) {
  const [ws, setWs] = useState<WsDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/workstreams/${id}`)
      .then(r => r.ok ? r.json() as Promise<WsDetail> : Promise.reject())
      .then(d => { setWs(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [id]);

  if (loading) return <div className="px-4 py-4 text-[12px] text-dim animate-pulse">Loading…</div>;
  if (!ws)     return <div className="px-4 py-4 text-[12px] text-dim">Workstream not found.</div>;

  const status   = ws.summary.status.replace(/^[-*]\s*/, '');
  const blockers = ws.summary.blockers.replace(/^[-*]\s*/, '');
  const isBlocked = blockers !== 'None' && blockers !== 'none' && blockers.length > 0;
  const done  = ws.plan.steps.filter(s => s.completed).length;
  const total = ws.plan.steps.length;
  const pct   = total === 0 ? 0 : Math.round((done / total) * 100);

  return (
    <div className="px-4 py-4 space-y-4 overflow-y-auto">
      {/* Objective */}
      <p className="text-[13px] text-primary leading-snug font-medium">{ws.summary.objective}</p>

      {/* Status */}
      <div className="space-y-1">
        <p className="text-[12px] text-secondary">{status}</p>
        {isBlocked && <p className="text-[12px] text-warning">⚠ {blockers}</p>}
      </div>

      {/* Plan */}
      {total > 0 && (
        <div className="border-t border-border-subtle pt-3">
          <div className="flex items-center justify-between text-[10px] text-dim mb-2">
            <span className="font-semibold uppercase tracking-wider">Plan</span>
            <span className="tabular-nums font-mono">{done}/{total} · {pct}%</span>
          </div>
          <div className="h-1 rounded-full bg-elevated overflow-hidden mb-3">
            <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${pct}%` }} />
          </div>
          <ul className="space-y-1.5">
            {ws.plan.steps.map((step, i) => (
              <li key={i} className="flex items-start gap-2 text-[12px]">
                <span className={`mt-0.5 shrink-0 ${step.completed ? 'text-success' : 'text-dim'}`}>
                  {step.completed ? '✓' : '○'}
                </span>
                <span className={step.completed ? 'text-dim line-through' : 'text-secondary'}>
                  {step.text}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Counts */}
      <div className="border-t border-border-subtle pt-3 flex gap-6 text-[11px] text-dim">
        <span><span className="font-mono text-primary">{ws.taskCount}</span> tasks</span>
        <span><span className="font-mono text-primary">{ws.artifactCount}</span> artifacts</span>
      </div>
    </div>
  );
}

// ── Memory file content ───────────────────────────────────────────────────────

function MemoryFileContext({ path }: { path: string }) {
  const fetcher = useCallback(() => api.memoryFile(path), [path]);
  const { data, loading, error, refetch } = useApi(fetcher);
  // Re-fetch when path changes (useApi's fetcherRef doesn't re-trigger on dep changes)
  const prevPath = useRef(path);
  useEffect(() => {
    if (prevPath.current !== path) { prevPath.current = path; refetch(); }
  }, [path, refetch]);
  const [editing,  setEditing]  = useState(false);
  const [draft,    setDraft]    = useState('');
  const [saving,   setSaving]   = useState(false);
  const [saveErr,  setSaveErr]  = useState<string | null>(null);
  const [savedOk,  setSavedOk]  = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (data?.content !== undefined) setDraft(data.content);
    setEditing(false);
  }, [data?.content]);

  useEffect(() => {
    if (editing && textareaRef.current) {
      const el = textareaRef.current;
      el.style.height = 'auto';
      el.style.height = `${Math.min(el.scrollHeight, 600)}px`;
    }
  }, [editing, draft]);

  async function save() {
    setSaving(true); setSaveErr(null); setSavedOk(false);
    try {
      await api.memoryFileSave(path, draft);
      setEditing(false);
      setSavedOk(true);
      setTimeout(() => setSavedOk(false), 2000);
      refetch();
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : String(e));
    } finally { setSaving(false); }
  }

  if (loading) return <div className="px-4 py-4 text-[11px] text-dim animate-pulse font-mono">Loading…</div>;
  if (error)   return <div className="px-4 py-4 text-[11px] text-danger/80 font-mono">Error: {error}</div>;

  const fileName = path.split('/').pop() ?? path;

  return (
    <div className="px-4 py-4 space-y-3">
      <p className="text-[11px] font-mono text-dim/60 truncate" title={path}>{fileName}</p>
      {editing ? (
        <div className="space-y-2">
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={e => setDraft(e.target.value)}
            className="w-full text-[11px] font-mono text-secondary leading-relaxed bg-base border border-border-default rounded-lg px-3 py-2 resize-none focus:outline-none focus:border-accent/60 min-h-[120px]"
            spellCheck={false}
          />
          {saveErr && <p className="text-[11px] text-danger/80">{saveErr}</p>}
          <div className="flex items-center gap-3">
            <button onClick={save} disabled={saving} className="text-[11px] font-medium text-accent hover:text-accent/70 transition-colors disabled:opacity-40">
              {saving ? 'Saving…' : 'Save'}
            </button>
            {savedOk && <span className="text-[11px] text-success">✓ Saved</span>}
            <button onClick={() => setEditing(false)} disabled={saving} className="text-[11px] text-secondary hover:text-primary transition-colors disabled:opacity-40">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="relative group/content">
          <pre className="text-[11px] font-mono text-secondary leading-relaxed whitespace-pre-wrap break-words overflow-x-auto max-h-[calc(100vh-200px)] overflow-y-auto">
            {data?.content}
          </pre>
          <button
            onClick={() => { setDraft(data?.content ?? ''); setEditing(true); }}
            className="absolute top-0 right-0 opacity-0 group-hover/content:opacity-100 transition-opacity text-[10px] text-secondary hover:text-primary"
          >
            Edit
          </button>
        </div>
      )}
    </div>
  );
}

// ── Root ──────────────────────────────────────────────────────────────────────

export function ContextRail({ onCollapse }: { onCollapse?: () => void }) {
  const location = useLocation();
  const parts = location.pathname.split('/').filter(Boolean);
  const section = parts[0];
  const id = parts[1];

  // Conversations
  if (section === 'conversations' && id) return (
    <div className="flex-1 overflow-y-auto flex flex-col">
      <RailHeader label="Session" onCollapse={onCollapse} />
      <LiveSessionContextPanel id={id} />
    </div>
  );

  // Tasks
  if (section === 'tasks' && id) return (
    <div className="flex-1 overflow-y-auto flex flex-col">
      <RailHeader label="Task" sub={id} onCollapse={onCollapse} />
      <TaskContext id={id} />
    </div>
  );
  if (section === 'tasks') return (
    <div className="flex-1 flex flex-col">
      <RailHeader label="Tasks" onCollapse={onCollapse} />
      <EmptyPrompt text="Select a task to see its prompt and schedule." />
    </div>
  );

  // Inbox
  if (section === 'inbox' && id) return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <RailHeader label="Inbox" sub={id} onCollapse={onCollapse} />
      <div className="flex-1 overflow-y-auto">
        <InboxItemContext id={id} />
      </div>
    </div>
  );
  if (section === 'inbox') return (
    <div className="flex-1 flex flex-col">
      <RailHeader label="Inbox" onCollapse={onCollapse} />
      <EmptyPrompt text="Select an item to see details." />
    </div>
  );

  // Workstreams
  if (section === 'workstreams' && id) return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <RailHeader label="Workstream" sub={id} onCollapse={onCollapse} />
      <div className="flex-1 overflow-y-auto">
        <WorkstreamDetailContext id={id} />
      </div>
    </div>
  );
  if (section === 'workstreams') return (
    <div className="flex-1 flex flex-col">
      <RailHeader label="Workstreams" onCollapse={onCollapse} />
      <EmptyPrompt text="Select a workstream to see its plan." />
    </div>
  );

  // Memory
  if (section === 'memory') {
    const itemPath = new URLSearchParams(location.search).get('item');
    if (itemPath) {
      const fileName = itemPath.split('/').pop() ?? itemPath;
      return (
        <div className="flex-1 flex flex-col overflow-hidden">
          <RailHeader label="Memory" sub={fileName} onCollapse={onCollapse} />
          <div className="flex-1 overflow-y-auto">
            <MemoryFileContext path={itemPath} />
          </div>
        </div>
      );
    }
    return (
      <div className="flex-1 flex flex-col">
        <RailHeader label="Memory" onCollapse={onCollapse} />
        <EmptyPrompt text="Select an item to read its content." />
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center h-full gap-2 text-center px-6">
      <p className="text-[12px] text-dim">Select a conversation, workstream, or inbox item to see context.</p>
    </div>
  );
}

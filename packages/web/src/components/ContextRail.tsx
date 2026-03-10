import { useCallback, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { api } from '../api';
import { useApi } from '../hooks';
import { timeAgo } from '../utils';
import type { LiveSessionContext } from '../types';

// ── Section wrapper ───────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-dim mb-2">{title}</p>
      {children}
    </div>
  );
}

// ── Live session context ──────────────────────────────────────────────────────

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max).trimEnd() + '…';
}

function LiveSessionContextPanel({ id }: { id: string }) {
  const { data, loading, error } = useApi<LiveSessionContext>(
    useCallback(() => api.liveSessionContext(id), [id]),
  );

  if (loading) return <div className="px-4 py-4 text-[12px] text-dim animate-pulse">Loading…</div>;
  if (error)   return <div className="px-4 py-4 text-[12px] text-dim/60">Unable to load context.</div>;
  if (!data)   return null;

  const dirParts = data.cwd.replace(/^\//, '').split('/');
  // Show last 3 path segments to keep it readable
  const cwdShort = dirParts.length > 3 ? '…/' + dirParts.slice(-3).join('/') : data.cwd;

  return (
    <div className="space-y-5 px-4 py-4">

      {/* Working directory */}
      <Section title="Working Directory">
        <div className="space-y-1.5">
          <p className="text-[12px] font-mono text-secondary break-all leading-relaxed" title={data.cwd}>
            {cwdShort}
          </p>
          {data.branch && (
            <div className="flex items-center gap-1.5 text-[11px]">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                className="text-teal shrink-0">
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

      {/* Recent messages */}
      {data.userMessages.length > 0 && (
        <Section title="Recent Messages">
          <div className="space-y-2.5">
            {[...data.userMessages].reverse().map((msg, i) => (
              <div key={msg.id} className={`space-y-0.5 ${i > 0 ? 'opacity-50' : ''}`}>
                <p className="text-[10px] text-dim">{timeAgo(msg.ts)}</p>
                <p className="text-[12px] text-secondary leading-snug">
                  {truncate(msg.text, 140)}
                </p>
              </div>
            ))}
          </div>
        </Section>
      )}

      {data.userMessages.length === 0 && (
        <p className="text-[12px] text-dim">No messages yet.</p>
      )}
    </div>
  );
}

// ── Empty / default states ────────────────────────────────────────────────────

function InboxContext() {
  return (
    <div className="px-4 py-4 space-y-5">
      <Section title="About">
        <p className="text-[12px] text-secondary leading-relaxed">
          The inbox shows activity from scheduled tasks, deferred resumes, and background runs.
          Select an item to see details.
        </p>
      </Section>
    </div>
  );
}

function WorkstreamsContext() {
  return (
    <div className="px-4 py-4 space-y-5">
      <Section title="About">
        <p className="text-[12px] text-secondary leading-relaxed">
          Workstreams track ongoing projects. Select a workstream to see its plan and artifacts.
        </p>
      </Section>
    </div>
  );
}

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
    <div className="space-y-4 px-4 py-4">
      {/* Objective */}
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-dim mb-1.5">Objective</p>
        <p className="text-[12px] text-primary leading-relaxed">{ws.summary.objective}</p>
      </div>

      {/* Status */}
      <div className="space-y-1">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-dim">Status</p>
        <p className="text-[12px] text-secondary">{status}</p>
        {isBlocked && <p className="text-[12px] text-warning">⚠ {blockers}</p>}
      </div>

      {/* Plan progress */}
      {total > 0 && (
        <div>
          <div className="flex items-center justify-between text-[10px] text-dim mb-1">
            <span className="font-semibold uppercase tracking-wider">Plan</span>
            <span className="tabular-nums">{done}/{total} · {pct}%</span>
          </div>
          <div className="h-1 rounded-full bg-elevated overflow-hidden mb-2">
            <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${pct}%` }} />
          </div>
          <ul className="space-y-1">
            {ws.plan.steps.map((step, i) => (
              <li key={i} className="flex items-start gap-2 text-[11px]">
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

function EmptyContext() {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-2 text-center px-6">
      <p className="text-[12px] text-dim">Select a conversation, workstream, or inbox item to see context.</p>
    </div>
  );
}

// ── Root ──────────────────────────────────────────────────────────────────────

// ── Task detail ───────────────────────────────────────────────────────────────

interface TaskDetail {
  id: string; running: boolean; enabled: boolean;
  cron?: string; model?: string;
  lastStatus?: string; lastRunAt?: string; lastLogPath?: string;
  fileContent: string;
}

function cronHuman(cron: string): string {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return cron;
  const [min, hour] = parts;
  const intervalMatch = hour.match(/^\*\/(\d+)$/);
  if (intervalMatch && min !== '*') return `every ${intervalMatch[1]}h at :${min.padStart(2,'0')}`;
  if (hour !== '*' && min !== '*' && !hour.includes('*')) return `daily at ${hour.padStart(2,'0')}:${min.padStart(2,'0')}`;
  return cron;
}

function TaskContext({ id }: { id: string }) {
  const [task, setTask]     = useState<TaskDetail | null>(null);
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

  // Strip YAML frontmatter, render body
  const body = task.fileContent.replace(/^---[\s\S]*?---\n?/, '').trim();
  // Simple line renderer — code spans, bold, bullets
  const lines = body.split('\n');

  const statusCls = task.running ? 'text-accent' : task.lastStatus === 'success' ? 'text-success' : task.lastStatus === 'failure' ? 'text-danger' : 'text-dim';
  const statusText = task.running ? 'running' : task.lastStatus ?? 'never run';

  return (
    <div className="space-y-4 px-4 py-4">
      {/* Status */}
      <div className="flex items-center gap-3 text-[12px]">
        <span className={`font-medium ${statusCls}`}>{statusText}</span>
        {task.lastRunAt && <span className="text-dim">· {timeAgo(task.lastRunAt)}</span>}
        {!task.enabled && <span className="text-dim">(disabled)</span>}
      </div>

      {/* Schedule + model */}
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

      {/* Prompt body */}
      <div className="space-y-1.5">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-dim mb-2">Prompt</p>
        <div className="text-[12px] leading-relaxed text-secondary space-y-1 font-mono whitespace-pre-wrap break-words">
          {lines.map((line, i) => {
            if (line.startsWith('## ')) return <p key={i} className="text-primary font-semibold text-[13px] mt-2">{line.slice(3)}</p>;
            if (line.startsWith('# '))  return <p key={i} className="text-primary font-semibold text-[13px] mt-2">{line.slice(2)}</p>;
            if (line.startsWith('- ') || line.match(/^\d+\. /)) return <p key={i} className="pl-2">{line}</p>;
            if (line.trim() === '')     return <div key={i} className="h-1.5" />;
            return <p key={i}>{line}</p>;
          })}
        </div>
      </div>

      <TaskLogSection taskId={id} />
    </div>
  );
}

function TaskLogSection({ taskId }: { taskId: string }) {
  const [log,     setLog]     = useState<string | null>(null);
  const [logPath, setLogPath] = useState<string | null>(null);
  const [open,    setOpen]    = useState(false);
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
      <button onClick={loadLog}
        className="text-[11px] text-accent hover:underline flex items-center gap-1.5">
        {loading ? <span className="animate-spin text-[10px]">⟳</span> : (open ? '▾' : '▸')}
        Last run log
      </button>
      {open && log !== null && (
        <div className="mt-2">
          {logPath && <p className="text-[9px] font-mono text-dim/50 truncate mb-1" title={logPath}>{logPath.split('/').slice(-1)[0]}</p>}
          <pre className="text-[10px] font-mono text-secondary whitespace-pre-wrap break-all bg-elevated rounded-lg p-2.5 max-h-64 overflow-y-auto leading-relaxed">
            {log || '(empty)'}
          </pre>
        </div>
      )}
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

export function ContextRail({ onCollapse }: { onCollapse?: () => void }) {
  const location = useLocation();
  const parts = location.pathname.split('/').filter(Boolean);
  const section = parts[0];
  const id = parts[1];

  // Conversation context
  if (section === 'conversations' && id) {
    return (
      <div className="flex-1 overflow-y-auto">
        <div className="px-4 pt-4 pb-3 border-b border-border-subtle flex items-start justify-between gap-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-dim">Session</p>
          {onCollapse && <CollapseBtn onCollapse={onCollapse} />}
        </div>
        <LiveSessionContextPanel id={id} />
      </div>
    );
  }

  if (section === 'tasks' && id) return (
    <div className="flex-1 overflow-y-auto">
      <div className="px-4 pt-4 pb-3 border-b border-border-subtle flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-dim">Task</p>
          <p className="text-[12px] text-secondary mt-0.5 font-mono truncate">{id}</p>
        </div>
        {onCollapse && <CollapseBtn onCollapse={onCollapse} />}
      </div>
      <TaskContext id={id} />
    </div>
  );

  if (section === 'tasks') return (
    <div className="flex-1 flex flex-col">
      <div className="px-4 pt-4 pb-3 border-b border-border-subtle flex items-center justify-between">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-dim">Tasks</p>
        {onCollapse && <CollapseBtn onCollapse={onCollapse} />}
      </div>
      <div className="flex-1 flex items-center justify-center px-4">
        <p className="text-[12px] text-dim text-center">Select a task to see its prompt and schedule.</p>
      </div>
    </div>
  );

  if (section === 'inbox') return (
    <div className="flex-1 overflow-y-auto">
      <div className="px-4 pt-4 pb-3 border-b border-border-subtle flex items-center justify-between">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-dim">Inbox</p>
        {onCollapse && <CollapseBtn onCollapse={onCollapse} />}
      </div>
      <InboxContext />
    </div>
  );

  if (section === 'workstreams' && id) return (
    <div className="flex-1 overflow-y-auto">
      <div className="px-4 pt-4 pb-3 border-b border-border-subtle flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-dim">Workstream</p>
          <p className="text-[12px] text-secondary mt-0.5 font-mono truncate">{id}</p>
        </div>
        {onCollapse && <CollapseBtn onCollapse={onCollapse} />}
      </div>
      <WorkstreamDetailContext id={id} />
    </div>
  );

  if (section === 'workstreams') return (
    <div className="flex-1 overflow-y-auto">
      <div className="px-4 pt-4 pb-3 border-b border-border-subtle flex items-center justify-between">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-dim">Workstreams</p>
        {onCollapse && <CollapseBtn onCollapse={onCollapse} />}
      </div>
      <WorkstreamsContext />
    </div>
  );

  if (section === 'memory') return (
    <div className="flex-1 overflow-y-auto">
      <div className="px-4 pt-4 pb-3 border-b border-border-subtle flex items-center justify-between">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-dim">Memory</p>
        {onCollapse && <CollapseBtn onCollapse={onCollapse} />}
      </div>
      <div className="px-4 py-4 space-y-5">
        <Section title="About">
          <p className="text-[12px] text-secondary leading-relaxed">
            Memory shows the agent's durable knowledge: AGENTS.md config, loaded skills, and memory docs.
            Click any item in the main panel to read its content.
          </p>
        </Section>
        <Section title="Sections">
          <div className="space-y-2 text-[12px] text-secondary">
            <p><span className="text-primary font-medium">Config</span> — AGENTS.md files for shared and active profile</p>
            <p><span className="text-primary font-medium">Skills</span> — reusable workflow files loaded by the agent</p>
            <p><span className="text-primary font-medium">Memory Docs</span> — profile-specific notes, runbooks, and context</p>
          </div>
        </Section>
      </div>
    </div>
  );

  return <EmptyContext />;
}

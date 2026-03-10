import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { MOCK_CONVERSATIONS, type MockConversation } from '../data/mockConversations';
import { timeAgo, formatDate } from '../utils';

// ── Section wrapper ───────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-dim mb-2">{title}</p>
      {children}
    </div>
  );
}

// ── Plan steps ────────────────────────────────────────────────────────────────

function PlanSection({ plan }: { plan: NonNullable<MockConversation['plan']> }) {
  const done = plan.filter(s => s.done).length;
  return (
    <Section title={`Plan · ${done}/${plan.length}`}>
      <div className="space-y-1.5">
        {plan.map((step, i) => (
          <div key={i} className="flex items-start gap-2">
            <span className={`mt-0.5 shrink-0 text-[12px] ${step.done ? 'text-success' : 'text-dim'}`}>
              {step.done ? '✓' : '○'}
            </span>
            <p className={`text-[12px] leading-snug ${step.done ? 'text-dim line-through' : 'text-secondary'}`}>
              {step.text}
            </p>
          </div>
        ))}
      </div>
    </Section>
  );
}

// ── Artifacts ─────────────────────────────────────────────────────────────────

const TYPE_ICON: Record<string, string> = {
  code: '{ }',
  document: '≡',
  image: '⊡',
  data: '⊞',
};

const LANG_COLOR: Record<string, string> = {
  TypeScript: 'text-steel',
  JavaScript: 'text-warning',
  Python: 'text-success',
  CSS: 'text-teal',
};

function ArtifactsSection({ artifacts }: { artifacts: NonNullable<MockConversation['artifacts']> }) {
  return (
    <Section title="Artifacts">
      <div className="space-y-1">
        {artifacts.map(a => (
          <button
            key={a.id}
            className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-elevated transition-colors text-left group"
          >
            <span className="shrink-0 font-mono text-[11px] text-dim w-5 text-center select-none">
              {TYPE_ICON[a.type] ?? '·'}
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-[12px] font-medium text-secondary group-hover:text-primary truncate">{a.name}</p>
              <p className="text-[10px] text-dim truncate">
                {a.language && <span className={LANG_COLOR[a.language] ?? 'text-dim'}>{a.language}</span>}
                {a.language && a.lines && <span className="text-dim"> · </span>}
                {a.lines && <span>{a.lines} lines</span>}
                {a.path && !a.lines && <span>{a.path}</span>}
              </p>
            </div>
            <span className="shrink-0 text-[10px] text-dim opacity-0 group-hover:opacity-100 transition-opacity">↗</span>
          </button>
        ))}
      </div>
    </Section>
  );
}

// ── Tasks ─────────────────────────────────────────────────────────────────────

const TASK_STATUS: Record<string, { icon: string; color: string }> = {
  pending: { icon: '○', color: 'text-dim' },
  running: { icon: '●', color: 'text-accent' },
  done:    { icon: '✓', color: 'text-success' },
  failed:  { icon: '✕', color: 'text-danger' },
};

function TasksSection({ tasks }: { tasks: NonNullable<MockConversation['tasks']> }) {
  return (
    <Section title="Tasks">
      <div className="space-y-1.5">
        {tasks.map(t => {
          const s = TASK_STATUS[t.status];
          return (
            <div key={t.id} className="flex items-start gap-2">
              <span className={`shrink-0 text-[12px] mt-0.5 ${s.color} ${t.status === 'running' ? 'animate-pulse' : ''}`}>
                {s.icon}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-[12px] text-secondary leading-snug">{t.title}</p>
                {t.schedule && (
                  <p className="text-[10px] font-mono text-dim mt-0.5">{t.schedule}</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </Section>
  );
}

// ── Files accessed ────────────────────────────────────────────────────────────

const FILE_ACTION_COLOR: Record<string, string> = {
  read:  'text-teal',
  write: 'text-accent',
  edit:  'text-warning',
};

function FilesSection({ files }: { files: NonNullable<MockConversation['files']> }) {
  // Deduplicate by path+action
  const deduped = files.filter((f, i, arr) =>
    arr.findIndex(x => x.path === f.path && x.action === f.action) === i
  );
  return (
    <Section title="Files">
      <div className="space-y-1">
        {deduped.map((f, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className={`shrink-0 text-[10px] font-mono font-semibold w-8 ${FILE_ACTION_COLOR[f.action]}`}>
              {f.action}
            </span>
            <p className="text-[11px] font-mono text-dim truncate" title={f.path}>{f.path}</p>
          </div>
        ))}
      </div>
    </Section>
  );
}

// ── References ────────────────────────────────────────────────────────────────

function ReferencesSection({ refs }: { refs: NonNullable<MockConversation['references']> }) {
  return (
    <Section title="References">
      <div className="space-y-2">
        {refs.map((r, i) => (
          <div key={i} className="group">
            <p className="text-[12px] text-secondary leading-snug group-hover:text-primary cursor-pointer">{r.title}</p>
            {r.source && <p className="text-[10px] text-dim mt-0.5">{r.source}</p>}
          </div>
        ))}
      </div>
    </Section>
  );
}

// ── Conversation context ──────────────────────────────────────────────────────

function ConversationContext({ conv }: { conv: MockConversation }) {
  const hasContent = conv.plan || conv.artifacts?.length || conv.tasks?.length || conv.files?.length || conv.references?.length;

  if (!hasContent) {
    return (
      <div className="flex flex-col items-center justify-center h-32 gap-2 text-center">
        <p className="text-[12px] text-dim">No context yet for this conversation.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5 px-4 py-4">
      {conv.plan && <PlanSection plan={conv.plan} />}
      {conv.tasks && conv.tasks.length > 0 && <TasksSection tasks={conv.tasks} />}
      {conv.artifacts && conv.artifacts.length > 0 && <ArtifactsSection artifacts={conv.artifacts} />}
      {conv.files && conv.files.length > 0 && <FilesSection files={conv.files} />}
      {conv.references && conv.references.length > 0 && <ReferencesSection refs={conv.references} />}
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
    const conv = MOCK_CONVERSATIONS[id];
    return (
      <div className="flex-1 overflow-y-auto">
        {/* Header */}
        <div className="px-4 pt-4 pb-3 border-b border-border-subtle flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-dim">Context</p>
            {conv && (
              <p className="text-[12px] text-secondary mt-0.5 truncate">
                {conv.workstreamId
                  ? <>linked to <span className="text-accent font-mono">{conv.workstreamId}</span></>
                  : 'no workstream linked'}
              </p>
            )}
          </div>
          {onCollapse && <CollapseBtn onCollapse={onCollapse} />}
        </div>
        {conv
          ? <ConversationContext conv={conv} />
          : <div className="px-4 py-4 text-[12px] text-dim">No context for this conversation.</div>
        }
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

  return <EmptyContext />;
}

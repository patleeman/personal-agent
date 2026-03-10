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

function EmptyContext() {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-2 text-center px-6">
      <p className="text-[12px] text-dim">Select a conversation, workstream, or inbox item to see context.</p>
    </div>
  );
}

// ── Root ──────────────────────────────────────────────────────────────────────

export function ContextRail() {
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
        <div className="px-4 pt-4 pb-3 border-b border-border-subtle">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-dim">Context</p>
          {conv && (
            <p className="text-[12px] text-secondary mt-0.5 truncate">
              {conv.workstreamId
                ? <>linked to <span className="text-accent font-mono">{conv.workstreamId}</span></>
                : 'no workstream linked'}
            </p>
          )}
        </div>
        {conv
          ? <ConversationContext conv={conv} />
          : <div className="px-4 py-4 text-[12px] text-dim">No context for this conversation.</div>
        }
      </div>
    );
  }

  if (section === 'inbox') return (
    <div className="flex-1 overflow-y-auto">
      <div className="px-4 pt-4 pb-3 border-b border-border-subtle">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-dim">Inbox</p>
      </div>
      <InboxContext />
    </div>
  );

  if (section === 'workstreams') return (
    <div className="flex-1 overflow-y-auto">
      <div className="px-4 pt-4 pb-3 border-b border-border-subtle">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-dim">Workstreams</p>
      </div>
      <WorkstreamsContext />
    </div>
  );

  return <EmptyContext />;
}

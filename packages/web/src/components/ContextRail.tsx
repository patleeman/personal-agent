import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api';
import {
  pickAttachProjectId,
  pickFocusedProjectId,
} from '../contextRailProject';
import { useApi } from '../hooks';
import { buildCapabilityCards, buildIdentitySummary, buildKnowledgeSections, buildMemoryPageSummary } from '../memoryOverview';
import type { ActivityEntry, LiveSessionContext, ProjectDetail, ProjectRecord } from '../types';
import { formatDate, kindMeta, timeAgo } from '../utils';
import { emitProjectsChanged, PROJECTS_CHANGED_EVENT } from '../projectEvents';
import { CONVERSATION_PROJECTS_CHANGED_EVENT, emitConversationProjectsChanged } from '../conversationProjectEvents';
import { ProjectDetailPanel } from './ProjectDetailPanel';
import { ProjectOverviewPanel } from './ProjectOverviewPanel';
import { ErrorState, IconButton, LoadingState, Pill, SurfacePanel } from './ui';

// ── Helpers ───────────────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="ui-section-label mb-2">{title}</p>
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
    <IconButton onClick={onCollapse} title="Hide context panel" aria-label="Hide context panel" compact>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 18l6-6-6-6" />
      </svg>
    </IconButton>
  );
}

function RailHeader({ label, sub, onCollapse }: { label: string; sub?: string; onCollapse?: () => void }) {
  return (
    <div className="px-4 pt-4 pb-3 border-b border-border-subtle flex items-start justify-between gap-2 shrink-0">
      <div className="min-w-0">
        <p className="ui-section-label">{label}</p>
        {sub && <p className="text-[12px] text-secondary mt-0.5 font-mono truncate">{sub}</p>}
      </div>
      {onCollapse && <CollapseBtn onCollapse={onCollapse} />}
    </div>
  );
}

// ── Live session context ──────────────────────────────────────────────────────

function LinkedProjectOverviewPanel({
  project,
  onRemove,
  removeDisabled = false,
}: {
  project: ProjectDetail;
  onRemove?: () => void;
  removeDisabled?: boolean;
}) {
  return (
    <ProjectOverviewPanel
      project={project}
      onRemove={onRemove}
      removeDisabled={removeDisabled}
    />
  );
}

function LiveSessionContextPanel({ id }: { id: string }) {
  const [data, setData] = useState<LiveSessionContext | null>(null);
  const [allProjects, setAllProjects] = useState<ProjectRecord[]>([]);
  const [focusedProjectId, setFocusedProjectId] = useState('');
  const [attachProjectId, setAttachProjectId] = useState('');
  const [focusedProject, setFocusedProject] = useState<ProjectDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [linkBusy, setLinkBusy] = useState(false);
  const [focusedLoading, setFocusedLoading] = useState(false);

  const load = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    Promise.all([api.liveSessionContext(id), api.projects()])
      .then(([context, projects]) => {
        if (cancelled) return;
        setData(context);
        setAllProjects(projects);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setError(true);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [id]);

  useEffect(() => load(), [load]);

  useEffect(() => {
    function handleConversationProjectsChanged(event: Event) {
      const detail = (event as CustomEvent<{ conversationId?: string }>).detail;
      if (detail?.conversationId && detail.conversationId !== id) {
        return;
      }

      load();
    }

    window.addEventListener(CONVERSATION_PROJECTS_CHANGED_EVENT, handleConversationProjectsChanged);
    return () => window.removeEventListener(CONVERSATION_PROJECTS_CHANGED_EVENT, handleConversationProjectsChanged);
  }, [id, load]);

  const relatedProjectIds = data?.relatedProjectIds ?? [];
  const availableProjects = allProjects.filter((project) => !relatedProjectIds.includes(project.id));
  const availableProjectIds = availableProjects.map((project) => project.id);

  useEffect(() => {
    const nextFocusedProjectId = pickFocusedProjectId(relatedProjectIds, focusedProjectId);
    if (nextFocusedProjectId !== focusedProjectId) {
      setFocusedProjectId(nextFocusedProjectId);
    }
  }, [focusedProjectId, relatedProjectIds]);

  useEffect(() => {
    const nextAttachProjectId = pickAttachProjectId(availableProjectIds, attachProjectId);
    if (nextAttachProjectId !== attachProjectId) {
      setAttachProjectId(nextAttachProjectId);
    }
  }, [attachProjectId, availableProjectIds]);

  useEffect(() => {
    let cancelled = false;

    if (!focusedProjectId) {
      setFocusedProject(null);
      setFocusedLoading(false);
      return () => { cancelled = true; };
    }

    setFocusedLoading(true);
    api.projectById(focusedProjectId)
      .then((detail) => {
        if (cancelled) return;
        setFocusedProject(detail);
        setFocusedLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setFocusedProject(null);
        setFocusedLoading(false);
      });

    return () => { cancelled = true; };
  }, [focusedProjectId]);

  async function attachSelectedProject() {
    if (!attachProjectId || linkBusy) return;
    setLinkBusy(true);
    try {
      await api.addConversationProject(id, attachProjectId);
      emitConversationProjectsChanged(id);
      load();
    } finally {
      setLinkBusy(false);
    }
  }

  async function removeLinkedProject(projectId: string) {
    if (linkBusy) return;
    setLinkBusy(true);
    try {
      await api.removeConversationProject(id, projectId);
      emitConversationProjectsChanged(id);
      load();
    } finally {
      setLinkBusy(false);
    }
  }

  if (loading) return <div className="px-4 py-4 text-[12px] text-dim animate-pulse">Loading…</div>;
  if (error) return <div className="px-4 py-4 text-[12px] text-dim/60">Unable to load context.</div>;
  if (!data) return null;

  const dirParts = data.cwd.replace(/^\//, '').split('/');
  const cwdShort = dirParts.length > 3 ? '…/' + dirParts.slice(-3).join('/') : data.cwd;

  return (
    <div className="space-y-5 px-4 py-4">
      <Section title="Working Directory">
        <SurfacePanel muted className="px-3 py-3 space-y-2">
          <p className="ui-card-body break-all" title={data.cwd}>{cwdShort}</p>
          {data.branch && (
            <div className="flex items-center gap-2">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-teal shrink-0">
                <line x1="6" y1="3" x2="6" y2="15" />
                <circle cx="18" cy="6" r="3" />
                <circle cx="6" cy="18" r="3" />
                <path d="M18 9a9 9 0 0 1-9 9" />
              </svg>
              <Pill tone="teal" mono>{data.branch}</Pill>
            </div>
          )}
        </SurfacePanel>
      </Section>

      <Section title="Referenced projects">
        <div className="space-y-3">
          {relatedProjectIds.length > 1 && (
            <div className="flex flex-wrap items-center gap-2">
              {relatedProjectIds.map((projectId) => {
                const isFocused = projectId === focusedProjectId;
                return (
                  <button
                    key={projectId}
                    onClick={() => setFocusedProjectId(projectId)}
                    className={isFocused ? 'ui-pill ui-pill-accent font-mono' : 'ui-pill ui-pill-muted font-mono hover:text-primary'}
                    title={`Focus referenced project ${projectId}`}
                  >
                    {projectId}
                  </button>
                );
              })}
            </div>
          )}

          {focusedLoading && <div className="text-[12px] text-dim animate-pulse">Loading project…</div>}
          {!focusedLoading && focusedProject && (
            <LinkedProjectOverviewPanel
              project={focusedProject}
              onRemove={() => { void removeLinkedProject(focusedProject.id); }}
              removeDisabled={linkBusy}
            />
          )}

          {availableProjects.length > 0 && (
            <SurfacePanel muted className="px-3 py-3 space-y-2.5">
              <p className="ui-section-label">Reference project</p>
              <div className="flex items-center gap-2">
                <select
                  value={attachProjectId}
                  onChange={(event) => setAttachProjectId(event.target.value)}
                  className="flex-1 bg-base border border-border-subtle rounded-lg px-2.5 py-2 text-[12px] text-secondary focus:outline-none focus:border-accent/60"
                  aria-label="Reference project"
                >
                  {availableProjects.map((project) => (
                    <option key={project.id} value={project.id}>{project.id}</option>
                  ))}
                </select>
                <button
                  onClick={() => { void attachSelectedProject(); }}
                  disabled={!attachProjectId || linkBusy}
                  className="ui-pill ui-pill-accent disabled:opacity-40"
                >
                  {linkBusy ? 'Saving…' : 'Reference'}
                </button>
              </div>
            </SurfacePanel>
          )}

          {!focusedProject && !focusedLoading && availableProjects.length === 0 && relatedProjectIds.length === 0 && (
            <p className="text-[12px] text-dim">No projects available.</p>
          )}
        </div>
      </Section>
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
  const scheduleText = task.cron ? cronHuman(task.cron) : null;

  return (
    <div className="space-y-4 px-4 py-4">
      <div className="space-y-1">
        <p className="ui-card-title font-mono">{id}</p>
        <p className="ui-card-meta">
          <span className={statusCls}>{statusText}</span>
          {task.lastRunAt && <><span className="opacity-40 mx-1.5">·</span>last run {timeAgo(task.lastRunAt)}</>}
          {!task.enabled && <><span className="opacity-40 mx-1.5">·</span>disabled</>}
        </p>
      </div>

      <div className="border-t border-border-subtle pt-3">
        <div className="ui-detail-list">
          {scheduleText && (
            <div className="ui-detail-row">
              <span className="ui-detail-label">schedule</span>
              <div className="min-w-0">
                <p className="ui-detail-value">{scheduleText}</p>
                <p className="ui-card-meta mt-0.5">{task.cron}</p>
              </div>
            </div>
          )}
          {task.model && (
            <div className="ui-detail-row">
              <span className="ui-detail-label">model</span>
              <p className="ui-detail-value">{task.model.split('/').pop()}</p>
            </div>
          )}
        </div>
      </div>

      <div className="border-t border-border-subtle pt-3">
        <p className="ui-section-label mb-2">Prompt</p>
        <div className="text-[12px] leading-relaxed text-secondary space-y-1 whitespace-pre-wrap break-words">
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
      <div className="space-y-1">
        <p className="ui-card-title">{entry.summary}</p>
        <p className="ui-card-meta">
          <span className={meta.color}>{meta.label}</span>
          <span className="opacity-40 mx-1.5">·</span>
          {formatDate(entry.createdAt)}
        </p>
      </div>

      {entry.details && (
        <div className="border-t border-border-subtle pt-3">
          <p className="ui-section-label mb-1.5">Details</p>
          <div className="text-[12px] text-secondary whitespace-pre-wrap break-words leading-relaxed">
            {entry.details}
          </div>
        </div>
      )}

      {entry.relatedProjectIds && entry.relatedProjectIds.length > 0 && (
        <div className="border-t border-border-subtle pt-3">
          <p className="ui-section-label mb-2">Related</p>
          <div className="space-y-1.5">
            {entry.relatedProjectIds.map((wsId) => (
              <Link key={wsId} to={`/projects/${wsId}`} className="ui-card-meta font-mono text-accent hover:text-accent/80">
                {wsId}
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="border-t border-border-subtle pt-3">
        <div className="ui-detail-list">
          {[
            { label: 'id', value: entry.id },
            { label: 'profile', value: entry.profile },
            ...(entry.notificationState ? [{ label: 'notify', value: entry.notificationState }] : []),
          ].map(({ label, value }) => (
            <div key={label} className="ui-detail-row">
              <span className="ui-detail-label">{label}</span>
              <span className="ui-detail-value break-all">{value}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Project detail ───────────────────────────────────────────────────────────

function ProjectDetailContext({ id }: { id: string }) {
  const navigate = useNavigate();
  const fetcher = useCallback(() => api.projectById(id), [id]);
  const { data: project, loading, error, refetch } = useApi(fetcher, id);

  useEffect(() => {
    function handleProjectChanged() {
      refetch();
    }

    window.addEventListener(PROJECTS_CHANGED_EVENT, handleProjectChanged);
    return () => window.removeEventListener(PROJECTS_CHANGED_EVENT, handleProjectChanged);
  }, [refetch]);

  if (loading) return <div className="px-4 py-4 text-[12px] text-dim animate-pulse">Loading…</div>;
  if (error) return <div className="px-4 py-4 text-[12px] text-dim">Project not found.</div>;
  if (!project) return <div className="px-4 py-4 text-[12px] text-dim">Project not found.</div>;

  return (
    <ProjectDetailPanel
      project={project}
      onChanged={() => {
        void refetch();
        emitProjectsChanged();
      }}
      onDeleted={() => {
        navigate('/projects');
        emitProjectsChanged();
      }}
    />
  );
}

// ── Memory file content ───────────────────────────────────────────────────────

function MemoryFileContext({ path }: { path: string }) {
  const fetcher = useCallback(() => api.memoryFile(path), [path]);
  const { data, loading, error, refetch } = useApi(fetcher, path);
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

  if (loading) return <div className="px-4 py-4 text-[12px] text-dim animate-pulse font-mono">Loading…</div>;
  if (error)   return <div className="px-4 py-4 text-[12px] text-danger/80 font-mono">Error: {error}</div>;

  const fileName = path.split('/').pop() ?? path;

  return (
    <div className="px-4 py-4 space-y-3">
      <p className="text-[12px] font-mono text-dim/60 truncate" title={path}>{fileName}</p>
      {editing ? (
        <div className="space-y-2">
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={e => setDraft(e.target.value)}
            className="w-full text-[13px] font-mono text-secondary leading-[1.75] bg-base border border-border-default rounded-lg px-3 py-2 resize-none focus:outline-none focus:border-accent/60 min-h-[120px]"
            spellCheck={false}
          />
          {saveErr && <p className="text-[12px] text-danger/80">{saveErr}</p>}
          <div className="flex items-center gap-3">
            <button onClick={save} disabled={saving} className="text-[12px] font-medium text-accent hover:text-accent/70 transition-colors disabled:opacity-40">
              {saving ? 'Saving…' : 'Save'}
            </button>
            {savedOk && <span className="text-[12px] text-success">✓ Saved</span>}
            <button onClick={() => setEditing(false)} disabled={saving} className="text-[12px] text-secondary hover:text-primary transition-colors disabled:opacity-40">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="relative group/content">
          <pre className="text-[13px] font-mono text-secondary leading-[1.75] whitespace-pre-wrap break-words overflow-x-auto max-h-[calc(100vh-200px)] overflow-y-auto">
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

function MemoryOverviewContext() {
  const { data, loading, error } = useApi(api.memory);

  if (loading) return <LoadingState label="Loading memory…" className="px-4 py-4" />;
  if (error) return <ErrorState message={`Failed to load memory: ${error}`} className="px-4 py-4" />;
  if (!data) return null;

  const summary = buildMemoryPageSummary(data);
  const identity = buildIdentitySummary(data);
  const capabilities = buildCapabilityCards(data).slice(0, 3);
  const knowledge = buildKnowledgeSections(data);

  return (
    <div className="px-4 py-4 space-y-4">
      <div className="space-y-1">
        <p className="ui-card-title">Agent memory</p>
        <p className="ui-card-meta">Select an item on the left to inspect the raw markdown.</p>
      </div>

      <p className="ui-card-meta">
        {summary.role}
        {' · '}
        {summary.knowledgeCount} knowledge items
        {' · '}
        {summary.capabilityCount} capabilities
      </p>

      <div className="space-y-3 border-t border-border-subtle pt-4">
        <div className="space-y-1.5">
          <p className="ui-section-label">Identity</p>
          <p className="ui-card-meta">{identity.ruleCount} behavior rules · {identity.role}</p>
        </div>

        <div className="space-y-1.5 border-t border-border-subtle pt-4">
          <p className="ui-section-label">Knowledge</p>
          {knowledge.recent.length === 0
            ? <p className="ui-card-meta">No recently used knowledge yet.</p>
            : knowledge.recent.map((item) => (
              <p key={item.item.path} className="ui-card-meta">{item.title} · {item.usageLabel}</p>
            ))}
        </div>

        <div className="space-y-1.5 border-t border-border-subtle pt-4">
          <p className="ui-section-label">Capabilities</p>
          {capabilities.length === 0
            ? <p className="ui-card-meta">No capabilities loaded yet.</p>
            : capabilities.map((item) => (
              <p key={item.item.path} className="ui-card-meta">{item.title} · {item.usageLabel}</p>
            ))}
        </div>
      </div>
    </div>
  );
}

// ── Root ──────────────────────────────────────────────────────────────────────

export function ContextRail({ onCollapse }: { onCollapse?: () => void }) {
  const location = useLocation();
  const parts = location.pathname.split('/').filter(Boolean);
  const section = parts[0];
  const id = parts[1];
  const scheduledSection = section === 'scheduled' || section === 'automations' || section === 'tasks';

  // Conversations
  if (section === 'conversations' && id) return (
    <div className="flex-1 overflow-y-auto flex flex-col">
      <RailHeader label="Session" onCollapse={onCollapse} />
      <LiveSessionContextPanel id={id} />
    </div>
  );

  // Scheduled tasks
  if (scheduledSection && id) return (
    <div className="flex-1 overflow-y-auto flex flex-col">
      <RailHeader label="Scheduled task" sub={id} onCollapse={onCollapse} />
      <TaskContext id={id} />
    </div>
  );
  if (scheduledSection) return (
    <div className="flex-1 flex flex-col">
      <RailHeader label="Scheduled" onCollapse={onCollapse} />
      <EmptyPrompt text="Select a scheduled task to see its prompt and schedule." />
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

  // Projects
  if (section === 'projects' && id) return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <RailHeader label="Project" onCollapse={onCollapse} />
      <div className="flex-1 overflow-y-auto">
        <ProjectDetailContext id={id} />
      </div>
    </div>
  );
  if (section === 'projects') return (
    <div className="flex-1 flex flex-col">
      <RailHeader label="Project" onCollapse={onCollapse} />
      <EmptyPrompt text="Select a project to inspect and edit it." />
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
      <div className="flex-1 flex flex-col overflow-hidden">
        <RailHeader label="Memory" onCollapse={onCollapse} />
        <div className="flex-1 overflow-y-auto">
          <MemoryOverviewContext />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center h-full gap-2 text-center px-6">
      <p className="text-[12px] text-dim">Select a conversation, project, or inbox item to see context.</p>
    </div>
  );
}

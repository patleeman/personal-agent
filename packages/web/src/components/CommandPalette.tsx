import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api';
import {
  COMMAND_PALETTE_SCOPE_OPTIONS,
  COMMAND_PALETTE_SECTION_LABELS,
  searchCommandPaletteItems,
  type CommandPaletteItem,
  type CommandPaletteScope,
  type CommandPaletteSection,
} from '../commandPalette';
import { formatProjectStatus, hasMeaningfulBlockers, summarizeProjectPreview } from '../contextRailProject';
import { useAppData } from '../contexts';
import { useConversations } from '../hooks/useConversations';
import type { ConversationCheckpointSummary, ProjectRecord, ScheduledTaskSummary, SessionMeta } from '../types';
import { timeAgo } from '../utils';
import { IconButton, Keycap, Pill, cx } from './ui';

type CommandPaletteAction =
  | { kind: 'navigate'; to: string }
  | { kind: 'restoreArchivedConversation'; conversationId: string }
  | { kind: 'setScope'; scope: CommandPaletteSection }
  | { kind: 'startCheckpoint'; checkpointId: string };

interface ScopedSessionMeta extends SessionMeta {
  pinned?: boolean;
}

function hasBlockingOverlayOpen(): boolean {
  return document.querySelector('.ui-overlay-backdrop:not([data-command-palette="true"])') !== null;
}

function isCommandPaletteHotkey(event: KeyboardEvent): boolean {
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  return key === 'k' && (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey;
}

function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') {
    return false;
  }

  return /mac|iphone|ipad|ipod/i.test(navigator.platform);
}

function excerpt(value: string | undefined, maxLength = 110): string | undefined {
  const normalized = (value ?? '').replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return undefined;
  }

  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}…` : normalized;
}

function taskStatusText(task: ScheduledTaskSummary): string {
  if (task.running) return 'running';
  if (task.lastStatus === 'success') return 'ok';
  if (task.lastStatus === 'failure') return 'failed';
  if (!task.enabled) return 'disabled';
  return 'pending';
}

function humanizeTaskCron(cron: string | undefined): string | undefined {
  if (!cron) {
    return undefined;
  }

  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) {
    return cron;
  }

  const [min, hour, dom, month, dow] = parts;
  if (dom === '*' && month === '*' && dow === '*') {
    if (hour === '*' && min === '*') {
      return 'every minute';
    }

    const minuteStep = min.match(/^\*\/(\d+)$/);
    if (hour === '*' && minuteStep) {
      return `every ${minuteStep[1]} min`;
    }

    if (hour === '*' && min !== '*') {
      return `every hour at :${min.padStart(2, '0')}`;
    }

    const hourStep = hour.match(/^\*\/(\d+)$/);
    if (hourStep && min !== '*') {
      return `every ${hourStep[1]}h at :${min.padStart(2, '0')}`;
    }

    if (hour !== '*' && min !== '*') {
      return `daily at ${hour.padStart(2, '0')}:${min.padStart(2, '0')}`;
    }
  }

  return cron;
}

function buildNavItems(): CommandPaletteItem<CommandPaletteAction>[] {
  return [
    {
      id: 'nav:new-chat',
      section: 'nav',
      title: 'New chat',
      subtitle: 'Start a fresh conversation',
      keywords: ['conversation', 'new', 'chat'],
      order: 0,
      action: { kind: 'navigate', to: '/conversations/new' },
    },
    {
      id: 'nav:inbox',
      section: 'nav',
      title: 'Inbox',
      subtitle: 'Unread activity and follow-ups',
      keywords: ['activity', 'notifications'],
      order: 1,
      action: { kind: 'navigate', to: '/inbox' },
    },
    {
      id: 'nav:checkpoints',
      section: 'nav',
      title: 'Checkpoints',
      subtitle: 'Search saved conversation branches',
      keywords: ['branches', 'forks', 'saved'],
      order: 2,
      action: { kind: 'setScope', scope: 'checkpoints' },
    },
    {
      id: 'nav:archived',
      section: 'nav',
      title: 'Archived conversations',
      subtitle: 'Search archived chats and restore them',
      keywords: ['archive', 'restore', 'history'],
      order: 3,
      action: { kind: 'setScope', scope: 'archived' },
    },
    {
      id: 'nav:scheduled',
      section: 'nav',
      title: 'Scheduled',
      subtitle: 'Browse recurring and one-off tasks',
      keywords: ['tasks', 'automation'],
      order: 4,
      action: { kind: 'navigate', to: '/scheduled' },
    },
    {
      id: 'nav:projects',
      section: 'nav',
      title: 'Projects',
      subtitle: 'Browse durable work hubs',
      keywords: ['project', 'work'],
      order: 5,
      action: { kind: 'navigate', to: '/projects' },
    },
    {
      id: 'nav:memory',
      section: 'nav',
      title: 'Memory',
      subtitle: 'Inspect memory docs, skills, and briefs',
      keywords: ['docs', 'skills'],
      order: 6,
      action: { kind: 'navigate', to: '/memory' },
    },
    {
      id: 'nav:tools',
      section: 'nav',
      title: 'Tools',
      subtitle: 'Review tool configuration and MCP servers',
      keywords: ['mcp', 'tooling'],
      order: 7,
      action: { kind: 'navigate', to: '/tools' },
    },
    {
      id: 'nav:daemon',
      section: 'nav',
      title: 'Daemon',
      subtitle: 'Inspect daemon service state',
      keywords: ['service', 'runtime'],
      order: 8,
      action: { kind: 'navigate', to: '/daemon' },
    },
    {
      id: 'nav:gateway',
      section: 'nav',
      title: 'Gateway',
      subtitle: 'Inspect messaging gateway state',
      keywords: ['telegram', 'bot'],
      order: 9,
      action: { kind: 'navigate', to: '/gateway' },
    },
    {
      id: 'nav:web-ui',
      section: 'nav',
      title: 'Web UI',
      subtitle: 'Inspect deployment status and releases',
      keywords: ['deploy', 'release'],
      order: 10,
      action: { kind: 'navigate', to: '/web-ui' },
    },
    {
      id: 'nav:executions',
      section: 'nav',
      title: 'Executions',
      subtitle: 'Browse durable runs and recoverable work',
      keywords: ['runs', 'background'],
      order: 11,
      action: { kind: 'navigate', to: '/runs' },
    },
    {
      id: 'nav:settings',
      section: 'nav',
      title: 'Settings',
      subtitle: 'Adjust UI and model preferences',
      keywords: ['preferences', 'config'],
      order: 12,
      action: { kind: 'navigate', to: '/settings' },
    },
  ];
}

function buildConversationItems(
  section: 'open' | 'archived',
  sessions: ScopedSessionMeta[],
): CommandPaletteItem<CommandPaletteAction>[] {
  const orderedSessions = section === 'archived'
    ? [...sessions].sort((left, right) => {
      const leftTimestamp = left.lastActivityAt ?? left.timestamp;
      const rightTimestamp = right.lastActivityAt ?? right.timestamp;
      return rightTimestamp.localeCompare(leftTimestamp);
    })
    : sessions;

  return orderedSessions.map((session, index) => {
    const timestamp = session.lastActivityAt ?? session.timestamp;
    const metaParts = [timeAgo(timestamp)];

    if (section === 'open' && session.pinned) {
      metaParts.push('pinned');
    }

    if (session.isRunning) {
      metaParts.push('running');
    }

    if (session.needsAttention) {
      metaParts.push('attention');
    }

    if (session.model) {
      metaParts.push(session.model.split('/').pop() ?? session.model);
    }

    return {
      id: `${section}:${session.id}`,
      section,
      title: session.title,
      subtitle: session.cwd,
      meta: metaParts.join(' · '),
      keywords: [session.id, session.file, session.cwd, session.model, session.cwdSlug],
      order: index,
      action: section === 'archived'
        ? { kind: 'restoreArchivedConversation', conversationId: session.id }
        : { kind: 'navigate', to: `/conversations/${encodeURIComponent(session.id)}` },
    };
  });
}

function buildCheckpointItems(checkpoints: ConversationCheckpointSummary[]): CommandPaletteItem<CommandPaletteAction>[] {
  const orderedCheckpoints = [...checkpoints].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));

  return orderedCheckpoints.map((checkpoint, index) => {
    const sourceTitle = checkpoint.source.conversationTitle || checkpoint.source.conversationId;
    const metaParts = [sourceTitle, timeAgo(checkpoint.updatedAt), `${checkpoint.snapshot.messageCount} msgs`];
    if (checkpoint.snapshotMissing) {
      metaParts.push('snapshot missing');
    }

    return {
      id: `checkpoint:${checkpoint.id}`,
      section: 'checkpoints',
      title: checkpoint.title,
      subtitle: excerpt(checkpoint.anchor.preview || checkpoint.summary || checkpoint.note, 120),
      meta: metaParts.join(' · '),
      keywords: [
        checkpoint.id,
        checkpoint.title,
        checkpoint.note ?? '',
        checkpoint.summary ?? '',
        checkpoint.source.conversationId,
        checkpoint.source.conversationTitle ?? '',
        checkpoint.source.cwd ?? '',
        checkpoint.anchor.preview,
        ...checkpoint.source.relatedProjectIds,
      ],
      order: index,
      disabled: checkpoint.snapshotMissing,
      action: { kind: 'startCheckpoint', checkpointId: checkpoint.id },
    };
  });
}

function buildTaskItems(tasks: ScheduledTaskSummary[]): CommandPaletteItem<CommandPaletteAction>[] {
  const orderedTasks = [...tasks].sort((left, right) => {
    if (left.running !== right.running) {
      return left.running ? -1 : 1;
    }

    const leftTimestamp = left.lastRunAt ?? '';
    const rightTimestamp = right.lastRunAt ?? '';
    if (leftTimestamp !== rightTimestamp) {
      return rightTimestamp.localeCompare(leftTimestamp);
    }

    return left.id.localeCompare(right.id);
  });

  return orderedTasks.map((task, index) => {
    const metaParts = [taskStatusText(task)];
    const cronText = humanizeTaskCron(task.cron);
    if (cronText) {
      metaParts.push(cronText);
    }
    if (task.lastRunAt) {
      metaParts.push(`last run ${timeAgo(task.lastRunAt)}`);
    }
    if (task.model) {
      metaParts.push(task.model.split('/').pop() ?? task.model);
    }

    return {
      id: `task:${task.id}`,
      section: 'tasks',
      title: task.id,
      subtitle: excerpt(task.prompt, 120) ?? task.filePath,
      meta: metaParts.join(' · '),
      keywords: [task.id, task.filePath, task.scheduleType, task.prompt, task.cron ?? '', task.model ?? '', task.lastStatus ?? ''],
      order: index,
      action: { kind: 'navigate', to: `/scheduled/${encodeURIComponent(task.id)}` },
    };
  });
}

function buildProjectItems(projects: ProjectRecord[]): CommandPaletteItem<CommandPaletteAction>[] {
  const orderedProjects = [...projects].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));

  return orderedProjects.map((project, index) => {
    const blockers = project.blockers.filter((blocker) => blocker.trim().length > 0);
    const metaParts = [formatProjectStatus(project.status), project.id, timeAgo(project.updatedAt)];
    if (hasMeaningfulBlockers(project.blockers) && blockers[0]) {
      metaParts.push(blockers[0]);
    }

    return {
      id: `project:${project.id}`,
      section: 'projects',
      title: project.title,
      subtitle: excerpt(summarizeProjectPreview(project), 120),
      meta: metaParts.join(' · '),
      keywords: [
        project.id,
        project.title,
        project.description,
        project.summary,
        project.status,
        project.currentFocus ?? '',
        ...project.blockers,
        ...project.recentProgress,
      ],
      order: index,
      action: { kind: 'navigate', to: `/projects/${encodeURIComponent(project.id)}` },
    };
  });
}

function emptyStateCopy(scope: CommandPaletteScope, query: string): string {
  if (query.trim().length > 0) {
    switch (scope) {
      case 'nav':
        return `No navigation items match “${query}”.`;
      case 'open':
        return `No open conversations match “${query}”.`;
      case 'archived':
        return `No archived conversations match “${query}”.`;
      case 'checkpoints':
        return `No checkpoints match “${query}”.`;
      case 'tasks':
        return `No scheduled tasks match “${query}”.`;
      case 'projects':
        return `No projects match “${query}”.`;
      default:
        return `No results match “${query}”.`;
    }
  }

  switch (scope) {
    case 'open':
      return 'No open conversations yet.';
    case 'archived':
      return 'No archived conversations yet.';
    case 'checkpoints':
      return 'No checkpoints yet.';
    case 'tasks':
      return 'No scheduled tasks yet.';
    case 'projects':
      return 'No projects yet.';
    default:
      return 'Nothing to show yet.';
  }
}

export function CommandPalette() {
  const navigate = useNavigate();
  const location = useLocation();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const macPlatform = useMemo(() => isMacPlatform(), []);
  const { projects, tasks } = useAppData();
  const {
    pinnedSessions,
    tabs,
    archivedSessions,
    openSession,
    loading: sessionsLoading,
  } = useConversations();
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<CommandPaletteScope>('all');
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const [busyItemId, setBusyItemId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [checkpoints, setCheckpoints] = useState<ConversationCheckpointSummary[]>([]);
  const [checkpointsLoading, setCheckpointsLoading] = useState(false);
  const [checkpointsError, setCheckpointsError] = useState<string | null>(null);

  const openConversationItems = useMemo(
    () => buildConversationItems('open', [
      ...pinnedSessions.map((session) => ({ ...session, pinned: true } satisfies ScopedSessionMeta)),
      ...tabs,
    ]),
    [pinnedSessions, tabs],
  );
  const archivedConversationItems = useMemo(
    () => buildConversationItems('archived', archivedSessions),
    [archivedSessions],
  );
  const checkpointItems = useMemo(() => buildCheckpointItems(checkpoints), [checkpoints]);
  const taskItems = useMemo(() => buildTaskItems(tasks ?? []), [tasks]);
  const projectItems = useMemo(() => buildProjectItems(projects ?? []), [projects]);
  const items = useMemo(
    () => [
      ...buildNavItems(),
      ...openConversationItems,
      ...archivedConversationItems,
      ...checkpointItems,
      ...taskItems,
      ...projectItems,
    ],
    [archivedConversationItems, checkpointItems, openConversationItems, projectItems, taskItems],
  );
  const groups = useMemo(
    () => searchCommandPaletteItems(items, { query, scope }),
    [items, query, scope],
  );
  const visibleItems = useMemo(
    () => groups.flatMap((group) => group.items),
    [groups],
  );

  const closePalette = useCallback(() => {
    setOpen(false);
    setBusyItemId(null);
    setActionError(null);
  }, []);

  const openPalette = useCallback(() => {
    setQuery('');
    setScope('all');
    setCursor(0);
    setBusyItemId(null);
    setActionError(null);
    setOpen(true);
  }, []);

  const activateItem = useCallback(async (item: CommandPaletteItem<CommandPaletteAction>) => {
    if (item.disabled) {
      return;
    }

    setActionError(null);
    setBusyItemId(item.id);

    try {
      switch (item.action.kind) {
        case 'navigate':
          navigate(item.action.to);
          closePalette();
          return;
        case 'restoreArchivedConversation':
          openSession(item.action.conversationId);
          navigate(`/conversations/${encodeURIComponent(item.action.conversationId)}`);
          closePalette();
          return;
        case 'setScope':
          setScope(item.action.scope);
          setQuery('');
          setCursor(0);
          setBusyItemId(null);
          window.requestAnimationFrame(() => inputRef.current?.focus());
          return;
        case 'startCheckpoint': {
          const result = await api.startCheckpoint(item.action.checkpointId);
          openSession(result.id);
          navigate(`/conversations/${encodeURIComponent(result.id)}`);
          closePalette();
          return;
        }
        default:
          return;
      }
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyItemId(null);
    }
  }, [closePalette, navigate, openSession]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handle = window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);

    return () => window.clearTimeout(handle);
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    setCursor((current) => {
      if (visibleItems.length === 0) {
        return 0;
      }

      return Math.max(0, Math.min(current, visibleItems.length - 1));
    });
  }, [open, visibleItems.length]);

  useEffect(() => {
    if (!open) {
      return;
    }

    listRef.current?.querySelector(`[data-command-palette-idx="${cursor}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [cursor, open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    setCheckpointsLoading(true);
    setCheckpointsError(null);
    let cancelled = false;

    api.checkpoints()
      .then((result) => {
        if (cancelled) {
          return;
        }

        setCheckpoints(result.checkpoints);
        setCheckpointsLoading(false);
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }

        setCheckpointsLoading(false);
        setCheckpointsError(error instanceof Error ? error.message : String(error));
      });

    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.isComposing) {
        return;
      }

      if (isCommandPaletteHotkey(event)) {
        if (!open && hasBlockingOverlayOpen()) {
          return;
        }

        event.preventDefault();
        if (open) {
          closePalette();
        } else {
          openPalette();
        }
        return;
      }

      if (!open) {
        return;
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        closePalette();
        return;
      }

      if (event.key === 'Enter') {
        event.preventDefault();
        const active = visibleItems[cursor];
        if (active) {
          void activateItem(active);
        }
        return;
      }

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setCursor((current) => Math.min(current + 1, Math.max(visibleItems.length - 1, 0)));
        return;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setCursor((current) => Math.max(current - 1, 0));
        return;
      }

      if (event.key === 'PageDown') {
        event.preventDefault();
        setCursor((current) => Math.min(current + 10, Math.max(visibleItems.length - 1, 0)));
        return;
      }

      if (event.key === 'PageUp') {
        event.preventDefault();
        setCursor((current) => Math.max(current - 10, 0));
        return;
      }

      if (event.key === 'Home') {
        event.preventDefault();
        setCursor(0);
        return;
      }

      if (event.key === 'End') {
        event.preventDefault();
        setCursor(Math.max(visibleItems.length - 1, 0));
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activateItem, closePalette, cursor, open, openPalette, visibleItems]);

  useEffect(() => {
    closePalette();
  }, [closePalette, location.pathname, location.search]);

  const visibleCount = visibleItems.length;
  const loadingSections = useMemo(() => {
    const sections = new Set<CommandPaletteSection>();
    if (scope === 'all' || scope === 'open' || scope === 'archived') {
      if (sessionsLoading) {
        sections.add(scope === 'archived' ? 'archived' : 'open');
      }
    }
    if ((scope === 'all' || scope === 'checkpoints') && checkpointsLoading) {
      sections.add('checkpoints');
    }
    if ((scope === 'all' || scope === 'tasks') && tasks === null) {
      sections.add('tasks');
    }
    if ((scope === 'all' || scope === 'projects') && projects === null) {
      sections.add('projects');
    }
    return [...sections];
  }, [checkpointsLoading, projects, scope, sessionsLoading, tasks]);

  if (!open) {
    return null;
  }

  let runningIndex = -1;

  return (
    <div
      className="ui-overlay-backdrop"
      data-command-palette="true"
      style={{ background: 'rgb(0 0 0 / 0.48)', backdropFilter: 'blur(3px)' }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          closePalette();
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="ui-dialog-shell"
        style={{ maxWidth: '900px', maxHeight: 'calc(100vh - 5rem)', overscrollBehavior: 'contain' }}
      >
        <div className="px-4 pt-3 pb-0 border-b border-border-subtle">
          <div className="flex items-center justify-between gap-3 mb-2.5">
            <div>
              <p className="ui-section-label text-[11px]">Command palette</p>
              <p className="text-[12px] text-secondary mt-1">
                Jump across conversations, navigation, checkpoints, scheduled tasks, and projects.
              </p>
            </div>
            <div className="flex items-center gap-2 text-[10px] text-dim/70 font-mono">
              <Keycap>↑↓</Keycap>
              <span>move</span>
              <Keycap>↵</Keycap>
              <span>open</span>
              <Pill tone="muted" mono className="tabular-nums">{visibleCount}</Pill>
              <IconButton onClick={closePalette} title="Close command palette" aria-label="Close command palette" compact>
                ✕
              </IconButton>
            </div>
          </div>

          <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-elevated border border-border-subtle min-w-0 mb-2.5">
            <span className="text-dim text-[12px]">⌕</span>
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setCursor(0);
                setActionError(null);
              }}
              placeholder="Search conversations, routes, checkpoints, tasks, and projects…"
              aria-label="Search command palette"
              className="flex-1 bg-transparent text-[13px] text-primary placeholder:text-dim outline-none font-mono min-w-0"
            />
            <span className="text-[10px] text-dim/70 font-mono shrink-0">{macPlatform ? '⌘K' : 'Ctrl+K'}</span>
          </div>

          <div className="flex flex-wrap gap-1.5 pb-2">
            {COMMAND_PALETTE_SCOPE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => {
                  setScope(option.value);
                  setCursor(0);
                  setActionError(null);
                  window.requestAnimationFrame(() => inputRef.current?.focus());
                }}
                className={cx(
                  'rounded-md px-2.5 py-1 text-[11px] transition-colors',
                  scope === option.value
                    ? 'bg-surface text-primary shadow-sm'
                    : 'text-dim hover:text-secondary hover:bg-elevated/50',
                )}
              >
                {option.label}
              </button>
            ))}
          </div>

          {actionError && <p className="pb-2 text-[11px] text-danger">{actionError}</p>}
        </div>

        <div ref={listRef} className="overflow-y-auto flex-1 py-1" style={{ overscrollBehavior: 'contain' }}>
          {groups.map((group) => (
            <section key={group.section} className="py-1">
              <div className="px-5 pb-1 flex items-center gap-2">
                <p className="ui-section-label">{group.label}</p>
                <span className="ui-section-count">{group.items.length}{group.total > group.items.length ? `/${group.total}` : ''}</span>
              </div>

              {group.items.map((item) => {
                runningIndex += 1;
                const itemIndex = runningIndex;
                const isSelected = itemIndex === cursor;
                const isBusy = busyItemId === item.id;
                return (
                  <button
                    key={item.id}
                    data-command-palette-idx={itemIndex}
                    type="button"
                    onMouseEnter={() => setCursor(itemIndex)}
                    onClick={() => { void activateItem(item); }}
                    disabled={item.disabled || isBusy}
                    className={cx(
                      'group w-full flex items-start gap-3 px-5 py-2 text-left transition-colors disabled:cursor-not-allowed',
                      isSelected ? 'bg-elevated' : 'hover:bg-elevated/40',
                      item.disabled && 'opacity-55',
                    )}
                    title={item.subtitle ?? item.title}
                  >
                    <span className={cx(
                      'text-[11px] shrink-0 w-2 mt-1',
                      isSelected ? 'text-accent' : 'text-border-default/50',
                    )}>
                      {isSelected ? '▶' : '·'}
                    </span>

                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] text-primary leading-snug truncate">{item.title}</p>
                      {item.subtitle && (
                        <p className="mt-0.5 text-[11px] text-secondary truncate" title={item.subtitle}>{item.subtitle}</p>
                      )}
                      {item.meta && (
                        <p className="mt-0.5 text-[11px] text-dim/70 truncate" title={item.meta}>{item.meta}</p>
                      )}
                    </div>

                    <span className="shrink-0 mt-0.5 text-[10px] text-dim/60 font-mono">
                      {isBusy ? '…' : group.label.replace(/\s+/g, ' ').toLowerCase()}
                    </span>
                  </button>
                );
              })}
            </section>
          ))}

          {loadingSections.map((section) => (
            <section key={`loading:${section}`} className="py-1">
              <div className="px-5 pb-1 flex items-center gap-2">
                <p className="ui-section-label">{COMMAND_PALETTE_SECTION_LABELS[section]}</p>
              </div>
              <p className="px-5 py-3 text-[12px] text-dim font-mono">Loading {COMMAND_PALETTE_SECTION_LABELS[section].toLowerCase()}…</p>
            </section>
          ))}

          {checkpointsError && (scope === 'all' || scope === 'checkpoints') && (
            <section className="py-1">
              <div className="px-5 pb-1 flex items-center gap-2">
                <p className="ui-section-label">Checkpoints</p>
              </div>
              <p className="px-5 py-3 text-[12px] text-danger">Failed to load checkpoints: {checkpointsError}</p>
            </section>
          )}

          {visibleCount === 0 && loadingSections.length === 0 && !(checkpointsError && (scope === 'all' || scope === 'checkpoints')) && (
            <p className="px-6 py-10 text-[12px] text-dim text-center font-mono">{emptyStateCopy(scope, query)}</p>
          )}
        </div>

        <div className="px-5 py-2.5 border-t border-border-subtle flex items-center justify-between text-[10px] text-dim/60 font-mono gap-3">
          <Pill tone="muted" mono>{visibleCount > 0 ? `${cursor + 1} / ${visibleCount}` : '0 / 0'}</Pill>
          <span>
            Search across open chats, archived chats, checkpoints, scheduled tasks, projects, and routes · esc to close
          </span>
        </div>
      </div>
    </div>
  );
}

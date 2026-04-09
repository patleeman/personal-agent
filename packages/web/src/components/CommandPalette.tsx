import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api';
import {
  COMMAND_PALETTE_SCOPE_OPTIONS,
  COMMAND_PALETTE_SCOPE_SECTIONS,
  COMMAND_PALETTE_SECTION_LABELS,
  searchCommandPaletteItems,
  type CommandPaletteItem,
  type CommandPaletteScope,
  type CommandPaletteSection,
} from '../commandPalette';
import { OPEN_COMMAND_PALETTE_EVENT, type OpenCommandPaletteDetail } from '../commandPaletteEvents';
import { useAppData } from '../contexts';
import { useConversations } from '../hooks/useConversations';
import type { ScheduledTaskSummary, SessionMeta } from '../types';
import { timeAgo } from '../utils';
import { cx } from './ui';

type CommandPaletteAction =
  | { kind: 'navigate'; to: string }
  | { kind: 'restoreArchivedConversation'; conversationId: string }
  | { kind: 'setScope'; scope: CommandPaletteScope };

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
      title: 'Notifications',
      subtitle: 'Notification center for activity, reminders, and follow-ups',
      keywords: ['activity', 'notifications', 'alerts', 'reminders', 'callbacks', 'inbox'],
      order: 1,
      action: { kind: 'navigate', to: '/inbox' },
    },
    {
      id: 'nav:scheduled',
      section: 'nav',
      title: 'Automations',
      subtitle: 'Browse unattended automation',
      keywords: ['automation', 'scheduled', 'tasks', 'cron'],
      order: 8,
      action: { kind: 'navigate', to: '/automations' },
    },
    {
      id: 'nav:tools',
      section: 'nav',
      title: 'Tools',
      subtitle: 'Inspect runtime tools and integrations',
      keywords: ['tools', 'mcp', 'integrations', 'capabilities'],
      order: 9,
      action: { kind: 'navigate', to: '/tools' },
    },
    {
      id: 'nav:instructions',
      section: 'nav',
      title: 'Instructions',
      subtitle: 'Browse AGENTS and durable behavior sources',
      keywords: ['agents', 'instructions', 'policy', 'capabilities'],
      order: 10,
      action: { kind: 'navigate', to: '/instructions' },
    },
    {
      id: 'nav:threads',
      section: 'nav',
      title: 'Threads',
      subtitle: 'Search archived conversations',
      keywords: ['archive', 'restore', 'history', 'messages', 'threads', 'fuzzy'],
      order: 12,
      action: { kind: 'setScope', scope: 'threads' },
    },
    {
      id: 'nav:system',
      section: 'nav',
      title: 'System',
      subtitle: 'Inspect services, logs, and operational state',
      keywords: ['daemon', 'web ui', 'status', 'services', 'logs', 'operations'],
      order: 13,
      action: { kind: 'navigate', to: '/settings?page=system' },
    },
    {
      id: 'nav:web-ui',
      section: 'nav',
      title: 'Web UI',
      subtitle: 'Inspect release, companion access, and frontend logs',
      keywords: ['system', 'web ui', 'frontend', 'release', 'desktop', 'pairing'],
      order: 14,
      action: { kind: 'navigate', to: '/settings?page=system-web-ui' },
    },
    {
      id: 'nav:daemon',
      section: 'nav',
      title: 'Daemon',
      subtitle: 'Inspect runtime health, queue depth, and daemon logs',
      keywords: ['system', 'daemon', 'queue', 'runtime', 'background'],
      order: 15,
      action: { kind: 'navigate', to: '/settings?page=system-daemon' },
    },
    {
      id: 'nav:runs',
      section: 'nav',
      title: 'Runs',
      subtitle: 'Inspect durable background work and recovery review',
      keywords: ['runs', 'background', 'durable', 'executions', 'recovery'],
      order: 17,
      action: { kind: 'navigate', to: '/runs' },
    },
    {
      id: 'nav:settings',
      section: 'nav',
      title: 'Settings',
      subtitle: 'Adjust UI, profile, and model preferences',
      keywords: ['preferences', 'config'],
      order: 18,
      action: { kind: 'navigate', to: '/settings' },
    },
  ];
}

function buildConversationItems(
  section: 'open' | 'archived',
  sessions: ScopedSessionMeta[],
  archivedSearchIndex: Record<string, string> = {},
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

    const archivedSearchText = section === 'archived' ? archivedSearchIndex[session.id] ?? '' : '';

    return {
      id: `${section}:${session.id}`,
      section,
      title: session.title,
      subtitle: session.cwd,
      meta: metaParts.join(' · '),
      keywords: [session.id, session.file, session.cwd, session.model, session.cwdSlug, archivedSearchText],
      order: index,
      action: section === 'archived'
        ? { kind: 'restoreArchivedConversation', conversationId: session.id }
        : { kind: 'navigate', to: `/conversations/${encodeURIComponent(session.id)}` },
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
      action: { kind: 'navigate', to: `/automations/${encodeURIComponent(task.id)}` },
    };
  });
}

function emptyStateCopy(scope: CommandPaletteScope, query: string): string {
  if (query.trim().length > 0) {
    switch (scope) {
      case 'threads':
        return `No threads match “${query}”.`;
      case 'commands':
      default:
        return `No commands match “${query}”.`;
    }
  }

  switch (scope) {
    case 'threads':
      return 'No archived conversations yet.';
    case 'commands':
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
  const { tasks } = useAppData();
  const {
    pinnedSessions,
    tabs,
    archivedSessions,
    openSession,
    loading: sessionsLoading,
  } = useConversations();
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<CommandPaletteScope>('threads');
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const [busyItemId, setBusyItemId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [archivedSearchIndex, setArchivedSearchIndex] = useState<Record<string, string>>({});
  const [archivedSearchLoading, setArchivedSearchLoading] = useState(false);
  const [archivedSearchError, setArchivedSearchError] = useState<string | null>(null);

  const openConversationItems = useMemo(
    () => buildConversationItems('open', [
      ...pinnedSessions.map((session) => ({ ...session, pinned: true } satisfies ScopedSessionMeta)),
      ...tabs,
    ]),
    [pinnedSessions, tabs],
  );
  const archivedConversationItems = useMemo(
    () => buildConversationItems('archived', archivedSessions, archivedSearchIndex),
    [archivedSearchIndex, archivedSessions],
  );
  const taskItems = useMemo(() => buildTaskItems(tasks ?? []), [tasks]);
  const items = useMemo(
    () => [
      ...buildNavItems(),
      ...openConversationItems,
      ...archivedConversationItems,
      ...taskItems,
    ],
    [archivedConversationItems, openConversationItems, taskItems],
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

  const openPalette = useCallback((options: OpenCommandPaletteDetail = {}) => {
    setQuery(options.query ?? '');
    setScope(options.scope ?? 'threads');
    setCursor(0);
    setBusyItemId(null);
    setActionError(null);
    setOpen(true);
  }, []);

  useEffect(() => {
    function handleOpenPalette(event: Event) {
      const detail = (event as CustomEvent<OpenCommandPaletteDetail>).detail;
      openPalette(detail ?? {});
    }

    window.addEventListener(OPEN_COMMAND_PALETTE_EVENT, handleOpenPalette);
    return () => window.removeEventListener(OPEN_COMMAND_PALETTE_EVENT, handleOpenPalette);
  }, [openPalette]);

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

  const archivedSessionIds = useMemo(
    () => archivedSessions.map((session) => session.id),
    [archivedSessions],
  );
  const shouldIndexArchivedSearch = open
    && query.trim().length > 0
    && scope === 'threads';

  useEffect(() => {
    if (!open) {
      return;
    }

    if (archivedSessionIds.length === 0) {
      setArchivedSearchIndex({});
      setArchivedSearchError(null);
      setArchivedSearchLoading(false);
      return;
    }

    if (!shouldIndexArchivedSearch) {
      setArchivedSearchLoading(false);
      return;
    }

    const missingSessionIds = archivedSessionIds
      .filter((sessionId) => archivedSearchIndex[sessionId] === undefined)
      .slice(0, 25);
    if (missingSessionIds.length === 0) {
      setArchivedSearchLoading(false);
      return;
    }

    let cancelled = false;
    setArchivedSearchLoading(true);
    setArchivedSearchError(null);

    api.sessionSearchIndex(missingSessionIds)
      .then((result) => {
        if (cancelled) {
          return;
        }

        setArchivedSearchIndex((current) => ({
          ...current,
          ...result.index,
        }));
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }

        setArchivedSearchError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (!cancelled) {
          setArchivedSearchLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [archivedSearchIndex, archivedSessionIds, open, query, scope, shouldIndexArchivedSearch]);

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
        event.stopPropagation();
        closePalette();
        return;
      }

      if (event.key === 'Tab') {
        event.preventDefault();
        const scopeValues = COMMAND_PALETTE_SCOPE_OPTIONS.map((option) => option.value);
        const currentIndex = scopeValues.indexOf(scope);
        const direction = event.shiftKey ? -1 : 1;
        const nextIndex = currentIndex === -1
          ? 0
          : (currentIndex + direction + scopeValues.length) % scopeValues.length;
        const nextScope = scopeValues[nextIndex];
        setScope(nextScope);
        setCursor(0);
        setActionError(null);
        window.requestAnimationFrame(() => inputRef.current?.focus());
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
  }, [activateItem, closePalette, cursor, open, openPalette, scope, visibleItems]);

  useEffect(() => {
    closePalette();
  }, [closePalette, location.pathname, location.search]);

  const visibleCount = visibleItems.length;
  const loadingSections = useMemo(() => {
    const sections = new Set<CommandPaletteSection>();
    if (sessionsLoading) {
      for (const section of COMMAND_PALETTE_SCOPE_SECTIONS[scope]) {
        if (section === 'open' || section === 'archived') {
          sections.add(section);
        }
      }
    }
    if (scope === 'threads' && archivedSearchLoading) {
      sections.add('archived');
    }
    if (scope === 'commands' && tasks === null) {
      sections.add('tasks');
    }
    return [...sections];
  }, [archivedSearchLoading, scope, sessionsLoading, tasks]);
  const showSectionHeaders = scope === 'commands' && groups.length > 1;
  const searchPlaceholder = scope === 'threads'
    ? 'Search threads…'
    : 'Search commands, tabs, and automations…';

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
        style={{
          maxWidth: '720px',
          maxHeight: 'min(560px, calc(100vh - 4rem))',
          overscrollBehavior: 'contain',
        }}
      >
        <div className="border-b border-border-subtle px-3.5 pt-3 pb-2.5">
          <div className="mb-2 flex items-center justify-between gap-3">
            <div className="inline-flex items-center gap-1 rounded-lg bg-elevated p-1">
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
                      ? 'bg-surface text-primary'
                      : 'text-dim hover:bg-surface/60 hover:text-secondary',
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2 text-[10px] text-dim/70 font-mono">
              <span>{visibleCount > 0 ? `${cursor + 1}/${visibleCount}` : '0/0'}</span>
              <span>tab switches</span>
              <span>↵ open</span>
              <span>esc close</span>
            </div>
          </div>

          <div className="flex items-center gap-2 rounded-lg border border-border-subtle bg-elevated px-3 py-2 min-w-0">
            <span className="text-[12px] text-dim">⌕</span>
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setCursor(0);
                setActionError(null);
              }}
              placeholder={searchPlaceholder}
              aria-label="Search command palette"
              className="min-w-0 flex-1 bg-transparent text-[13px] text-primary placeholder:text-dim outline-none"
            />
            <span className="shrink-0 text-[10px] text-dim/70 font-mono">{macPlatform ? '⌘K' : 'Ctrl+K'}</span>
          </div>

          {actionError && <p className="pt-2 text-[11px] text-danger">{actionError}</p>}
        </div>

        <div ref={listRef} className="flex-1 overflow-y-auto px-2 py-2" style={{ overscrollBehavior: 'contain' }}>
          {groups.map((group) => (
            <section key={group.section} className="pb-2 last:pb-0">
              {showSectionHeaders && (
                <div className="px-2.5 pb-1 flex items-center gap-2">
                  <p className="ui-section-label">{group.label}</p>
                  <span className="ui-section-count">{group.items.length}{group.total > group.items.length ? `/${group.total}` : ''}</span>
                </div>
              )}

              {group.items.map((item) => {
                runningIndex += 1;
                const itemIndex = runningIndex;
                const isSelected = itemIndex === cursor;
                const isBusy = busyItemId === item.id;
                const secondaryText = [item.subtitle, item.meta].filter(Boolean).join(' · ');

                return (
                  <button
                    key={item.id}
                    data-command-palette-idx={itemIndex}
                    type="button"
                    onMouseEnter={() => setCursor(itemIndex)}
                    onClick={() => { void activateItem(item); }}
                    disabled={item.disabled || isBusy}
                    className={cx(
                      'group flex w-full items-start gap-3 rounded-lg px-2.5 py-2 text-left transition-colors disabled:cursor-not-allowed',
                      isSelected ? 'bg-elevated' : 'hover:bg-elevated/50',
                      item.disabled && 'opacity-55',
                    )}
                    title={item.subtitle ?? item.title}
                  >
                    <span
                      className={cx(
                        'mt-0.5 h-4 w-px shrink-0 rounded-full transition-colors',
                        isSelected ? 'bg-accent' : 'bg-border-subtle',
                      )}
                    />

                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] leading-snug text-primary">{item.title}</p>
                      {secondaryText && (
                        <p className="mt-0.5 truncate text-[11px] text-secondary" title={secondaryText}>{secondaryText}</p>
                      )}
                    </div>

                    {isBusy && (
                      <span className="mt-0.5 shrink-0 text-[10px] text-dim/60 font-mono">…</span>
                    )}
                  </button>
                );
              })}
            </section>
          ))}

          {loadingSections.map((section) => (
            <section key={`loading:${section}`} className="pb-2 last:pb-0">
              {showSectionHeaders && (
                <div className="px-2.5 pb-1 flex items-center gap-2">
                  <p className="ui-section-label">{COMMAND_PALETTE_SECTION_LABELS[section]}</p>
                </div>
              )}
              <p className="px-2.5 py-3 text-[12px] text-dim font-mono">Loading {COMMAND_PALETTE_SECTION_LABELS[section].toLowerCase()}…</p>
            </section>
          ))}

          {archivedSearchError && scope === 'threads' && (
            <section className="pb-2 last:pb-0">
              <p className="px-2.5 py-3 text-[12px] text-danger">Failed to index archived messages: {archivedSearchError}</p>
            </section>
          )}

          {visibleCount === 0 && loadingSections.length === 0 && !(archivedSearchError && scope === 'threads') && (
            <p className="px-4 py-10 text-center font-mono text-[12px] text-dim">{emptyStateCopy(scope, query)}</p>
          )}
        </div>
      </div>
    </div>
  );
}

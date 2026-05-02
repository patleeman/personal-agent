import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAppData } from '../app/contexts';
import { api, vaultApi } from '../client/api';
import {
  COMMAND_PALETTE_SCOPE_OPTIONS,
  COMMAND_PALETTE_SCOPE_SECTIONS,
  COMMAND_PALETTE_SECTION_LABELS,
  isCommandPaletteThreadDataLoading,
  resolveCommandPaletteHotkeyScope,
  searchCommandPaletteItems,
  selectCommandPaletteScopedItems,
  shouldBootstrapCommandPaletteThreads,
  type CommandPaletteItem,
  type CommandPaletteScope,
  type CommandPaletteSection,
} from '../commands/commandPalette';
import { OPEN_COMMAND_PALETTE_EVENT, type OpenCommandPaletteDetail } from '../commands/commandPaletteEvents';
import { buildCommandPaletteFileOpenRoute } from '../commands/commandPaletteNavigation';
import { useConversations } from '../hooks/useConversations';
import type { ConversationContentSearchMatch, SessionMeta, VaultEntry, VaultSearchResult } from '../shared/types';
import { timeAgo } from '../shared/utils';
import { readAppLayoutMode } from '../ui-state/appLayoutMode';
import { onKBEvent } from './knowledge/knowledgeEvents';
import { cx } from './ui';

type CommandPaletteAction =
  | { kind: 'navigate'; to: string }
  | { kind: 'restoreArchivedConversation'; conversationId: string }
  | { kind: 'openFile'; fileId: string };

interface ScopedSessionMeta extends SessionMeta {
  pinned?: boolean;
}

const THREADS_EMPTY_QUERY_PAGE_SIZE = 50;
const CONVERSATION_CONTENT_SEARCH_LIMIT = 80;
const FILE_SEARCH_LIMIT = 50;
const FILE_CONTENT_SEARCH_DEBOUNCE_MS = 160;
const CONVERSATION_CONTENT_SEARCH_DEBOUNCE_MS = 160;

function hasBlockingOverlayOpen(): boolean {
  return document.querySelector('.ui-overlay-backdrop:not([data-command-palette="true"])') !== null;
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

function fileTitle(name: string): string {
  return name.replace(/\.md$/i, '');
}

function fileLocation(id: string): string | undefined {
  const parts = id.split('/').slice(0, -1).filter(Boolean);
  return parts.length > 0 ? parts.join('/') : undefined;
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

function buildFileItems(files: VaultEntry[]): CommandPaletteItem<CommandPaletteAction>[] {
  return files
    .filter((file) => file.kind === 'file' && file.name.endsWith('.md'))
    .map((file, index) => ({
      id: `file:${file.id}`,
      section: 'files' as const,
      title: fileTitle(file.name),
      subtitle: fileLocation(file.id),
      meta: file.id,
      keywords: [file.id, file.name, file.path],
      order: index,
      action: { kind: 'openFile', fileId: file.id },
    }));
}

function buildFileSearchItems(results: VaultSearchResult[]): CommandPaletteItem<CommandPaletteAction>[] {
  return results.map((result, index) => ({
    id: `file-search:${result.id}`,
    section: 'files' as const,
    title: fileTitle(result.name),
    subtitle: fileLocation(result.id),
    meta: excerpt(result.excerpt, 140) ?? result.id,
    keywords: [result.id, result.name, result.excerpt],
    order: index,
    action: { kind: 'openFile', fileId: result.id },
  }));
}

function buildConversationContentSearchItems(results: ConversationContentSearchMatch[], query: string): CommandPaletteItem<CommandPaletteAction>[] {
  return results.map((result, index) => ({
    id: `conversation-search:${result.conversationId}:${result.blockId}`,
    section: result.isLive ? 'open' as const : 'archived' as const,
    title: result.title,
    subtitle: result.cwd,
    meta: excerpt(result.snippet, 160),
    keywords: [query, result.conversationId, result.cwd, result.snippet, result.blockId],
    order: index,
    action: result.isLive
      ? { kind: 'navigate', to: `/conversations/${encodeURIComponent(result.conversationId)}` }
      : { kind: 'restoreArchivedConversation', conversationId: result.conversationId },
  }));
}

function emptyStateCopy(scope: CommandPaletteScope, query: string): string {
  if (query.trim().length > 0) {
    switch (scope) {
      case 'files':
        return `No files match “${query}”.`;
      case 'search':
        return `Nothing matches “${query}”.`;
      case 'threads':
      default:
        return `No threads match “${query}”.`;
    }
  }

  switch (scope) {
    case 'files':
      return 'No knowledge files yet.';
    case 'search':
      return 'Type to search threads and files.';
    case 'threads':
    default:
      return 'No threads yet.';
  }
}

export function CommandPalette() {
  const navigate = useNavigate();
  const location = useLocation();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const requestedThreadBootstrapRef = useRef(false);
  const macPlatform = useMemo(() => isMacPlatform(), []);
  const { sessions } = useAppData();
  const {
    pinnedSessions,
    tabs,
    archivedSessions,
    openSession,
    loading: sessionsLoading,
    refetch,
  } = useConversations();
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<CommandPaletteScope>('threads');
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const [busyItemId, setBusyItemId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [archivedVisibleLimit, setArchivedVisibleLimit] = useState(THREADS_EMPTY_QUERY_PAGE_SIZE);
  const [conversationContentSearchResults, setConversationContentSearchResults] = useState<ConversationContentSearchMatch[]>([]);
  const [conversationContentSearchLoading, setConversationContentSearchLoading] = useState(false);
  const [conversationContentSearchError, setConversationContentSearchError] = useState<string | null>(null);
  const [vaultFiles, setVaultFiles] = useState<VaultEntry[]>([]);
  const [vaultFilesLoading, setVaultFilesLoading] = useState(false);
  const [vaultFilesError, setVaultFilesError] = useState<string | null>(null);
  const [vaultSearchResults, setVaultSearchResults] = useState<VaultSearchResult[]>([]);
  const [vaultSearchLoading, setVaultSearchLoading] = useState(false);
  const [vaultSearchError, setVaultSearchError] = useState<string | null>(null);

  const openThreadSessions = useMemo(
    () => [
      ...pinnedSessions.map((session) => ({ ...session, pinned: true } satisfies ScopedSessionMeta)),
      ...tabs,
    ],
    [pinnedSessions, tabs],
  );

  const openConversationItems = useMemo(
    () => buildConversationItems('open', openThreadSessions),
    [openThreadSessions],
  );
  const archivedConversationItems = useMemo(
    () => buildConversationItems('archived', archivedSessions),
    [archivedSessions],
  );
  const fileItems = useMemo(() => buildFileItems(vaultFiles), [vaultFiles]);
  const searchedFileItems = useMemo(() => buildFileSearchItems(vaultSearchResults), [vaultSearchResults]);
  const searchedConversationItems = useMemo(
    () => buildConversationContentSearchItems(conversationContentSearchResults, query.trim()),
    [conversationContentSearchResults, query],
  );
  const allItems = useMemo(() => {
    return selectCommandPaletteScopedItems({
      scope,
      query,
      openConversationItems,
      archivedConversationItems,
      fileItems,
      searchedConversationItems,
      searchedFileItems,
    });
  }, [archivedConversationItems, fileItems, openConversationItems, query, scope, searchedConversationItems, searchedFileItems]);

  const emptyQueryLimits = useMemo(
    () => (scope === 'threads' && query.trim().length === 0
      ? { archived: archivedVisibleLimit }
      : undefined),
    [archivedVisibleLimit, query, scope],
  );
  const groups = useMemo(
    () => searchCommandPaletteItems(allItems, { query, scope, emptyQueryLimits }),
    [allItems, emptyQueryLimits, query, scope],
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
    setArchivedVisibleLimit(THREADS_EMPTY_QUERY_PAGE_SIZE);
    setOpen(true);
  }, []);

  const loadVaultFiles = useCallback(async () => {
    setVaultFilesLoading(true);
    setVaultFilesError(null);
    try {
      const result = await api.vaultFiles();
      setVaultFiles(result.files);
    } catch (error) {
      setVaultFilesError(error instanceof Error ? error.message : String(error));
    } finally {
      setVaultFilesLoading(false);
    }
  }, []);

  useEffect(() => {
    function handleOpenPalette(event: Event) {
      const detail = (event as CustomEvent<OpenCommandPaletteDetail>).detail;
      openPalette(detail ?? {});
    }

    window.addEventListener(OPEN_COMMAND_PALETTE_EVENT, handleOpenPalette);
    return () => window.removeEventListener(OPEN_COMMAND_PALETTE_EVENT, handleOpenPalette);
  }, [openPalette]);

  useEffect(() => {
    if (sessions !== null || !open) {
      requestedThreadBootstrapRef.current = false;
    }

    if (!shouldBootstrapCommandPaletteThreads({
      open,
      scope,
      sessions,
      alreadyRequested: requestedThreadBootstrapRef.current,
    })) {
      return;
    }

    requestedThreadBootstrapRef.current = true;
    void refetch().catch(() => {
      // Keep the palette usable even if the eager thread bootstrap fails.
    });
  }, [open, refetch, scope, sessions]);

  useEffect(() => {
    if (!open) {
      return;
    }

    if (scope !== 'files' && scope !== 'search') {
      return;
    }

    if (vaultFilesLoading || vaultFiles.length > 0) {
      return;
    }

    void loadVaultFiles();
  }, [loadVaultFiles, open, scope, vaultFiles.length, vaultFilesLoading]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const offHandlers = [
      onKBEvent('kb:entries-changed', () => { void loadVaultFiles(); }),
      onKBEvent('kb:file-created', () => { void loadVaultFiles(); }),
      onKBEvent('kb:file-renamed', () => { void loadVaultFiles(); }),
      onKBEvent('kb:file-deleted', () => { void loadVaultFiles(); }),
    ];

    return () => offHandlers.forEach((off) => off());
  }, [loadVaultFiles, open]);

  const archivedGroup = useMemo(
    () => groups.find((group) => group.section === 'archived') ?? null,
    [groups],
  );
  const canLoadMoreArchivedThreads = Boolean(
    open
    && scope === 'threads'
    && query.trim().length === 0
    && archivedGroup
    && archivedGroup.total > archivedGroup.items.length,
  );

  useEffect(() => {
    if (!canLoadMoreArchivedThreads) {
      return;
    }

    const listElement = listRef.current;
    if (!listElement) {
      return;
    }

    if (listElement.scrollHeight > listElement.clientHeight + 8) {
      return;
    }

    setArchivedVisibleLimit((current) => current + THREADS_EMPTY_QUERY_PAGE_SIZE);
  }, [canLoadMoreArchivedThreads, groups]);

  const shouldSearchFilesByContent = open
    && scope === 'search'
    && query.trim().length > 0;

  const shouldSearchConversationsByContent = open
    && (scope === 'threads' || scope === 'search')
    && query.trim().length > 0;

  useEffect(() => {
    if (!shouldSearchConversationsByContent) {
      setConversationContentSearchLoading(false);
      setConversationContentSearchError(null);
      setConversationContentSearchResults([]);
      return;
    }

    let cancelled = false;
    setConversationContentSearchLoading(true);
    setConversationContentSearchError(null);

    const handle = window.setTimeout(() => {
      void api.conversationContentSearch(query.trim(), CONVERSATION_CONTENT_SEARCH_LIMIT)
        .then((result) => {
          if (cancelled) {
            return;
          }
          setConversationContentSearchResults(result.matches);
        })
        .catch((error) => {
          if (cancelled) {
            return;
          }
          setConversationContentSearchError(error instanceof Error ? error.message : String(error));
          setConversationContentSearchResults([]);
        })
        .finally(() => {
          if (!cancelled) {
            setConversationContentSearchLoading(false);
          }
        });
    }, CONVERSATION_CONTENT_SEARCH_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [query, shouldSearchConversationsByContent]);

  useEffect(() => {
    if (!shouldSearchFilesByContent) {
      setVaultSearchLoading(false);
      setVaultSearchError(null);
      setVaultSearchResults([]);
      return;
    }

    let cancelled = false;
    setVaultSearchLoading(true);
    setVaultSearchError(null);

    const handle = window.setTimeout(() => {
      void vaultApi.search(query.trim(), FILE_SEARCH_LIMIT)
        .then((result) => {
          if (cancelled) {
            return;
          }
          setVaultSearchResults(result.results);
        })
        .catch((error) => {
          if (cancelled) {
            return;
          }
          setVaultSearchError(error instanceof Error ? error.message : String(error));
          setVaultSearchResults([]);
        })
        .finally(() => {
          if (!cancelled) {
            setVaultSearchLoading(false);
          }
        });
    }, FILE_CONTENT_SEARCH_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [query, shouldSearchFilesByContent]);

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
        case 'openFile':
          navigate(buildCommandPaletteFileOpenRoute({
            pathname: location.pathname,
            search: location.search,
            hash: location.hash,
            layoutMode: readAppLayoutMode(),
            fileId: item.action.fileId,
          }));
          closePalette();
          return;
        default:
          return;
      }
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyItemId(null);
    }
  }, [closePalette, location.hash, location.pathname, location.search, navigate, openSession]);

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
    function handleKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.isComposing) {
        return;
      }

      const nextScope = resolveCommandPaletteHotkeyScope(event);

      if (nextScope) {
        if (!open && hasBlockingOverlayOpen()) {
          return;
        }

        event.preventDefault();
        if (nextScope === 'threads' && open) {
          closePalette();
        } else {
          openPalette({ scope: nextScope });
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
        setArchivedVisibleLimit(THREADS_EMPTY_QUERY_PAGE_SIZE);
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
    const threadSessionsLoading = isCommandPaletteThreadDataLoading({ sessions, sessionsLoading });

    if (threadSessionsLoading) {
      for (const section of COMMAND_PALETTE_SCOPE_SECTIONS[scope]) {
        if (section === 'open' || section === 'archived') {
          sections.add(section);
        }
      }
    }

    if (conversationContentSearchLoading && (scope === 'threads' || scope === 'search')) {
      sections.add('open');
      sections.add('archived');
    }

    if ((scope === 'files' || scope === 'search') && vaultFilesLoading && fileItems.length === 0) {
      sections.add('files');
    }

    if (scope === 'search' && vaultSearchLoading) {
      sections.add('files');
    }

    return [...sections];
  }, [conversationContentSearchLoading, fileItems.length, scope, sessions, sessionsLoading, vaultFilesLoading, vaultSearchLoading]);
  const showSectionHeaders = groups.length > 1;
  const searchPlaceholder = scope === 'threads'
    ? 'Search threads…'
    : scope === 'files'
      ? 'Open files…'
      : 'Search threads and files…';

  if (!open) {
    return null;
  }

  let runningIndex = -1;

  return (
    <div
      className="ui-overlay-backdrop"
      data-command-palette="true"
      style={{
        background: 'rgb(0 0 0 / 0.48)',
        backdropFilter: 'blur(3px)',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1.75rem',
      }}
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
                    setArchivedVisibleLimit(THREADS_EMPTY_QUERY_PAGE_SIZE);
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
                setArchivedVisibleLimit(THREADS_EMPTY_QUERY_PAGE_SIZE);
              }}
              placeholder={searchPlaceholder}
              aria-label="Search command palette"
              className="min-w-0 flex-1 bg-transparent text-[13px] text-primary placeholder:text-dim outline-none"
            />
            <span className="shrink-0 text-[10px] text-dim/70 font-mono">{macPlatform ? '⌘K' : 'Ctrl+K'}</span>
          </div>

          {actionError && <p className="pt-2 text-[11px] text-danger">{actionError}</p>}
        </div>

        <div
          ref={listRef}
          className="flex-1 overflow-y-auto px-2 py-2"
          style={{ overscrollBehavior: 'contain' }}
          onScroll={(event) => {
            if (!canLoadMoreArchivedThreads) {
              return;
            }

            const element = event.currentTarget;
            const distanceFromBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
            if (distanceFromBottom > 96) {
              return;
            }

            setArchivedVisibleLimit((current) => current + THREADS_EMPTY_QUERY_PAGE_SIZE);
          }}
        >
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

              {scope === 'threads' && query.trim().length === 0 && group.section === 'archived' && group.total > group.items.length ? (
                <p className="px-2.5 py-2 text-[11px] text-dim font-mono">Scroll to load older threads…</p>
              ) : null}
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

          {conversationContentSearchError && (scope === 'threads' || scope === 'search') && (
            <section className="pb-2 last:pb-0">
              <p className="px-2.5 py-3 text-[12px] text-danger">Failed to search thread contents: {conversationContentSearchError}</p>
            </section>
          )}

          {vaultFilesError && (scope === 'files' || scope === 'search') && (
            <section className="pb-2 last:pb-0">
              <p className="px-2.5 py-3 text-[12px] text-danger">Failed to load files: {vaultFilesError}</p>
            </section>
          )}

          {vaultSearchError && scope === 'search' && (
            <section className="pb-2 last:pb-0">
              <p className="px-2.5 py-3 text-[12px] text-danger">Failed to search file contents: {vaultSearchError}</p>
            </section>
          )}

          {visibleCount === 0 && loadingSections.length === 0 && !(conversationContentSearchError && (scope === 'threads' || scope === 'search')) && !(vaultFilesError && (scope === 'files' || scope === 'search')) && !(vaultSearchError && scope === 'search') && (
            <p className="px-4 py-10 text-center font-mono text-[12px] text-dim">{emptyStateCopy(scope, query)}</p>
          )}
        </div>
      </div>
    </div>
  );
}

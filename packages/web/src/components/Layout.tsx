import { Component, Suspense, lazy, useRef, useState, useCallback, useEffect, useMemo, type ReactNode } from 'react';
import { Link, Outlet, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { AlertToaster } from './AlertToaster';
import { CommandPalette } from './CommandPalette';
import { Sidebar } from './Sidebar';
import { DesktopTopBar } from './DesktopTopBar';
import { PageSearchBar } from './PageSearchBar';
import { VaultEditor } from './knowledge/VaultEditor';
import { clampPanelWidth, getRailInitialWidth, getRailLayoutPrefs, getRailMaxWidth } from '../ui-state/layoutSizing';
import { readAppLayoutMode, writeAppLayoutMode, type AppLayoutMode } from '../ui-state/appLayoutMode';
import { DesktopChromeContext, type DesktopRightRailControl } from '../desktop/desktopChromeContext';
import { SIDEBAR_WIDTH_STORAGE_KEY } from '../local/localSettings';
import { useAppData, useAppEvents } from '../app/contexts';
import { isDesktopShell, readDesktopEnvironment } from '../desktop/desktopBridge';
import type { DesktopEnvironmentState } from '../shared/types';
import { CONVERSATION_LAYOUT_CHANGED_EVENT, readConversationLayout } from '../session/sessionTabs';
import { buildConversationBootstrapVersionKey, fetchConversationBootstrapCached } from '../hooks/useConversationBootstrap';
import { primeSessionDetailCache } from '../hooks/useSessions';
import { useSessionStream } from '../hooks/useSessionStream';
import { clearWarmLiveSessionState, listWarmLiveSessionStateIds } from '../ui-state/liveSessionWarmth';
import { navigateKnowledgeFile } from '../knowledge/knowledgeNavigation';
import { cx } from './ui';

const DESKTOP_SHORTCUT_EVENT = 'personal-agent-desktop-shortcut';
const DESKTOP_NAVIGATE_EVENT = 'personal-agent-desktop-navigate';
const ContextRail = lazy(() => import('./ContextRail').then((module) => ({ default: module.ContextRail })));
const VaultFileTree = lazy(() => import('./knowledge/VaultFileTree').then((module) => ({ default: module.VaultFileTree })));
const WorkspaceExplorer = lazy(() => import('./workspace/WorkspaceExplorer').then((module) => ({ default: module.WorkspaceExplorer })));
const WORKSPACE_DRAFT_PROMPT_EVENT = 'pa:workspace-draft-prompt';

const WORKBENCH_DOCUMENT_WIDTH_STORAGE_KEY = 'pa:workbench-document-width';
const WORKBENCH_EXPLORER_WIDTH_STORAGE_KEY = 'pa:workbench-explorer-width';
const KNOWLEDGE_ICON_PATH = 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20 M4 4.5A2.5 2.5 0 0 1 6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15z';

type DesktopLayoutShortcutAction = 'toggle-sidebar' | 'toggle-right-rail' | 'toggle-layout-mode';

function isDesktopLayoutShortcutAction(value: unknown): value is DesktopLayoutShortcutAction {
  return value === 'toggle-sidebar' || value === 'toggle-right-rail' || value === 'toggle-layout-mode';
}

function isDesktopNavigateDetail(value: unknown): value is { route: string; replace?: boolean } {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const route = (value as { route?: unknown }).route;
  if (typeof route !== 'string' || !route.startsWith('/')) {
    return false;
  }

  const replace = (value as { replace?: unknown }).replace;
  return replace === undefined || typeof replace === 'boolean';
}

function hasBlockingOverlayOpen(): boolean {
  return document.querySelector('.ui-overlay-backdrop') !== null;
}

function resolveRouteContentBoundaryErrorMessage(error: unknown): string | null {
  if (error instanceof Error) {
    const message = error.message.trim();
    return message.length > 0 ? message : null;
  }

  if (typeof error === 'string') {
    const message = error.trim();
    return message.length > 0 ? message : null;
  }

  return null;
}

// ── Resize hook ───────────────────────────────────────────────────────────────

interface ResizeOptions {
  initial: number;
  min: number;
  max: number;
  storageKey: string;
  side: 'left' | 'right'; // which side of the handle the panel is on
}

function readStoredWidth(storageKey: string, initial: number, min: number): number {
  try {
    const stored = localStorage.getItem(storageKey);
    if (stored) {
      const parsed = parseInt(stored, 10);
      if (Number.isFinite(parsed)) {
        return Math.max(min, parsed);
      }
    }
  } catch { /* ignore */ }

  return Math.max(min, initial);
}

function useResize({ initial, min, max, storageKey, side }: ResizeOptions) {
  const [desiredWidth, setDesiredWidth] = useState(() => readStoredWidth(storageKey, initial, min));

  const dragging = useRef(false);
  const startX   = useRef(0);
  const startW   = useRef(0);
  const width = clampPanelWidth(desiredWidth, min, max);

  const persistWidth = useCallback((nextWidth: number) => {
    setDesiredWidth(nextWidth);
    try { localStorage.setItem(storageKey, String(nextWidth)); } catch { /* ignore */ }
  }, [storageKey]);

  const reset = useCallback(() => {
    persistWidth(Math.max(min, initial));
  }, [initial, min, persistWidth]);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    startX.current   = e.clientX;
    startW.current   = width;
    document.body.style.cursor    = 'col-resize';
    document.body.style.userSelect = 'none';

    function onMove(e: MouseEvent) {
      if (!dragging.current) return;
      const dx   = side === 'left' ? e.clientX - startX.current : startX.current - e.clientX;
      const next = clampPanelWidth(startW.current + dx, min, max);
      persistWidth(next);
    }

    function onUp() {
      dragging.current = false;
      document.body.style.cursor    = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup',   onUp);
    }

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',   onUp);
  }, [width, min, max, side, persistWidth]);

  useEffect(() => {
    setDesiredWidth(readStoredWidth(storageKey, initial, min));
  }, [storageKey, initial, min]);

  return { width, onMouseDown, reset };
}

// ── Resize handle ─────────────────────────────────────────────────────────────

function ResizeHandle({
  onMouseDown,
  onDoubleClick,
}: {
  onMouseDown: (e: React.MouseEvent) => void;
  onDoubleClick?: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      className="relative flex-shrink-0 w-[5px] cursor-col-resize select-none z-10 group"
      onMouseDown={onMouseDown}
      onDoubleClick={onDoubleClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Wider invisible hit area */}
      <div className="absolute inset-y-0 -left-1.5 -right-1.5" />
      {/* Visual line — thickens on hover */}
      <div
        className="absolute inset-y-0 left-[2px] w-[1px] transition-all duration-100"
        style={{
          background: hovered
            ? 'rgb(var(--color-accent) / 0.5)'
            : 'rgb(var(--color-border-subtle))',
          width: hovered ? '2px' : '1px',
          left: hovered ? '1.5px' : '2px',
        }}
      />
    </div>
  );
}

// ── Layout ────────────────────────────────────────────────────────────────────

class RouteContentBoundary extends Component<{
  resetKey: string;
  pathname: string;
  children: ReactNode;
}, {
  hasError: boolean;
  errorMessage: string | null;
}> {
  state = {
    hasError: false,
    errorMessage: null,
  };

  static getDerivedStateFromError(error: unknown): {
    hasError: boolean;
    errorMessage: string | null;
  } {
    return {
      hasError: true,
      errorMessage: resolveRouteContentBoundaryErrorMessage(error),
    };
  }

  componentDidUpdate(prevProps: Readonly<{ resetKey: string }>) {
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.setState({
        hasError: false,
        errorMessage: null,
      });
    }
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    const isConversationRoute = this.props.pathname.startsWith('/conversations/');
    const title = isConversationRoute ? 'Conversation unavailable' : 'This page hit an unexpected error';
    const body = isConversationRoute
      ? 'This conversation may be stale, missing, or temporarily broken. Open another conversation or start a new one.'
      : 'Try another page, then come back if needed.';
    const errorMessage = this.state.errorMessage;

    return (
      <main className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden select-text">
        <div className="flex h-full items-center justify-center px-8 py-10">
          <div className="max-w-lg rounded-2xl border border-border-subtle bg-surface px-6 py-6 shadow-sm">
            <p className="text-[11px] uppercase tracking-[0.18em] text-dim">Recovered from render error</p>
            <h1 className="mt-2 text-[22px] font-semibold text-primary">{title}</h1>
            <p className="mt-2 text-[13px] leading-6 text-secondary">{body}</p>
            {errorMessage ? (
              <div className="mt-4 rounded-2xl border border-amber-500/20 bg-amber-500/8 px-4 py-3">
                <p className="text-[11px] uppercase tracking-[0.16em] text-dim">Error details</p>
                <p className="mt-2 whitespace-pre-wrap break-words font-mono text-[12px] leading-5 text-primary">{errorMessage}</p>
              </div>
            ) : null}
            <div className="mt-5 flex flex-wrap gap-2">
              <Link to="/conversations/new" className="ui-action-button">New conversation</Link>
            </div>
          </div>
        </div>
      </main>
    );
  }
}

function useViewportWidth() {
  const [viewportWidth, setViewportWidth] = useState(() => (
    typeof window === 'undefined' ? 1440 : window.innerWidth
  ));

  useEffect(() => {
    function onResize() {
      setViewportWidth(window.innerWidth);
    }

    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return viewportWidth;
}

const ENABLE_OPEN_CONVERSATION_WARMING = true;
const OPEN_TAB_WARM_TAIL_BLOCKS = 120;
const OPEN_TAB_WARM_IDLE_TIMEOUT_MS = 1500;
const OPEN_TAB_WARM_START_DELAY_MS = 0;
const OPEN_TAB_WARM_INTERLEAVE_MS = 25;

type IdleCallbackHandle = number;
type IdleCallbackLike = (deadline: { didTimeout: boolean; timeRemaining(): number }) => void;

type IdleWindow = Window & typeof globalThis & {
  requestIdleCallback?: (callback: IdleCallbackLike, options?: { timeout: number }) => IdleCallbackHandle;
  cancelIdleCallback?: (handle: IdleCallbackHandle) => void;
};

function scheduleIdleWarmup(callback: () => void, timeoutMs: number): () => void {
  const idleWindow = window as IdleWindow;
  if (typeof idleWindow.requestIdleCallback === 'function') {
    const handle = idleWindow.requestIdleCallback(() => {
      callback();
    }, { timeout: timeoutMs });

    return () => {
      idleWindow.cancelIdleCallback?.(handle);
    };
  }

  const timer = window.setTimeout(callback, timeoutMs);
  return () => {
    window.clearTimeout(timer);
  };
}

function getActiveConversationId(pathname: string): string | null {
  const parts = pathname.split('/').filter(Boolean);
  return parts[0] === 'conversations' && parts[1] && parts[1] !== 'new'
    ? parts[1]
    : null;
}

function WarmLiveConversationSubscription({ sessionId }: { sessionId: string }) {
  useSessionStream(sessionId, {
    tailBlocks: OPEN_TAB_WARM_TAIL_BLOCKS,
    registerSurface: false,
  });

  return null;
}

function useWarmOpenConversationTabs(pathname: string): string[] {
  const { versions } = useAppEvents();
  const { sessions } = useAppData();
  const [layout, setLayout] = useState(() => readConversationLayout());
  const [warmingEnabled, setWarmingEnabled] = useState(false);
  const activeConversationId = getActiveConversationId(pathname);

  useEffect(() => {
    if (!ENABLE_OPEN_CONVERSATION_WARMING) {
      setWarmingEnabled(false);
      return;
    }

    return scheduleIdleWarmup(() => {
      setWarmingEnabled(true);
    }, OPEN_TAB_WARM_IDLE_TIMEOUT_MS);
  }, []);

  useEffect(() => {
    function handleConversationLayoutChanged() {
      setLayout(readConversationLayout());
    }

    window.addEventListener(CONVERSATION_LAYOUT_CHANGED_EVENT, handleConversationLayoutChanged);
    return () => window.removeEventListener(CONVERSATION_LAYOUT_CHANGED_EVENT, handleConversationLayoutChanged);
  }, []);

  const openConversationIds = useMemo(() => {
    const seen = new Set<string>();
    const ids: string[] = [];

    for (const id of [...layout.pinnedSessionIds, ...layout.sessionIds]) {
      if (!id || seen.has(id)) {
        continue;
      }

      seen.add(id);
      ids.push(id);
    }

    return ids;
  }, [layout.pinnedSessionIds, layout.sessionIds]);

  const sessionsById = useMemo(
    () => new Map((sessions ?? []).map((session) => [session.id, session] as const)),
    [sessions],
  );

  useEffect(() => {
    const openConversationIdSet = new Set(openConversationIds);
    for (const sessionId of listWarmLiveSessionStateIds()) {
      if (
        !ENABLE_OPEN_CONVERSATION_WARMING
        || !openConversationIdSet.has(sessionId)
        || (sessions !== null && sessionsById.get(sessionId)?.isLive !== true)
      ) {
        clearWarmLiveSessionState(sessionId);
      }
    }
  }, [openConversationIds, sessions, sessionsById]);

  useEffect(() => {
    const idsToWarm = openConversationIds
      .filter((conversationId) => conversationId !== activeConversationId)
      .filter((conversationId) => sessions !== null ? sessionsById.has(conversationId) : true);

    if (!warmingEnabled || idsToWarm.length === 0) {
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        const bootstrapVersionKey = buildConversationBootstrapVersionKey({
          sessionsVersion: versions.sessions,
          sessionFilesVersion: versions.sessionFiles,
        });

        for (const conversationId of idsToWarm) {
          if (cancelled) {
            return;
          }

          const bootstrapResult = await fetchConversationBootstrapCached(
            conversationId,
            { tailBlocks: OPEN_TAB_WARM_TAIL_BLOCKS },
            bootstrapVersionKey,
          ).catch(() => null);

          if (bootstrapResult?.sessionDetail) {
            primeSessionDetailCache(
              conversationId,
              bootstrapResult.sessionDetail,
              { tailBlocks: OPEN_TAB_WARM_TAIL_BLOCKS },
              versions.sessionFiles,
            );
          }

          if (cancelled) {
            return;
          }

          await new Promise((resolve) => window.setTimeout(resolve, OPEN_TAB_WARM_INTERLEAVE_MS));
        }
      })();
    }, OPEN_TAB_WARM_START_DELAY_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [activeConversationId, openConversationIds, sessions, sessionsById, versions.sessionFiles, versions.sessions, warmingEnabled]);

  if (!ENABLE_OPEN_CONVERSATION_WARMING) {
    return [];
  }

  return warmingEnabled
    ? openConversationIds
        .filter((conversationId) => conversationId !== activeConversationId)
        .filter((conversationId) => sessions === null || sessionsById.get(conversationId)?.isLive === true)
    : [];
}

function WorkbenchDocumentPane() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeFileId = searchParams.get('file') ?? null;
  const fileName = activeFileId
    ? activeFileId.split('/').filter(Boolean).pop()
    : undefined;

  const handleFileNavigate = useCallback((id: string) => {
    navigateKnowledgeFile(setSearchParams, id);
  }, [setSearchParams]);

  const handleFileRenamed = useCallback((oldId: string, newId: string) => {
    if (activeFileId === oldId) {
      navigateKnowledgeFile(setSearchParams, newId, { replace: true });
    }
  }, [activeFileId, setSearchParams]);

  if (!activeFileId) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center select-text">
        <div className="max-w-sm">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-steel/80">Workbench</p>
          <h2 className="mt-2 text-lg font-semibold text-primary text-balance">Open a Knowledge note</h2>
          <p className="mt-2 text-[13px] leading-6 text-secondary">
            Pick a file from the Knowledge sidebar to keep it beside the transcript.
          </p>
        </div>
      </div>
    );
  }

  return (
    <VaultEditor
      fileId={activeFileId}
      fileName={fileName}
      onFileNavigate={handleFileNavigate}
      onFileRenamed={handleFileRenamed}
    />
  );
}

function WorkbenchKnowledgeRail({ workspaceCwd }: { workspaceCwd: string | null }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [railMode, setRailMode] = useState<'knowledge' | 'files'>('knowledge');
  const activeFileId = searchParams.get('file') ?? null;
  const handleFileSelect = useCallback((id: string) => {
    navigateKnowledgeFile(setSearchParams, id);
  }, [setSearchParams]);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex shrink-0 flex-col gap-1 px-1.5 py-1.5">
        <button type="button" className={cx('ui-sidebar-nav-item w-full', railMode === 'knowledge' && 'ui-sidebar-nav-item-active')} title="Knowledge" onClick={() => setRailMode('knowledge')}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 opacity-70" aria-hidden="true">
            <path d={KNOWLEDGE_ICON_PATH} />
          </svg>
          <span className="flex-1">Knowledge</span>
        </button>
        <button type="button" className={cx('ui-sidebar-nav-item w-full', railMode === 'files' && 'ui-sidebar-nav-item-active')} title="File explorer" onClick={() => setRailMode('files')}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 opacity-70" aria-hidden="true">
            <path d="M3.75 6.75h5.379a1.5 1.5 0 0 1 1.06.44l2.122 2.12a1.5 1.5 0 0 0 1.06.44H20.25m-16.5-3A2.25 2.25 0 0 0 1.5 9v8.25A2.25 2.25 0 0 0 3.75 19.5h16.5a2.25 2.25 0 0 0 2.25-2.25v-5.25a2.25 2.25 0 0 0-2.25-2.25H3.75" />
          </svg>
          <span className="flex-1">File Explorer</span>
        </button>
      </div>
      {railMode === 'knowledge' ? (
        <div className="min-h-0 flex-1 overflow-hidden">
          <Suspense fallback={<div className="flex h-full items-center justify-center px-4 text-[12px] text-dim">Loading…</div>}>
            <VaultFileTree activeFileId={activeFileId} onFileSelect={handleFileSelect} />
          </Suspense>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-hidden">
          {workspaceCwd ? (
            <Suspense fallback={<div className="flex h-full items-center justify-center px-4 text-[12px] text-dim">Loading workspace…</div>}>
              <WorkspaceExplorer
                cwd={workspaceCwd}
                railOnly
                onDraftPrompt={(prompt) => {
                  window.dispatchEvent(new CustomEvent(WORKSPACE_DRAFT_PROMPT_EVENT, { detail: { prompt } }));
                }}
              />
            </Suspense>
          ) : (
            <div className="px-4 py-5 text-[12px] text-dim">Open a local conversation to browse its workspace.</div>
          )}
        </div>
      )}
    </div>
  );
}

export function Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { sessions } = useAppData();
  const [desktopEnvironment, setDesktopEnvironment] = useState<DesktopEnvironmentState | null>(null);
  const [appLayoutMode, setAppLayoutMode] = useState<AppLayoutMode>(() => readAppLayoutMode());
  const warmLiveConversationIds = useWarmOpenConversationTabs(location.pathname);
  const viewportWidth = useViewportWidth();
  const sidebar = useResize({ initial: 224, min: 160, max: 320, storageKey: SIDEBAR_WIDTH_STORAGE_KEY, side: 'left'  });
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const railMinWidth = 160;
  const railMaxWidth = getRailMaxWidth({
    viewportWidth,
    sidebarWidth: sidebar.width,
    railMinWidth,
    mainMinWidth: 320,
  });
  const railPrefs = getRailLayoutPrefs(location.pathname);
  const railInitialWidth = getRailInitialWidth({
    pathname: location.pathname,
    viewportWidth,
    sidebarWidth: sidebar.width,
    railMinWidth,
    railMaxWidth,
  });
  const rail = useResize({
    initial: railInitialWidth,
    min: railMinWidth,
    max: railMaxWidth,
    storageKey: railPrefs.storageKey,
    side: 'right',
  });
  const workbenchExplorer = useResize({
    initial: 276,
    min: 220,
    max: Math.max(220, Math.min(380, viewportWidth - sidebar.width - 760)),
    storageKey: WORKBENCH_EXPLORER_WIDTH_STORAGE_KEY,
    side: 'right',
  });
  const workbenchDocument = useResize({
    initial: 520,
    min: 360,
    max: Math.max(360, viewportWidth - sidebar.width - workbenchExplorer.width - 460),
    storageKey: WORKBENCH_DOCUMENT_WIDTH_STORAGE_KEY,
    side: 'right',
  });
  const [railOpen, setRailOpen] = useState(true);
  const pageSearchRootRef = useRef<HTMLDivElement | null>(null);
  const [registeredRightRailControl, setRegisteredRightRailControl] = useState<DesktopRightRailControl | null>(null);
  const railWidth = rail.width;
  const canShowContextRail = !(
    location.pathname.startsWith('/conversations')
    || location.pathname.startsWith('/nodes')
    || location.pathname.startsWith('/settings')
    || location.pathname.startsWith('/system')
    || location.pathname.startsWith('/automations')
    || location.pathname.startsWith('/knowledge')
  );

  useEffect(() => {
    let cancelled = false;

    readDesktopEnvironment()
      .then((environment) => {
        if (!cancelled) {
          setDesktopEnvironment(environment);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setDesktopEnvironment(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const showContextRail = canShowContextRail && railOpen;
  const showWorkbench = appLayoutMode === 'workbench' && (
    location.pathname.startsWith('/conversations')
    || location.pathname.startsWith('/automations')
  );
  const activeConversationId = getActiveConversationId(location.pathname);
  const activeWorkspaceCwd = activeConversationId
    ? sessions?.find((session) => session.id === activeConversationId && !session.remoteHostId)?.cwd ?? null
    : null;
  const activeRightRailControl = registeredRightRailControl ?? (canShowContextRail
    ? {
        railOpen: showContextRail,
        toggleRail: () => setRailOpen((current) => !current),
      }
    : null);

  const handleAppLayoutModeChange = useCallback((mode: AppLayoutMode) => {
    setAppLayoutMode(mode);
    writeAppLayoutMode(mode);
  }, []);

  useEffect(() => {
    function handleDesktopShortcut(event: Event) {
      if (hasBlockingOverlayOpen()) {
        return;
      }

      const action = (event as CustomEvent<{ action?: unknown }>).detail?.action;
      if (!isDesktopLayoutShortcutAction(action)) {
        return;
      }

      if (action === 'toggle-sidebar') {
        setSidebarOpen((current) => !current);
        return;
      }

      if (action === 'toggle-layout-mode') {
        handleAppLayoutModeChange(appLayoutMode === 'workbench' ? 'compact' : 'workbench');
        return;
      }

      activeRightRailControl?.toggleRail();
    }

    function handleDesktopNavigate(event: Event) {
      const detail = (event as CustomEvent<unknown>).detail;
      if (!isDesktopNavigateDetail(detail)) {
        return;
      }

      const nextRoute = detail.route.trim();
      const currentRoute = `${location.pathname}${location.search}${location.hash}`;
      if (!nextRoute || nextRoute === currentRoute) {
        return;
      }

      navigate(nextRoute, { replace: detail.replace === true });
    }

    window.addEventListener(DESKTOP_SHORTCUT_EVENT, handleDesktopShortcut);
    window.addEventListener(DESKTOP_NAVIGATE_EVENT, handleDesktopNavigate);
    return () => {
      window.removeEventListener(DESKTOP_SHORTCUT_EVENT, handleDesktopShortcut);
      window.removeEventListener(DESKTOP_NAVIGATE_EVENT, handleDesktopNavigate);
    };
  }, [activeRightRailControl, appLayoutMode, handleAppLayoutModeChange, location.hash, location.pathname, location.search, navigate]);

  return (
    <>
      <DesktopChromeContext.Provider value={{ setRightRailControl: setRegisteredRightRailControl }}>
        <div className="flex h-screen flex-col overflow-hidden bg-base text-primary select-none">
          <DesktopTopBar
            environment={desktopEnvironment}
            sidebarOpen={sidebarOpen}
            onToggleSidebar={() => setSidebarOpen((current) => !current)}
            showRailToggle={activeRightRailControl !== null}
            railOpen={activeRightRailControl?.railOpen ?? false}
            onToggleRail={activeRightRailControl?.toggleRail ?? (() => {})}
            layoutMode={appLayoutMode}
            onLayoutModeChange={handleAppLayoutModeChange}
          />
          <div className="flex min-h-0 flex-1 overflow-hidden">
          {sidebarOpen ? (
            <div style={{ width: sidebar.width }} className="flex-shrink-0 flex flex-col overflow-hidden bg-surface border-r border-border-subtle">
              <Sidebar hideKnowledgeNav={showWorkbench} />
            </div>
          ) : null}

          {sidebarOpen ? <ResizeHandle onMouseDown={sidebar.onMouseDown} /> : null}

          <div ref={pageSearchRootRef} className="flex min-w-0 flex-1 overflow-hidden">
            <RouteContentBoundary resetKey={`${location.pathname}${location.search}`} pathname={location.pathname}>
              <main className={showWorkbench
                ? 'flex-1 min-w-[360px] overflow-y-auto overflow-x-hidden select-text'
                : 'flex-1 min-w-0 overflow-y-auto overflow-x-hidden select-text'}>
                <Outlet />
              </main>

              {showWorkbench ? (
                <>
                  <ResizeHandle onMouseDown={workbenchDocument.onMouseDown} onDoubleClick={workbenchDocument.reset} />
                  <section
                    style={{ width: workbenchDocument.width }}
                    className="flex-shrink-0 overflow-hidden border-x border-border-subtle bg-base select-text"
                    aria-label="Workbench note"
                  >
                    <WorkbenchDocumentPane />
                  </section>
                  <ResizeHandle onMouseDown={workbenchExplorer.onMouseDown} onDoubleClick={workbenchExplorer.reset} />
                  <aside
                    style={{ width: workbenchExplorer.width }}
                    className="flex-shrink-0 overflow-hidden bg-surface select-text"
                    aria-label="Knowledge sidebar"
                  >
                    <WorkbenchKnowledgeRail workspaceCwd={activeWorkspaceCwd} />
                  </aside>
                </>
              ) : null}

              {showContextRail ? (
                <>
                  <ResizeHandle onMouseDown={rail.onMouseDown} onDoubleClick={rail.reset} />
                  <div style={{ width: railWidth }} className="relative z-10 flex-shrink-0 overflow-hidden select-text">
                    <Suspense fallback={<div className="flex h-full items-center justify-center px-4 text-[12px] text-dim">Loading…</div>}>
                      <ContextRail />
                    </Suspense>
                  </div>
                </>
              ) : null}
            </RouteContentBoundary>
          </div>
          </div>
        </div>
      </DesktopChromeContext.Provider>

      {warmLiveConversationIds.map((conversationId) => (
        <WarmLiveConversationSubscription key={conversationId} sessionId={conversationId} />
      ))}

      <AlertToaster />
      <PageSearchBar rootRef={pageSearchRootRef} desktopShell={desktopEnvironment?.isElectron ?? isDesktopShell()} />
      <CommandPalette />
    </>
  );
}

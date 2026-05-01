import { Component, Suspense, useRef, useState, useCallback, useEffect, useLayoutEffect, useMemo, type ReactNode } from 'react';
import { Link, Outlet, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { AlertToaster } from './AlertToaster';
import { CommandPalette } from './CommandPalette';
import { Sidebar } from './Sidebar';
import { DesktopTopBar } from './DesktopTopBar';
import { PageSearchBar } from './PageSearchBar';
import { VaultEditor } from './knowledge/VaultEditor';
import { ConversationArtifactRailContent, ConversationArtifactWorkbenchPane, useConversationArtifactSummaries } from './ConversationArtifactWorkbench';
import { ConversationCheckpointWorkbenchPane, ConversationDiffRailContent, useConversationCheckpointSummaries } from './ConversationCheckpointWorkbench';
import { ConversationRunsRailContent, ConversationRunWorkbenchPane, useConversationRunList } from './ConversationRunsWorkbench';
import { clampPanelWidth, getRailInitialWidth, getRailLayoutPrefs, getRailMaxWidth } from '../ui-state/layoutSizing';
import { APP_LAYOUT_MODE_CHANGED_EVENT, readAppLayoutMode, writeAppLayoutMode, type AppLayoutMode } from '../ui-state/appLayoutMode';
import { DesktopChromeContext, type DesktopRightRailControl } from '../desktop/desktopChromeContext';
import { SIDEBAR_WIDTH_STORAGE_KEY } from '../local/localSettings';
import { useAppData, useAppEvents } from '../app/contexts';
import { getDesktopBridge, isDesktopShell, readDesktopEnvironment, DESKTOP_SHOW_WORKBENCH_BROWSER_EVENT, DESKTOP_WORKBENCH_BROWSER_COMMENT_EVENT, type DesktopWorkbenchBrowserCommentTarget, type DesktopWorkbenchBrowserState } from '../desktop/desktopBridge';
import type { DesktopEnvironmentState, SessionMeta } from '../shared/types';
import { CONVERSATION_LAYOUT_CHANGED_EVENT, readConversationLayout } from '../session/sessionTabs';
import { buildConversationBootstrapVersionKey, fetchConversationBootstrapCached } from '../hooks/useConversationBootstrap';
import { primeSessionDetailCache } from '../hooks/useSessions';
import { useSessionStream } from '../hooks/useSessionStream';
import { clearWarmLiveSessionState, listWarmLiveSessionStateIds } from '../ui-state/liveSessionWarmth';
import { navigateKnowledgeFile } from '../knowledge/knowledgeNavigation';
import { getConversationArtifactIdFromSearch, setConversationArtifactIdInSearch } from '../conversation/conversationArtifacts';
import { getConversationCheckpointIdFromSearch, setConversationCheckpointIdInSearch } from '../conversation/conversationCheckpoints';
import { getConversationRunIdFromSearch, setConversationRunIdInSearch } from '../conversation/conversationRuns';
import { lazyRouteWithRecovery } from '../navigation/lazyRouteRecovery';
import { cx } from './ui';

const DESKTOP_SHORTCUT_EVENT = 'personal-agent-desktop-shortcut';
const DESKTOP_NAVIGATE_EVENT = 'personal-agent-desktop-navigate';
const WORKBENCH_CLOSE_ACTIVE_FILE_EVENT = 'pa:workbench-close-active-file';
const ContextRail = lazyRouteWithRecovery('layout-context-rail', () => import('./ContextRail').then((module) => ({ default: module.ContextRail })));
const VaultFileTree = lazyRouteWithRecovery('layout-vault-file-tree', () => import('./knowledge/VaultFileTree').then((module) => ({ default: module.VaultFileTree })));
const WorkspaceExplorer = lazyRouteWithRecovery('layout-workspace-explorer', () => import('./workspace/WorkspaceExplorer').then((module) => ({ default: module.WorkspaceExplorer })));
const WorkspaceFileDocument = lazyRouteWithRecovery('layout-workspace-file-document', () => import('./workspace/WorkspaceExplorer').then((module) => ({ default: module.WorkspaceFileDocument })));
const WORKSPACE_DRAFT_PROMPT_EVENT = 'pa:workspace-draft-prompt';
const WORKSPACE_REPLY_SELECTION_EVENT = 'pa:workspace-reply-selection';
const WORKBENCH_BROWSER_COMMENT_ADDED_EVENT = 'pa:workbench-browser-comment-added';

const WORKBENCH_DOCUMENT_WIDTH_STORAGE_KEY = 'pa:workbench-document-width';
const WORKBENCH_EXPLORER_WIDTH_STORAGE_KEY = 'pa:workbench-explorer-width';
const WORKBENCH_EXPLORER_OPEN_STORAGE_KEY = 'pa:workbench-explorer-open';
const KNOWLEDGE_ICON_PATH = 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20 M4 4.5A2.5 2.5 0 0 1 6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15z';

type DesktopLayoutShortcutAction = 'toggle-sidebar' | 'toggle-right-rail' | 'toggle-layout-mode' | 'cycle-view-mode';

type WorkbenchRailMode = 'knowledge' | 'files' | 'diffs' | 'artifacts' | 'browser' | 'runs';

function isDesktopLayoutShortcutAction(value: unknown): value is DesktopLayoutShortcutAction {
  return value === 'toggle-sidebar' || value === 'toggle-right-rail' || value === 'toggle-layout-mode' || value === 'cycle-view-mode';
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

export function resolveActiveWorkspaceCwd(
  sessions: SessionMeta[] | null | undefined,
  activeConversationId: string | null | undefined,
): string | null {
  if (!activeConversationId) {
    return null;
  }

  const session = sessions?.find((entry) => entry.id === activeConversationId) ?? null;
  if (!session || session.remoteHostId?.trim() || session.remoteConversationId?.trim()) {
    return null;
  }

  return session.cwd ?? null;
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

export function readStoredPanelWidth(storageKey: string, initial: number, min: number, storage: Pick<Storage, 'getItem'> = localStorage): number {
  try {
    const stored = storage.getItem(storageKey);
    if (stored) {
      const normalized = stored.trim();
      const parsed = /^\d+$/.test(normalized) ? Number.parseInt(normalized, 10) : Number.NaN;
      if (Number.isSafeInteger(parsed)) {
        return Math.max(min, parsed);
      }
    }
  } catch { /* ignore */ }

  return Math.max(min, initial);
}

export function readStoredWorkbenchExplorerOpen(storage: Pick<Storage, 'getItem'> = localStorage): boolean {
  try {
    return storage.getItem(WORKBENCH_EXPLORER_OPEN_STORAGE_KEY) !== 'false';
  } catch {
    return true;
  }
}

function writeStoredWorkbenchExplorerOpen(open: boolean, storage: Pick<Storage, 'setItem'> = localStorage): void {
  try { storage.setItem(WORKBENCH_EXPLORER_OPEN_STORAGE_KEY, open ? 'true' : 'false'); } catch { /* ignore */ }
}

export function shouldShowConversationRunsTab(runCount: number): boolean {
  return runCount > 0;
}

function useResize({ initial, min, max, storageKey, side }: ResizeOptions) {
  const [desiredWidth, setDesiredWidth] = useState(() => readStoredPanelWidth(storageKey, initial, min));

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
    setDesiredWidth(readStoredPanelWidth(storageKey, initial, min));
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

function WorkbenchDocumentPane({
  conversationId,
  artifactId,
  checkpointId,
  runId,
  workspaceFile,
  activeTool,
  onActiveToolChange,
  onMissingCheckpoint,
}: {
  conversationId: string | null;
  artifactId: string | null;
  checkpointId: string | null;
  runId: string | null;
  workspaceFile: { cwd: string; path: string } | null;
  activeTool: WorkbenchRailMode;
  onActiveToolChange: (mode: WorkbenchRailMode) => void;
  onMissingCheckpoint: () => void;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const { sessions, tasks } = useAppData();
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

  if (conversationId && artifactId) {
    return <ConversationArtifactWorkbenchPane conversationId={conversationId} artifactId={artifactId} />;
  }

  if (activeTool === 'diffs' && conversationId) {
    return <ConversationCheckpointWorkbenchPane conversationId={conversationId} checkpointId={checkpointId} onMissingCheckpoint={onMissingCheckpoint} />;
  }

  if (activeTool === 'runs') {
    return <ConversationRunWorkbenchPane conversationId={conversationId} runId={runId} lookups={{ sessions, tasks }} />;
  }

  if (activeTool === 'browser') {
    return <WorkbenchBrowserTab conversationId={conversationId} onClose={() => onActiveToolChange('knowledge')} />;
  }

  if (!activeFileId && workspaceFile) {
    return (
      <Suspense fallback={<div className="flex h-full items-center justify-center px-4 text-[12px] text-dim">Opening file…</div>}>
        <WorkspaceFileDocument
          cwd={workspaceFile.cwd}
          path={workspaceFile.path}
          onReplyWithSelection={(selection) => {
            window.dispatchEvent(new CustomEvent(WORKSPACE_REPLY_SELECTION_EVENT, { detail: selection }));
          }}
        />
      </Suspense>
    );
  }

  if (!activeFileId) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center select-text">
        <div className="max-w-sm">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-steel/80">Workbench</p>
          <h2 className="mt-2 text-lg font-semibold text-primary text-balance">Open a file</h2>
          <p className="mt-2 text-[13px] leading-6 text-secondary">
            Pick a file from the right rail to keep it beside the transcript.
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

function hasBlockingHtmlModal(): boolean {
  if (typeof document === 'undefined') {
    return false;
  }

  return Boolean(document.querySelector('[aria-modal="true"]'));
}

function WorkbenchBrowserTab({ conversationId, onClose }: { conversationId: string | null; onClose: () => void }) {
  const browserHostRef = useRef<HTMLDivElement | null>(null);
  const urlInputRef = useRef<HTMLInputElement | null>(null);
  const closedRef = useRef(false);
  const [urlDraft, setUrlDraft] = useState('https://www.google.com/');
  const [state, setState] = useState<DesktopWorkbenchBrowserState | null>(null);
  const [status, setStatus] = useState('');
  const [commentDraft, setCommentDraft] = useState<null | { target: DesktopWorkbenchBrowserCommentTarget; text: string }>(null);
  const [pendingMarkers, setPendingMarkers] = useState<Array<{ id: string; target: DesktopWorkbenchBrowserCommentTarget; comment: string }>>([]);
  const bridge = getDesktopBridge();
  const browserSessionKey = conversationId ?? 'draft';

  const syncUrlDraftFromBrowserState = useCallback((nextState: DesktopWorkbenchBrowserState) => {
    if (document.activeElement === urlInputRef.current) {
      return;
    }

    setUrlDraft(nextState.url === 'about:blank' ? '' : nextState.url);
  }, []);

  const syncBounds = useCallback(() => {
    const host = browserHostRef.current;
    if (!bridge || !host || closedRef.current) {
      return;
    }

    if (hasBlockingHtmlModal()) {
      void bridge.setWorkbenchBrowserBounds({ visible: false, sessionKey: browserSessionKey })
        .then((nextState) => {
          if (nextState) {
            setState(nextState);
            syncUrlDraftFromBrowserState(nextState);
          }
        })
        .catch((error) => setStatus(error instanceof Error ? error.message : String(error)));
      return;
    }

    const rect = host.getBoundingClientRect();
    const visible = rect.width >= 24 && rect.height >= 24;
    void bridge.setWorkbenchBrowserBounds({
      visible,
      sessionKey: browserSessionKey,
      ...(visible ? {
        bounds: {
          x: Math.round(rect.left),
          y: Math.round(rect.top),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        },
      } : {}),
      }).then((nextState) => {
      if (nextState) {
        setState(nextState);
        syncUrlDraftFromBrowserState(nextState);
      }
    }).catch((error) => setStatus(error instanceof Error ? error.message : String(error)));
  }, [bridge, browserSessionKey, syncUrlDraftFromBrowserState]);

  useLayoutEffect(() => {
    syncBounds();
    const observer = typeof ResizeObserver !== 'undefined' && browserHostRef.current
      ? new ResizeObserver(syncBounds)
      : null;
    if (browserHostRef.current) {
      observer?.observe(browserHostRef.current);
    }
    window.addEventListener('resize', syncBounds);
    const modalObserver = typeof MutationObserver !== 'undefined'
      ? new MutationObserver(syncBounds)
      : null;
    modalObserver?.observe(document.body, {
      attributes: true,
      attributeFilter: ['aria-modal'],
      childList: true,
      subtree: true,
    });
    const timer = window.setInterval(syncBounds, 1000);

    return () => {
      closedRef.current = true;
      observer?.disconnect();
      modalObserver?.disconnect();
      window.removeEventListener('resize', syncBounds);
      window.clearInterval(timer);
      void bridge?.setWorkbenchBrowserBounds({ visible: false, sessionKey: browserSessionKey, deactivate: true }).catch(() => undefined);
    };
  }, [bridge, browserSessionKey, syncBounds]);

  useEffect(() => {
    function handleBrowserCommentTarget(event: Event) {
      const target = (event as CustomEvent<DesktopWorkbenchBrowserCommentTarget>).detail;
      if (!target || typeof target.url !== 'string') {
        return;
      }
      setCommentDraft({ target, text: '' });
    }

    window.addEventListener(DESKTOP_WORKBENCH_BROWSER_COMMENT_EVENT, handleBrowserCommentTarget);
    return () => window.removeEventListener(DESKTOP_WORKBENCH_BROWSER_COMMENT_EVENT, handleBrowserCommentTarget);
  }, []);

  async function runBrowserCommand(command: () => Promise<DesktopWorkbenchBrowserState | null | undefined>) {
    if (!bridge) {
      setStatus('Workbench browser is only available in the Electron desktop app.');
      return;
    }
    try {
      setStatus('Working…');
      const nextState = await command();
      if (nextState) {
        setState(nextState);
        setUrlDraft(nextState.url === 'about:blank' ? '' : nextState.url);
      }
      setStatus('');
      syncBounds();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  function handleCloseBrowser() {
    closedRef.current = true;
    setStatus('');
    setCommentDraft(null);
    void bridge?.setWorkbenchBrowserBounds({ visible: false, sessionKey: browserSessionKey, deactivate: true }).catch(() => undefined);
    onClose();
  }

  function saveCommentDraft() {
    const text = commentDraft?.text.trim();
    if (!commentDraft || !text) {
      setCommentDraft(null);
      return;
    }

    const id = `browser-comment-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    window.dispatchEvent(new CustomEvent(WORKBENCH_BROWSER_COMMENT_ADDED_EVENT, {
      detail: {
        id,
        createdAt: new Date().toISOString(),
        target: commentDraft.target,
        comment: text,
      },
    }));
    setPendingMarkers((current) => [...current, { id, target: commentDraft.target, comment: text }]);
    setCommentDraft(null);
    setStatus('Browser comment added to composer.');
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <form
        className="flex shrink-0 items-center gap-2 border-b border-border-subtle px-3 py-2"
        onSubmit={(event) => {
          event.preventDefault();
          void runBrowserCommand(() => bridge!.navigateWorkbenchBrowser({ url: urlDraft, sessionKey: browserSessionKey }));
        }}
      >
        <button type="button" className="rounded px-1.5 py-1 text-[12px] text-secondary hover:bg-surface hover:text-primary disabled:opacity-35" disabled={!state?.canGoBack} onClick={() => void runBrowserCommand(() => bridge!.goBackWorkbenchBrowser({ sessionKey: browserSessionKey }))}>←</button>
        <button type="button" className="rounded px-1.5 py-1 text-[12px] text-secondary hover:bg-surface hover:text-primary disabled:opacity-35" disabled={!state?.canGoForward} onClick={() => void runBrowserCommand(() => bridge!.goForwardWorkbenchBrowser({ sessionKey: browserSessionKey }))}>→</button>
        <button type="button" className="rounded px-1.5 py-1 text-[13px] text-secondary hover:bg-surface hover:text-primary" aria-label={state?.loading ? 'Stop loading' : 'Reload'} title={state?.loading ? 'Stop loading' : 'Reload'} onClick={() => void runBrowserCommand(() => state?.loading ? bridge!.stopWorkbenchBrowser({ sessionKey: browserSessionKey }) : bridge!.reloadWorkbenchBrowser({ sessionKey: browserSessionKey }))}>{state?.loading ? '×' : '↻'}</button>
        <input
          ref={urlInputRef}
          className="min-w-0 flex-1 rounded-md border border-border-subtle bg-surface px-2 py-1 text-[12px] text-primary outline-none focus:border-accent/60"
          value={urlDraft}
          onChange={(event) => setUrlDraft(event.target.value)}
          placeholder="https://example.com"
        />
        <button
          type="button"
          className="rounded px-1.5 py-1 text-[13px] text-secondary hover:bg-surface hover:text-primary"
          aria-label="Close browser"
          title="Close browser"
          onClick={handleCloseBrowser}
        >
          ×
        </button>
      </form>
      <div ref={browserHostRef} className="relative min-h-[220px] flex-1 overflow-hidden bg-base">
        {!bridge ? (
          <div className="flex h-full items-center justify-center px-4 text-center text-[12px] leading-5 text-dim">
            Browser embedding is only available in the Electron desktop app.
          </div>
        ) : null}
        {pendingMarkers.map((marker, index) => {
          const hostWidth = browserHostRef.current?.clientWidth ?? 320;
          const hostHeight = browserHostRef.current?.clientHeight ?? 320;
          const x = Math.max(6, Math.min(marker.target.viewportRect.x, hostWidth - 28));
          const y = Math.max(6, Math.min(marker.target.viewportRect.y, hostHeight - 28));
          return (
            <div
              key={marker.id}
              className="pointer-events-none absolute z-10 flex h-6 w-6 items-center justify-center rounded-full border border-accent/70 bg-accent text-[11px] font-semibold text-black shadow-lg"
              style={{ left: x, top: y }}
              title={marker.comment}
              aria-hidden="true"
            >
              {index + 1}
            </div>
          );
        })}
        {commentDraft ? (
          <div
            className="absolute z-20 w-[min(18rem,calc(100%-1rem))] rounded-xl border border-accent/30 bg-surface/95 p-2 shadow-2xl backdrop-blur"
            style={{
              left: Math.max(8, Math.min(commentDraft.target.viewportRect.x, (browserHostRef.current?.clientWidth ?? 320) - 296)),
              top: Math.max(8, Math.min(commentDraft.target.viewportRect.y + Math.min(commentDraft.target.viewportRect.height, 28), (browserHostRef.current?.clientHeight ?? 320) - 156)),
            }}
          >
            <p className="truncate text-[11px] font-medium text-primary">Comment on {commentDraft.target.role ?? 'element'}{commentDraft.target.accessibleName ? `: ${commentDraft.target.accessibleName}` : ''}</p>
            <textarea
              className="mt-2 min-h-[72px] w-full resize-none rounded-md border border-border-subtle bg-base px-2 py-1.5 text-[12px] leading-5 text-primary outline-none focus:border-accent/60"
              value={commentDraft.text}
              onChange={(event) => setCommentDraft((current) => current ? { ...current, text: event.target.value } : null)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault();
                  setCommentDraft(null);
                }
                if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                  event.preventDefault();
                  saveCommentDraft();
                }
              }}
              autoFocus
              placeholder="What should the agent know about this?"
            />
            <div className="mt-2 flex justify-end gap-1.5">
              <button type="button" className="ui-toolbar-button px-2 py-1 text-[11px]" onClick={() => setCommentDraft(null)}>Cancel</button>
              <button type="button" className="ui-action-button px-2 py-1 text-[11px]" onClick={saveCommentDraft}>Add comment</button>
            </div>
          </div>
        ) : null}
      </div>
      {status ? <div className="shrink-0 border-t border-border-subtle px-3 py-1.5 text-[11px] text-dim">{status}</div> : null}
    </div>
  );
}

function WorkbenchKnowledgeRail({
  conversationId,
  workspaceCwd,
  activeArtifactId,
  activeCheckpointId,
  activeRunId,
  activeWorkspaceFile,
  activeTool,
  onActiveToolChange,
  onCheckpointSelect,
  onRunSelect,
  onWorkspaceFileSelect,
  onWorkspaceFileClear,
}: {
  conversationId: string | null;
  workspaceCwd: string | null;
  activeArtifactId: string | null;
  activeCheckpointId: string | null;
  activeRunId: string | null;
  activeWorkspaceFile: { cwd: string; path: string } | null;
  activeTool: WorkbenchRailMode;
  onActiveToolChange: (mode: WorkbenchRailMode) => void;
  onCheckpointSelect: (checkpointId: string | null) => void;
  onRunSelect: (runId: string | null) => void;
  onWorkspaceFileSelect: (file: { cwd: string; path: string }) => void;
  onWorkspaceFileClear: () => void;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const { runs, sessions, tasks } = useAppData();
  const { artifacts, loading: artifactsLoading, error: artifactsError } = useConversationArtifactSummaries(conversationId);
  const { checkpoints, loading: checkpointsLoading, error: checkpointsError } = useConversationCheckpointSummaries(conversationId);
  const runLookups = useMemo(() => ({ sessions, tasks }), [sessions, tasks]);
  const connectedRuns = useConversationRunList(conversationId, runs, runLookups);
  const showRunsTab = shouldShowConversationRunsTab(connectedRuns.length) || activeRunId !== null;
  const activeFileId = searchParams.get('file') ?? null;
  const handleFileSelect = useCallback((id: string) => {
    onActiveToolChange('knowledge');
    onWorkspaceFileClear();
    onCheckpointSelect(null);
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.delete('artifact');
      next.delete('checkpoint');
      next.delete('run');
      next.set('file', id);
      return next;
    });
  }, [onActiveToolChange, onCheckpointSelect, onWorkspaceFileClear, setSearchParams]);
  const handleWorkspaceFileSelect = useCallback((file: { cwd: string; path: string }) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.delete('file');
      next.delete('artifact');
      next.delete('checkpoint');
      next.delete('run');
      return next;
    });
    onCheckpointSelect(null);
    onWorkspaceFileSelect(file);
  }, [onCheckpointSelect, onWorkspaceFileSelect, setSearchParams]);
  const handleKnowledgeModeSelect = useCallback(() => {
    onActiveToolChange('knowledge');
    onWorkspaceFileClear();
    onCheckpointSelect(null);
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.delete('artifact');
      next.delete('checkpoint');
      next.delete('run');
      return next;
    });
  }, [onActiveToolChange, onCheckpointSelect, onWorkspaceFileClear, setSearchParams]);
  const handleFileExplorerModeSelect = useCallback(() => {
    onActiveToolChange('files');
    onWorkspaceFileClear();
    onCheckpointSelect(null);
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.delete('file');
      next.delete('artifact');
      next.delete('checkpoint');
      next.delete('run');
      return next;
    });
  }, [onActiveToolChange, onCheckpointSelect, onWorkspaceFileClear, setSearchParams]);
  const handleDiffsModeSelect = useCallback(() => {
    const nextCheckpointId = activeCheckpointId ?? checkpoints[0]?.id ?? null;
    onActiveToolChange('diffs');
    onWorkspaceFileClear();
    onCheckpointSelect(nextCheckpointId);
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.delete('file');
      next.delete('artifact');
      next.delete('run');
      if (nextCheckpointId) {
        next.set('checkpoint', nextCheckpointId);
      } else {
        next.delete('checkpoint');
      }
      return next;
    });
  }, [activeCheckpointId, checkpoints, onActiveToolChange, onCheckpointSelect, onWorkspaceFileClear, setSearchParams]);
  const handleArtifactsModeSelect = useCallback(() => {
    const firstArtifactId = activeArtifactId ?? artifacts[0]?.id ?? null;
    onActiveToolChange('artifacts');
    onWorkspaceFileClear();
    onCheckpointSelect(null);
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.delete('file');
      next.delete('checkpoint');
      next.delete('run');
      if (firstArtifactId) {
        next.set('artifact', firstArtifactId);
      }
      return next;
    });
  }, [activeArtifactId, artifacts, onActiveToolChange, onCheckpointSelect, onWorkspaceFileClear, setSearchParams]);
  const handleBrowserModeSelect = useCallback(() => {
    onActiveToolChange('browser');
    onWorkspaceFileClear();
  }, [onActiveToolChange, onWorkspaceFileClear]);
  const handleRunsModeSelect = useCallback(() => {
    onActiveToolChange('runs');
    onWorkspaceFileClear();
    onCheckpointSelect(null);
    const nextRunId = activeRunId;
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.delete('file');
      next.delete('artifact');
      next.delete('checkpoint');
      return new URLSearchParams(setConversationRunIdInSearch(next.toString(), nextRunId));
    });
  }, [activeRunId, onActiveToolChange, onCheckpointSelect, onWorkspaceFileClear, setSearchParams]);
  const handleCheckpointSelect = useCallback((checkpointId: string) => {
    onActiveToolChange('diffs');
    onWorkspaceFileClear();
    onCheckpointSelect(checkpointId);
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.delete('file');
      next.delete('artifact');
      next.delete('run');
      return new URLSearchParams(setConversationCheckpointIdInSearch(next.toString(), checkpointId));
    });
  }, [onActiveToolChange, onCheckpointSelect, onWorkspaceFileClear, setSearchParams]);
  const handleArtifactSelect = useCallback((artifactId: string) => {
    onActiveToolChange('artifacts');
    onWorkspaceFileClear();
    onCheckpointSelect(null);
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.delete('file');
      next.delete('checkpoint');
      next.delete('run');
      return new URLSearchParams(setConversationArtifactIdInSearch(next.toString(), artifactId));
    });
  }, [onActiveToolChange, onCheckpointSelect, onWorkspaceFileClear, setSearchParams]);
  const handleRunSelect = useCallback((runId: string) => {
    onActiveToolChange('runs');
    onWorkspaceFileClear();
    onCheckpointSelect(null);
    onRunSelect(runId);
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.delete('file');
      next.delete('artifact');
      next.delete('checkpoint');
      return new URLSearchParams(setConversationRunIdInSearch(next.toString(), runId));
    });
  }, [onActiveToolChange, onCheckpointSelect, onRunSelect, onWorkspaceFileClear, setSearchParams]);

  useEffect(() => {
    if (activeArtifactId && artifacts.length > 0) {
      onActiveToolChange('artifacts');
      onWorkspaceFileClear();
    }
  }, [activeArtifactId, artifacts.length, onActiveToolChange, onWorkspaceFileClear]);

  useEffect(() => {
    if (activeCheckpointId && checkpoints.some((checkpoint) => checkpoint.id === activeCheckpointId)) {
      onActiveToolChange('diffs');
      onWorkspaceFileClear();
    }
  }, [activeCheckpointId, checkpoints, onActiveToolChange, onWorkspaceFileClear]);

  useEffect(() => {
    if (activeRunId) {
      onActiveToolChange('runs');
      onWorkspaceFileClear();
    }
  }, [activeRunId, onActiveToolChange, onWorkspaceFileClear]);

  useEffect(() => {
    if (activeTool !== 'runs' || showRunsTab) {
      return;
    }

    onActiveToolChange('knowledge');
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.delete('run');
      return next;
    }, { replace: true });
  }, [activeTool, onActiveToolChange, setSearchParams, showRunsTab]);

  useEffect(() => {
    if (activeTool === 'artifacts' && !artifactsLoading && artifacts.length === 0) {
      onActiveToolChange('knowledge');
      setSearchParams((current) => {
        const next = new URLSearchParams(current);
        next.delete('artifact');
        return next;
      }, { replace: true });
    }
  }, [activeTool, artifacts.length, artifactsLoading, onActiveToolChange, setSearchParams]);

  useEffect(() => {
    if (activeTool === 'diffs' && !activeCheckpointId && !checkpointsLoading && checkpoints.length === 0) {
      onActiveToolChange('knowledge');
      onCheckpointSelect(null);
      setSearchParams((current) => {
        const next = new URLSearchParams(current);
        next.delete('checkpoint');
        return next;
      }, { replace: true });
    }
  }, [activeCheckpointId, activeTool, checkpoints.length, checkpointsLoading, onActiveToolChange, onCheckpointSelect, setSearchParams]);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex shrink-0 flex-col gap-1 px-1.5 py-1.5">
        <button type="button" className={cx('ui-sidebar-nav-item w-full text-left', activeTool === 'knowledge' && 'ui-sidebar-nav-item-active')} title="Knowledge" onClick={handleKnowledgeModeSelect}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 opacity-70" aria-hidden="true">
            <path d={KNOWLEDGE_ICON_PATH} />
          </svg>
          <span className="flex-1 text-left">Knowledge</span>
        </button>
        <button type="button" className={cx('ui-sidebar-nav-item w-full text-left', activeTool === 'files' && 'ui-sidebar-nav-item-active')} title="File explorer" onClick={handleFileExplorerModeSelect}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 opacity-70" aria-hidden="true">
            <path d="M3.75 6.75h5.379a1.5 1.5 0 0 1 1.06.44l2.122 2.12a1.5 1.5 0 0 0 1.06.44H20.25m-16.5-3A2.25 2.25 0 0 0 1.5 9v8.25A2.25 2.25 0 0 0 3.75 19.5h16.5a2.25 2.25 0 0 0 2.25-2.25v-5.25a2.25 2.25 0 0 0-2.25-2.25H3.75" />
          </svg>
          <span className="flex-1 text-left">File Explorer</span>
        </button>
        {checkpoints.length > 0 || activeCheckpointId ? (
          <button type="button" className={cx('ui-sidebar-nav-item w-full text-left', activeTool === 'diffs' && 'ui-sidebar-nav-item-active')} title="Diffs" onClick={handleDiffsModeSelect}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 opacity-70" aria-hidden="true">
              <path d="M7.5 4.5v15" />
              <path d="M16.5 4.5v15" />
              <path d="M4.5 8.25h6" />
              <path d="M13.5 15.75h6" />
              <path d="M6 6.75 4.5 8.25 6 9.75" />
              <path d="M18 14.25l1.5 1.5-1.5 1.5" />
            </svg>
            <span className="flex-1 text-left">Diffs</span>
          </button>
        ) : null}
        {artifacts.length > 0 ? (
          <button type="button" className={cx('ui-sidebar-nav-item w-full text-left', activeTool === 'artifacts' && 'ui-sidebar-nav-item-active')} title="Artifacts" onClick={handleArtifactsModeSelect}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 opacity-70" aria-hidden="true">
              <path d="M6.75 3.75h7.5L19.5 9v11.25H6.75V3.75Z" />
              <path d="M14.25 3.75V9h5.25" />
              <path d="M9.75 13.5h6" />
              <path d="M9.75 16.5h4.5" />
            </svg>
            <span className="flex-1 text-left">Artifacts</span>
          </button>
        ) : null}
        <button type="button" className={cx('ui-sidebar-nav-item w-full text-left', activeTool === 'browser' && 'ui-sidebar-nav-item-active')} title="Browser" onClick={handleBrowserModeSelect}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 opacity-70" aria-hidden="true">
            <circle cx="12" cy="12" r="8.25" />
            <path d="M3.75 12h16.5" />
            <path d="M12 3.75c2.1 2.25 3.15 5 3.15 8.25S14.1 18 12 20.25" />
            <path d="M12 3.75C9.9 6 8.85 8.75 8.85 12S9.9 18 12 20.25" />
          </svg>
          <span className="flex-1 text-left">Browser</span>
        </button>
        {showRunsTab ? (
          <button type="button" className={cx('ui-sidebar-nav-item w-full text-left', activeTool === 'runs' && 'ui-sidebar-nav-item-active')} title="Runs" onClick={handleRunsModeSelect}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 opacity-70" aria-hidden="true">
              <path d="M4.5 6.75h15v10.5h-15z" />
              <path d="m8 10 2 2-2 2" />
              <path d="M12 14h4" />
            </svg>
            <span className="flex-1 text-left">Runs</span>
          </button>
        ) : null}
      </div>
      {activeTool === 'knowledge' ? (
        <div className="min-h-0 flex-1 overflow-hidden">
          <Suspense fallback={<div className="flex h-full items-center justify-center px-4 text-[12px] text-dim">Loading…</div>}>
            <VaultFileTree activeFileId={activeFileId} onFileSelect={handleFileSelect} />
          </Suspense>
        </div>
      ) : activeTool === 'files' ? (
        <div className="min-h-0 flex-1 overflow-hidden">
          {workspaceCwd ? (
            <Suspense fallback={<div className="flex h-full items-center justify-center px-4 text-[12px] text-dim">Loading workspace…</div>}>
              <WorkspaceExplorer
                cwd={workspaceCwd}
                railOnly
                activeFilePath={activeWorkspaceFile?.cwd === workspaceCwd ? activeWorkspaceFile.path : null}
                onOpenFile={handleWorkspaceFileSelect}
                onDraftPrompt={(prompt) => {
                  window.dispatchEvent(new CustomEvent(WORKSPACE_DRAFT_PROMPT_EVENT, { detail: { prompt } }));
                }}
              />
            </Suspense>
          ) : (
            <div className="px-4 py-5 text-[12px] text-dim">Open a local conversation to browse its workspace.</div>
          )}
        </div>
      ) : activeTool === 'artifacts' ? (
        <div className="min-h-0 flex-1 overflow-hidden">
          <ConversationArtifactRailContent
            artifacts={artifacts}
            activeArtifactId={activeArtifactId}
            loading={artifactsLoading}
            error={artifactsError}
            onOpenArtifact={handleArtifactSelect}
          />
        </div>
      ) : activeTool === 'diffs' ? (
        <div className="min-h-0 flex-1 overflow-hidden">
          <ConversationDiffRailContent
            checkpoints={checkpoints}
            activeCheckpointId={activeCheckpointId}
            loading={checkpointsLoading}
            error={checkpointsError}
            onOpenCheckpoint={handleCheckpointSelect}
          />
        </div>
      ) : activeTool === 'runs' ? (
        <div className="min-h-0 flex-1 overflow-hidden">
          <ConversationRunsRailContent
            conversationId={conversationId}
            runs={runs}
            activeRunId={activeRunId}
            lookups={runLookups}
            onOpenRun={handleRunSelect}
          />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 items-center justify-center px-4 text-center text-[12px] leading-5 text-dim">
          Browser is open in the workbench pane. Right-click the page to comment on an element.
        </div>
      )}
    </div>
  );
}

export function Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { sessions } = useAppData();
  const [desktopEnvironment, setDesktopEnvironment] = useState<DesktopEnvironmentState | null>(null);
  const [appLayoutMode, setAppLayoutMode] = useState<AppLayoutMode>(() => readAppLayoutMode());
  const [activeWorkspaceFile, setActiveWorkspaceFile] = useState<{ cwd: string; path: string } | null>(null);
  const [activeWorkbenchTool, setActiveWorkbenchTool] = useState<WorkbenchRailMode>('knowledge');
  const [selectedCheckpointByConversation, setSelectedCheckpointByConversation] = useState<Record<string, string | null>>({});
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
  const [workbenchExplorerOpen, setWorkbenchExplorerOpen] = useState(() => readStoredWorkbenchExplorerOpen());
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

  useEffect(() => {
    function handleAppLayoutModeChanged() {
      setAppLayoutMode(readAppLayoutMode());
    }

    window.addEventListener(APP_LAYOUT_MODE_CHANGED_EVENT, handleAppLayoutModeChanged);
    window.addEventListener('storage', handleAppLayoutModeChanged);
    return () => {
      window.removeEventListener(APP_LAYOUT_MODE_CHANGED_EVENT, handleAppLayoutModeChanged);
      window.removeEventListener('storage', handleAppLayoutModeChanged);
    };
  }, []);

  const zenMode = searchParams.get('view') === 'zen';
  const effectiveSidebarOpen = !zenMode && sidebarOpen;
  const showContextRail = !zenMode && canShowContextRail && railOpen;
  const showWorkbench = !zenMode && appLayoutMode === 'workbench' && (
    location.pathname.startsWith('/conversations')
    || location.pathname.startsWith('/automations')
  );
  const activeConversationId = getActiveConversationId(location.pathname);
  const activeWorkbenchKnowledgeFileId = showWorkbench ? searchParams.get('file') : null;
  const activeWorkbenchArtifactId = showWorkbench && activeConversationId ? getConversationArtifactIdFromSearch(location.search) : null;
  const activeWorkbenchCheckpointFromSearch = showWorkbench && activeConversationId ? getConversationCheckpointIdFromSearch(location.search) : null;
  const activeWorkbenchRunFromSearch = showWorkbench && activeConversationId ? getConversationRunIdFromSearch(location.search) : null;
  const activeWorkbenchCheckpointId = activeConversationId
    ? activeWorkbenchCheckpointFromSearch ?? selectedCheckpointByConversation[activeConversationId] ?? null
    : null;
  const activeWorkbenchRunId = activeConversationId ? activeWorkbenchRunFromSearch : null;
  const activeWorkspaceCwd = resolveActiveWorkspaceCwd(sessions, activeConversationId);
  const clearActiveWorkspaceFile = useCallback(() => setActiveWorkspaceFile(null), []);
  const setActiveConversationCheckpoint = useCallback((checkpointId: string | null) => {
    if (!activeConversationId) {
      return;
    }

    setSelectedCheckpointByConversation((current) => ({
      ...current,
      [activeConversationId]: checkpointId,
    }));
  }, [activeConversationId]);

  const clearActiveConversationCheckpoint = useCallback(() => {
    setActiveConversationCheckpoint(null);
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.delete('checkpoint');
      return next;
    }, { replace: true });
  }, [setActiveConversationCheckpoint, setSearchParams]);

  const setActiveConversationRun = useCallback((_runId: string | null) => {
    // Run selection is URL-backed.
  }, []);

  useEffect(() => {
    setActiveWorkspaceFile((current) => (
      current && current.cwd === activeWorkspaceCwd ? current : null
    ));
  }, [activeWorkspaceCwd]);

  useEffect(() => {
    if (!activeConversationId || !activeWorkbenchCheckpointFromSearch) {
      return;
    }

    setSelectedCheckpointByConversation((current) => ({
      ...current,
      [activeConversationId]: activeWorkbenchCheckpointFromSearch,
    }));
    setActiveWorkbenchTool('diffs');
    setActiveWorkspaceFile(null);
  }, [activeConversationId, activeWorkbenchCheckpointFromSearch]);

  useEffect(() => {
    if (!activeConversationId || !activeWorkbenchRunFromSearch) {
      return;
    }

    setActiveWorkbenchTool('runs');
    setActiveWorkspaceFile(null);
  }, [activeConversationId, activeWorkbenchRunFromSearch]);

  useEffect(() => {
    function handleWorkbenchCloseActiveFile() {
      if (activeWorkbenchArtifactId) {
        setSearchParams((current) => {
          const next = new URLSearchParams(current);
          next.delete('artifact');
          return next;
        }, { replace: true });
        return;
      }

      if (activeWorkbenchKnowledgeFileId) {
        setSearchParams((current) => {
          const next = new URLSearchParams(current);
          next.delete('file');
          return next;
        }, { replace: true });
        return;
      }

      if (activeWorkbenchCheckpointId) {
        clearActiveConversationCheckpoint();
        return;
      }

      if (activeWorkbenchRunId) {
        setSearchParams((current) => {
          const next = new URLSearchParams(current);
          next.delete('run');
          return next;
        }, { replace: true });
        return;
      }

      setActiveWorkspaceFile(null);
    }

    window.addEventListener(WORKBENCH_CLOSE_ACTIVE_FILE_EVENT, handleWorkbenchCloseActiveFile);
    return () => window.removeEventListener(WORKBENCH_CLOSE_ACTIVE_FILE_EVENT, handleWorkbenchCloseActiveFile);
  }, [activeWorkbenchArtifactId, activeWorkbenchCheckpointId, activeWorkbenchKnowledgeFileId, activeWorkbenchRunId, clearActiveConversationCheckpoint, setSearchParams]);

  const toggleWorkbenchExplorer = useCallback(() => {
    setWorkbenchExplorerOpen((current) => {
      const next = !current;
      writeStoredWorkbenchExplorerOpen(next);
      return next;
    });
  }, []);

  const activeRightRailControl = showWorkbench
    ? {
        railOpen: workbenchExplorerOpen,
        toggleRail: toggleWorkbenchExplorer,
      }
    : registeredRightRailControl ?? (canShowContextRail
    ? {
        railOpen: showContextRail,
        toggleRail: () => setRailOpen((current) => !current),
      }
    : null);

  const handleAppLayoutModeChange = useCallback((mode: AppLayoutMode) => {
    setAppLayoutMode(mode);
    writeAppLayoutMode(mode);
  }, []);

  const handleZenModeChange = useCallback((enabled: boolean) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (enabled) {
        next.set('view', 'zen');
      } else {
        next.delete('view');
      }
      return next;
    }, { replace: true });
  }, [setSearchParams]);

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

      if (action === 'cycle-view-mode') {
        if (zenMode) {
          handleZenModeChange(false);
          handleAppLayoutModeChange('compact');
          return;
        }

        if (appLayoutMode === 'compact') {
          handleAppLayoutModeChange('workbench');
          return;
        }

        handleZenModeChange(true);
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

    function handleShowWorkbenchBrowser() {
      if (zenMode) {
        handleZenModeChange(false);
      }
      handleAppLayoutModeChange('workbench');
      setActiveWorkbenchTool('browser');
    }

    window.addEventListener(DESKTOP_SHORTCUT_EVENT, handleDesktopShortcut);
    window.addEventListener(DESKTOP_NAVIGATE_EVENT, handleDesktopNavigate);
    window.addEventListener(DESKTOP_SHOW_WORKBENCH_BROWSER_EVENT, handleShowWorkbenchBrowser);
    return () => {
      window.removeEventListener(DESKTOP_SHORTCUT_EVENT, handleDesktopShortcut);
      window.removeEventListener(DESKTOP_NAVIGATE_EVENT, handleDesktopNavigate);
      window.removeEventListener(DESKTOP_SHOW_WORKBENCH_BROWSER_EVENT, handleShowWorkbenchBrowser);
    };
  }, [activeRightRailControl, appLayoutMode, handleAppLayoutModeChange, handleZenModeChange, location.hash, location.pathname, location.search, navigate, zenMode]);

  return (
    <>
      <DesktopChromeContext.Provider value={{ setRightRailControl: setRegisteredRightRailControl }}>
        <div className="flex h-screen flex-col overflow-hidden bg-base text-primary select-none">
          <DesktopTopBar
            environment={desktopEnvironment}
            sidebarOpen={effectiveSidebarOpen}
            onToggleSidebar={() => setSidebarOpen((current) => !current)}
            showRailToggle={showWorkbench && activeRightRailControl !== null}
            railOpen={activeRightRailControl?.railOpen ?? false}
            onToggleRail={activeRightRailControl?.toggleRail ?? (() => {})}
            layoutMode={appLayoutMode}
            onLayoutModeChange={handleAppLayoutModeChange}
            onZenModeChange={handleZenModeChange}
            zenMode={zenMode}
          />
          <div className="flex min-h-0 flex-1 overflow-hidden">
          {effectiveSidebarOpen ? (
            <div style={{ width: sidebar.width }} className="flex-shrink-0 flex flex-col overflow-hidden bg-surface border-r border-border-subtle">
              <Sidebar hideKnowledgeNav={showWorkbench} />
            </div>
          ) : null}

          {effectiveSidebarOpen ? <ResizeHandle onMouseDown={sidebar.onMouseDown} /> : null}

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
                    data-workbench-document-pane="true"
                    data-has-open-file={activeWorkbenchKnowledgeFileId || activeWorkbenchArtifactId || activeWorkbenchCheckpointId || activeWorkbenchRunId || activeWorkspaceFile || activeWorkbenchTool === 'browser' ? 'true' : 'false'}
                  >
                    <WorkbenchDocumentPane
                      conversationId={activeConversationId}
                      artifactId={activeWorkbenchArtifactId}
                      checkpointId={activeWorkbenchCheckpointId}
                      runId={activeWorkbenchRunId}
                      workspaceFile={activeWorkspaceFile}
                      activeTool={activeWorkbenchTool}
                      onActiveToolChange={setActiveWorkbenchTool}
                      onMissingCheckpoint={clearActiveConversationCheckpoint}
                    />
                  </section>
                  {workbenchExplorerOpen ? (
                    <>
                      <ResizeHandle onMouseDown={workbenchExplorer.onMouseDown} onDoubleClick={workbenchExplorer.reset} />
                      <aside
                        style={{ width: workbenchExplorer.width }}
                        className="flex-shrink-0 overflow-hidden bg-surface select-text"
                        aria-label="Workbench sidebar"
                      >
                        <WorkbenchKnowledgeRail
                          conversationId={activeConversationId}
                          workspaceCwd={activeWorkspaceCwd}
                          activeArtifactId={activeWorkbenchArtifactId}
                          activeCheckpointId={activeWorkbenchCheckpointId}
                          activeRunId={activeWorkbenchRunId}
                          activeWorkspaceFile={activeWorkspaceFile}
                          activeTool={activeWorkbenchTool}
                          onActiveToolChange={setActiveWorkbenchTool}
                          onCheckpointSelect={setActiveConversationCheckpoint}
                          onRunSelect={setActiveConversationRun}
                          onWorkspaceFileSelect={setActiveWorkspaceFile}
                          onWorkspaceFileClear={clearActiveWorkspaceFile}
                        />
                      </aside>
                    </>
                  ) : null}
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

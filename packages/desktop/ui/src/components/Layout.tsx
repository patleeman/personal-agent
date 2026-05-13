import { Component, type ReactNode, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate, useSearchParams } from 'react-router-dom';

import { useAppData, useAppEvents } from '../app/contexts';
import { api } from '../client/api';
import { OPEN_COMMAND_PALETTE_EVENT, type OpenCommandPaletteDetail } from '../commands/commandPaletteEvents';
import { getConversationArtifactIdFromSearch, setConversationArtifactIdInSearch } from '../conversation/conversationArtifacts';
import { getConversationCheckpointIdFromSearch, setConversationCheckpointIdInSearch } from '../conversation/conversationCheckpoints';
import { getConversationRunIdFromSearch, setConversationRunIdInSearch } from '../conversation/conversationRuns';
import { DESKTOP_SHOW_WORKBENCH_BROWSER_EVENT, isDesktopShell, readDesktopEnvironment } from '../desktop/desktopBridge';
import { DesktopChromeContext, type DesktopRightRailControl } from '../desktop/desktopChromeContext';
import { ExtensionModalHost } from '../extensions/ExtensionModalHost';
import { EXTENSION_REGISTRY_CHANGED_EVENT } from '../extensions/extensionRegistryEvents';
import { findMatchingExtensionKeybinding } from '../extensions/keybindings';
import { NativeExtensionSurfaceHost } from '../extensions/NativeExtensionSurfaceHost';
import {
  type ExtensionKeybindingRegistration,
  type ExtensionRightToolPanelSurface,
  type ExtensionSurfaceSummary,
  getExtensionViewPlacement,
  isExtensionRightToolPanelSurface,
  isNativeExtensionPageSurface,
  isNativeExtensionRightRailSurface,
  isNativeExtensionWorkbenchSurface,
  type NativeExtensionViewSummary,
} from '../extensions/types';
import { useExtensionRegistry } from '../extensions/useExtensionRegistry';
import { SIDEBAR_WIDTH_STORAGE_KEY } from '../local/localSettings';
import { lazyRouteWithRecovery } from '../navigation/lazyRouteRecovery';
import { routeIsKnowledge, routeMatchesPrefix, routeSupportsContextRail, routeSupportsWorkbench } from '../navigation/routeRegistry';
import type { DesktopEnvironmentState, SessionMeta } from '../shared/types';
import { useRouteTelemetry } from '../telemetry/appTelemetry';
import { APP_LAYOUT_MODE_CHANGED_EVENT, type AppLayoutMode, readAppLayoutMode, writeAppLayoutMode } from '../ui-state/appLayoutMode';
import { clampPanelWidth, getRailInitialWidth, getRailLayoutPrefs, getRailMaxWidth } from '../ui-state/layoutSizing';
import { useConversationArtifactSummaries } from './conversationArtifactHooks';
import { UNCOMMITTED_SENTINEL, useConversationCheckpointSummaries, useUncommittedDiff } from './conversationCheckpointHooks';
import { useConversationRunList } from './conversationRunHooks';
import { DesktopTopBar } from './DesktopTopBar';
import { NotificationBell } from './notifications/NotificationBell';
import { NotificationCenter } from './notifications/NotificationCenter';
import { NotificationProvider } from './notifications/notificationStore';
import { NotificationToaster } from './notifications/NotificationToaster';
import { PageSearchBar } from './PageSearchBar';
import { Sidebar } from './Sidebar';
import { cx } from './ui';
import { iconGlyphForExtensionSurface, labelForExtensionToolPanel, shouldRenderExtensionToolPanelInWorkbenchNav } from './workbenchNav';

const DESKTOP_SHORTCUT_EVENT = 'personal-agent-desktop-shortcut';
const DESKTOP_NAVIGATE_EVENT = 'personal-agent-desktop-navigate';
const CommandPalette = lazyRouteWithRecovery('layout-command-palette', () =>
  import('./CommandPalette').then((module) => ({ default: module.CommandPalette })),
);
const WORKBENCH_CLOSE_ACTIVE_FILE_EVENT = 'pa:workbench-close-active-file';
const ContextRail = lazyRouteWithRecovery('layout-context-rail', () =>
  import('./ContextRail').then((module) => ({ default: module.ContextRail })),
);
const WorkspaceExplorer = lazyRouteWithRecovery('layout-workspace-explorer', () =>
  import('./workspace/WorkspaceExplorer').then((module) => ({ default: module.WorkspaceExplorer })),
);
const ConversationArtifactRailContent = lazyRouteWithRecovery('layout-artifact-rail', () =>
  import('./ConversationArtifactWorkbench').then((module) => ({ default: module.ConversationArtifactRailContent })),
);
const ConversationArtifactWorkbenchPane = lazyRouteWithRecovery('layout-artifact-workbench', () =>
  import('./ConversationArtifactWorkbench').then((module) => ({ default: module.ConversationArtifactWorkbenchPane })),
);
const ConversationDiffRailContent = lazyRouteWithRecovery('layout-diff-rail', () =>
  import('./ConversationCheckpointWorkbench').then((module) => ({ default: module.ConversationDiffRailContent })),
);
const ConversationCheckpointWorkbenchPane = lazyRouteWithRecovery('layout-checkpoint-workbench', () =>
  import('./ConversationCheckpointWorkbench').then((module) => ({ default: module.ConversationCheckpointWorkbenchPane })),
);
const ConversationBackgroundWorkRailContent = lazyRouteWithRecovery('layout-background-work-rail', () =>
  import('./ConversationBackgroundWorkWorkbench').then((module) => ({ default: module.ConversationBackgroundWorkRailContent })),
);
const ConversationBackgroundWorkWorkbenchPane = lazyRouteWithRecovery('layout-background-work-workbench', () =>
  import('./ConversationBackgroundWorkWorkbench').then((module) => ({ default: module.ConversationBackgroundWorkWorkbenchPane })),
);

const WORKBENCH_DOCUMENT_WIDTH_STORAGE_KEY = 'pa:workbench-document-width';
const WORKBENCH_EXPLORER_WIDTH_STORAGE_KEY = 'pa:workbench-explorer-width';
const WORKBENCH_EXPLORER_OPEN_STORAGE_KEY = 'pa:workbench-explorer-open';

type DesktopLayoutShortcutAction =
  | 'toggle-sidebar'
  | 'toggle-right-rail'
  | 'toggle-layout-mode'
  | 'show-conversation-mode'
  | 'show-workbench-mode';

type BuiltInWorkbenchRailMode = 'files' | 'diffs' | 'artifacts' | 'browser' | 'runs';
type ExtensionWorkbenchRailMode = `extension:${string}:${string}`;
type WorkbenchRailMode = BuiltInWorkbenchRailMode | ExtensionWorkbenchRailMode;

function extensionToolPanelMode(
  surface: (ExtensionRightToolPanelSurface & ExtensionSurfaceSummary) | NativeExtensionViewSummary,
): ExtensionWorkbenchRailMode {
  return `extension:${surface.extensionId}:${surface.id}`;
}

export function resolveWorkbenchRailMode(
  builtInMode: BuiltInWorkbenchRailMode,
  surface: ((ExtensionRightToolPanelSurface & ExtensionSurfaceSummary) | NativeExtensionViewSummary) | null | undefined,
): WorkbenchRailMode {
  return surface ? extensionToolPanelMode(surface) : builtInMode;
}

export function resolveDefaultDiffCheckpointId({
  activeCheckpointId,
  firstCheckpointId,
  hasUncommittedDiff,
}: {
  activeCheckpointId: string | null;
  firstCheckpointId: string | null;
  hasUncommittedDiff: boolean;
}): string | null {
  return hasUncommittedDiff ? UNCOMMITTED_SENTINEL : (activeCheckpointId ?? firstCheckpointId);
}

function parseExtensionToolPanelMode(mode: WorkbenchRailMode): { extensionId: string; surfaceId: string } | null {
  if (!mode.startsWith('extension:')) return null;
  const [, extensionId, surfaceId] = mode.split(':');
  return extensionId && surfaceId ? { extensionId, surfaceId } : null;
}

export function resolveActiveExtensionWorkbenchSurface({
  activeWorkbenchTool,
  extensionRightToolPanels,
  extensionWorkbenchSurfaces,
}: {
  activeWorkbenchTool: WorkbenchRailMode;
  extensionRightToolPanels: Array<(ExtensionRightToolPanelSurface & ExtensionSurfaceSummary) | NativeExtensionViewSummary>;
  extensionWorkbenchSurfaces: NativeExtensionViewSummary[];
}): NativeExtensionViewSummary | null {
  const parsed = parseExtensionToolPanelMode(activeWorkbenchTool);
  const activeRailSurface = parsed
    ? extensionRightToolPanels.find((surface) => surface.extensionId === parsed.extensionId && surface.id === parsed.surfaceId)
    : activeWorkbenchTool === 'files'
      ? (extensionRightToolPanels.find((surface) => surface.extensionId === 'system-files') ?? null)
      : null;
  if (!activeRailSurface || !('detailView' in activeRailSurface) || typeof activeRailSurface.detailView !== 'string') return null;
  return (
    extensionWorkbenchSurfaces.find(
      (surface) => surface.extensionId === activeRailSurface.extensionId && surface.id === activeRailSurface.detailView,
    ) ?? null
  );
}

export function isDiffsRailMode(mode: WorkbenchRailMode): boolean {
  const parsed = parseExtensionToolPanelMode(mode);
  return mode === 'diffs' || parsed?.extensionId === 'system-diffs';
}

function isDesktopLayoutShortcutAction(value: unknown): value is DesktopLayoutShortcutAction {
  return (
    value === 'toggle-sidebar' ||
    value === 'toggle-right-rail' ||
    value === 'toggle-layout-mode' ||
    value === 'show-conversation-mode' ||
    value === 'show-workbench-mode'
  );
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
  return session?.cwd ?? null;
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

export function readStoredPanelWidth(
  storageKey: string,
  initial: number,
  min: number,
  storage: Pick<Storage, 'getItem'> = localStorage,
): number {
  try {
    const stored = storage.getItem(storageKey);
    if (stored) {
      const normalized = stored.trim();
      const parsed = /^\d+$/.test(normalized) ? Number.parseInt(normalized, 10) : Number.NaN;
      if (Number.isSafeInteger(parsed)) {
        return Math.max(min, parsed);
      }
    }
  } catch {
    /* ignore */
  }

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
  try {
    storage.setItem(WORKBENCH_EXPLORER_OPEN_STORAGE_KEY, open ? 'true' : 'false');
  } catch {
    /* ignore */
  }
}

export function shouldShowConversationRunsTab(input: {
  runCount: number;
  activeRunId?: string | null;
  activeRunConnected?: boolean;
  runsLoaded?: boolean;
}): boolean {
  if (input.runCount > 0) {
    return true;
  }

  if (!input.activeRunId) {
    return false;
  }

  return input.runsLoaded === false || input.activeRunConnected === true;
}

export function shouldResetWorkbenchRunsOnConversationChange(input: {
  previousConversationId: string | null;
  activeConversationId: string | null;
  activeTool: WorkbenchRailMode;
  activeRunId: string | null;
}): boolean {
  if (input.previousConversationId === input.activeConversationId) {
    return false;
  }

  return input.activeTool === 'runs' || input.activeRunId !== null;
}

export function clearWorkbenchOnlySearchParamsForCompact(search: string): string {
  const next = new URLSearchParams(search);
  next.delete('checkpoint');
  next.delete('run');
  return next.toString();
}

function useResize({ initial, min, max, storageKey, side }: ResizeOptions) {
  const [desiredWidth, setDesiredWidth] = useState(() => readStoredPanelWidth(storageKey, initial, min));

  const dragging = useRef(false);
  const startX = useRef(0);
  const startW = useRef(0);
  const width = clampPanelWidth(desiredWidth, min, max);

  const persistWidth = useCallback(
    (nextWidth: number) => {
      setDesiredWidth(nextWidth);
      try {
        localStorage.setItem(storageKey, String(nextWidth));
      } catch {
        /* ignore */
      }
    },
    [storageKey],
  );

  const reset = useCallback(() => {
    persistWidth(Math.max(min, initial));
  }, [initial, min, persistWidth]);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragging.current = true;
      startX.current = e.clientX;
      startW.current = width;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';

      function onMove(e: MouseEvent) {
        if (!dragging.current) return;
        const dx = side === 'left' ? e.clientX - startX.current : startX.current - e.clientX;
        const next = clampPanelWidth(startW.current + dx, min, max);
        persistWidth(next);
      }

      function onUp() {
        dragging.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      }

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    [width, min, max, side, persistWidth],
  );

  useEffect(() => {
    setDesiredWidth(readStoredPanelWidth(storageKey, initial, min));
  }, [storageKey, initial, min]);

  return { width, onMouseDown, reset };
}

// ── Resize handle ─────────────────────────────────────────────────────────────

function ResizeHandle({ onMouseDown, onDoubleClick }: { onMouseDown: (e: React.MouseEvent) => void; onDoubleClick?: () => void }) {
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
      <div className="absolute inset-y-0 -left-0.5 -right-0.5" />
      {/* Visual line — thickens on hover */}
      <div
        className="absolute inset-y-0 left-[2px] w-[1px] transition-all duration-100"
        style={{
          background: hovered ? 'rgb(var(--color-accent) / 0.5)' : 'rgb(var(--color-border-subtle))',
          width: hovered ? '2px' : '1px',
          left: hovered ? '1.5px' : '2px',
        }}
      />
    </div>
  );
}

// ── Layout ────────────────────────────────────────────────────────────────────

class RouteContentBoundary extends Component<
  {
    resetKey: string;
    pathname: string;
    children: ReactNode;
  },
  {
    hasError: boolean;
    errorMessage: string | null;
  }
> {
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

  componentDidCatch(error: unknown, _errorInfo: { componentStack?: string }) {
    window.dispatchEvent(
      new CustomEvent('pa-notification', {
        detail: {
          message: 'A page error was recovered',
          type: 'error',
          details: error instanceof Error ? (error.stack ?? error.message) : String(error ?? ''),
          source: 'core',
        },
      }),
    );
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

    const isConversationRoute = routeMatchesPrefix(this.props.pathname, '/conversations');
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
              <Link to="/conversations/new" className="ui-action-button">
                New conversation
              </Link>
            </div>
          </div>
        </div>
      </main>
    );
  }
}

function useViewportWidth() {
  const [viewportWidth, setViewportWidth] = useState(() => (typeof window === 'undefined' ? 1440 : window.innerWidth));

  useEffect(() => {
    function onResize() {
      setViewportWidth(window.innerWidth);
    }

    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return viewportWidth;
}

function getActiveConversationId(pathname: string): string | null {
  const parts = pathname.split('/').filter(Boolean);
  return parts[0] === 'conversations' && parts[1] && parts[1] !== 'new' ? parts[1] : null;
}

function WorkbenchDocumentPane({
  conversationId,
  artifactId,
  checkpointId,
  runId,
  activeTool,
  onMissingCheckpoint,
  scrollToCheckpointFile,
  workspaceCwd,
  extensionWorkbenchSurface,
}: {
  conversationId: string | null;
  artifactId: string | null;
  checkpointId: string | null;
  runId: string | null;
  activeTool: WorkbenchRailMode;
  onMissingCheckpoint: () => void;
  scrollToCheckpointFile?: string | null;
  workspaceCwd?: string | null;
  extensionWorkbenchSurface: NativeExtensionViewSummary | null;
}) {
  const location = useLocation();
  const { sessions, tasks } = useAppData();

  if (activeTool === 'artifacts' && conversationId && artifactId) {
    return (
      <Suspense fallback={<div className="px-4 py-3 text-[12px] text-dim">Loading artifact…</div>}>
        <ConversationArtifactWorkbenchPane conversationId={conversationId} artifactId={artifactId} />
      </Suspense>
    );
  }

  if (activeTool === 'diffs' && conversationId) {
    return (
      <Suspense fallback={<div className="px-4 py-3 text-[12px] text-dim">Loading diff…</div>}>
        <ConversationCheckpointWorkbenchPane
          conversationId={conversationId}
          checkpointId={checkpointId}
          onMissingCheckpoint={onMissingCheckpoint}
          scrollToFile={scrollToCheckpointFile}
          workspaceCwd={workspaceCwd}
        />
      </Suspense>
    );
  }

  if (activeTool === 'runs') {
    return (
      <Suspense fallback={<div className="px-4 py-3 text-[12px] text-dim">Loading run…</div>}>
        <ConversationBackgroundWorkWorkbenchPane conversationId={conversationId} runId={runId} lookups={{ sessions, tasks }} />
      </Suspense>
    );
  }

  if (extensionWorkbenchSurface) {
    return (
      <NativeExtensionSurfaceHost
        surface={extensionWorkbenchSurface}
        pathname={location.pathname}
        search={location.search}
        hash={location.hash}
        conversationId={conversationId}
        cwd={workspaceCwd}
      />
    );
  }

  if (activeTool === 'browser') {
    return null;
  }

  return (
    <div className="flex h-full items-center justify-center px-6 text-center select-text">
      <div className="max-w-sm">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-steel/80">Workbench</p>
        <h2 className="mt-2 text-lg font-semibold text-primary text-balance">Open a file</h2>
        <p className="mt-2 text-[13px] leading-6 text-secondary">Pick a file from the right rail to keep it beside the transcript.</p>
      </div>
    </div>
  );
}

function WorkbenchKnowledgeRail({
  conversationId,
  workspaceCwd,
  activeArtifactId,
  activeCheckpointId,
  activeRunId,
  activeTool,
  onActiveToolChange,
  onCheckpointSelect,
  onRunSelect,
  onWorkspaceFileClear,
  onScrollToCheckpointFile,
  extensionToolPanels,
}: {
  conversationId: string | null;
  workspaceCwd: string | null;
  activeArtifactId: string | null;
  activeCheckpointId: string | null;
  activeRunId: string | null;
  activeTool: WorkbenchRailMode;
  onActiveToolChange: (mode: WorkbenchRailMode) => void;
  onCheckpointSelect: (checkpointId: string | null) => void;
  onRunSelect: (runId: string | null) => void;
  onWorkspaceFileClear: () => void;
  onScrollToCheckpointFile?: (filePath: string) => void;
  extensionToolPanels: Array<(ExtensionRightToolPanelSurface & ExtensionSurfaceSummary) | NativeExtensionViewSummary>;
}) {
  const location = useLocation();
  const [, setSearchParams] = useSearchParams();
  const { runs, sessions, tasks } = useAppData();
  const artifactsEnabled = activeTool === 'artifacts' || activeArtifactId !== null;
  const diffsEnabled = isDiffsRailMode(activeTool) || activeCheckpointId !== null;
  const runsEnabled = activeTool === 'runs' || activeRunId !== null;
  const {
    artifacts,
    loading: artifactsLoading,
    error: artifactsError,
  } = useConversationArtifactSummaries(artifactsEnabled ? conversationId : null);
  const {
    checkpoints,
    loading: checkpointsLoading,
    error: checkpointsError,
  } = useConversationCheckpointSummaries(diffsEnabled ? conversationId : null);
  const { result: uncommittedResult } = useUncommittedDiff(diffsEnabled ? workspaceCwd : null);
  const runLookups = useMemo(() => ({ sessions, tasks }), [sessions, tasks]);
  const connectedRuns = useConversationRunList(runsEnabled ? conversationId : null, runs, runLookups);
  const activeRunConnected = activeRunId !== null && connectedRuns.some((run) => run.runId === activeRunId);
  const showRunsTab = shouldShowConversationRunsTab({
    runCount: connectedRuns.length,
    activeRunId,
    activeRunConnected,
    runsLoaded: runs !== null,
  });
  const availableExtensionToolPanels = extensionToolPanels;
  const activeExtensionToolPanel = useMemo(() => {
    const parsed = parseExtensionToolPanelMode(activeTool);
    if (!parsed) return null;
    return (
      availableExtensionToolPanels.find((surface) => surface.extensionId === parsed.extensionId && surface.id === parsed.surfaceId) ?? null
    );
  }, [activeTool, availableExtensionToolPanels]);
  const systemArtifactsExtensionSurface =
    availableExtensionToolPanels.find((surface) => surface.extensionId === 'system-artifacts') ?? null;
  const systemFilesExtensionSurface = availableExtensionToolPanels.find((surface) => surface.extensionId === 'system-files') ?? null;
  const systemDiffsExtensionSurface = availableExtensionToolPanels.find((surface) => surface.extensionId === 'system-diffs') ?? null;
  const systemRunsExtensionSurface = availableExtensionToolPanels.find((surface) => surface.extensionId === 'system-runs') ?? null;
  const handleFileExplorerModeSelect = useCallback(() => {
    onActiveToolChange(systemFilesExtensionSurface ? extensionToolPanelMode(systemFilesExtensionSurface) : 'files');
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
  }, [onActiveToolChange, onCheckpointSelect, onWorkspaceFileClear, setSearchParams, systemFilesExtensionSurface]);
  const handleDiffsModeSelect = useCallback(() => {
    const nextCheckpointId = resolveDefaultDiffCheckpointId({
      activeCheckpointId,
      firstCheckpointId: checkpoints[0]?.id ?? null,
      hasUncommittedDiff: Boolean(uncommittedResult),
    });
    onActiveToolChange(systemDiffsExtensionSurface ? extensionToolPanelMode(systemDiffsExtensionSurface) : 'diffs');
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
  }, [
    activeCheckpointId,
    checkpoints,
    uncommittedResult,
    onActiveToolChange,
    onCheckpointSelect,
    onWorkspaceFileClear,
    setSearchParams,
    systemDiffsExtensionSurface,
  ]);
  const handleArtifactsModeSelect = useCallback(() => {
    const firstArtifactId = activeArtifactId ?? artifacts[0]?.id ?? null;
    onActiveToolChange(systemArtifactsExtensionSurface ? extensionToolPanelMode(systemArtifactsExtensionSurface) : 'artifacts');
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
  }, [
    activeArtifactId,
    artifacts,
    onActiveToolChange,
    onCheckpointSelect,
    onWorkspaceFileClear,
    setSearchParams,
    systemArtifactsExtensionSurface,
  ]);
  const handleRunsModeSelect = useCallback(() => {
    onActiveToolChange(resolveWorkbenchRailMode('runs', systemRunsExtensionSurface));
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
  }, [activeRunId, onActiveToolChange, onCheckpointSelect, onWorkspaceFileClear, setSearchParams, systemRunsExtensionSurface]);
  const handleCheckpointSelect = useCallback(
    (checkpointId: string) => {
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
    },
    [onActiveToolChange, onCheckpointSelect, onWorkspaceFileClear, setSearchParams],
  );
  const handleArtifactSelect = useCallback(
    (artifactId: string) => {
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
    },
    [onActiveToolChange, onCheckpointSelect, onWorkspaceFileClear, setSearchParams],
  );
  const handleRunSelect = useCallback(
    (runId: string) => {
      onActiveToolChange(resolveWorkbenchRailMode('runs', systemRunsExtensionSurface));
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
    },
    [onActiveToolChange, onCheckpointSelect, onRunSelect, onWorkspaceFileClear, setSearchParams, systemRunsExtensionSurface],
  );
  const handleExtensionToolPanelSelect = useCallback(
    (surface: ExtensionRightToolPanelSurface & ExtensionSurfaceSummary) => {
      onActiveToolChange(extensionToolPanelMode(surface));
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
    },
    [onActiveToolChange, onCheckpointSelect, onWorkspaceFileClear, setSearchParams],
  );

  useEffect(() => {
    if (activeArtifactId && artifacts.length > 0) {
      onActiveToolChange(systemArtifactsExtensionSurface ? extensionToolPanelMode(systemArtifactsExtensionSurface) : 'artifacts');
      onWorkspaceFileClear();
    }
  }, [activeArtifactId, artifacts.length, onActiveToolChange, onWorkspaceFileClear, systemArtifactsExtensionSurface]);

  useEffect(() => {
    if (activeCheckpointId && checkpoints.some((checkpoint) => checkpoint.id === activeCheckpointId)) {
      onActiveToolChange(systemDiffsExtensionSurface ? extensionToolPanelMode(systemDiffsExtensionSurface) : 'diffs');
      onWorkspaceFileClear();
    }
  }, [activeCheckpointId, checkpoints, onActiveToolChange, onWorkspaceFileClear, systemDiffsExtensionSurface]);

  useEffect(() => {
    if (activeRunId) {
      onActiveToolChange(resolveWorkbenchRailMode('runs', systemRunsExtensionSurface));
      onWorkspaceFileClear();
    }
  }, [activeRunId, onActiveToolChange, onWorkspaceFileClear, systemRunsExtensionSurface]);

  useEffect(() => {
    if (activeTool !== 'runs' || showRunsTab) {
      return;
    }

    onActiveToolChange('files');
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.delete('run');
        return next;
      },
      { replace: true },
    );
  }, [activeTool, onActiveToolChange, setSearchParams, showRunsTab]);

  useEffect(() => {
    const parsed = parseExtensionToolPanelMode(activeTool);
    if (!parsed) return;
    if (activeExtensionToolPanel) return;
    onActiveToolChange('files');
  }, [activeExtensionToolPanel, activeTool, onActiveToolChange]);

  useEffect(() => {
    if (activeTool === 'artifacts' && !artifactsLoading && artifacts.length === 0) {
      onActiveToolChange('files');
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current);
          next.delete('artifact');
          return next;
        },
        { replace: true },
      );
    }
  }, [activeTool, artifacts.length, artifactsLoading, onActiveToolChange, setSearchParams]);

  useEffect(() => {
    if (isDiffsRailMode(activeTool) && !activeCheckpointId && uncommittedResult) {
      onCheckpointSelect(UNCOMMITTED_SENTINEL);
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current);
          next.delete('file');
          next.delete('artifact');
          next.delete('run');
          next.set('checkpoint', UNCOMMITTED_SENTINEL);
          return next;
        },
        { replace: true },
      );
    }
  }, [activeCheckpointId, activeTool, onCheckpointSelect, setSearchParams, uncommittedResult]);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex shrink-0 flex-col gap-1 px-1.5 py-1.5">
        <button
          type="button"
          className={cx(
            'ui-sidebar-nav-item w-full text-left',
            (activeTool === 'files' ||
              (systemFilesExtensionSurface && activeTool === extensionToolPanelMode(systemFilesExtensionSurface))) &&
              'ui-sidebar-nav-item-active',
          )}
          title="File explorer"
          onClick={handleFileExplorerModeSelect}
        >
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="shrink-0 opacity-70"
            aria-hidden="true"
          >
            <path d="M3.75 6.75h5.379a1.5 1.5 0 0 1 1.06.44l2.122 2.12a1.5 1.5 0 0 0 1.06.44H20.25m-16.5-3A2.25 2.25 0 0 0 1.5 9v8.25A2.25 2.25 0 0 0 3.75 19.5h16.5a2.25 2.25 0 0 0 2.25-2.25v-5.25a2.25 2.25 0 0 0-2.25-2.25H3.75" />
          </svg>
          <span className="flex-1 text-left">File Explorer</span>
        </button>
        {!systemDiffsExtensionSurface && (checkpoints.length > 0 || activeCheckpointId || uncommittedResult) ? (
          <button
            type="button"
            className={cx('ui-sidebar-nav-item w-full text-left', activeTool === 'diffs' && 'ui-sidebar-nav-item-active')}
            title="Diffs"
            onClick={handleDiffsModeSelect}
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="shrink-0 opacity-70"
              aria-hidden="true"
            >
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
        {!systemArtifactsExtensionSurface && artifacts.length > 0 ? (
          <button
            type="button"
            className={cx('ui-sidebar-nav-item w-full text-left', activeTool === 'artifacts' && 'ui-sidebar-nav-item-active')}
            title="Artifacts"
            onClick={handleArtifactsModeSelect}
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="shrink-0 opacity-70"
              aria-hidden="true"
            >
              <path d="M6.75 3.75h7.5L19.5 9v11.25H6.75V3.75Z" />
              <path d="M14.25 3.75V9h5.25" />
              <path d="M9.75 13.5h6" />
              <path d="M9.75 16.5h4.5" />
            </svg>
            <span className="flex-1 text-left">Artifacts</span>
          </button>
        ) : null}
        {!systemRunsExtensionSurface && showRunsTab ? (
          <button
            type="button"
            className={cx('ui-sidebar-nav-item w-full text-left', activeTool === 'runs' && 'ui-sidebar-nav-item-active')}
            title="Runs"
            onClick={handleRunsModeSelect}
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="shrink-0 opacity-70"
              aria-hidden="true"
            >
              <path d="M4.5 6.75h15v10.5h-15z" />
              <path d="m8 10 2 2-2 2" />
              <path d="M12 14h4" />
            </svg>
            <span className="flex-1 text-left">Runs</span>
          </button>
        ) : null}
        {availableExtensionToolPanels
          .filter((surface) => shouldRenderExtensionToolPanelInWorkbenchNav(surface.extensionId))
          .map((surface) => (
            <button
              key={`${surface.extensionId}:${surface.id}`}
              type="button"
              className={cx(
                'ui-sidebar-nav-item w-full text-left',
                (activeTool === extensionToolPanelMode(surface) ||
                  (surface.extensionId === 'system-runs' && activeTool === 'runs') ||
                  (surface.extensionId === 'system-diffs' && activeTool === 'diffs') ||
                  (surface.extensionId === 'system-artifacts' && activeTool === 'artifacts')) &&
                  'ui-sidebar-nav-item-active',
              )}
              title={labelForExtensionToolPanel(surface)}
              onClick={() =>
                surface.extensionId === 'system-diffs'
                  ? handleDiffsModeSelect()
                  : surface.extensionId === 'system-artifacts'
                    ? handleArtifactsModeSelect()
                    : handleExtensionToolPanelSelect(surface)
              }
            >
              <span className="w-[15px] shrink-0 text-center text-[12px] opacity-70" aria-hidden="true">
                {iconGlyphForExtensionSurface(surface.icon)}
              </span>
              <span className="min-w-0 flex-1 truncate text-left">{labelForExtensionToolPanel(surface)}</span>
            </button>
          ))}
      </div>
      {activeTool === 'files' ? (
        <div className="min-h-0 flex-1 overflow-hidden bg-surface [&>[data-extension-id]]:bg-surface">
          {systemFilesExtensionSurface ? (
            <NativeExtensionSurfaceHost
              surface={systemFilesExtensionSurface}
              pathname={location.pathname}
              search={location.search}
              hash={location.hash}
              conversationId={conversationId}
              cwd={workspaceCwd}
            />
          ) : (
            <Suspense fallback={<div className="px-3 py-2 text-[12px] text-dim">Loading files…</div>}>
              <WorkspaceExplorer cwd={workspaceCwd} onDraftPrompt={onWorkspaceFileClear} railOnly={true} />
            </Suspense>
          )}
        </div>
      ) : activeTool === 'artifacts' ? (
        <div className="min-h-0 flex-1 overflow-hidden">
          <Suspense fallback={<div className="px-3 py-2 text-[12px] text-dim">Loading artifacts…</div>}>
            <ConversationArtifactRailContent
              artifacts={artifacts}
              activeArtifactId={activeArtifactId}
              loading={artifactsLoading}
              error={artifactsError}
              onOpenArtifact={handleArtifactSelect}
            />
          </Suspense>
        </div>
      ) : activeTool === 'diffs' && !systemDiffsExtensionSurface ? (
        <div className="min-h-0 flex-1 overflow-hidden">
          <Suspense fallback={<div className="px-3 py-2 text-[12px] text-dim">Loading diffs…</div>}>
            <ConversationDiffRailContent
              checkpoints={checkpoints}
              activeCheckpointId={activeCheckpointId}
              loading={checkpointsLoading}
              error={checkpointsError}
              onOpenCheckpoint={handleCheckpointSelect}
              onScrollToFile={onScrollToCheckpointFile}
              workspaceCwd={workspaceCwd}
            />
          </Suspense>
        </div>
      ) : activeTool === 'runs' ? (
        <div className="min-h-0 flex-1 overflow-hidden">
          {systemRunsExtensionSurface ? (
            <NativeExtensionSurfaceHost
              surface={systemRunsExtensionSurface}
              pathname={location.pathname}
              search={location.search}
              hash={location.hash}
              conversationId={conversationId}
              cwd={workspaceCwd}
            />
          ) : (
            <Suspense fallback={<div className="px-3 py-2 text-[12px] text-dim">Loading runs…</div>}>
              <ConversationBackgroundWorkRailContent
                conversationId={conversationId}
                runs={runs}
                activeRunId={activeRunId}
                lookups={runLookups}
                onOpenRun={handleRunSelect}
              />
            </Suspense>
          )}
        </div>
      ) : activeExtensionToolPanel ? (
        <div className="min-h-0 flex-1 overflow-hidden bg-surface [&>[data-extension-id]]:bg-surface">
          {'component' in activeExtensionToolPanel ? (
            <NativeExtensionSurfaceHost
              surface={activeExtensionToolPanel}
              pathname={location.pathname}
              search={location.search}
              hash={location.hash}
              conversationId={conversationId}
              cwd={workspaceCwd}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function Layout() {
  const location = useLocation();
  useRouteTelemetry();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { sessions } = useAppData();
  const { versions } = useAppEvents();
  const [desktopEnvironment, setDesktopEnvironment] = useState<DesktopEnvironmentState | null>(null);
  const [appLayoutMode, setAppLayoutMode] = useState<AppLayoutMode>(() => readAppLayoutMode());
  const [activeWorkbenchTool, setActiveWorkbenchTool] = useState<WorkbenchRailMode>('files');
  const [selectedCheckpointByConversation, setSelectedCheckpointByConversation] = useState<Record<string, string | null>>({});
  const [selectedToolByConversation, setSelectedToolByConversation] = useState<Record<string, WorkbenchRailMode>>({});
  const [selectedFileByConversation, setSelectedFileByConversation] = useState<Record<string, string | null>>({});
  const [selectedArtifactByConversation, setSelectedArtifactByConversation] = useState<Record<string, string | null>>({});
  const [selectedRunByConversation, setSelectedRunByConversation] = useState<Record<string, string | null>>({});
  const viewportWidth = useViewportWidth();
  const sidebar = useResize({ initial: 224, min: 160, max: 320, storageKey: SIDEBAR_WIDTH_STORAGE_KEY, side: 'left' });
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
  const [scrollToCheckpointFile, setScrollToCheckpointFile] = useState<string | null>(null);
  const handleCheckpointFileScroll = useCallback((filePath: string) => {
    setScrollToCheckpointFile(filePath);
  }, []);
  const pageSearchRootRef = useRef<HTMLDivElement | null>(null);
  const [registeredRightRailControl, setRegisteredRightRailControl] = useState<DesktopRightRailControl | null>(null);
  const railWidth = rail.width;
  const extensionRegistry = useExtensionRegistry();
  const [extensionKeybindings, setExtensionKeybindings] = useState<ExtensionKeybindingRegistration[]>([]);
  const canShowContextRail = !routeSupportsContextRail(location.pathname, extensionRegistry.surfaces);

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

  const effectiveSidebarOpen = sidebarOpen;
  const showContextRail = canShowContextRail && railOpen;
  const showWorkbench = appLayoutMode === 'workbench' && routeSupportsWorkbench(location.pathname, extensionRegistry.surfaces);
  const activeConversationId = getActiveConversationId(location.pathname);
  const activeWorkbenchKnowledgeFileId = showWorkbench
    ? (searchParams.get('file') ?? (activeConversationId ? selectedFileByConversation[activeConversationId] : null) ?? null)
    : null;
  const activeWorkbenchWorkspaceFileId = showWorkbench ? searchParams.get('workspaceFile') : null;
  const activeWorkbenchArtifactId =
    showWorkbench && activeConversationId
      ? (getConversationArtifactIdFromSearch(location.search) ?? selectedArtifactByConversation[activeConversationId] ?? null)
      : null;
  const activeWorkbenchCheckpointFromSearch =
    showWorkbench && activeConversationId ? getConversationCheckpointIdFromSearch(location.search) : null;
  const activeWorkbenchRunFromSearch =
    showWorkbench && activeConversationId
      ? (getConversationRunIdFromSearch(location.search) ?? selectedRunByConversation[activeConversationId] ?? null)
      : null;
  const activeWorkbenchCheckpointId = activeConversationId
    ? (activeWorkbenchCheckpointFromSearch ?? selectedCheckpointByConversation[activeConversationId] ?? null)
    : null;
  const activeWorkbenchRunId = activeConversationId ? activeWorkbenchRunFromSearch : null;
  const previousActiveConversationIdRef = useRef<string | null>(activeConversationId);
  const activeWorkspaceCwd = resolveActiveWorkspaceCwd(sessions, activeConversationId);
  const clearActiveWorkspaceFile = useCallback(() => undefined, []);
  const extensionRightToolPanels = useMemo(
    () =>
      extensionRegistry.surfaces.filter(
        (surface) => isExtensionRightToolPanelSurface(surface) || isNativeExtensionRightRailSurface(surface),
      ),
    [extensionRegistry.surfaces],
  );
  const extensionWorkbenchSurfaces = useMemo(
    () => extensionRegistry.surfaces.filter(isNativeExtensionWorkbenchSurface),
    [extensionRegistry.surfaces],
  );
  const systemBrowserExtensionSurface = useMemo(
    () => extensionRightToolPanels.find((surface) => surface.extensionId === 'system-browser') ?? null,
    [extensionRightToolPanels],
  );
  const systemKnowledgeExtensionSurface = useMemo(
    () => extensionRightToolPanels.find((surface) => surface.extensionId === 'system-knowledge') ?? null,
    [extensionRightToolPanels],
  );
  const systemDiffsExtensionSurface = useMemo(
    () => extensionRightToolPanels.find((surface) => surface.extensionId === 'system-diffs') ?? null,
    [extensionRightToolPanels],
  );
  const routePrimaryRailSurface = useMemo(() => {
    if (showWorkbench) return null;
    const pageSurface = extensionRegistry.surfaces.find(
      (surface) => isNativeExtensionPageSurface(surface) && routeMatchesPrefix(location.pathname, surface.route),
    );
    if (!pageSurface) return null;
    return (
      extensionRightToolPanels.find(
        (surface) =>
          surface.extensionId === pageSurface.extensionId &&
          'location' in surface &&
          surface.location === 'rightRail' &&
          getExtensionViewPlacement(surface) === 'primary',
      ) ?? null
    );
  }, [extensionRegistry.surfaces, extensionRightToolPanels, location.pathname, showWorkbench]);
  const showRoutePrimaryRail = routePrimaryRailSurface !== null && railOpen;
  const showKnowledgeRouteRail =
    !showWorkbench &&
    !routePrimaryRailSurface &&
    routeIsKnowledge(location.pathname, extensionRegistry.surfaces) &&
    railOpen &&
    systemKnowledgeExtensionSurface !== null;
  const activeExtensionWorkbenchSurface = useMemo(
    () => resolveActiveExtensionWorkbenchSurface({ activeWorkbenchTool, extensionRightToolPanels, extensionWorkbenchSurfaces }),
    [activeWorkbenchTool, extensionRightToolPanels, extensionWorkbenchSurfaces],
  );
  const [notificationCenterOpen, setNotificationCenterOpen] = useState(false);
  const [commandPaletteMounted, setCommandPaletteMounted] = useState(false);
  const [pendingCommandPaletteOpen, setPendingCommandPaletteOpen] = useState<OpenCommandPaletteDetail | null>(null);

  const setActiveConversationTool = useCallback(
    (tool: WorkbenchRailMode) => {
      if (activeConversationId && tool !== 'browser') {
        setSelectedToolByConversation((current) => ({
          ...current,
          [activeConversationId]: tool,
        }));
      }
      setActiveWorkbenchTool(tool);
    },
    [activeConversationId],
  );

  const runExtensionKeybindingCommand = useCallback(
    (command: string) => {
      if (command.startsWith('navigate:')) {
        navigate(command.slice('navigate:'.length));
        return true;
      }
      if (command.startsWith('commandPalette:')) {
        const scope = command.slice('commandPalette:'.length);
        window.dispatchEvent(new CustomEvent(OPEN_COMMAND_PALETTE_EVENT, { detail: { scope } }));
        return true;
      }
      if (command.startsWith('layout:')) {
        const mode = command.slice('layout:'.length);
        if (mode === 'compact' || mode === 'workbench') {
          writeAppLayoutMode(mode);
          setAppLayoutMode(mode);
          return true;
        }
      }
      if (command.startsWith('rightRail:')) {
        const target = command.slice('rightRail:'.length);
        const surface = extensionRightToolPanels.find((candidate) => `${candidate.extensionId}/${candidate.id}` === target);
        if (surface) {
          setActiveConversationTool(extensionToolPanelMode(surface));
          setRailOpen(true);
          return true;
        }
      }
      return false;
    },
    [extensionRightToolPanels, navigate, setActiveConversationTool],
  );

  const lastWorkbenchRouteRef = useRef<{ pathname: string; search: string }>({ pathname: '/conversations/new', search: '' });

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      api
        .extensionKeybindings()
        .then((items) => {
          if (!cancelled) setExtensionKeybindings(items);
        })
        .catch(() => {
          if (!cancelled) setExtensionKeybindings([]);
        });
    };
    load();
    window.addEventListener(EXTENSION_REGISTRY_CHANGED_EVENT, load);
    return () => {
      cancelled = true;
      window.removeEventListener(EXTENSION_REGISTRY_CHANGED_EVENT, load);
    };
  }, [versions.extensions]);

  useEffect(() => {
    function handleExtensionKeybinding(event: KeyboardEvent) {
      if (event.defaultPrevented) return;
      const match = findMatchingExtensionKeybinding(
        event,
        extensionKeybindings.filter((keybinding) => keybinding.enabled && keybinding.scope === 'global'),
      );
      if (!match) return;
      if (runExtensionKeybindingCommand(match.command)) {
        event.preventDefault();
        event.stopPropagation();
      }
    }

    window.addEventListener('keydown', handleExtensionKeybinding, true);
    return () => window.removeEventListener('keydown', handleExtensionKeybinding, true);
  }, [extensionKeybindings, runExtensionKeybindingCommand]);

  useEffect(() => {
    if (!routeSupportsWorkbench(location.pathname, extensionRegistry.surfaces)) {
      return;
    }
    lastWorkbenchRouteRef.current = { pathname: location.pathname, search: location.search };
  }, [extensionRegistry.surfaces, location.pathname, location.search]);

  const setActiveConversationCheckpoint = useCallback(
    (checkpointId: string | null) => {
      if (!activeConversationId) {
        return;
      }

      setSelectedCheckpointByConversation((current) => ({
        ...current,
        [activeConversationId]: checkpointId,
      }));
    },
    [activeConversationId],
  );

  const clearActiveConversationCheckpoint = useCallback(() => {
    setActiveConversationCheckpoint(null);
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.delete('checkpoint');
        return next;
      },
      { replace: true },
    );
  }, [setActiveConversationCheckpoint, setSearchParams]);

  const setActiveConversationRun = useCallback((_runId: string | null) => {
    // Run selection is URL-backed.
  }, []);

  // Cwd change: clear workspace file if its cwd no longer matches

  // Save/restore per-conversation window state + runs reset when switching conversations
  useEffect(() => {
    const previousConversationId = previousActiveConversationIdRef.current;
    previousActiveConversationIdRef.current = activeConversationId;

    if (previousConversationId === activeConversationId || !previousConversationId) {
      return;
    }

    // Save outgoing conversation state (skip browser which is global)
    if (activeWorkbenchTool !== 'browser') {
      setSelectedToolByConversation((current) => ({
        ...current,
        [previousConversationId]: activeWorkbenchTool,
      }));
    }
    setSelectedFileByConversation((current) => ({
      ...current,
      [previousConversationId]: activeWorkbenchKnowledgeFileId,
    }));
    setSelectedArtifactByConversation((current) => ({
      ...current,
      [previousConversationId]: activeWorkbenchArtifactId,
    }));
    setSelectedRunByConversation((current) => ({
      ...current,
      [previousConversationId]: activeWorkbenchRunFromSearch,
    }));
    // Restore incoming conversation state
    if (activeConversationId && activeWorkbenchTool !== 'browser') {
      // Restore tool: prefer saved per-conversation state; fall back to
      // knowledge unless we were on runs (reset to avoid stale run context).
      const savedTool = selectedToolByConversation[activeConversationId];
      if (savedTool) {
        setActiveWorkbenchTool(savedTool);
      } else if (
        shouldResetWorkbenchRunsOnConversationChange({
          previousConversationId,
          activeConversationId,
          activeTool: activeWorkbenchTool,
          activeRunId: activeWorkbenchRunFromSearch,
        })
      ) {
        setActiveWorkbenchTool('files');
        setSearchParams(
          (current) => {
            const next = new URLSearchParams(current);
            next.delete('run');
            return next;
          },
          { replace: true },
        );
      } else {
        setActiveWorkbenchTool('files');
      }
    }
  }, [
    activeConversationId,
    activeWorkbenchArtifactId,
    activeWorkbenchKnowledgeFileId,
    activeWorkbenchRunFromSearch,
    activeWorkbenchTool,
    activeWorkspaceCwd,
    selectedToolByConversation,
  ]);

  useEffect(() => {
    if (!activeConversationId || !activeWorkbenchCheckpointFromSearch) {
      return;
    }

    setSelectedCheckpointByConversation((current) => ({
      ...current,
      [activeConversationId]: activeWorkbenchCheckpointFromSearch,
    }));
    setActiveConversationTool(systemDiffsExtensionSurface ? extensionToolPanelMode(systemDiffsExtensionSurface) : 'diffs');
  }, [activeConversationId, activeWorkbenchCheckpointFromSearch, systemDiffsExtensionSurface]);

  useEffect(() => {
    if (!activeConversationId || !activeWorkbenchRunFromSearch) {
      return;
    }

    setActiveConversationTool('runs');
  }, [activeConversationId, activeWorkbenchRunFromSearch]);

  useEffect(() => {
    if (!activeWorkbenchKnowledgeFileId) {
      return;
    }

    // Don't override the current tool when the system-knowledge extension is
    // active — it sets the ?file= param through its own file selection flow.
    const parsed = parseExtensionToolPanelMode(activeWorkbenchTool);
    if (parsed && parsed.extensionId === 'system-knowledge') {
      return;
    }

    setActiveConversationTool('files');
  }, [activeWorkbenchKnowledgeFileId]);

  useEffect(() => {
    function handleWorkbenchCloseActiveFile() {
      if (activeWorkbenchArtifactId) {
        setSearchParams(
          (current) => {
            const next = new URLSearchParams(current);
            next.delete('artifact');
            return next;
          },
          { replace: true },
        );
        return;
      }

      if (activeWorkbenchKnowledgeFileId || activeWorkbenchWorkspaceFileId) {
        setSearchParams(
          (current) => {
            const next = new URLSearchParams(current);
            next.delete('file');
            next.delete('workspaceFile');
            return next;
          },
          { replace: true },
        );
        return;
      }

      if (activeWorkbenchCheckpointId) {
        clearActiveConversationCheckpoint();
        return;
      }

      if (activeWorkbenchRunId) {
        setSearchParams(
          (current) => {
            const next = new URLSearchParams(current);
            next.delete('run');
            return next;
          },
          { replace: true },
        );
        return;
      }
    }

    window.addEventListener(WORKBENCH_CLOSE_ACTIVE_FILE_EVENT, handleWorkbenchCloseActiveFile);
    return () => window.removeEventListener(WORKBENCH_CLOSE_ACTIVE_FILE_EVENT, handleWorkbenchCloseActiveFile);
  }, [
    activeWorkbenchArtifactId,
    activeWorkbenchCheckpointId,
    activeWorkbenchKnowledgeFileId,
    activeWorkbenchRunId,
    activeWorkbenchWorkspaceFileId,
    clearActiveConversationCheckpoint,
    setSearchParams,
  ]);

  useEffect(() => {
    if (commandPaletteMounted) {
      return;
    }

    const timer = window.setTimeout(() => setCommandPaletteMounted(true), 750);
    const mountImmediately = (event: Event) => {
      setPendingCommandPaletteOpen((event as CustomEvent<OpenCommandPaletteDetail>).detail ?? {});
      setCommandPaletteMounted(true);
    };
    window.addEventListener(OPEN_COMMAND_PALETTE_EVENT, mountImmediately, { once: true });
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener(OPEN_COMMAND_PALETTE_EVENT, mountImmediately);
    };
  }, [commandPaletteMounted]);

  useEffect(() => {
    if (!commandPaletteMounted || pendingCommandPaletteOpen === null) {
      return;
    }

    const timer = window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent(OPEN_COMMAND_PALETTE_EVENT, { detail: pendingCommandPaletteOpen }));
      setPendingCommandPaletteOpen(null);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [commandPaletteMounted, pendingCommandPaletteOpen]);

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
    : routePrimaryRailSurface || showKnowledgeRouteRail || routeIsKnowledge(location.pathname, extensionRegistry.surfaces)
      ? {
          railOpen: showRoutePrimaryRail || showKnowledgeRouteRail,
          toggleRail: () => setRailOpen((current) => !current),
        }
      : (registeredRightRailControl ??
        (canShowContextRail
          ? {
              railOpen: showContextRail,
              toggleRail: () => setRailOpen((current) => !current),
            }
          : null));

  const handleAppLayoutModeChange = useCallback(
    (mode: AppLayoutMode) => {
      const previousMode = appLayoutMode;
      setAppLayoutMode(mode);
      writeAppLayoutMode(mode);

      if (mode === 'compact') {
        setSearchParams(
          (current) => {
            const next = new URLSearchParams(clearWorkbenchOnlySearchParamsForCompact(current.toString()));
            next.delete('view');
            return next;
          },
          { replace: true },
        );
        return;
      }

      if (mode === 'workbench' && previousMode === 'compact') {
        setWorkbenchExplorerOpen(true);
        writeStoredWorkbenchExplorerOpen(true);

        if (routeIsKnowledge(location.pathname, extensionRegistry.surfaces)) {
          const nextSearch = new URLSearchParams(lastWorkbenchRouteRef.current.search);
          nextSearch.delete('artifact');
          nextSearch.delete('checkpoint');
          nextSearch.delete('run');
          const activeKnowledgeFileId = searchParams.get('file');
          if (activeKnowledgeFileId) {
            nextSearch.set('file', activeKnowledgeFileId);
          } else {
            nextSearch.delete('file');
          }
          setActiveConversationTool(systemKnowledgeExtensionSurface ? extensionToolPanelMode(systemKnowledgeExtensionSurface) : 'files');
          navigate({
            pathname: lastWorkbenchRouteRef.current.pathname,
            search: nextSearch.toString(),
          });
          return;
        }
      }
    },
    [
      appLayoutMode,
      extensionRegistry.surfaces,
      location.pathname,
      navigate,
      searchParams,
      setActiveConversationTool,
      setSearchParams,
      systemKnowledgeExtensionSurface,
    ],
  );

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

      if (action === 'show-conversation-mode') {
        handleAppLayoutModeChange('compact');
        return;
      }

      if (action === 'show-workbench-mode') {
        handleAppLayoutModeChange('workbench');
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
      if (!routeSupportsWorkbench(location.pathname, extensionRegistry.surfaces)) {
        navigate('/conversations/new');
      }
      handleAppLayoutModeChange('workbench');
      setActiveConversationTool(systemBrowserExtensionSurface ? extensionToolPanelMode(systemBrowserExtensionSurface) : 'files');
    }

    window.addEventListener(DESKTOP_SHORTCUT_EVENT, handleDesktopShortcut);
    window.addEventListener(DESKTOP_NAVIGATE_EVENT, handleDesktopNavigate);
    window.addEventListener(DESKTOP_SHOW_WORKBENCH_BROWSER_EVENT, handleShowWorkbenchBrowser);
    return () => {
      window.removeEventListener(DESKTOP_SHORTCUT_EVENT, handleDesktopShortcut);
      window.removeEventListener(DESKTOP_NAVIGATE_EVENT, handleDesktopNavigate);
      window.removeEventListener(DESKTOP_SHOW_WORKBENCH_BROWSER_EVENT, handleShowWorkbenchBrowser);
    };
  }, [
    activeRightRailControl,
    appLayoutMode,
    handleAppLayoutModeChange,
    location.hash,
    extensionRegistry.surfaces,
    location.pathname,
    location.search,
    navigate,
    systemBrowserExtensionSurface,
  ]);

  return (
    <NotificationProvider>
      <DesktopChromeContext.Provider value={{ setRightRailControl: setRegisteredRightRailControl }}>
        <div className="flex h-screen flex-col overflow-hidden bg-base text-primary select-none">
          <DesktopTopBar
            environment={desktopEnvironment}
            sidebarOpen={effectiveSidebarOpen}
            onToggleSidebar={() => setSidebarOpen((current) => !current)}
            showRailToggle={activeRightRailControl !== null}
            railOpen={activeRightRailControl?.railOpen ?? false}
            onToggleRail={activeRightRailControl?.toggleRail ?? (() => {})}
            layoutMode={appLayoutMode}
            onLayoutModeChange={handleAppLayoutModeChange}
            trailingExtra={<NotificationBell onClick={() => setNotificationCenterOpen((open) => !open)} />}
          />
          <div className="flex min-h-0 flex-1 overflow-hidden">
            {effectiveSidebarOpen ? (
              <div
                style={{ width: sidebar.width }}
                className="flex-shrink-0 flex flex-col overflow-hidden bg-surface border-r border-border-subtle"
              >
                <Sidebar />
              </div>
            ) : null}

            {effectiveSidebarOpen ? <ResizeHandle onMouseDown={sidebar.onMouseDown} /> : null}

            <div ref={pageSearchRootRef} className="flex min-w-0 flex-1 overflow-hidden">
              <RouteContentBoundary resetKey={`${location.pathname}${location.search}`} pathname={location.pathname}>
                <main
                  className={
                    showWorkbench
                      ? 'flex-1 min-w-[360px] overflow-y-auto overflow-x-hidden select-text'
                      : 'flex-1 min-w-0 overflow-y-auto overflow-x-hidden select-text'
                  }
                >
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
                      data-has-open-file={
                        activeWorkbenchKnowledgeFileId ||
                        activeWorkbenchWorkspaceFileId ||
                        activeWorkbenchArtifactId ||
                        activeWorkbenchCheckpointId ||
                        activeWorkbenchRunId ||
                        activeWorkbenchTool === 'browser' ||
                        activeExtensionWorkbenchSurface
                          ? 'true'
                          : 'false'
                      }
                    >
                      <WorkbenchDocumentPane
                        conversationId={activeConversationId}
                        artifactId={activeWorkbenchArtifactId}
                        checkpointId={activeWorkbenchCheckpointId}
                        runId={activeWorkbenchRunId}
                        activeTool={activeWorkbenchTool}
                        onMissingCheckpoint={clearActiveConversationCheckpoint}
                        scrollToCheckpointFile={scrollToCheckpointFile}
                        workspaceCwd={activeWorkspaceCwd}
                        extensionWorkbenchSurface={activeExtensionWorkbenchSurface}
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
                            activeTool={activeWorkbenchTool}
                            onActiveToolChange={setActiveConversationTool}
                            onCheckpointSelect={setActiveConversationCheckpoint}
                            onRunSelect={setActiveConversationRun}
                            onWorkspaceFileClear={clearActiveWorkspaceFile}
                            onScrollToCheckpointFile={handleCheckpointFileScroll}
                            extensionToolPanels={extensionRightToolPanels}
                          />
                        </aside>
                      </>
                    ) : null}
                  </>
                ) : null}

                {(showRoutePrimaryRail && routePrimaryRailSurface) || (showKnowledgeRouteRail && systemKnowledgeExtensionSurface) ? (
                  <>
                    <ResizeHandle onMouseDown={rail.onMouseDown} onDoubleClick={rail.reset} />
                    <aside
                      style={{ width: railWidth }}
                      className="relative z-10 flex-shrink-0 overflow-hidden border-l border-border-subtle bg-surface select-text [&>[data-extension-id]]:bg-surface"
                    >
                      <NativeExtensionSurfaceHost
                        surface={routePrimaryRailSurface ?? systemKnowledgeExtensionSurface}
                        pathname={location.pathname}
                        search={location.search}
                        hash={location.hash}
                        conversationId={activeConversationId}
                        cwd={activeWorkspaceCwd}
                      />
                    </aside>
                  </>
                ) : showContextRail ? (
                  <>
                    <ResizeHandle onMouseDown={rail.onMouseDown} onDoubleClick={rail.reset} />
                    <div style={{ width: railWidth }} className="relative z-10 flex-shrink-0 overflow-hidden bg-surface select-text">
                      <Suspense
                        fallback={<div className="flex h-full items-center justify-center px-4 text-[12px] text-dim">Loading…</div>}
                      >
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

      <NotificationToaster />
      {notificationCenterOpen && <NotificationCenter onClose={() => setNotificationCenterOpen(false)} />}
      <ExtensionModalHost />
      <PageSearchBar rootRef={pageSearchRootRef} desktopShell={desktopEnvironment?.isElectron ?? isDesktopShell()} />
      {commandPaletteMounted ? (
        <Suspense fallback={null}>
          <CommandPalette />
        </Suspense>
      ) : null}
    </NotificationProvider>
  );
}

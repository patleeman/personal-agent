import { emitKBEvent } from '@personal-agent/extensions/knowledge';
import {
  type DragEvent,
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';

import { useAppData, useAppEvents } from '../app/contexts';
import { api } from '../client/api';
import {
  buildConversationGroupLabels,
  getConversationGroupLabel,
  groupConversationItemsByCwd,
  normalizeConversationGroupCwd,
} from '../conversation/conversationCwdGroups';
import {
  buildConversationDeeplink,
  buildConversationSurfacePath,
  resolveConversationAdjacentPath,
  resolveConversationCloseRedirect,
} from '../conversation/conversationRoutes';
import {
  clearDraftConversationAttachments,
  clearDraftConversationComposer,
  clearDraftConversationCwd,
  clearDraftConversationModel,
  clearDraftConversationThinkingLevel,
  DRAFT_CONVERSATION_ID,
  DRAFT_CONVERSATION_ROUTE,
  persistDraftConversationCwd,
  readDraftConversationCwd,
} from '../conversation/draftConversation';
import { persistForkPromptDraft } from '../conversation/forking';
import {
  DESKTOP_SHOW_WORKBENCH_BROWSER_EVENT,
  type DesktopConversationContextMenuAction,
  type DesktopConversationCwdGroupContextMenuAction,
  getDesktopBridge,
  shouldUseNativeAppContextMenus,
} from '../desktop/desktopBridge';
import { type ExtensionSurfaceSummary, isExtensionLeftNavItemSurface } from '../extensions/types';
import { useExtensionRegistry } from '../extensions/useExtensionRegistry';
import { buildConversationBootstrapVersionKey, fetchConversationBootstrapCached } from '../hooks/useConversationBootstrap';
import { useConversations } from '../hooks/useConversations';
import { getOrCreateConversationSurfaceId, retryLiveSessionActionAfterTakeover } from '../hooks/useSessionStream';
import { buildSidebarNavSectionStorageKey } from '../local/localSettings';
import { normalizeWorkspacePaths, readStoredWorkspacePaths, writeStoredWorkspacePaths } from '../local/savedWorkspacePaths';
import { routeIsKnowledge, routeMatchesPrefix } from '../navigation/routeRegistry';
import { sessionNeedsAttention } from '../session/sessionIndicators';
import { type ConversationShelf, type OpenConversationDropPosition, replaceConversationLayout } from '../session/sessionTabs';
import type { GatewayState, SessionMeta } from '../shared/types';
import { timeAgoCompact } from '../shared/utils';
import { ConversationStatusText } from './ConversationStatusText';

const SIDEBAR_CONVERSATION_PREFETCH_TAIL_BLOCKS = 120;

function Ico({ d, size = 16 }: { d: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={d} />
    </svg>
  );
}

function MoreActionsIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
      <circle cx="2" cy="6" r="1.15" />
      <circle cx="6" cy="6" r="1.15" />
      <circle cx="10" cy="6" r="1.15" />
    </svg>
  );
}

function GatewayRailIcon({ provider }: { provider: 'telegram' | 'slack_mcp' }) {
  const label = provider === 'telegram' ? 'Telegram gateway attached' : 'Slack gateway attached';
  return (
    <span
      className="grid h-3.5 min-w-3.5 shrink-0 place-items-center rounded-sm bg-accent/15 px-0.5 text-[8px] font-semibold text-accent"
      title={label}
      aria-label={label}
    >
      {provider === 'telegram' ? 'TG' : 'SL'}
    </span>
  );
}

const PATH = {
  conversations:
    'M4.5 6.75A2.25 2.25 0 0 1 6.75 4.5h10.5a2.25 2.25 0 0 1 2.25 2.25v7.5a2.25 2.25 0 0 1-2.25 2.25H13.5l-3 3v-3H6.75A2.25 2.25 0 0 1 4.5 14.25v-7.5Z',
  nodes: 'M6 6.75h4.5v4.5H6v-4.5Zm7.5 0H18v4.5h-4.5v-4.5Zm-3.75 7.5h4.5v4.5h-4.5v-4.5Z',
  notes:
    'M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25',
  skills: 'M12 3.75l7.5 4.125v8.25L12 20.25 4.5 16.125v-8.25L12 3.75Zm0 0v16.5M4.5 7.875 12 12l7.5-4.125',
  workspace:
    'M3.75 6A2.25 2.25 0 0 1 6 3.75h4.19a2.25 2.25 0 0 1 1.59.66l.91.9a2.25 2.25 0 0 0 1.59.66H18A2.25 2.25 0 0 1 20.25 8.25v9A2.25 2.25 0 0 1 18 19.5H6A2.25 2.25 0 0 1 3.75 17.25V6Z',
  workspaceAdd:
    'M3.75 7.5A1.5 1.5 0 0 1 5.25 6h4.018a1.5 1.5 0 0 1 1.06.44l1.172 1.17a1.5 1.5 0 0 0 1.06.44h6.19a1.5 1.5 0 0 1 1.5 1.5v7.95a1.5 1.5 0 0 1-1.5 1.5H5.25a1.5 1.5 0 0 1-1.5-1.5V7.5Z M3.75 9.75h16.5 M15.75 11.25v4.5 M13.5 13.5h4.5',
  automations: 'M12 6v6l4 2m5-2a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  gateways: 'M5 12h5m4 0h5M9 8l3-3 3 3M9 16l3 3 3-3M10 12a2 2 0 1 0 4 0 2 2 0 0 0-4 0Z',
  settings:
    'M10.5 6h3m-1.5-3v6m4.348-2.826 2.121 2.121m-12.728 0 2.121-2.121m8.486 8.486 2.121 2.121m-12.728 0 2.121-2.121M6 10.5H3m18 0h-3m-5.25 7.5v3m0-18v3',
  close: 'M6 18 18 6M6 6l12 12',
  chevronDown: 'm6 9 6 6 6-6',
  chevronRight: 'm9 6 6 6-6 6',
  plus: 'M12 5v14M5 12h14',
  grid: 'M5 5h6v6H5V5Zm8 0h6v6h-6V5ZM5 13h6v6H5v-6Zm8 0h6v6h-6v-6Z',
  filter: 'M4.5 7.5h15M7.5 12h9M10.5 16.5h3',
  list: 'M8.25 6.75h9m-9 5.25h9m-9 5.25h9M5.25 6.75h.01M5.25 12h.01M5.25 17.25h.01',
  grip: 'M9 6.75h.01M9 12h.01M9 17.25h.01M15 6.75h.01M15 12h.01M15 17.25h.01',
  clock: 'M12 6v6l4 2m5-2a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  sparkles:
    'M12 3.75l1.07 3.43a1.5 1.5 0 0 0 .93.94l3.43 1.07-3.43 1.07a1.5 1.5 0 0 0-.93.93L12 15.62l-1.07-3.43a1.5 1.5 0 0 0-.93-.93L6.57 10.19 10 9.12a1.5 1.5 0 0 0 .93-.94L12 3.75Zm6 10.5.54 1.71a.75.75 0 0 0 .47.47l1.71.54-1.71.54a.75.75 0 0 0-.47.47L18 20.69l-.54-1.71a.75.75 0 0 0-.47-.47l-1.71-.54 1.71-.54a.75.75 0 0 0 .47-.47L18 14.25Z',
  chatBubble:
    'M4.5 6.75A2.25 2.25 0 0 1 6.75 4.5h10.5a2.25 2.25 0 0 1 2.25 2.25v6.75a2.25 2.25 0 0 1-2.25 2.25H12l-4.5 3v-3H6.75A2.25 2.25 0 0 1 4.5 13.5V6.75Z',
  check: 'm5 12.75 4.5 4.5L19 7.75',
  pin: 'm15.75 3.75 4.5 4.5-3 3v3l-2.25 2.25-7.5-7.5L9.75 6.75h3l3-3ZM9.75 14.25 4.5 19.5',
};

const THREADS_COLLAPSED_CWD_GROUPS_STORAGE_KEY = buildSidebarNavSectionStorageKey('threads-collapsed-cwd-groups');
const THREADS_CWD_GROUP_LABEL_OVERRIDES_STORAGE_KEY = buildSidebarNavSectionStorageKey('threads-cwd-group-label-overrides');
const THREADS_ORGANIZE_STORAGE_KEY = buildSidebarNavSectionStorageKey('threads-organize');
const THREADS_FILTER_STORAGE_KEY = buildSidebarNavSectionStorageKey('threads-filter');
const THREADS_SORT_BY_STORAGE_KEY = buildSidebarNavSectionStorageKey('threads-sort-by');
const THREADS_MANUAL_GROUP_ORDER_STORAGE_KEY = buildSidebarNavSectionStorageKey('threads-manual-group-order');

const SIDEBAR_BROWSER_NEW_CHAT_HOTKEY = 'Ctrl+Shift+N';
const DESKTOP_CONVERSATION_SHORTCUT_EVENT = 'personal-agent-desktop-shortcut';
const WORKBENCH_CLOSE_ACTIVE_FILE_EVENT = 'pa:workbench-close-active-file';
const WORKBENCH_DOCUMENT_WITH_OPEN_FILE_SELECTOR = '[data-workbench-document-pane="true"][data-has-open-file="true"]';
const SETTINGS_ROUTE_PREFIXES = ['/settings', '/system', '/automations'] as const;

function getExtensionNavIcon(icon: string | undefined): string {
  switch (icon) {
    case 'automation':
      return PATH.automations;
    case 'browser':
      return PATH.chatBubble;
    case 'diff':
      return PATH.list;
    case 'file':
      return PATH.workspace;
    case 'gear':
      return PATH.settings;
    case 'graph':
      return PATH.nodes;
    case 'kanban':
      return PATH.grid;
    case 'play':
      return PATH.clock;
    case 'sparkle':
      return PATH.sparkles;
    case 'terminal':
      return PATH.workspace;
    case 'app':
    case 'database':
    default:
      return PATH.grid;
  }
}

type DesktopConversationShortcutAction =
  | 'close-conversation'
  | 'reopen-closed-conversation'
  | 'previous-conversation'
  | 'next-conversation'
  | 'toggle-conversation-pin'
  | 'toggle-conversation-archive';

type ThreadsOrganizeMode = 'project' | 'chronological';
type ThreadsFilterMode = 'all' | 'human' | 'automation';
type ThreadsSortMode = 'created' | 'updated' | 'manual';

type SidebarConversationItem = {
  session: SessionMeta;
  section: ConversationShelf;
  pinned: boolean;
  originalIndex: number;
};

type SidebarConversationGroup = {
  key: string;
  cwd: string | null;
  label: string;
  defaultLabel: string;
  items: SidebarConversationItem[];
  executionTargetKey: string;
  executionTargetLabel: string;
  executionTargetIsLocal: boolean;
};

type PointerPosition = { x: number; y: number };

let lastSidebarPointerPosition: PointerPosition | null = null;
let sidebarPointerTrackingAttached = false;

const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

function recordSidebarPointerPosition(event: PointerEvent) {
  lastSidebarPointerPosition = { x: event.clientX, y: event.clientY };
}

function clearSidebarPointerPosition() {
  lastSidebarPointerPosition = null;
}

function ensureSidebarPointerTracking() {
  if (sidebarPointerTrackingAttached || typeof window === 'undefined') {
    return;
  }
  window.addEventListener('pointermove', recordSidebarPointerPosition, { passive: true });
  window.addEventListener('pointerleave', clearSidebarPointerPosition);
  window.addEventListener('blur', clearSidebarPointerPosition);
  sidebarPointerTrackingAttached = true;
}

function elementContainsPointer(element: HTMLElement, point: PointerPosition): boolean {
  if (typeof document === 'undefined') {
    return false;
  }
  const hoveredElement = document.elementFromPoint(point.x, point.y);
  if (hoveredElement && element.contains(hoveredElement)) {
    return true;
  }
  const bounds = element.getBoundingClientRect();
  return point.x >= bounds.left && point.x <= bounds.right && point.y >= bounds.top && point.y <= bounds.bottom;
}

function useSidebarRowHover<T extends HTMLElement>() {
  const hoverRef = useRef<T | null>(null);
  const [hovered, setHovered] = useState(false);

  useEffect(() => {
    ensureSidebarPointerTracking();
  }, []);

  useIsomorphicLayoutEffect(() => {
    const element = hoverRef.current;
    const point = lastSidebarPointerPosition;
    if (!element || !point) {
      return;
    }
    const nextHovered = elementContainsPointer(element, point);
    setHovered((current) => (current === nextHovered ? current : nextHovered));
  });

  return {
    hoverRef,
    hovered,
    onMouseEnter: () => setHovered(true),
    onMouseLeave: () => setHovered(false),
  };
}

function sameStringLists(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((value, index) => value === right[index]);
}

function normalizeStoredStringList(values: Iterable<unknown>): string[] {
  const normalized: string[] = [];
  const seen = new Set<string>();

  for (const value of values) {
    const key = typeof value === 'string' ? value.trim() : '';
    if (!key || seen.has(key)) {
      continue;
    }

    seen.add(key);
    normalized.push(key);
  }

  return normalized;
}

function WorkspaceQuickSelectModal({
  workspacePaths,
  choosingNewFolder,
  onClose,
  onSelectWorkspace,
  onChooseNewFolder,
}: {
  workspacePaths: string[];
  choosingNewFolder: boolean;
  onClose: () => void;
  onSelectWorkspace: (workspacePath: string) => void;
  onChooseNewFolder: () => void;
}) {
  const [cursor, setCursor] = useState(0);
  const optionCount = workspacePaths.length + 1;
  const workspaceLabels = useMemo(() => buildConversationGroupLabels(workspacePaths), [workspacePaths]);

  useEffect(() => {
    setCursor(0);
  }, [workspacePaths]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setCursor((current) => Math.min(current + 1, optionCount - 1));
        return;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setCursor((current) => Math.max(current - 1, 0));
        return;
      }

      if (event.key === 'Enter') {
        event.preventDefault();
        const workspacePath = workspacePaths[cursor];
        if (workspacePath) {
          onSelectWorkspace(workspacePath);
          return;
        }

        onChooseNewFolder();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [cursor, onChooseNewFolder, onClose, onSelectWorkspace, optionCount, workspacePaths]);

  return (
    <div
      className="ui-overlay-backdrop"
      style={{
        background: 'rgb(0 0 0 / 0.52)',
        backdropFilter: 'blur(8px)',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1.75rem',
      }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Choose workspace"
        className="ui-dialog-shell"
        style={{
          width: 'min(560px, calc(100vw - 2rem))',
          maxHeight: 'min(560px, calc(100vh - 3.5rem))',
          background: 'rgb(var(--color-surface) / 0.985)',
          backdropFilter: 'blur(24px)',
          boxShadow: '0 28px 80px rgb(0 0 0 / 0.35)',
          overscrollBehavior: 'contain',
        }}
      >
        <div className="border-b border-border-subtle px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-[15px] font-semibold text-primary">Open workspace</h2>
              <p className="mt-1 text-[12px] leading-5 text-secondary">Choose one of the saved workspaces or pick a new folder.</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="ui-icon-button ui-icon-button-compact -mr-1 shrink-0"
              aria-label="Close workspace picker"
            >
              <Ico d={PATH.close} size={12} />
            </button>
          </div>
        </div>

        <div className="overflow-y-auto px-2 py-2" style={{ overscrollBehavior: 'contain' }}>
          {workspacePaths.length > 0 ? (
            workspacePaths.map((workspacePath, index) => {
              const selected = cursor === index;
              return (
                <button
                  key={workspacePath}
                  type="button"
                  onClick={() => onSelectWorkspace(workspacePath)}
                  className={[
                    'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors',
                    selected ? 'bg-elevated text-primary' : 'text-secondary hover:bg-elevated/70 hover:text-primary',
                  ].join(' ')}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium">
                      {getConversationGroupLabel(workspacePath, { labelsByCwd: workspaceLabels })}
                    </p>
                    <p className="truncate text-[11px] text-dim">{workspacePath}</p>
                  </div>
                </button>
              );
            })
          ) : (
            <p className="px-3 py-4 text-[12px] text-dim">No saved workspaces yet.</p>
          )}

          <button
            type="button"
            onClick={onChooseNewFolder}
            className={[
              'mt-1 flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors',
              cursor === workspacePaths.length ? 'bg-elevated text-primary' : 'text-secondary hover:bg-elevated/70 hover:text-primary',
            ].join(' ')}
            disabled={choosingNewFolder}
          >
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-elevated text-primary">
              <Ico d={PATH.workspaceAdd} size={13} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium">{choosingNewFolder ? 'Choosing folder…' : 'Choose a new folder'}</p>
              <p className="text-[11px] text-dim">Use the system picker to add another workspace.</p>
            </div>
          </button>
        </div>

        <div className="border-t border-border-subtle px-4 py-2 text-[10px] text-dim/80">↑↓ move · ↵ select · esc close</div>
      </div>
    </div>
  );
}

function readCollapsedConversationGroupKeys(): string[] {
  try {
    const raw = localStorage.getItem(THREADS_COLLAPSED_CWD_GROUPS_STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    const seen = new Set<string>();
    const keys: string[] = [];
    for (const value of parsed) {
      if (typeof value !== 'string') {
        continue;
      }

      const normalized = value.trim();
      if (!normalized || seen.has(normalized)) {
        continue;
      }

      seen.add(normalized);
      keys.push(normalized);
    }

    return keys;
  } catch {
    return [];
  }
}

function writeCollapsedConversationGroupKeys(keys: readonly string[]): void {
  try {
    if (keys.length > 0) {
      localStorage.setItem(THREADS_COLLAPSED_CWD_GROUPS_STORAGE_KEY, JSON.stringify(keys));
      return;
    }

    localStorage.removeItem(THREADS_COLLAPSED_CWD_GROUPS_STORAGE_KEY);
  } catch {
    // Ignore storage failures.
  }
}

function readConversationGroupLabelOverrides(): Record<string, string> {
  try {
    const raw = localStorage.getItem(THREADS_CWD_GROUP_LABEL_OVERRIDES_STORAGE_KEY);
    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }

    const overrides: Record<string, string> = {};
    for (const [rawKey, rawValue] of Object.entries(parsed)) {
      const key = rawKey.trim();
      const value = typeof rawValue === 'string' ? rawValue.trim() : '';
      if (!key || !value) {
        continue;
      }

      overrides[key] = value;
    }

    return overrides;
  } catch {
    return {};
  }
}

function writeConversationGroupLabelOverrides(overrides: Record<string, string>): void {
  try {
    const entries = Object.entries(overrides)
      .map(([rawKey, rawValue]) => [rawKey.trim(), rawValue.trim()] as const)
      .filter(([key, value]) => key.length > 0 && value.length > 0);

    if (entries.length > 0) {
      localStorage.setItem(THREADS_CWD_GROUP_LABEL_OVERRIDES_STORAGE_KEY, JSON.stringify(Object.fromEntries(entries)));
      return;
    }

    localStorage.removeItem(THREADS_CWD_GROUP_LABEL_OVERRIDES_STORAGE_KEY);
  } catch {
    // Ignore storage failures.
  }
}

function readThreadsOrganizeMode(): ThreadsOrganizeMode {
  try {
    const raw = localStorage.getItem(THREADS_ORGANIZE_STORAGE_KEY);
    return raw === 'chronological' || raw === 'manual' ? 'chronological' : 'project';
  } catch {
    return 'project';
  }
}

function writeThreadsOrganizeMode(value: ThreadsOrganizeMode): void {
  try {
    localStorage.setItem(THREADS_ORGANIZE_STORAGE_KEY, value);
  } catch {
    // Ignore storage failures.
  }
}

function readThreadsFilterMode(): ThreadsFilterMode {
  try {
    const raw = localStorage.getItem(THREADS_FILTER_STORAGE_KEY);
    return raw === 'human' || raw === 'automation' ? raw : 'all';
  } catch {
    return 'all';
  }
}

function writeThreadsFilterMode(value: ThreadsFilterMode): void {
  try {
    localStorage.setItem(THREADS_FILTER_STORAGE_KEY, value);
  } catch {
    // Ignore storage failures.
  }
}

function readThreadsSortMode(): ThreadsSortMode {
  try {
    if (localStorage.getItem(THREADS_ORGANIZE_STORAGE_KEY) === 'manual') {
      return 'manual';
    }

    const raw = localStorage.getItem(THREADS_SORT_BY_STORAGE_KEY);
    return raw === 'updated' || raw === 'manual' ? raw : 'created';
  } catch {
    return 'created';
  }
}

function writeThreadsSortMode(value: ThreadsSortMode): void {
  try {
    localStorage.setItem(THREADS_SORT_BY_STORAGE_KEY, value);
  } catch {
    // Ignore storage failures.
  }
}

function readManualConversationGroupOrder(): string[] {
  try {
    const raw = localStorage.getItem(THREADS_MANUAL_GROUP_ORDER_STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? normalizeStoredStringList(parsed) : [];
  } catch {
    return [];
  }
}

function writeManualConversationGroupOrder(groupKeys: readonly string[]): void {
  try {
    if (groupKeys.length > 0) {
      localStorage.setItem(THREADS_MANUAL_GROUP_ORDER_STORAGE_KEY, JSON.stringify(groupKeys));
      return;
    }

    localStorage.removeItem(THREADS_MANUAL_GROUP_ORDER_STORAGE_KEY);
  } catch {
    // Ignore storage failures.
  }
}

function getConversationItemSortTimestamp(session: SessionMeta, sortMode: ThreadsSortMode): number {
  const source = sortMode === 'created' ? session.timestamp : (session.lastActivityAt ?? session.attentionUpdatedAt ?? session.timestamp);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(source)) {
    return Number.NEGATIVE_INFINITY;
  }

  const parsed = Date.parse(source);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === source ? parsed : Number.NEGATIVE_INFINITY;
}

function compareConversationItems(left: SidebarConversationItem, right: SidebarConversationItem, sortMode: ThreadsSortMode): number {
  const timestampDelta =
    getConversationItemSortTimestamp(right.session, sortMode) - getConversationItemSortTimestamp(left.session, sortMode);
  if (timestampDelta !== 0) {
    return timestampDelta;
  }

  return left.originalIndex - right.originalIndex;
}

function matchesSettingsRoute(pathname: string): boolean {
  return SETTINGS_ROUTE_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function normalizeHotkeyKey(key: string): string {
  return key.length === 1 ? key.toLowerCase() : key;
}

function hasCommandOrControlHotkey(event: KeyboardEvent): boolean {
  return event.metaKey || event.ctrlKey;
}

function resolveConversationNumberHotkey(event: KeyboardEvent): number {
  if (event.shiftKey || event.altKey || !hasCommandOrControlHotkey(event)) {
    return -1;
  }

  const match = event.code.match(/^Digit([1-9])$/);
  if (match) {
    return Number(match[1]) - 1;
  }

  const key = normalizeHotkeyKey(event.key);
  return /^[1-9]$/.test(key) ? Number(key) - 1 : -1;
}

function resolveSidebarConversationHotkeyOrder<T>(input: {
  organizeMode: 'project' | 'chronological';
  orderedItems: readonly T[];
  groupedRows: ReadonlyArray<{ key: string; items: readonly T[] }>;
  collapsedGroupKeys?: ReadonlySet<string>;
}): T[] {
  if (input.organizeMode !== 'project') {
    return [...input.orderedItems];
  }

  return input.groupedRows.flatMap((group) => (input.collapsedGroupKeys?.has(group.key) ? [] : [...group.items]));
}

export function isRemoteConversationSession(session: Pick<SessionMeta, 'remoteHostId' | 'remoteConversationId'>): boolean {
  return Boolean(session.remoteHostId?.trim() || session.remoteConversationId?.trim());
}

export function resolveSessionExecutionTarget(session: Pick<SessionMeta, 'remoteHostId' | 'remoteHostLabel' | 'remoteConversationId'>): {
  key: string;
  label: string;
  isLocal: boolean;
} {
  const remoteHostId = session.remoteHostId?.trim() || '';
  const remoteConversationId = session.remoteConversationId?.trim() || '';
  if (!remoteHostId && !remoteConversationId) {
    return {
      key: 'local',
      label: 'Local',
      isLocal: true,
    };
  }

  const remoteHostLabel = session.remoteHostLabel?.trim();
  return {
    key: remoteHostId || `conversation:${remoteConversationId}`,
    label: remoteHostLabel || remoteHostId || 'Remote',
    isLocal: false,
  };
}

function getSessionWorkspaceCwd(session: Pick<SessionMeta, 'cwd' | 'workspaceCwd'>): string | null {
  return Object.prototype.hasOwnProperty.call(session, 'workspaceCwd') ? (session.workspaceCwd ?? null) : (session.cwd ?? null);
}

export function getLocalSessionWorkspacePath(
  session: Pick<SessionMeta, 'cwd' | 'workspaceCwd' | 'remoteHostId' | 'remoteHostLabel' | 'remoteConversationId'>,
): string {
  const workspaceCwd = getSessionWorkspaceCwd(session);
  return resolveSessionExecutionTarget(session).isLocal ? (workspaceCwd ?? '') : '';
}

function buildScopedConversationGroupKey(input: {
  executionTargetKey: string;
  executionTargetIsLocal: boolean;
  cwdGroupKey: string;
}): string {
  if (input.executionTargetIsLocal) {
    return input.cwdGroupKey;
  }

  return `remote:${input.executionTargetKey}::${input.cwdGroupKey}`;
}

function matchesLetterHotkey(event: KeyboardEvent, code: string, letter: string): boolean {
  return event.code === code || normalizeHotkeyKey(event.key) === letter;
}

function hasOverlayOpen(): boolean {
  return document.querySelector('.ui-overlay-backdrop') !== null;
}

function isFocusWithinWorkbenchOpenFile(): boolean {
  const activeElement = document.activeElement;
  if (!(activeElement instanceof Element)) {
    return false;
  }

  return activeElement.closest(WORKBENCH_DOCUMENT_WITH_OPEN_FILE_SELECTOR) !== null;
}

function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') {
    return false;
  }

  return /mac|iphone|ipad|ipod/i.test(navigator.platform);
}

function getNewConversationHotkeyLabel(): string {
  if (getDesktopBridge() !== null) {
    return isMacPlatform() ? '⌘N' : 'Ctrl+N';
  }

  return SIDEBAR_BROWSER_NEW_CHAT_HOTKEY;
}

function isDesktopConversationShortcutAction(value: unknown): value is DesktopConversationShortcutAction {
  return (
    value === 'close-conversation' ||
    value === 'reopen-closed-conversation' ||
    value === 'previous-conversation' ||
    value === 'next-conversation' ||
    value === 'toggle-conversation-pin' ||
    value === 'toggle-conversation-archive'
  );
}

function TopNavItem({
  to,
  icon,
  label,
  badge,
  forceActive = false,
}: {
  to: string;
  icon: string;
  label: string;
  badge?: number | null;
  forceActive?: boolean;
}) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        ['ui-sidebar-nav-item', (forceActive || isActive) && 'ui-sidebar-nav-item-active'].filter(Boolean).join(' ')
      }
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
      >
        <path d={icon} />
      </svg>
      <span className="flex-1">{label}</span>
      {badge != null && badge > 0 && <span className="ui-sidebar-nav-badge">{badge > 99 ? '99+' : badge}</span>}
    </NavLink>
  );
}

function ThreadsFilterButton({
  organizeMode,
  filterMode,
  sortMode,
  onChangeOrganizeMode,
  onChangeFilterMode,
  onChangeSortMode,
}: {
  organizeMode: ThreadsOrganizeMode;
  filterMode: ThreadsFilterMode;
  sortMode: ThreadsSortMode;
  onChangeOrganizeMode: (value: ThreadsOrganizeMode) => void;
  onChangeFilterMode: (value: ThreadsFilterMode) => void;
  onChangeSortMode: (value: ThreadsSortMode) => void;
}) {
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRootRef = useRef<HTMLDivElement | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<{ x: number; y: number } | null>(null);
  const menuItemClass = 'ui-context-menu-item';

  useEffect(() => {
    if (!menuOpen || typeof document === 'undefined') {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }

      if (menuRootRef.current?.contains(target) || buttonRef.current?.contains(target)) {
        return;
      }

      setMenuOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setMenuOpen(false);
      }
    }

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [menuOpen]);

  function openMenu() {
    const bounds = buttonRef.current?.getBoundingClientRect();
    if (!bounds) {
      return;
    }

    const menuWidth = 172;
    const menuHeight = 320;
    const edgePadding = 12;
    const viewportWidth = typeof window === 'undefined' ? Number.POSITIVE_INFINITY : window.innerWidth;
    const viewportHeight = typeof window === 'undefined' ? Number.POSITIVE_INFINITY : window.innerHeight;

    setMenuPosition({
      x: Math.max(edgePadding, Math.min(bounds.right - menuWidth, viewportWidth - menuWidth - edgePadding)),
      y: Math.max(edgePadding, Math.min(bounds.bottom + 6, viewportHeight - menuHeight - edgePadding)),
    });
    setMenuOpen(true);
  }

  function stopMenuEvent(event: { preventDefault: () => void; stopPropagation: () => void }) {
    event.preventDefault();
    event.stopPropagation();
  }

  function handleMenuToggle() {
    if (menuOpen) {
      setMenuOpen(false);
      return;
    }

    openMenu();
  }

  function renderMenuItem({ label, icon, checked, onClick }: { label: string; icon: string; checked: boolean; onClick: () => void }) {
    return (
      <button
        type="button"
        onPointerDown={stopMenuEvent}
        onMouseDown={stopMenuEvent}
        onClick={() => {
          onClick();
          setMenuOpen(false);
        }}
        className={menuItemClass}
        role="menuitemradio"
        aria-checked={checked}
      >
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <span className="shrink-0 text-secondary">
            <Ico d={icon} size={11} />
          </span>
          <span className="truncate">{label}</span>
        </span>
        <span className="ml-3 flex h-4 w-4 shrink-0 items-center justify-center text-accent">
          {checked ? <Ico d={PATH.check} size={11} /> : null}
        </span>
      </button>
    );
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={handleMenuToggle}
        className="ui-icon-button ui-icon-button-compact shrink-0"
        title="Organize and sort threads"
        aria-label="Organize and sort threads"
        aria-expanded={menuOpen}
        aria-haspopup="menu"
      >
        <Ico d={PATH.filter} size={12} />
      </button>
      {menuOpen && menuPosition ? (
        <div
          ref={menuRootRef}
          className="ui-menu-shell ui-context-menu-shell fixed bottom-auto left-auto right-auto top-auto mb-0 min-w-[172px]"
          style={{ left: menuPosition.x, top: menuPosition.y }}
          role="menu"
          aria-label="Threads organization options"
        >
          <div className="space-y-px">
            <div className="px-2.5 pt-2 pb-1 text-[12px] font-medium text-dim">Show</div>
            {renderMenuItem({
              label: 'All threads',
              icon: PATH.list,
              checked: filterMode === 'all',
              onClick: () => onChangeFilterMode('all'),
            })}
            {renderMenuItem({
              label: 'Human threads',
              icon: PATH.conversations,
              checked: filterMode === 'human',
              onClick: () => onChangeFilterMode('human'),
            })}
            {renderMenuItem({
              label: 'Automation threads',
              icon: PATH.automations,
              checked: filterMode === 'automation',
              onClick: () => onChangeFilterMode('automation'),
            })}
            <div className="my-1 h-px bg-border-subtle" aria-hidden="true" />
            <div className="px-2.5 pt-1 pb-1 text-[12px] font-medium text-dim">Organize</div>
            {renderMenuItem({
              label: 'By project',
              icon: PATH.workspace,
              checked: organizeMode === 'project',
              onClick: () => onChangeOrganizeMode('project'),
            })}
            {renderMenuItem({
              label: 'Chronological list',
              icon: PATH.list,
              checked: organizeMode === 'chronological',
              onClick: () => onChangeOrganizeMode('chronological'),
            })}
            <div className="my-1 h-px bg-border-subtle" aria-hidden="true" />
            <div className="px-2.5 pt-1 pb-1 text-[12px] font-medium text-dim">Order</div>
            {renderMenuItem({
              label: 'Created',
              icon: PATH.clock,
              checked: sortMode === 'created',
              onClick: () => onChangeSortMode('created'),
            })}
            {renderMenuItem({
              label: 'Updated',
              icon: PATH.sparkles,
              checked: sortMode === 'updated',
              onClick: () => onChangeSortMode('updated'),
            })}
            {renderMenuItem({
              label: 'Manual order',
              icon: PATH.grip,
              checked: sortMode === 'manual',
              onClick: () => onChangeSortMode('manual'),
            })}
          </div>
        </div>
      ) : null}
    </>
  );
}

function ConversationExecutionTargetHeader({ label }: { label: string }) {
  return (
    <div className="px-4 pb-0.5 pt-1 text-[10px] uppercase tracking-[0.12em] text-accent/80">
      <span className="inline-flex min-w-0 items-center gap-1.5" title={`Execution target: ${label}`}>
        <svg width="11" height="11" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
          <rect x="1.75" y="2" width="4.5" height="3.5" rx="1" />
          <rect x="7.75" y="8.5" width="4.5" height="3.5" rx="1" />
          <path d="M6.2 4.8h1.5c1.1 0 2 .9 2 2v1" />
          <path d="M7.9 7.8 9.7 7.8 9.7 6" />
        </svg>
        <span className="truncate">{label}</span>
      </span>
    </div>
  );
}

function ConversationCwdGroupHeader({
  label,
  cwd,
  collapsed,
  canDrag = false,
  isDragging = false,
  isConversationDropTarget = false,
  dropPosition = null,
  dragId,
  onToggleCollapsed,
  onNewConversation,
  onOpenInFinder,
  onEditName,
  onArchiveThreads,
  onRemove,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}: {
  label: string;
  cwd: string | null;
  collapsed: boolean;
  canDrag?: boolean;
  isDragging?: boolean;
  isConversationDropTarget?: boolean;
  dropPosition?: OpenConversationDropPosition | null;
  dragId?: string;
  onToggleCollapsed: () => void;
  onNewConversation: () => void;
  onOpenInFinder?: () => void | Promise<void>;
  onEditName?: () => void | Promise<void>;
  onArchiveThreads?: () => void | Promise<void>;
  onRemove?: () => void | Promise<void>;
  onDragStart?: (event: DragEvent<HTMLDivElement>) => void;
  onDragOver?: (event: DragEvent<HTMLDivElement>) => void;
  onDrop?: (event: DragEvent<HTMLDivElement>) => void;
  onDragEnd?: (event: DragEvent<HTMLDivElement>) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const menuRootRef = useRef<HTMLDivElement | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<{ x: number; y: number } | null>(null);
  const hoverTitle = cwd ?? label;
  const newConversationTitle = cwd ? `New conversation in ${cwd}` : 'New conversation';
  const workspaceActionsTitle = cwd ? `Workspace actions for ${cwd}` : `Chat actions for ${label}`;
  const toggleTitle = `${collapsed ? 'Expand' : 'Collapse'} ${label}`;
  const iconPath = hovered ? (collapsed ? PATH.chevronRight : PATH.chevronDown) : cwd ? PATH.workspace : PATH.chatBubble;
  const hasMenuActions = Boolean(onOpenInFinder || onEditName || onArchiveThreads || onRemove);
  const menuActionCount =
    Number(Boolean(onOpenInFinder)) + Number(Boolean(onEditName)) + Number(Boolean(onArchiveThreads)) + Number(Boolean(onRemove));
  const showMenuDivider = Boolean((onOpenInFinder || onEditName) && (onArchiveThreads || onRemove));
  const menuItemClass = 'ui-context-menu-item';
  const toggleButtonClassName = [
    'flex min-w-0 flex-1 items-center gap-2 rounded-md py-1 text-left text-primary transition-colors hover:bg-white/5',
    canDrag && (isDragging ? 'cursor-grabbing opacity-60' : 'cursor-grab'),
  ]
    .filter(Boolean)
    .join(' ');

  useEffect(() => {
    if (!menuOpen || typeof document === 'undefined') {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node) || !menuRootRef.current || menuRootRef.current.contains(target)) {
        return;
      }

      setMenuOpen(false);
    }

    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [menuOpen]);

  function stopMenuEvent(event: { preventDefault: () => void; stopPropagation: () => void }) {
    event.preventDefault();
    event.stopPropagation();
  }

  function openDomContextMenu(x: number, y: number) {
    const menuWidth = 214;
    const menuHeight = Math.max(1, menuActionCount) * 33 + (showMenuDivider ? 9 : 0) + 10;
    const viewportWidth = typeof window === 'undefined' ? Number.POSITIVE_INFINITY : window.innerWidth;
    const viewportHeight = typeof window === 'undefined' ? Number.POSITIVE_INFINITY : window.innerHeight;
    const edgePadding = 12;

    setMenuPosition({
      x: Math.max(edgePadding, Math.min(x, viewportWidth - menuWidth - edgePadding)),
      y: Math.max(edgePadding, Math.min(y, viewportHeight - menuHeight - edgePadding)),
    });
    setMenuOpen(true);
  }

  async function runMenuHandler(handler?: () => void | Promise<void>) {
    await handler?.();
    setMenuOpen(false);
  }

  async function runNativeContextMenuAction(action: DesktopConversationCwdGroupContextMenuAction | null) {
    switch (action) {
      case 'open-in-finder':
        await onOpenInFinder?.();
        return;
      case 'edit-name':
        await onEditName?.();
        return;
      case 'archive-threads':
        await onArchiveThreads?.();
        return;
      case 'remove':
        await onRemove?.();
        return;
      default:
        return;
    }
  }

  function openContextMenuAt(x: number, y: number) {
    if (!hasMenuActions) {
      return;
    }

    const desktopBridge = shouldUseNativeAppContextMenus() ? getDesktopBridge() : null;
    if (desktopBridge?.showConversationCwdGroupContextMenu) {
      setMenuOpen(false);
      setMenuPosition(null);
      void desktopBridge
        .showConversationCwdGroupContextMenu({
          x,
          y,
          canOpenInFinder: Boolean(onOpenInFinder),
          canEditName: Boolean(onEditName),
          canArchiveThreads: Boolean(onArchiveThreads),
          canRemove: Boolean(onRemove),
        })
        .then(({ action }) => runNativeContextMenuAction(action))
        .catch(() => {
          openDomContextMenu(x, y);
        });
      return;
    }

    openDomContextMenu(x, y);
  }

  function handleContextMenu(event: ReactMouseEvent<HTMLDivElement>) {
    if (!hasMenuActions) {
      return;
    }

    stopMenuEvent(event);
    openContextMenuAt(event.clientX, event.clientY);
  }

  function handleMenuButtonClick(event: ReactMouseEvent<HTMLButtonElement>) {
    stopMenuEvent(event);
    const bounds = event.currentTarget.getBoundingClientRect();
    openContextMenuAt(bounds.left, bounds.bottom + 4);
  }

  return (
    <div
      className={['relative px-4 pt-1 pb-0.5 transition-colors', isConversationDropTarget && 'bg-accent/10'].filter(Boolean).join(' ')}
      onContextMenu={handleContextMenu}
      draggable={canDrag}
      onDragStart={canDrag ? onDragStart : undefined}
      onDragOver={canDrag ? onDragOver : undefined}
      onDrop={canDrag ? onDrop : undefined}
      onDragEnd={canDrag ? onDragEnd : undefined}
      data-sidebar-group-key={dragId}
    >
      {dropPosition ? (
        <span
          aria-hidden="true"
          className={[
            'pointer-events-none absolute left-4 right-4 z-10 h-0.5 rounded-full bg-accent/80',
            dropPosition === 'before' ? 'top-0' : 'bottom-0',
          ].join(' ')}
        />
      ) : null}
      <div className="flex items-center gap-1">
        <button
          type="button"
          draggable={false}
          onClick={onToggleCollapsed}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          className={toggleButtonClassName}
          title={hoverTitle}
          aria-label={toggleTitle}
          aria-expanded={!collapsed}
        >
          <span className="shrink-0 text-secondary">
            <Ico d={iconPath} size={13} />
          </span>
          <span className="min-w-0 truncate text-[14px] font-semibold tracking-tight">{label}</span>
        </button>
        {hasMenuActions ? (
          <button
            type="button"
            draggable={false}
            onClick={handleMenuButtonClick}
            className="ui-icon-button ui-icon-button-compact shrink-0"
            title={workspaceActionsTitle}
            aria-label={workspaceActionsTitle}
          >
            <MoreActionsIcon size={12} />
          </button>
        ) : null}
        <button
          type="button"
          draggable={false}
          onClick={onNewConversation}
          className="ui-icon-button ui-icon-button-compact shrink-0"
          title={newConversationTitle}
          aria-label={newConversationTitle}
        >
          <Ico d={PATH.plus} size={11} />
        </button>
      </div>
      {menuOpen && menuPosition ? (
        <div
          ref={menuRootRef}
          className="ui-menu-shell ui-context-menu-shell fixed bottom-auto left-auto right-auto top-auto mb-0 min-w-[214px]"
          style={{ left: menuPosition.x, top: menuPosition.y }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              setMenuOpen(false);
            }
          }}
          role="menu"
          aria-label={`Workspace actions for ${label}`}
        >
          <div className="space-y-px">
            {onOpenInFinder ? (
              <button
                type="button"
                onPointerDown={stopMenuEvent}
                onMouseDown={stopMenuEvent}
                onClick={() => {
                  void runMenuHandler(onOpenInFinder);
                }}
                className={menuItemClass}
                role="menuitem"
              >
                Open in Finder
              </button>
            ) : null}
            {onEditName ? (
              <button
                type="button"
                onPointerDown={stopMenuEvent}
                onMouseDown={stopMenuEvent}
                onClick={() => {
                  void runMenuHandler(onEditName);
                }}
                className={menuItemClass}
                role="menuitem"
              >
                Edit Name
              </button>
            ) : null}
            {showMenuDivider ? <div className="my-1 h-px bg-border-subtle" aria-hidden="true" /> : null}
            {onArchiveThreads ? (
              <button
                type="button"
                onPointerDown={stopMenuEvent}
                onMouseDown={stopMenuEvent}
                onClick={() => {
                  void runMenuHandler(onArchiveThreads);
                }}
                className={menuItemClass}
                role="menuitem"
              >
                Archive Threads
              </button>
            ) : null}
            {onRemove ? (
              <button
                type="button"
                onPointerDown={stopMenuEvent}
                onMouseDown={stopMenuEvent}
                onClick={() => {
                  void runMenuHandler(onRemove);
                }}
                className={`${menuItemClass} text-danger`}
                role="menuitem"
              >
                Remove
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

type ConversationCopyMenuAction = 'id' | 'working-directory' | 'deeplink';

type ConversationCopyMenuState = {
  action: ConversationCopyMenuAction;
  status: 'copied' | 'failed';
};

function OpenConversationRow({
  session,
  active,
  pinned = false,
  canDrag = false,
  isDragging = false,
  dropPosition = null,
  onPin,
  onUnpin,
  onClose,
  onArchive,
  onOpenInNewWindow,
  onDuplicate,
  onSummarizeAndNew,
  onAttachToGateway,
  onCopyWorkingDirectory,
  onCopyId,
  onCopyDeeplink,
  onPrefetch,
  gatewayProviders = [],
  isAutomation = false,
  automationTitle,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}: {
  session: SessionMeta;
  active: boolean;
  pinned?: boolean;
  canDrag?: boolean;
  isDragging?: boolean;
  dropPosition?: OpenConversationDropPosition | null;
  onPin?: () => void;
  onUnpin?: () => void;
  onClose?: () => void;
  onArchive?: () => boolean | Promise<boolean>;
  onOpenInNewWindow?: () => boolean | Promise<boolean>;
  onDuplicate?: () => boolean | Promise<boolean>;
  onSummarizeAndNew?: () => boolean | Promise<boolean>;
  onAttachToGateway?: () => boolean | Promise<boolean>;
  onCopyWorkingDirectory?: () => boolean | Promise<boolean>;
  onCopyId?: () => boolean | Promise<boolean>;
  onCopyDeeplink?: () => boolean | Promise<boolean>;
  onPrefetch?: () => void;
  gatewayProviders?: Array<'telegram' | 'slack_mcp'>;
  isAutomation?: boolean;
  automationTitle?: string;
  onDragStart?: (event: DragEvent<HTMLDivElement>) => void;
  onDragOver?: (event: DragEvent<HTMLDivElement>) => void;
  onDrop?: (event: DragEvent<HTMLDivElement>) => void;
  onDragEnd?: (event: DragEvent<HTMLDivElement>) => void;
}) {
  const { hoverRef, hovered, onMouseEnter, onMouseLeave } = useSidebarRowHover<HTMLDivElement>();
  const needsAttention = sessionNeedsAttention(session as Parameters<typeof sessionNeedsAttention>[0]);
  const menuRootRef = useRef<HTMLDivElement | null>(null);
  const copyResetTimeoutRef = useRef<number | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<{ x: number; y: number } | null>(null);
  const [busyAction, setBusyAction] = useState<'duplicate' | 'summarize' | null>(null);
  const [copyState, setCopyState] = useState<ConversationCopyMenuState | null>(null);
  const hasContextMenuActions = Boolean(
    onPin ||
    onUnpin ||
    onArchive ||
    onOpenInNewWindow ||
    onDuplicate ||
    onSummarizeAndNew ||
    onAttachToGateway ||
    onCopyWorkingDirectory ||
    onCopyId ||
    onCopyDeeplink,
  );
  const contextMenuItemCount =
    (pinned && onUnpin ? 1 : !pinned && onPin ? 1 : 0) +
    Number(Boolean(onArchive)) +
    Number(Boolean(onOpenInNewWindow)) +
    Number(Boolean(onDuplicate)) +
    Number(Boolean(onSummarizeAndNew)) +
    Number(Boolean(onAttachToGateway)) +
    Number(Boolean(onCopyWorkingDirectory)) +
    Number(Boolean(onCopyId)) +
    Number(Boolean(onCopyDeeplink));

  useEffect(() => {
    if (!menuOpen || typeof document === 'undefined') {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node) || !menuRootRef.current || menuRootRef.current.contains(target)) {
        return;
      }

      setMenuOpen(false);
    }

    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [menuOpen]);

  useEffect(
    () => () => {
      if (copyResetTimeoutRef.current !== null) {
        window.clearTimeout(copyResetTimeoutRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    if (!menuOpen) {
      if (copyResetTimeoutRef.current !== null) {
        window.clearTimeout(copyResetTimeoutRef.current);
        copyResetTimeoutRef.current = null;
      }
      setCopyState(null);
      return;
    }

    if (!copyState) {
      return;
    }

    if (copyResetTimeoutRef.current !== null) {
      window.clearTimeout(copyResetTimeoutRef.current);
    }

    copyResetTimeoutRef.current = window.setTimeout(() => {
      setCopyState(null);
      copyResetTimeoutRef.current = null;
    }, 1500);

    return () => {
      if (copyResetTimeoutRef.current !== null) {
        window.clearTimeout(copyResetTimeoutRef.current);
        copyResetTimeoutRef.current = null;
      }
    };
  }, [copyState, menuOpen]);

  const showQuickActions = hovered || menuOpen;
  const showCloseButton = showQuickActions && Boolean(onClose);
  const showTrailingControls = showCloseButton;
  const rowTitle = canDrag ? 'Drag to reorder conversations' : undefined;
  const menuItemClass = 'ui-context-menu-item';

  function stopRowInteraction(event: { preventDefault: () => void; stopPropagation: () => void }) {
    event.preventDefault();
    event.stopPropagation();
  }

  async function runMenuAction(action: 'duplicate' | 'summarize', handler: () => boolean | Promise<boolean>) {
    if (busyAction) {
      return;
    }

    setBusyAction(action);
    try {
      const succeeded = await handler();
      if (succeeded !== false) {
        setMenuOpen(false);
      }
    } finally {
      setBusyAction(null);
    }
  }

  function getCopyMenuLabel(action: ConversationCopyMenuAction): string {
    if (!copyState || copyState.action !== action) {
      switch (action) {
        case 'working-directory':
          return 'Copy Working Directory';
        case 'id':
          return 'Copy Session ID';
        case 'deeplink':
          return 'Copy Deeplink';
      }
    }

    if (copyState.status === 'failed') {
      return 'Copy Failed';
    }

    switch (action) {
      case 'working-directory':
        return 'Copied Working Directory';
      case 'id':
        return 'Copied Session ID';
      case 'deeplink':
        return 'Copied Deeplink';
    }
  }

  async function handleCopyClick(action: ConversationCopyMenuAction, handler?: () => boolean | Promise<boolean>) {
    if (!handler || busyAction) {
      return;
    }

    const succeeded = await handler();
    setCopyState({ action, status: succeeded === false ? 'failed' : 'copied' });
  }

  function openDomContextMenu(x: number, y: number) {
    const menuWidth = 224;
    const menuHeight = Math.max(1, contextMenuItemCount) * 33 + 10;
    const viewportWidth = typeof window === 'undefined' ? Number.POSITIVE_INFINITY : window.innerWidth;
    const viewportHeight = typeof window === 'undefined' ? Number.POSITIVE_INFINITY : window.innerHeight;
    const edgePadding = 12;

    setMenuPosition({
      x: Math.max(edgePadding, Math.min(x, viewportWidth - menuWidth - edgePadding)),
      y: Math.max(edgePadding, Math.min(y, viewportHeight - menuHeight - edgePadding)),
    });
    setMenuOpen(true);
  }

  async function runNativeContextMenuAction(action: DesktopConversationContextMenuAction | null) {
    if (!action) {
      return;
    }

    switch (action) {
      case 'pin':
        await onPin?.();
        return;
      case 'unpin':
        await onUnpin?.();
        return;
      case 'archive':
        await onArchive?.();
        return;
      case 'open-in-new-window':
        await onOpenInNewWindow?.();
        return;
      case 'duplicate':
        if (onDuplicate) {
          await runMenuAction('duplicate', onDuplicate);
        }
        return;
      case 'summarize-and-new':
        if (onSummarizeAndNew) {
          await runMenuAction('summarize', onSummarizeAndNew);
        }
        return;
      case 'attach-to-gateway':
        await onAttachToGateway?.();
        return;
      case 'copy-working-directory':
        await onCopyWorkingDirectory?.();
        return;
      case 'copy-id':
        await onCopyId?.();
        return;
      case 'copy-deeplink':
        await onCopyDeeplink?.();
        return;
    }
  }

  const handleConversationIntent = useCallback(() => {
    onPrefetch?.();
  }, [onPrefetch]);

  function handleContextMenu(event: ReactMouseEvent<HTMLDivElement>) {
    if (!hasContextMenuActions) {
      return;
    }

    stopRowInteraction(event);
    const x = event.clientX;
    const y = event.clientY;
    const desktopBridge = shouldUseNativeAppContextMenus() ? getDesktopBridge() : null;

    if (desktopBridge?.showConversationContextMenu) {
      setMenuOpen(false);
      setMenuPosition(null);
      void desktopBridge
        .showConversationContextMenu({
          x,
          y,
          pinAction: pinned && onUnpin ? 'unpin' : !pinned && onPin ? 'pin' : null,
          canArchive: Boolean(onArchive),
          canOpenInNewWindow: Boolean(onOpenInNewWindow),
          canDuplicate: Boolean(onDuplicate),
          canSummarizeAndNew: Boolean(onSummarizeAndNew),
          canAttachToGateway: Boolean(onAttachToGateway),
          canCopyWorkingDirectory: Boolean(onCopyWorkingDirectory),
          canCopyId: Boolean(onCopyId),
          canCopyDeeplink: Boolean(onCopyDeeplink),
          busyAction,
        })
        .then(({ action }) => runNativeContextMenuAction(action))
        .catch(() => {
          openDomContextMenu(x, y);
        });
      return;
    }

    openDomContextMenu(x, y);
  }

  return (
    <div
      ref={hoverRef}
      className="relative"
      data-sidebar-session-id={session.id}
      draggable={canDrag}
      onDragStart={canDrag ? onDragStart : undefined}
      onDragOver={canDrag ? onDragOver : undefined}
      onDrop={canDrag ? onDrop : undefined}
      onDragEnd={canDrag ? onDragEnd : undefined}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onContextMenu={handleContextMenu}
    >
      {dropPosition ? (
        <span
          aria-hidden="true"
          className={[
            'pointer-events-none absolute left-4 right-4 z-10 h-0.5 rounded-full bg-accent/80',
            dropPosition === 'before' ? 'top-0' : 'bottom-0',
          ].join(' ')}
        />
      ) : null}
      <Link
        to={`/conversations/${session.id}`}
        draggable={false}
        onMouseEnter={handleConversationIntent}
        onFocus={handleConversationIntent}
        onPointerDown={handleConversationIntent}
        className={[
          'ui-sidebar-session-row select-none',
          active && 'ui-sidebar-session-row-active',
          canDrag && (isDragging ? 'cursor-grabbing opacity-60' : 'cursor-grab'),
        ]
          .filter(Boolean)
          .join(' ')}
        title={rowTitle}
      >
        <div className="flex w-3 shrink-0 items-center justify-center self-stretch">
          {session.isRunning || needsAttention ? (
            <ConversationStatusText isRunning={session.isRunning} needsAttention={needsAttention} className="shrink-0" />
          ) : isRemoteConversationSession(session) ? (
            <span
              className="shrink-0 text-accent/80"
              title={session.remoteHostLabel ? `Running on ${session.remoteHostLabel}` : 'Running on a remote host'}
              aria-label={session.remoteHostLabel ? `Running on ${session.remoteHostLabel}` : 'Running on a remote host'}
            >
              <svg width="11" height="11" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
                <rect x="1.75" y="2" width="4.5" height="3.5" rx="1" />
                <rect x="7.75" y="8.5" width="4.5" height="3.5" rx="1" />
                <path d="M6.2 4.8h1.5c1.1 0 2 .9 2 2v1" />
                <path d="M7.9 7.8 9.7 7.8 9.7 6" />
              </svg>
            </span>
          ) : null}
        </div>
        <div className="min-w-0 flex-1 pr-[4.5rem]">
          <div className="flex min-w-0 items-center gap-1.5">
            {isAutomation ? (
              <span
                className="shrink-0 text-accent/75"
                title={automationTitle ? `Automation thread: ${automationTitle}` : 'Automation thread'}
              >
                <Ico d={PATH.automations} size={11} />
              </span>
            ) : null}
            {pinned ? (
              <span className="ui-sidebar-pinned-icon shrink-0" title="Pinned chat" aria-label="Pinned chat">
                <Ico d={PATH.pin} size={11} />
              </span>
            ) : null}
            {gatewayProviders.map((provider) => (
              <GatewayRailIcon key={provider} provider={provider} />
            ))}
            <p className="ui-row-title truncate text-[12px] leading-tight">{session.title}</p>
          </div>
        </div>
      </Link>
      <div className="pointer-events-none absolute inset-y-0 right-2.5 flex w-[3.75rem] items-center justify-end pr-1">
        {showTrailingControls ? (
          <div className="pointer-events-auto flex items-center gap-0.5">
            {showCloseButton ? (
              <button
                type="button"
                onPointerDown={stopRowInteraction}
                onMouseDown={stopRowInteraction}
                onClick={() => onClose?.()}
                className="ui-icon-button ui-icon-button-compact"
                title="Close"
                aria-label="Close"
              >
                <Ico d={PATH.close} size={10} />
              </button>
            ) : null}
          </div>
        ) : (
          <span className="ui-sidebar-session-meta ui-sidebar-session-time shrink-0 whitespace-nowrap">
            {timeAgoCompact(session.timestamp)}
          </span>
        )}
      </div>
      {menuOpen && menuPosition ? (
        <div
          ref={menuRootRef}
          className="ui-menu-shell ui-context-menu-shell fixed bottom-auto left-auto right-auto top-auto mb-0 min-w-[224px]"
          style={{ left: menuPosition.x, top: menuPosition.y }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              setMenuOpen(false);
            }
          }}
          role="menu"
          aria-label={`Conversation actions for ${session.title}`}
        >
          <div className="space-y-px">
            {pinned && onUnpin ? (
              <button
                type="button"
                onPointerDown={stopRowInteraction}
                onMouseDown={stopRowInteraction}
                onClick={async () => {
                  const succeeded = await onUnpin();
                  if (succeeded !== false) {
                    setMenuOpen(false);
                  }
                }}
                className={menuItemClass}
                disabled={busyAction !== null}
                role="menuitem"
              >
                Unpin
              </button>
            ) : null}
            {!pinned && onPin ? (
              <button
                type="button"
                onPointerDown={stopRowInteraction}
                onMouseDown={stopRowInteraction}
                onClick={async () => {
                  const succeeded = await onPin();
                  if (succeeded !== false) {
                    setMenuOpen(false);
                  }
                }}
                className={menuItemClass}
                disabled={busyAction !== null}
                role="menuitem"
              >
                Pin
              </button>
            ) : null}
            {onArchive ? (
              <button
                type="button"
                onPointerDown={stopRowInteraction}
                onMouseDown={stopRowInteraction}
                onClick={async () => {
                  const succeeded = await onArchive();
                  if (succeeded !== false) {
                    setMenuOpen(false);
                  }
                }}
                className={menuItemClass}
                disabled={busyAction !== null}
                role="menuitem"
              >
                Archive
              </button>
            ) : null}
            {onOpenInNewWindow ? (
              <button
                type="button"
                onPointerDown={stopRowInteraction}
                onMouseDown={stopRowInteraction}
                onClick={async () => {
                  const succeeded = await onOpenInNewWindow?.();
                  if (succeeded !== false) {
                    setMenuOpen(false);
                  }
                }}
                className={menuItemClass}
                disabled={busyAction !== null}
                role="menuitem"
              >
                Open in Separate Window
              </button>
            ) : null}
            {onDuplicate ? (
              <button
                type="button"
                onPointerDown={stopRowInteraction}
                onMouseDown={stopRowInteraction}
                onClick={() => {
                  void runMenuAction('duplicate', onDuplicate);
                }}
                className={menuItemClass}
                disabled={busyAction !== null}
                role="menuitem"
              >
                {busyAction === 'duplicate' ? 'Duplicating…' : 'Duplicate'}
              </button>
            ) : null}
            {onSummarizeAndNew ? (
              <button
                type="button"
                onPointerDown={stopRowInteraction}
                onMouseDown={stopRowInteraction}
                onClick={() => {
                  void runMenuAction('summarize', onSummarizeAndNew);
                }}
                className={menuItemClass}
                disabled={busyAction !== null}
                role="menuitem"
              >
                {busyAction === 'summarize' ? 'Summarizing…' : 'Summarize & New'}
              </button>
            ) : null}
            {onAttachToGateway ? (
              <button
                type="button"
                onPointerDown={stopRowInteraction}
                onMouseDown={stopRowInteraction}
                onClick={async () => {
                  const succeeded = await onAttachToGateway();
                  if (succeeded !== false) {
                    setMenuOpen(false);
                  }
                }}
                className={menuItemClass}
                disabled={busyAction !== null}
                role="menuitem"
              >
                Attach to Gateway
              </button>
            ) : null}
            {onCopyWorkingDirectory ? (
              <button
                type="button"
                onPointerDown={stopRowInteraction}
                onMouseDown={stopRowInteraction}
                onClick={() => {
                  void handleCopyClick('working-directory', onCopyWorkingDirectory);
                }}
                className={menuItemClass}
                disabled={busyAction !== null}
                role="menuitem"
              >
                {getCopyMenuLabel('working-directory')}
              </button>
            ) : null}
            {onCopyId ? (
              <button
                type="button"
                onPointerDown={stopRowInteraction}
                onMouseDown={stopRowInteraction}
                onClick={() => {
                  void handleCopyClick('id', onCopyId);
                }}
                className={menuItemClass}
                disabled={busyAction !== null}
                role="menuitem"
              >
                {getCopyMenuLabel('id')}
              </button>
            ) : null}
            {onCopyDeeplink ? (
              <button
                type="button"
                onPointerDown={stopRowInteraction}
                onMouseDown={stopRowInteraction}
                onClick={() => {
                  void handleCopyClick('deeplink', onCopyDeeplink);
                }}
                className={menuItemClass}
                disabled={busyAction !== null}
                role="menuitem"
              >
                {getCopyMenuLabel('deeplink')}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function Sidebar({ hideBrowserNav = false }: { hideKnowledgeNav?: boolean; hideBrowserNav?: boolean }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { versions } = useAppEvents();
  const { sessions, tasks } = useAppData();
  const {
    pinnedIds,
    openIds,
    archivedConversationIds,
    pinnedSessions,
    tabs,
    archivedSessions,
    openSession,
    closeSession,
    pinSession,
    unpinSession,
    archiveSession,
    restoreSession,
    reopenMostRecentlyClosedSession,
    moveSession,
    shiftSession,
    loading,
    refetch,
  } = useConversations();

  const [draftCwd, setDraftCwd] = useState(() => readDraftConversationCwd());
  const [savedWorkspacePaths, setSavedWorkspacePaths] = useState(() => readStoredWorkspacePaths());
  const [savedWorkspacePathsLoaded, setSavedWorkspacePathsLoaded] = useState(false);
  const [workspaceBootstrapHasOpenConversations, setWorkspaceBootstrapHasOpenConversations] = useState(false);
  const [workspaceSyncReady, setWorkspaceSyncReady] = useState(false);
  const [workspaceQuickSelectOpen, setWorkspaceQuickSelectOpen] = useState(false);
  const [threadsOrganizeMode, setThreadsOrganizeMode] = useState<ThreadsOrganizeMode>(() => readThreadsOrganizeMode());
  const [threadsFilterMode, setThreadsFilterMode] = useState<ThreadsFilterMode>(() => readThreadsFilterMode());
  const [threadsSortMode, setThreadsSortMode] = useState<ThreadsSortMode>(() => readThreadsSortMode());
  const [manualConversationGroupOrder, setManualConversationGroupOrder] = useState(() => readManualConversationGroupOrder());
  const [collapsedConversationGroupKeys, setCollapsedConversationGroupKeys] = useState(() => readCollapsedConversationGroupKeys());
  const [conversationGroupLabelOverrides, setConversationGroupLabelOverrides] = useState(() => readConversationGroupLabelOverrides());
  const [draggingSessionId, setDraggingSessionId] = useState<string | null>(null);
  const [draggingSection, setDraggingSection] = useState<ConversationShelf | null>(null);
  const [draggingGroupKey, setDraggingGroupKey] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{
    section: ConversationShelf;
    sessionId: string | null;
    position: OpenConversationDropPosition;
  } | null>(null);
  const [groupDropTarget, setGroupDropTarget] = useState<{
    groupKey: string;
    position: OpenConversationDropPosition;
  } | null>(null);
  const [conversationCwdDropTargetGroupKey, setConversationCwdDropTargetGroupKey] = useState<string | null>(null);
  const conversationSurfaceId = useMemo(() => getOrCreateConversationSurfaceId(), []);
  const sidebarNoticeTimeoutRef = useRef<number | null>(null);
  const [sidebarNotice, setSidebarNotice] = useState<{ tone: 'accent' | 'danger'; text: string } | null>(null);
  const [gatewayState, setGatewayState] = useState<GatewayState | null>(null);
  const [addWorkspaceBusy, setAddWorkspaceBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .gateways()
      .then((next) => {
        if (!cancelled) setGatewayState(next);
      })
      .catch(() => {
        if (!cancelled) setGatewayState(null);
      });
    return () => {
      cancelled = true;
    };
  }, [versions.sessions]);

  useEffect(() => {
    try {
      if (localStorage.getItem(THREADS_ORGANIZE_STORAGE_KEY) !== 'manual') {
        return;
      }
    } catch {
      return;
    }

    writeThreadsOrganizeMode('chronological');
    writeThreadsSortMode('manual');
  }, []);

  const showSidebarNotice = useCallback((tone: 'accent' | 'danger', text: string, durationMs = 2500) => {
    setSidebarNotice({ tone, text });
    if (sidebarNoticeTimeoutRef.current !== null) {
      window.clearTimeout(sidebarNoticeTimeoutRef.current);
    }
    sidebarNoticeTimeoutRef.current = window.setTimeout(() => {
      setSidebarNotice(null);
      sidebarNoticeTimeoutRef.current = null;
    }, durationMs);
  }, []);

  useEffect(
    () => () => {
      if (sidebarNoticeTimeoutRef.current !== null) {
        window.clearTimeout(sidebarNoticeTimeoutRef.current);
      }
    },
    [],
  );

  const visibleConversationTabs = useMemo(() => tabs, [tabs]);
  const workspaceConversationTabs = useMemo(
    () => [...pinnedSessions, ...visibleConversationTabs],
    [pinnedSessions, visibleConversationTabs],
  );
  const pinnedWorkspacePaths = useMemo(
    () => normalizeWorkspacePaths(pinnedSessions.map((session) => getLocalSessionWorkspacePath(session))),
    [pinnedSessions],
  );
  const openWorkspacePaths = useMemo(
    () =>
      normalizeWorkspacePaths([
        draftCwd,
        ...pinnedSessions.map((session) => getLocalSessionWorkspacePath(session)),
        ...visibleConversationTabs.map((session) => getLocalSessionWorkspacePath(session)),
      ]),
    [draftCwd, pinnedSessions, visibleConversationTabs],
  );

  const persistSavedWorkspacePathsState = useCallback((workspacePaths: string[]) => {
    const normalized = normalizeWorkspacePaths(workspacePaths);
    writeStoredWorkspacePaths(normalized);
    setSavedWorkspacePaths(normalized);
    return normalized;
  }, []);
  const persistManualConversationGroupOrder = useCallback((groupKeys: string[]) => {
    const normalized = normalizeStoredStringList(groupKeys);
    writeManualConversationGroupOrder(normalized);
    setManualConversationGroupOrder(normalized);
    return normalized;
  }, []);

  const loadSavedWorkspacePaths = useCallback(async () => {
    try {
      const { sessionIds, pinnedSessionIds, workspacePaths } = await api.openConversationTabs();
      persistSavedWorkspacePathsState(workspacePaths);
      setWorkspaceBootstrapHasOpenConversations(sessionIds.length > 0 || pinnedSessionIds.length > 0);
    } finally {
      setSavedWorkspacePathsLoaded(true);
    }
  }, [persistSavedWorkspacePathsState]);

  useEffect(() => {
    void loadSavedWorkspacePaths().catch(() => {
      setSavedWorkspacePathsLoaded(true);
      setWorkspaceBootstrapHasOpenConversations(false);
    });
  }, [loadSavedWorkspacePaths]);

  useEffect(() => {
    if (!workspaceQuickSelectOpen) {
      return;
    }

    void loadSavedWorkspacePaths().catch(() => {
      // Ignore refresh failures and keep the last saved list.
    });
  }, [loadSavedWorkspacePaths, workspaceQuickSelectOpen]);

  useEffect(() => {
    if (workspaceSyncReady || !savedWorkspacePathsLoaded || sessions === null) {
      return;
    }

    const hasLocalWorkspaceState = draftCwd.trim().length > 0 || pinnedIds.length > 0 || openIds.length > 0;
    if (hasLocalWorkspaceState || !workspaceBootstrapHasOpenConversations) {
      setWorkspaceSyncReady(true);
    }
  }, [
    draftCwd,
    openIds.length,
    pinnedIds.length,
    savedWorkspacePathsLoaded,
    sessions,
    workspaceBootstrapHasOpenConversations,
    workspaceSyncReady,
  ]);

  useEffect(() => {
    if (!workspaceSyncReady || sessions === null) {
      return;
    }

    const nextWorkspacePaths = normalizeWorkspacePaths([...savedWorkspacePaths, ...openWorkspacePaths]);
    if (sameStringLists(savedWorkspacePaths, nextWorkspacePaths)) {
      return;
    }

    persistSavedWorkspacePathsState(nextWorkspacePaths);
    void api.setSavedWorkspacePaths(nextWorkspacePaths).catch(() => {
      // Ignore best-effort sync failures.
    });
  }, [openWorkspacePaths, persistSavedWorkspacePathsState, savedWorkspacePaths, sessions, workspaceSyncReady]);

  const orderedConversationItems = useMemo(() => {
    const pinnedItems: SidebarConversationItem[] = pinnedSessions.map((session, originalIndex) => ({
      session,
      section: 'pinned' as const,
      pinned: true,
      originalIndex,
    }));
    const openItems: SidebarConversationItem[] = visibleConversationTabs.map((session, originalIndex) => ({
      session,
      section: 'open' as const,
      pinned: false,
      originalIndex,
    }));

    if (threadsSortMode === 'manual') {
      return [...pinnedItems, ...openItems];
    }

    return [...pinnedItems, ...[...openItems].sort((left, right) => compareConversationItems(left, right, threadsSortMode))];
  }, [pinnedSessions, threadsSortMode, visibleConversationTabs]);
  const automationThreadTitleByConversationId = useMemo(
    () =>
      new Map(
        (tasks ?? []).flatMap((task) => (task.threadConversationId ? [[task.threadConversationId, task.title ?? task.id] as const] : [])),
      ),
    [tasks],
  );
  const automationConversationIdSet = useMemo(
    () => new Set(automationThreadTitleByConversationId.keys()),
    [automationThreadTitleByConversationId],
  );
  const runningAutomationConversationIdSet = useMemo(
    () => new Set((tasks ?? []).flatMap((task) => (task.running && task.threadConversationId ? [task.threadConversationId] : []))),
    [tasks],
  );
  const filteredConversationItems = useMemo(
    () =>
      orderedConversationItems.filter((item) => {
        const isAutomation = automationConversationIdSet.has(item.session.id);
        if (threadsFilterMode === 'automation') {
          return isAutomation;
        }
        if (threadsFilterMode === 'human') {
          return !isAutomation;
        }
        return true;
      }),
    [automationConversationIdSet, orderedConversationItems, threadsFilterMode],
  );
  const workspaceOrder = useMemo(
    () => normalizeWorkspacePaths([...pinnedWorkspacePaths, ...savedWorkspacePaths, ...openWorkspacePaths]),
    [openWorkspacePaths, pinnedWorkspacePaths, savedWorkspacePaths],
  );
  const conversationGroupLabels = useMemo(
    () =>
      buildConversationGroupLabels([...workspaceOrder, ...filteredConversationItems.map((item) => getSessionWorkspaceCwd(item.session))]),
    [filteredConversationItems, workspaceOrder],
  );
  const manualConversationGroupOrderIndex = useMemo(
    () => new Map(manualConversationGroupOrder.map((groupKey, index) => [groupKey, index] as const)),
    [manualConversationGroupOrder],
  );

  const activeConversationId = useMemo(() => {
    const match = location.pathname.match(/^\/conversations\/([^/]+)$/);
    if (!match || match[1] === 'new') {
      return null;
    }

    return decodeURIComponent(match[1]);
  }, [location.pathname]);
  const conversationBootstrapVersionKey = useMemo(
    () =>
      buildConversationBootstrapVersionKey({
        sessionsVersion: versions.sessions,
        sessionFilesVersion: versions.sessionFiles,
      }),
    [versions.sessionFiles, versions.sessions],
  );
  const prefetchConversation = useCallback(
    (conversationId: string) => {
      const normalizedConversationId = conversationId.trim();
      if (!normalizedConversationId || normalizedConversationId === activeConversationId) {
        return;
      }

      void fetchConversationBootstrapCached(
        normalizedConversationId,
        { tailBlocks: SIDEBAR_CONVERSATION_PREFETCH_TAIL_BLOCKS },
        conversationBootstrapVersionKey,
      ).catch(() => undefined);
    },
    [activeConversationId, conversationBootstrapVersionKey],
  );
  const activeConversationSurfaceId = useMemo(() => {
    if (location.pathname === DRAFT_CONVERSATION_ROUTE) {
      return DRAFT_CONVERSATION_ID;
    }

    return activeConversationId;
  }, [activeConversationId, location.pathname]);
  const resolveCloseRedirectPath = useCallback(
    (closingId: string) =>
      resolveConversationCloseRedirect({
        orderedIds: workspaceConversationTabs.map((session) => session.id),
        closingId,
      }),
    [workspaceConversationTabs],
  );
  const settingsRouteActive = useMemo(() => matchesSettingsRoute(location.pathname), [location.pathname]);
  const groupedConversationRows = useMemo(() => {
    if (threadsOrganizeMode !== 'project') {
      return [];
    }

    const targetBuckets = new Map<
      string,
      {
        executionTargetKey: string;
        executionTargetLabel: string;
        executionTargetIsLocal: boolean;
        items: SidebarConversationItem[];
      }
    >();

    for (const item of filteredConversationItems) {
      const executionTarget = resolveSessionExecutionTarget(item.session);
      const existingBucket = targetBuckets.get(executionTarget.key);
      if (existingBucket) {
        existingBucket.items.push(item);
        continue;
      }

      targetBuckets.set(executionTarget.key, {
        executionTargetKey: executionTarget.key,
        executionTargetLabel: executionTarget.label,
        executionTargetIsLocal: executionTarget.isLocal,
        items: [item],
      });
    }

    if (threadsFilterMode === 'all' && workspaceOrder.length > 0 && !targetBuckets.has('local')) {
      targetBuckets.set('local', {
        executionTargetKey: 'local',
        executionTargetLabel: 'Local',
        executionTargetIsLocal: true,
        items: [],
      });
    }

    const localTargetBucket = targetBuckets.get('local');
    const remoteTargetBuckets = [...targetBuckets.values()]
      .filter((bucket) => !bucket.executionTargetIsLocal)
      .sort((left, right) => left.executionTargetLabel.localeCompare(right.executionTargetLabel, undefined, { sensitivity: 'base' }));
    const orderedTargetBuckets = [...(localTargetBucket ? [localTargetBucket] : []), ...remoteTargetBuckets];

    const rows: SidebarConversationGroup[] = [];

    for (const targetBucket of orderedTargetBuckets) {
      const groupsByCwdKey = new Map(
        groupConversationItemsByCwd(targetBucket.items, (item) => getSessionWorkspaceCwd(item.session), {
          labelsByCwd: conversationGroupLabels,
        }).map((group) => [group.key, group] as const),
      );
      const baseGroups =
        targetBucket.executionTargetIsLocal && threadsFilterMode === 'all'
          ? workspaceOrder.map(
              (workspacePath) =>
                groupsByCwdKey.get(workspacePath) ?? {
                  key: workspacePath,
                  cwd: workspacePath,
                  label: getConversationGroupLabel(workspacePath, { labelsByCwd: conversationGroupLabels }),
                  items: [],
                },
            )
          : [];
      const groups = [...baseGroups];
      const seenGroupKeys = new Set(groups.map((group) => group.key));

      for (const group of groupsByCwdKey.values()) {
        if (seenGroupKeys.has(group.key)) {
          continue;
        }

        groups.push(group);
        seenGroupKeys.add(group.key);
      }

      const targetRows = groups.map((group, groupIndex) => {
        const scopedGroupKey = buildScopedConversationGroupKey({
          executionTargetKey: targetBucket.executionTargetKey,
          executionTargetIsLocal: targetBucket.executionTargetIsLocal,
          cwdGroupKey: group.key,
        });

        return {
          groupIndex,
          row: {
            key: scopedGroupKey,
            cwd: group.cwd,
            defaultLabel: group.cwd ? group.label : 'Chats',
            label: conversationGroupLabelOverrides[scopedGroupKey]?.trim() || (group.cwd ? group.label : 'Chats'),
            items: group.items,
            executionTargetKey: targetBucket.executionTargetKey,
            executionTargetLabel: targetBucket.executionTargetLabel,
            executionTargetIsLocal: targetBucket.executionTargetIsLocal,
          } satisfies SidebarConversationGroup,
        };
      });

      if (threadsSortMode === 'manual') {
        targetRows.sort((left, right) => {
          const leftManualIndex = manualConversationGroupOrderIndex.get(left.row.key);
          const rightManualIndex = manualConversationGroupOrderIndex.get(right.row.key);
          if (leftManualIndex !== undefined || rightManualIndex !== undefined) {
            if (leftManualIndex === undefined) {
              return 1;
            }
            if (rightManualIndex === undefined) {
              return -1;
            }
            if (leftManualIndex !== rightManualIndex) {
              return leftManualIndex - rightManualIndex;
            }
          }

          return left.groupIndex - right.groupIndex;
        });
      }

      rows.push(...targetRows.map((entry) => entry.row));
    }

    return rows;
  }, [
    conversationGroupLabelOverrides,
    conversationGroupLabels,
    filteredConversationItems,
    manualConversationGroupOrderIndex,
    threadsFilterMode,
    threadsOrganizeMode,
    threadsSortMode,
    workspaceOrder,
  ]);
  const conversationGroupsByKey = useMemo(
    () => new Map(groupedConversationRows.map((group) => [group.key, group] as const)),
    [groupedConversationRows],
  );
  const conversationGroupKeyBySessionId = useMemo(
    () => new Map(groupedConversationRows.flatMap((group) => group.items.map(({ session }) => [session.id, group.key] as const))),
    [groupedConversationRows],
  );
  const collapsedConversationGroupKeySet = useMemo(() => new Set(collapsedConversationGroupKeys), [collapsedConversationGroupKeys]);
  const renderedConversationItems = useMemo(
    () => (threadsOrganizeMode === 'project' ? groupedConversationRows.flatMap((group) => group.items) : filteredConversationItems),
    [filteredConversationItems, groupedConversationRows, threadsOrganizeMode],
  );
  const canReorderConversationRows = threadsFilterMode === 'all';
  const canReorderConversationGroups = canReorderConversationRows && threadsOrganizeMode === 'project';
  const hotkeyConversationItems = useMemo(
    () =>
      resolveSidebarConversationHotkeyOrder({
        organizeMode: threadsOrganizeMode,
        orderedItems: filteredConversationItems,
        groupedRows: groupedConversationRows,
        collapsedGroupKeys: collapsedConversationGroupKeySet,
      }),
    [collapsedConversationGroupKeySet, filteredConversationItems, groupedConversationRows, threadsOrganizeMode],
  );

  const toggleConversationGroupCollapsed = useCallback((groupKey: string) => {
    const normalizedGroupKey = groupKey.trim();
    if (!normalizedGroupKey) {
      return;
    }

    setCollapsedConversationGroupKeys((current) => {
      const next = current.includes(normalizedGroupKey)
        ? current.filter((key) => key !== normalizedGroupKey)
        : [...current, normalizedGroupKey];
      writeCollapsedConversationGroupKeys(next);
      return next;
    });
  }, []);

  const clearConversationGroupCollapsedState = useCallback((groupKey: string) => {
    const normalizedGroupKey = groupKey.trim();
    if (!normalizedGroupKey) {
      return;
    }

    setCollapsedConversationGroupKeys((current) => {
      if (!current.includes(normalizedGroupKey)) {
        return current;
      }

      const next = current.filter((key) => key !== normalizedGroupKey);
      writeCollapsedConversationGroupKeys(next);
      return next;
    });
  }, []);

  const updateConversationGroupLabelOverride = useCallback((groupKey: string, nextLabel: string | null) => {
    const normalizedGroupKey = groupKey.trim();
    if (!normalizedGroupKey) {
      return;
    }

    setConversationGroupLabelOverrides((current) => {
      const next = { ...current };
      const normalizedLabel = nextLabel?.trim() ?? '';
      if (normalizedLabel) {
        next[normalizedGroupKey] = normalizedLabel;
      } else {
        delete next[normalizedGroupKey];
      }
      writeConversationGroupLabelOverrides(next);
      return next;
    });
  }, []);

  const handleThreadsOrganizeModeChange = useCallback((value: ThreadsOrganizeMode) => {
    setThreadsOrganizeMode(value);
    writeThreadsOrganizeMode(value);
  }, []);

  const handleThreadsFilterModeChange = useCallback((value: ThreadsFilterMode) => {
    setThreadsFilterMode(value);
    writeThreadsFilterMode(value);
  }, []);

  const handleThreadsSortModeChange = useCallback((value: ThreadsSortMode) => {
    setThreadsSortMode(value);
    writeThreadsSortMode(value);
  }, []);

  function clearDragState() {
    setDraggingSessionId(null);
    setDraggingSection(null);
    setDraggingGroupKey(null);
    setDropTarget(null);
    setGroupDropTarget(null);
    setConversationCwdDropTargetGroupKey(null);
  }

  function getDropPosition(event: DragEvent<HTMLDivElement>): OpenConversationDropPosition {
    const bounds = event.currentTarget.getBoundingClientRect();
    return event.clientY < bounds.top + bounds.height / 2 ? 'before' : 'after';
  }

  function canDropConversationOnSession(draggedSessionId: string, targetSessionId: string): boolean {
    if (threadsOrganizeMode !== 'project') {
      return true;
    }

    const draggedGroupKey = conversationGroupKeyBySessionId.get(draggedSessionId);
    const targetGroupKey = conversationGroupKeyBySessionId.get(targetSessionId);
    return Boolean(draggedGroupKey && targetGroupKey && draggedGroupKey === targetGroupKey);
  }

  function canDropConversationGroupOnGroup(draggedGroupKey: string, targetGroupKey: string): boolean {
    const draggedGroup = conversationGroupsByKey.get(draggedGroupKey);
    const targetGroup = conversationGroupsByKey.get(targetGroupKey);
    return Boolean(draggedGroup && targetGroup && draggedGroup.executionTargetKey === targetGroup.executionTargetKey);
  }

  function canDropConversationOnGroup(draggedSessionId: string, targetGroupKey: string): boolean {
    const targetGroup = conversationGroupsByKey.get(targetGroupKey);
    if (!targetGroup?.executionTargetIsLocal || !targetGroup.cwd) {
      return false;
    }

    const draggedSession = [...pinnedSessions, ...tabs].find((session) => session.id === draggedSessionId);
    if (!draggedSession || isRemoteConversationSession(draggedSession)) {
      return false;
    }

    return normalizeConversationGroupCwd(draggedSession.cwd) !== normalizeConversationGroupCwd(targetGroup.cwd);
  }

  function handleTabDragStart(section: ConversationShelf, sessionId: string, event: DragEvent<HTMLDivElement>) {
    setDraggingSessionId(sessionId);
    setDraggingSection(section);
    setDraggingGroupKey(null);
    setDropTarget(null);
    setGroupDropTarget(null);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('application/x-personal-agent-conversation', sessionId);
    event.dataTransfer.setData('application/x-personal-agent-conversation-section', section);
    event.dataTransfer.setData('text/plain', sessionId);
  }

  function handleConversationGroupDragStart(groupKey: string, event: DragEvent<HTMLDivElement>) {
    setDraggingGroupKey(groupKey);
    setDraggingSessionId(null);
    setDraggingSection(null);
    setDropTarget(null);
    setGroupDropTarget(null);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('application/x-personal-agent-conversation-group', groupKey);
  }

  function handleTabDragOver(section: ConversationShelf, sessionId: string, event: DragEvent<HTMLDivElement>) {
    const draggedId = draggingSessionId ?? event.dataTransfer.getData('text/plain');
    const draggedSection = draggingSection || event.dataTransfer.getData('application/x-personal-agent-conversation-section');
    if (!draggedId || !draggedSection || draggedSection !== section) {
      return;
    }

    if (!canDropConversationOnSession(draggedId, sessionId)) {
      const targetGroupKey = conversationGroupKeyBySessionId.get(sessionId);
      if (targetGroupKey && canDropConversationOnGroup(draggedId, targetGroupKey)) {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        setConversationCwdDropTargetGroupKey((current) => (current === targetGroupKey ? current : targetGroupKey));
      }
      setDropTarget(null);
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';

    if (draggedId === sessionId) {
      setDropTarget(null);
      return;
    }

    const position = getDropPosition(event);
    setDropTarget((current) =>
      current?.section === section && current.sessionId === sessionId && current.position === position
        ? current
        : { section, sessionId, position },
    );
  }

  function handleConversationGroupDragOver(groupKey: string, event: DragEvent<HTMLDivElement>) {
    const draggedConversationId =
      draggingSessionId ||
      event.dataTransfer.getData('application/x-personal-agent-conversation') ||
      event.dataTransfer.getData('text/plain');
    if (draggedConversationId) {
      if (!canDropConversationOnGroup(draggedConversationId, groupKey)) {
        setConversationCwdDropTargetGroupKey(null);
        return;
      }

      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      setConversationCwdDropTargetGroupKey((current) => (current === groupKey ? current : groupKey));
      setGroupDropTarget(null);
      return;
    }

    const draggedGroupId = draggingGroupKey ?? event.dataTransfer.getData('application/x-personal-agent-conversation-group');
    if (!draggedGroupId) {
      return;
    }

    if (!canDropConversationGroupOnGroup(draggedGroupId, groupKey)) {
      setGroupDropTarget(null);
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';

    if (draggedGroupId === groupKey) {
      setGroupDropTarget(null);
      return;
    }

    const position = getDropPosition(event);
    setGroupDropTarget((current) => (current?.groupKey === groupKey && current.position === position ? current : { groupKey, position }));
  }

  async function handleConversationCwdDrop(targetGroupKey: string, event: DragEvent<HTMLDivElement>) {
    event.preventDefault();

    const draggedConversationId =
      draggingSessionId ||
      event.dataTransfer.getData('application/x-personal-agent-conversation') ||
      event.dataTransfer.getData('text/plain');
    const targetGroup = conversationGroupsByKey.get(targetGroupKey);
    if (!draggedConversationId || !targetGroup?.cwd || !canDropConversationOnGroup(draggedConversationId, targetGroupKey)) {
      clearDragState();
      return;
    }

    clearDragState();
    try {
      const result = await api.changeConversationCwd(draggedConversationId, targetGroup.cwd, conversationSurfaceId);
      if (result.changed && result.id !== draggedConversationId) {
        replaceConversationLayout({
          sessionIds: openIds.map((id) => (id === draggedConversationId ? result.id : id)),
          pinnedSessionIds: pinnedIds.map((id) => (id === draggedConversationId ? result.id : id)),
          archivedSessionIds: archivedConversationIds,
        });

        if (activeConversationSurfaceId === draggedConversationId) {
          navigate(buildConversationSurfacePath(result.id));
        }
      }
      await refetch();
      showSidebarNotice(
        'accent',
        result.changed === false ? `Conversation is already in ${targetGroup.label}.` : `Moved conversation to ${targetGroup.label}.`,
      );
    } catch (error) {
      showSidebarNotice('danger', `Move failed: ${error instanceof Error ? error.message : String(error)}`, 4000);
    }
  }

  function handleConversationDrop(
    targetSection: ConversationShelf,
    targetSessionId: string | null,
    position: OpenConversationDropPosition,
  ) {
    if (!draggingSessionId || !draggingSection || draggingSection !== targetSection) {
      clearDragState();
      return;
    }

    if (targetSessionId === draggingSessionId) {
      clearDragState();
      return;
    }

    if (targetSessionId && !canDropConversationOnSession(draggingSessionId, targetSessionId)) {
      clearDragState();
      return;
    }

    if (threadsSortMode !== 'manual') {
      replaceConversationLayout({
        sessionIds: renderedConversationItems.filter((item) => item.section === 'open').map((item) => item.session.id),
        pinnedSessionIds: renderedConversationItems.filter((item) => item.section === 'pinned').map((item) => item.session.id),
        archivedSessionIds: archivedConversationIds,
      });
      setThreadsSortMode('manual');
      writeThreadsSortMode('manual');
    }

    moveSession(draggingSessionId, targetSection, targetSessionId, position);
    clearDragState();
  }

  function handleConversationGroupDrop(targetGroupKey: string, event: DragEvent<HTMLDivElement>) {
    event.preventDefault();

    const draggedConversationId =
      draggingSessionId ||
      event.dataTransfer.getData('application/x-personal-agent-conversation') ||
      event.dataTransfer.getData('text/plain');
    if (draggedConversationId) {
      void handleConversationCwdDrop(targetGroupKey, event);
      return;
    }

    const draggedGroupId = draggingGroupKey ?? event.dataTransfer.getData('application/x-personal-agent-conversation-group');
    if (!draggedGroupId || draggedGroupId === targetGroupKey || !canDropConversationGroupOnGroup(draggedGroupId, targetGroupKey)) {
      clearDragState();
      return;
    }

    const draggedIndex = groupedConversationRows.findIndex((group) => group.key === draggedGroupId);
    const targetIndex = groupedConversationRows.findIndex((group) => group.key === targetGroupKey);
    if (draggedIndex === -1 || targetIndex === -1) {
      clearDragState();
      return;
    }

    const nextGroupedRows = [...groupedConversationRows];
    const [draggedGroup] = nextGroupedRows.splice(draggedIndex, 1);
    if (!draggedGroup) {
      clearDragState();
      return;
    }

    const adjustedTargetIndex = nextGroupedRows.findIndex((group) => group.key === targetGroupKey);
    if (adjustedTargetIndex === -1) {
      clearDragState();
      return;
    }

    const insertIndex = getDropPosition(event) === 'before' ? adjustedTargetIndex : adjustedTargetIndex + 1;
    nextGroupedRows.splice(insertIndex, 0, draggedGroup);

    persistManualConversationGroupOrder(nextGroupedRows.map((group) => group.key));
    replaceConversationLayout({
      sessionIds: nextGroupedRows.flatMap((group) => group.items.filter((item) => item.section === 'open').map((item) => item.session.id)),
      pinnedSessionIds: nextGroupedRows.flatMap((group) =>
        group.items.filter((item) => item.section === 'pinned').map((item) => item.session.id),
      ),
      archivedSessionIds: archivedConversationIds,
    });

    const nextLocalWorkspacePaths = normalizeWorkspacePaths(
      nextGroupedRows.flatMap((group) => (group.executionTargetIsLocal && group.cwd ? [group.cwd] : [])),
    );
    if (!sameStringLists(savedWorkspacePaths, nextLocalWorkspacePaths)) {
      persistSavedWorkspacePathsState(nextLocalWorkspacePaths);
      void api.setSavedWorkspacePaths(nextLocalWorkspacePaths).catch(() => {
        // Ignore best-effort sync failures.
      });
    }

    if (threadsSortMode !== 'manual') {
      setThreadsSortMode('manual');
      writeThreadsSortMode('manual');
    }

    clearDragState();
  }

  function handleTabDrop(section: ConversationShelf, sessionId: string, event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const targetGroupKey = conversationGroupKeyBySessionId.get(sessionId);
    const draggedConversationId =
      draggingSessionId ||
      event.dataTransfer.getData('application/x-personal-agent-conversation') ||
      event.dataTransfer.getData('text/plain');
    if (
      draggedConversationId &&
      targetGroupKey &&
      !canDropConversationOnSession(draggedConversationId, sessionId) &&
      canDropConversationOnGroup(draggedConversationId, targetGroupKey)
    ) {
      void handleConversationCwdDrop(targetGroupKey, event);
      return;
    }

    handleConversationDrop(section, sessionId, getDropPosition(event));
  }

  useEffect(() => {
    setDraftCwd(readDraftConversationCwd());
    setWorkspaceQuickSelectOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!activeConversationId) {
      return;
    }

    const activeSession = [...pinnedSessions, ...tabs, ...archivedSessions].find((session) => session.id === activeConversationId);
    if (!activeSession || !sessionNeedsAttention(activeSession)) {
      return;
    }

    void api.markConversationAttentionRead(activeSession.id).catch(() => {
      // Ignore optimistic attention-clear failures.
    });
  }, [activeConversationId, archivedSessions, pinnedSessions, tabs]);

  const handleNewConversation = useCallback(
    (cwd?: string | null) => {
      const explicitCwd = normalizeConversationGroupCwd(cwd);
      if (explicitCwd) {
        persistDraftConversationCwd(explicitCwd);
        setDraftCwd(explicitCwd);
      } else {
        clearDraftConversationCwd();
        setDraftCwd('');
      }

      navigate('/conversations/new');
    },
    [navigate],
  );

  const handleAddWorkspace = useCallback(() => {
    setWorkspaceQuickSelectOpen(true);
  }, []);

  const handleSelectSavedWorkspace = useCallback(
    (workspacePath: string) => {
      setWorkspaceQuickSelectOpen(false);
      handleNewConversation(workspacePath);
    },
    [handleNewConversation],
  );

  const handleChooseNewWorkspaceFolder = useCallback(async () => {
    if (addWorkspaceBusy) {
      return;
    }

    setAddWorkspaceBusy(true);
    try {
      const result = await api.pickFolder({
        cwd: draftCwd.trim() || undefined,
        prompt: 'Choose a workspace folder',
      });
      if (result.cancelled || !result.path) {
        return;
      }

      const nextWorkspacePaths = normalizeWorkspacePaths([...savedWorkspacePaths, result.path]);
      persistSavedWorkspacePathsState(nextWorkspacePaths);
      void api.setSavedWorkspacePaths(nextWorkspacePaths).catch(() => {
        // Ignore best-effort sync failures.
      });
      setWorkspaceQuickSelectOpen(false);
      handleNewConversation(result.path);
    } catch (error) {
      showSidebarNotice('danger', `Add workspace failed: ${error instanceof Error ? error.message : String(error)}`, 4000);
    } finally {
      setAddWorkspaceBusy(false);
    }
  }, [addWorkspaceBusy, draftCwd, handleNewConversation, persistSavedWorkspacePathsState, savedWorkspacePaths, showSidebarNotice]);

  const resolveLiveConversationIdForAction = useCallback(async (session: Pick<SessionMeta, 'id' | 'isLive'>, actionDescription: string) => {
    if (session.isLive) {
      return session.id;
    }

    const recovered = await api.recoverConversation(session.id);
    if (!recovered.live) {
      throw new Error(`This conversation could not ${actionDescription}.`);
    }

    return recovered.conversationId;
  }, []);

  const openCreatedConversation = useCallback(
    (sessionId: string, initialPromptText?: string) => {
      if (initialPromptText) {
        persistForkPromptDraft(sessionId, initialPromptText);
      }

      openSession(sessionId);
      void refetch().catch(() => {});
      navigate(buildConversationSurfacePath(sessionId));
    },
    [navigate, openSession, refetch],
  );

  const handleDuplicateConversation = useCallback(
    async (session: Pick<SessionMeta, 'id' | 'isLive'>) => {
      try {
        const { newSessionId } = await api.duplicateConversation(session.id);
        openCreatedConversation(newSessionId);
        return true;
      } catch (error) {
        showSidebarNotice('danger', `Duplicate failed: ${error instanceof Error ? error.message : String(error)}`, 4000);
        return false;
      }
    },
    [openCreatedConversation, showSidebarNotice],
  );

  const handleSummarizeConversation = useCallback(
    async (session: Pick<SessionMeta, 'id' | 'isLive'>) => {
      try {
        const liveConversationId = await resolveLiveConversationIdForAction(session, 'be summarized into a new conversation');
        const { newSessionId } = await retryLiveSessionActionAfterTakeover({
          attemptAction: () => api.summarizeAndForkSession(liveConversationId, conversationSurfaceId),
          takeOverSessionControl: () => api.takeoverLiveSession(liveConversationId, conversationSurfaceId),
        });
        openCreatedConversation(newSessionId);
        return true;
      } catch (error) {
        showSidebarNotice('danger', `Summarize & New failed: ${error instanceof Error ? error.message : String(error)}`, 4000);
        return false;
      }
    },
    [conversationSurfaceId, openCreatedConversation, resolveLiveConversationIdForAction, showSidebarNotice],
  );

  const copyTextToClipboard = useCallback(
    async (value: string) => {
      if (typeof navigator === 'undefined' || typeof navigator.clipboard?.writeText !== 'function') {
        showSidebarNotice('danger', 'Clipboard access is unavailable in this browser.', 4000);
        return false;
      }

      try {
        await navigator.clipboard.writeText(value);
        return true;
      } catch {
        showSidebarNotice('danger', 'Copy to clipboard failed.', 4000);
        return false;
      }
    },
    [showSidebarNotice],
  );

  const handleCopyConversationId = useCallback(
    async (conversationId: string) => {
      return copyTextToClipboard(conversationId);
    },
    [copyTextToClipboard],
  );

  const handleCopyConversationWorkingDirectory = useCallback(
    async (cwd: string | null | undefined) => {
      const normalizedCwd = cwd?.trim() ?? '';
      if (!normalizedCwd) {
        showSidebarNotice('danger', 'No working directory is saved for this conversation.', 4000);
        return false;
      }

      return copyTextToClipboard(normalizedCwd);
    },
    [copyTextToClipboard, showSidebarNotice],
  );

  const handleCopyConversationDeeplink = useCallback(
    async (conversationId: string) => {
      if (typeof window === 'undefined') {
        showSidebarNotice('danger', 'Could not build a deeplink for this conversation.', 4000);
        return false;
      }

      try {
        return copyTextToClipboard(buildConversationDeeplink(conversationId, window.location.href));
      } catch {
        showSidebarNotice('danger', 'Could not build a deeplink for this conversation.', 4000);
        return false;
      }
    },
    [copyTextToClipboard, showSidebarNotice],
  );

  const handleAttachConversationToGateway = useCallback(
    async (conversationId: string) => {
      openSession(conversationId);
      navigate(`/conversations/${encodeURIComponent(conversationId)}?gateway=1`);
      return true;
    },
    [navigate, openSession],
  );

  const handleOpenConversationInNewWindow = useCallback(
    async (conversationId: string) => {
      const desktopBridge = getDesktopBridge();
      if (!desktopBridge?.openConversationPopout) {
        showSidebarNotice('danger', 'Separate conversation windows are only available in the desktop app.', 4000);
        return false;
      }

      try {
        await desktopBridge.openConversationPopout({ conversationId });
        return true;
      } catch (error) {
        showSidebarNotice('danger', `Could not open separate window: ${error instanceof Error ? error.message : String(error)}`, 4000);
        return false;
      }
    },
    [showSidebarNotice],
  );

  const resolveConversationGroupRedirectPath = useCallback(
    (closingIds: readonly string[]) => {
      const closingIdSet = new Set(closingIds.map((value) => value.trim()).filter(Boolean));
      const orderedIds = workspaceConversationTabs.map((session) => session.id);
      const remainingIds = orderedIds.filter((id) => !closingIdSet.has(id));
      if (remainingIds.length === 0) {
        return DRAFT_CONVERSATION_ROUTE;
      }

      const activeIndex = activeConversationSurfaceId ? orderedIds.findIndex((id) => id === activeConversationSurfaceId) : -1;
      const nextIndex = activeIndex >= 0 ? Math.min(activeIndex, remainingIds.length - 1) : remainingIds.length - 1;
      return buildConversationSurfacePath(remainingIds[nextIndex]);
    },
    [activeConversationSurfaceId, workspaceConversationTabs],
  );

  const archiveConversationGroupSessions = useCallback(
    (sessionIds: readonly string[]) => {
      const normalizedSessionIds = sessionIds.map((value) => value.trim()).filter(Boolean);
      if (normalizedSessionIds.length === 0) {
        return 0;
      }

      const sessionIdSet = new Set(normalizedSessionIds);
      if (activeConversationSurfaceId && sessionIdSet.has(activeConversationSurfaceId)) {
        navigate(resolveConversationGroupRedirectPath(normalizedSessionIds));
      }

      replaceConversationLayout({
        sessionIds: openIds.filter((id) => !sessionIdSet.has(id)),
        pinnedSessionIds: pinnedIds.filter((id) => !sessionIdSet.has(id)),
        archivedSessionIds: [...new Set([...archivedConversationIds, ...normalizedSessionIds])],
      });

      return normalizedSessionIds.length;
    },
    [activeConversationSurfaceId, archivedConversationIds, navigate, openIds, pinnedIds, resolveConversationGroupRedirectPath],
  );

  const handleOpenConversationGroupInFinder = useCallback(
    async (cwd: string | null, label: string) => {
      const normalizedCwd = normalizeConversationGroupCwd(cwd);
      if (!normalizedCwd) {
        showSidebarNotice('danger', `No working directory is saved for ${label}.`, 4000);
        return;
      }

      const desktopBridge = getDesktopBridge();
      if (!desktopBridge?.openPath) {
        showSidebarNotice('danger', 'Open in Finder is only available in the desktop app.', 4000);
        return;
      }

      const result = await desktopBridge.openPath(normalizedCwd);
      if (!result.opened) {
        showSidebarNotice('danger', result.error ? `Could not open ${label}: ${result.error}` : `Could not open ${label}.`, 4000);
      }
    },
    [showSidebarNotice],
  );

  const handleRenameConversationGroup = useCallback(
    (groupKey: string, defaultLabel: string, currentLabel: string) => {
      if (typeof window === 'undefined') {
        return;
      }

      const nextLabel = window.prompt('Edit workspace name', currentLabel);
      if (nextLabel === null) {
        return;
      }

      const normalizedLabel = nextLabel.trim();
      updateConversationGroupLabelOverride(groupKey, normalizedLabel && normalizedLabel !== defaultLabel ? normalizedLabel : null);

      if (normalizedLabel && normalizedLabel !== defaultLabel) {
        showSidebarNotice('accent', `Workspace renamed to ${normalizedLabel}.`);
        return;
      }

      showSidebarNotice('accent', `Workspace name reset to ${defaultLabel}.`);
    },
    [showSidebarNotice, updateConversationGroupLabelOverride],
  );

  const handleArchiveConversationGroup = useCallback(
    (label: string, sessionIds: readonly string[]) => {
      const archivedCount = archiveConversationGroupSessions(sessionIds);
      if (archivedCount === 0) {
        showSidebarNotice('danger', `No threads to archive in ${label}.`, 4000);
        return;
      }

      showSidebarNotice(
        'accent',
        archivedCount === 1 ? `Archived 1 thread from ${label}.` : `Archived ${archivedCount} threads from ${label}.`,
      );
    },
    [archiveConversationGroupSessions, showSidebarNotice],
  );

  const handleRemoveConversationGroup = useCallback(
    (
      groupKey: string,
      label: string,
      cwd: string | null,
      sessionIds: readonly string[],
      includesDraft: boolean,
      executionTargetIsLocal: boolean,
    ) => {
      const removedCount = archiveConversationGroupSessions(sessionIds);
      updateConversationGroupLabelOverride(groupKey, null);
      clearConversationGroupCollapsedState(groupKey);

      const normalizedCwd = normalizeConversationGroupCwd(cwd);
      if (
        executionTargetIsLocal &&
        includesDraft &&
        normalizedCwd &&
        normalizeConversationGroupCwd(readDraftConversationCwd()) === normalizedCwd
      ) {
        clearDraftConversationCwd();
      }

      if (executionTargetIsLocal && normalizedCwd) {
        const nextWorkspacePaths = savedWorkspacePaths.filter((workspacePath) => workspacePath !== normalizedCwd);
        if (!sameStringLists(savedWorkspacePaths, nextWorkspacePaths)) {
          persistSavedWorkspacePathsState(nextWorkspacePaths);
          void api.setSavedWorkspacePaths(nextWorkspacePaths).catch(() => {
            // Ignore best-effort sync failures.
          });
        }
      }

      if (removedCount === 0 && !includesDraft && !normalizedCwd) {
        showSidebarNotice('danger', `No threads to remove in ${label}.`, 4000);
        return;
      }

      showSidebarNotice('accent', `Removed ${label} from Threads.`);
    },
    [
      archiveConversationGroupSessions,
      clearConversationGroupCollapsedState,
      persistSavedWorkspacePathsState,
      savedWorkspacePaths,
      showSidebarNotice,
      updateConversationGroupLabelOverride,
    ],
  );

  const navigateConversation = useCallback(
    (direction: -1 | 1) => {
      const nextPath = resolveConversationAdjacentPath({
        orderedIds: workspaceConversationTabs.map((session) => session.id),
        activeId: activeConversationSurfaceId,
        direction,
      });

      if (nextPath) {
        navigate(nextPath);
      }
    },
    [activeConversationSurfaceId, navigate, workspaceConversationTabs],
  );

  const jumpToConversation = useCallback(
    (index: number) => {
      if (index < 0 || index >= hotkeyConversationItems.length) {
        return;
      }

      navigate(buildConversationSurfacePath(hotkeyConversationItems[index].session.id));
    },
    [hotkeyConversationItems, navigate],
  );

  const shiftActiveConversation = useCallback(
    (direction: -1 | 1) => {
      if (!activeConversationId) {
        return;
      }

      shiftSession(activeConversationId, direction);
      if (draggingSessionId === activeConversationId) {
        clearDragState();
      }
    },
    [activeConversationId, draggingSessionId, shiftSession],
  );

  const handleReopenClosedConversation = useCallback(() => {
    const sessionId = reopenMostRecentlyClosedSession();
    if (!sessionId) {
      return;
    }

    navigate(buildConversationSurfacePath(sessionId));
  }, [navigate, reopenMostRecentlyClosedSession]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.repeat || hasOverlayOpen()) {
        return;
      }

      const desktopBridge = getDesktopBridge();
      if (desktopBridge !== null) {
        const conversationIndex = resolveConversationNumberHotkey(event);
        if (conversationIndex !== -1) {
          event.preventDefault();
          jumpToConversation(conversationIndex);
          return;
        }

        if (hasCommandOrControlHotkey(event) && event.altKey && !event.shiftKey) {
          if (event.code === 'BracketLeft') {
            event.preventDefault();
            shiftActiveConversation(-1);
            return;
          }

          if (event.code === 'BracketRight') {
            event.preventDefault();
            shiftActiveConversation(1);
            return;
          }
        }
      }

      if (!event.ctrlKey || !event.shiftKey || event.altKey || event.metaKey) {
        return;
      }

      const key = normalizeHotkeyKey(event.key);
      if (matchesLetterHotkey(event, 'KeyN', 'n')) {
        event.preventDefault();
        handleNewConversation();
        return;
      }

      if (event.code === 'BracketLeft' || key === '[' || key === '{') {
        event.preventDefault();
        navigateConversation(-1);
        return;
      }

      if (event.code === 'BracketRight' || key === ']' || key === '}') {
        event.preventDefault();
        navigateConversation(1);
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleNewConversation, jumpToConversation, navigateConversation, shiftActiveConversation]);

  function handleCloseDraftTab() {
    const closeDraft = () => {
      clearDraftConversationAttachments();
      clearDraftConversationComposer();
      clearDraftConversationCwd();
      clearDraftConversationModel();
      clearDraftConversationThinkingLevel();
      setDraftCwd('');
    };

    if (draggingSessionId === DRAFT_CONVERSATION_ID) {
      clearDragState();
    }

    if (location.pathname === DRAFT_CONVERSATION_ROUTE) {
      const nextPath =
        resolveConversationAdjacentPath({
          orderedIds: workspaceConversationTabs.map((session) => session.id),
          activeId: null,
          direction: 1,
        }) ?? DRAFT_CONVERSATION_ROUTE;
      navigate(nextPath);
      window.setTimeout(closeDraft, 0);
      return;
    }

    closeDraft();
  }

  function handleArchiveConversation(sessionId: string) {
    const archiveConversation = () => {
      archiveSession(sessionId);
    };
    const archivingActiveConversation = location.pathname === `/conversations/${sessionId}`;

    if (draggingSessionId === sessionId) {
      clearDragState();
    }

    if (archivingActiveConversation) {
      navigate(resolveCloseRedirectPath(sessionId));
      window.setTimeout(archiveConversation, 0);
      return;
    }

    archiveConversation();
  }

  function handleCloseConversation(sessionId: string) {
    const closeConversation = () => {
      closeSession(sessionId);
    };
    const closingActiveConversation = location.pathname === `/conversations/${sessionId}`;

    if (draggingSessionId === sessionId) {
      clearDragState();
    }

    if (closingActiveConversation) {
      navigate(resolveCloseRedirectPath(sessionId));
      window.setTimeout(closeConversation, 0);
      return;
    }

    closeConversation();
  }

  function handleClosePinnedConversation(sessionId: string) {
    const closeConversation = () => {
      unpinSession(sessionId, { open: false });
    };
    const closingActiveConversation = location.pathname === `/conversations/${sessionId}`;

    if (draggingSessionId === sessionId) {
      clearDragState();
    }

    if (closingActiveConversation) {
      navigate(resolveCloseRedirectPath(sessionId));
      window.setTimeout(closeConversation, 0);
      return;
    }

    closeConversation();
  }

  function handleCloseActiveConversation() {
    if (location.pathname === DRAFT_CONVERSATION_ROUTE) {
      handleCloseDraftTab();
      return;
    }

    if (!activeConversationId) {
      return;
    }

    if (pinnedSessions.some((session) => session.id === activeConversationId)) {
      handleClosePinnedConversation(activeConversationId);
      return;
    }

    if (tabs.some((session) => session.id === activeConversationId)) {
      handleCloseConversation(activeConversationId);
    }
  }

  function handleTogglePinnedActiveConversation() {
    if (location.pathname === DRAFT_CONVERSATION_ROUTE || !activeConversationId) {
      return;
    }

    if (pinnedSessions.some((session) => session.id === activeConversationId)) {
      handleUnpinConversation(activeConversationId);
      return;
    }

    pinSession(activeConversationId);
    if (draggingSessionId === activeConversationId) {
      clearDragState();
    }
  }

  function handleToggleArchivedActiveConversation() {
    if (location.pathname === DRAFT_CONVERSATION_ROUTE || !activeConversationId) {
      return;
    }

    const activeConversationPinned = pinnedSessions.some((session) => session.id === activeConversationId);
    const activeConversationOpen = tabs.some((session) => session.id === activeConversationId);

    if (draggingSessionId === activeConversationId) {
      clearDragState();
    }

    if (activeConversationPinned || activeConversationOpen) {
      handleArchiveConversation(activeConversationId);
      return;
    }

    restoreSession(activeConversationId);
  }

  useEffect(() => {
    if (getDesktopBridge() === null) {
      return;
    }

    function handleDesktopShortcut(event: Event) {
      if (hasOverlayOpen()) {
        return;
      }

      const action = (event as CustomEvent<{ action?: unknown }>).detail?.action;
      if (!isDesktopConversationShortcutAction(action)) {
        return;
      }

      const isKnowledgeRoute = routeIsKnowledge(location.pathname, extensionRegistry.surfaces);

      if (action === 'close-conversation') {
        if (isFocusWithinWorkbenchOpenFile()) {
          window.dispatchEvent(new CustomEvent(WORKBENCH_CLOSE_ACTIVE_FILE_EVENT));
          return;
        }

        if (isKnowledgeRoute) {
          emitKBEvent('kb:close-active-file');
          return;
        }

        handleCloseActiveConversation();
        return;
      }

      if (action === 'reopen-closed-conversation') {
        if (isKnowledgeRoute) {
          emitKBEvent('kb:reopen-closed-file');
          return;
        }

        handleReopenClosedConversation();
        return;
      }

      if (action === 'toggle-conversation-pin') {
        handleTogglePinnedActiveConversation();
        return;
      }

      if (action === 'toggle-conversation-archive') {
        handleToggleArchivedActiveConversation();
        return;
      }

      if (action === 'previous-conversation') {
        navigateConversation(-1);
        return;
      }

      navigateConversation(1);
    }

    window.addEventListener(DESKTOP_CONVERSATION_SHORTCUT_EVENT, handleDesktopShortcut);
    return () => window.removeEventListener(DESKTOP_CONVERSATION_SHORTCUT_EVENT, handleDesktopShortcut);
  }, [
    handleCloseActiveConversation,
    handleReopenClosedConversation,
    handleToggleArchivedActiveConversation,
    handleTogglePinnedActiveConversation,
    navigateConversation,
  ]);

  function handlePinConversation(sessionId: string) {
    pinSession(sessionId);
    if (draggingSessionId === sessionId) {
      clearDragState();
    }
  }

  function handleUnpinConversation(sessionId: string) {
    unpinSession(sessionId);
    if (draggingSessionId === sessionId) {
      clearDragState();
    }
  }

  function renderConversationRow({ session, section, pinned }: SidebarConversationItem) {
    const isDraftTab = session.id === DRAFT_CONVERSATION_ID;
    const canDrag = canReorderConversationRows && !isDraftTab;
    const dropPosition =
      canDrag && dropTarget?.section === section && dropTarget.sessionId === session.id && draggingSessionId !== session.id
        ? dropTarget.position
        : null;

    const isAutomationRunning = runningAutomationConversationIdSet.has(session.id);
    const gatewayProviders =
      gatewayState?.bindings
        .filter((binding) => binding.conversationId === session.id)
        .map((binding) => binding.provider)
        .filter((provider, index, providers) => providers.indexOf(provider) === index) ?? [];

    return (
      <OpenConversationRow
        key={session.id}
        session={isAutomationRunning && !session.isRunning ? { ...session, isRunning: true } : session}
        active={isDraftTab ? location.pathname === DRAFT_CONVERSATION_ROUTE : location.pathname === `/conversations/${session.id}`}
        pinned={pinned}
        canDrag={canDrag}
        isAutomation={isAutomationRunning}
        automationTitle={automationThreadTitleByConversationId.get(session.id)}
        isDragging={canDrag && draggingSessionId === session.id}
        dropPosition={dropPosition}
        onPin={!pinned && !isDraftTab ? () => handlePinConversation(session.id) : undefined}
        onUnpin={pinned ? () => handleUnpinConversation(session.id) : undefined}
        onClose={isDraftTab ? handleCloseDraftTab : !pinned ? () => handleCloseConversation(session.id) : undefined}
        onArchive={
          !isDraftTab
            ? () => {
                handleArchiveConversation(session.id);
                return true;
              }
            : undefined
        }
        onOpenInNewWindow={!isDraftTab ? () => handleOpenConversationInNewWindow(session.id) : undefined}
        onDuplicate={!isDraftTab ? () => handleDuplicateConversation(session) : undefined}
        onSummarizeAndNew={!isDraftTab ? () => handleSummarizeConversation(session) : undefined}
        onAttachToGateway={!isDraftTab ? () => handleAttachConversationToGateway(session.id) : undefined}
        onCopyWorkingDirectory={!isDraftTab && session.cwd?.trim() ? () => handleCopyConversationWorkingDirectory(session.cwd) : undefined}
        onCopyId={!isDraftTab ? () => handleCopyConversationId(session.id) : undefined}
        onCopyDeeplink={!isDraftTab ? () => handleCopyConversationDeeplink(session.id) : undefined}
        onPrefetch={!isDraftTab ? () => prefetchConversation(session.id) : undefined}
        gatewayProviders={gatewayProviders}
        onDragStart={canDrag ? (event) => handleTabDragStart(section, session.id, event) : undefined}
        onDragOver={canDrag ? (event) => handleTabDragOver(section, session.id, event) : undefined}
        onDrop={canDrag ? (event) => handleTabDrop(section, session.id, event) : undefined}
        onDragEnd={canDrag ? () => clearDragState() : undefined}
      />
    );
  }

  const extensionRegistry = useExtensionRegistry();
  const extensionNavItems = useMemo(() => {
    const legacy = extensionRegistry.surfaces.filter(isExtensionLeftNavItemSurface);
    const native = extensionRegistry.extensions.flatMap((extension) =>
      (extension.contributes?.nav ?? []).map(
        (item) =>
          ({ ...item, extensionId: extension.id, packageType: extension.packageType ?? 'user' }) as ExtensionSurfaceSummary & typeof item,
      ),
    );
    return [...legacy, ...native];
  }, [extensionRegistry.extensions, extensionRegistry.surfaces]);
  const browserNavVisible =
    !hideBrowserNav &&
    (extensionRegistry.loading || extensionRegistry.surfaces.some((surface) => surface.extensionId === 'system-browser'));
  const newConversationHotkeyLabel = getNewConversationHotkeyLabel();
  const chatButtonActive = location.pathname === DRAFT_CONVERSATION_ROUTE;
  return (
    <>
      <aside className="flex-1 flex flex-col overflow-hidden">
        <div className="pt-1.5 pb-1 space-y-px">
          <div className="px-1">
            <button
              type="button"
              onClick={() => handleNewConversation()}
              className={['ui-sidebar-nav-item mx-0 flex w-full text-secondary', chatButtonActive && 'ui-sidebar-nav-item-active']
                .filter(Boolean)
                .join(' ')}
              title={`Chat (${newConversationHotkeyLabel})`}
            >
              <Ico d={PATH.plus} size={15} />
              <span className="flex-1 text-left">Chat</span>
            </button>
          </div>
          {extensionNavItems.map((item) => (
            <TopNavItem
              key={`${item.extensionId}:${item.id}`}
              to={item.route}
              icon={getExtensionNavIcon(item.icon)}
              label={item.label}
              forceActive={routeMatchesPrefix(location.pathname, item.route)}
            />
          ))}

          {browserNavVisible ? (
            <button
              type="button"
              onClick={() => {
                window.dispatchEvent(new CustomEvent(DESKTOP_SHOW_WORKBENCH_BROWSER_EVENT));
              }}
              className="ui-sidebar-nav-item w-full text-left"
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
                <circle cx="12" cy="12" r="8.25" />
                <path d="M3.75 12h16.5" />
                <path d="M12 3.75c2.1 2.25 3.15 5 3.15 8.25S14.1 18 12 20.25" />
                <path d="M12 3.75C9.9 6 8.85 8.75 8.85 12S9.9 18 12 20.25" />
              </svg>
              <span className="flex-1 text-left">Browser</span>
            </button>
          ) : null}
        </div>

        <div className="px-4 pt-1 pb-0.5">
          <div className="flex items-center gap-1">
            <p className="ui-section-label flex-1">Threads</p>
            <ThreadsFilterButton
              organizeMode={threadsOrganizeMode}
              filterMode={threadsFilterMode}
              sortMode={threadsSortMode}
              onChangeOrganizeMode={handleThreadsOrganizeModeChange}
              onChangeFilterMode={handleThreadsFilterModeChange}
              onChangeSortMode={handleThreadsSortModeChange}
            />
            <button
              type="button"
              onClick={handleAddWorkspace}
              className="ui-icon-button ui-icon-button-compact -mr-1 shrink-0"
              title={addWorkspaceBusy ? 'Choosing workspace…' : 'Add workspace'}
              aria-label={addWorkspaceBusy ? 'Choosing workspace…' : 'Add workspace'}
              disabled={addWorkspaceBusy}
            >
              <Ico d={PATH.workspaceAdd} size={12} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto min-h-0 pb-3">
          <div className="py-0.5 space-y-0.5">
            {!loading &&
            renderedConversationItems.length === 0 &&
            !(threadsOrganizeMode === 'project' && groupedConversationRows.length > 0) ? (
              <p className="px-4 py-2 text-[12px] text-dim">
                {threadsFilterMode === 'automation'
                  ? 'No automation threads yet.'
                  : threadsFilterMode === 'human'
                    ? 'No human threads yet.'
                    : 'No open conversations yet.'}
              </p>
            ) : null}

            {threadsOrganizeMode === 'project'
              ? groupedConversationRows.map((group, groupIndex) => {
                  const collapsed = collapsedConversationGroupKeySet.has(group.key);
                  const groupSessionIds = group.items
                    .map(({ session }) => session.id)
                    .filter((sessionId) => sessionId !== DRAFT_CONVERSATION_ID);
                  const groupIncludesDraft = group.items.some(({ session }) => session.id === DRAFT_CONVERSATION_ID);
                  const previousGroup = groupIndex > 0 ? groupedConversationRows[groupIndex - 1] : null;
                  const showExecutionTargetHeader =
                    !group.executionTargetIsLocal && (!previousGroup || previousGroup.executionTargetKey !== group.executionTargetKey);

                  const groupDropPosition =
                    canReorderConversationGroups && groupDropTarget?.groupKey === group.key && draggingGroupKey !== group.key
                      ? groupDropTarget.position
                      : null;

                  return (
                    <div key={`cwd:${group.key}`} className="space-y-0.5 pt-1.5 first:pt-0">
                      {showExecutionTargetHeader ? <ConversationExecutionTargetHeader label={group.executionTargetLabel} /> : null}
                      <ConversationCwdGroupHeader
                        label={group.label}
                        cwd={group.cwd}
                        collapsed={collapsed}
                        canDrag={canReorderConversationGroups}
                        isDragging={canReorderConversationGroups && draggingGroupKey === group.key}
                        isConversationDropTarget={conversationCwdDropTargetGroupKey === group.key}
                        dropPosition={groupDropPosition}
                        dragId={group.key}
                        onToggleCollapsed={() => toggleConversationGroupCollapsed(group.key)}
                        onNewConversation={() => handleNewConversation(group.cwd)}
                        onOpenInFinder={
                          group.executionTargetIsLocal && group.cwd
                            ? () => handleOpenConversationGroupInFinder(group.cwd, group.label)
                            : undefined
                        }
                        onEditName={() => handleRenameConversationGroup(group.key, group.defaultLabel, group.label)}
                        onArchiveThreads={
                          groupSessionIds.length > 0 ? () => handleArchiveConversationGroup(group.label, groupSessionIds) : undefined
                        }
                        onRemove={() =>
                          handleRemoveConversationGroup(
                            group.key,
                            group.label,
                            group.cwd,
                            groupSessionIds,
                            groupIncludesDraft,
                            group.executionTargetIsLocal,
                          )
                        }
                        onDragStart={
                          canReorderConversationGroups ? (event) => handleConversationGroupDragStart(group.key, event) : undefined
                        }
                        onDragOver={canReorderConversationGroups ? (event) => handleConversationGroupDragOver(group.key, event) : undefined}
                        onDrop={canReorderConversationGroups ? (event) => handleConversationGroupDrop(group.key, event) : undefined}
                        onDragEnd={canReorderConversationGroups ? () => clearDragState() : undefined}
                      />
                      {!collapsed ? (
                        group.items.length > 0 ? (
                          group.items.map(renderConversationRow)
                        ) : (
                          <p className="px-4 pb-1 text-[12px] text-dim">No threads yet.</p>
                        )
                      ) : null}
                    </div>
                  );
                })
              : filteredConversationItems.map(renderConversationRow)}
          </div>
        </div>

        <div className="shrink-0">
          {sidebarNotice ? (
            <div
              aria-live="polite"
              className={['px-4 pb-2 text-[11px]', sidebarNotice.tone === 'danger' ? 'text-danger/90' : 'text-accent/80'].join(' ')}
            >
              {sidebarNotice.text}
            </div>
          ) : null}
          <div className="border-t border-border-subtle px-2 py-2 space-y-0.5">
            <TopNavItem
              to="/extensions"
              icon={PATH.sparkles}
              label="Extensions"
              forceActive={location.pathname.startsWith('/extensions')}
            />
            <TopNavItem to="/settings" icon={PATH.settings} label="Settings" forceActive={settingsRouteActive} />
          </div>
        </div>
      </aside>
      {workspaceQuickSelectOpen ? (
        <WorkspaceQuickSelectModal
          workspacePaths={savedWorkspacePaths}
          choosingNewFolder={addWorkspaceBusy}
          onClose={() => setWorkspaceQuickSelectOpen(false)}
          onSelectWorkspace={handleSelectSavedWorkspace}
          onChooseNewFolder={() => {
            void handleChooseNewWorkspaceFolder();
          }}
        />
      ) : null}
    </>
  );
}

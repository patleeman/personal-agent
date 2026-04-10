import { type DragEvent, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { ConversationStatusText } from './ConversationStatusText';
import { api } from '../api';
import { useConversations } from '../hooks/useConversations';
import { useAppData } from '../contexts';
import { sessionNeedsAttention } from '../sessionIndicators';
import {
  buildDraftConversationSessionMeta,
  clearDraftConversationAttachments,
  clearDraftConversationComposer,
  clearDraftConversationCwd,
  clearDraftConversationModel,
  clearDraftConversationThinkingLevel,
  DRAFT_CONVERSATION_ID,
  DRAFT_CONVERSATION_ROUTE,
  DRAFT_CONVERSATION_STATE_CHANGED_EVENT,
  hasDraftConversationAttachments,
  persistDraftConversationCwd,
  readDraftConversationComposer,
  readDraftConversationCwd,
  shouldShowDraftConversationTab,
} from '../draftConversation';
import { timeAgo } from '../utils';
import type { ConversationShelf, OpenConversationDropPosition } from '../sessionTabs';
import { groupConversationItemsByCwd } from '../conversationCwdGroups';
import { getDesktopBridge } from '../desktopBridge';
import {
  buildConversationSurfacePath,
  resolveConversationAdjacentPath,
  resolveConversationCloseRedirect,
} from '../conversationRoutes';
import { buildSidebarNavSectionStorageKey } from '../localSettings';

function Ico({ d, size = 16 }: { d: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

const PATH = {
  alerts: 'M14.857 17.082A23.848 23.848 0 0 0 18 18.75a8.967 8.967 0 0 1-6 2.292A8.967 8.967 0 0 1 6 18.75c1.09-.36 2.14-.92 3.143-1.668M14.857 17.082a23.848 23.848 0 0 1-5.714 0M14.857 17.082A5.98 5.98 0 0 0 18 11.25V9.75a6 6 0 1 0-12 0v1.5a5.98 5.98 0 0 0 3.143 5.832M12 3v1.5',
  inbox: 'M2.25 13.5h3.86a2.25 2.25 0 0 1 2.012 1.244l.256.512a2.25 2.25 0 0 0 2.013 1.244h3.218a2.25 2.25 0 0 0 2.013-1.244l.256-.512a2.25 2.25 0 0 1 2.013-1.244h3.859m-19.5.338V18a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18v-4.162c0-.224-.034-.447-.1-.661L19.24 5.338a2.25 2.25 0 0 0-2.15-1.588H6.911a2.25 2.25 0 0 0-2.15 1.588L2.35 13.177a2.25 2.25 0 0 0-.1.661Z',
  conversations: 'M4.5 6.75A2.25 2.25 0 0 1 6.75 4.5h10.5a2.25 2.25 0 0 1 2.25 2.25v7.5a2.25 2.25 0 0 1-2.25 2.25H13.5l-3 3v-3H6.75A2.25 2.25 0 0 1 4.5 14.25v-7.5Z',
  nodes: 'M6 6.75h4.5v4.5H6v-4.5Zm7.5 0H18v4.5h-4.5v-4.5Zm-3.75 7.5h4.5v4.5h-4.5v-4.5Z',
  notes: 'M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25',
  skills: 'M12 3.75l7.5 4.125v8.25L12 20.25 4.5 16.125v-8.25L12 3.75Zm0 0v16.5M4.5 7.875 12 12l7.5-4.125',
  workspace: 'M3.75 6A2.25 2.25 0 0 1 6 3.75h4.19a2.25 2.25 0 0 1 1.59.66l.91.9a2.25 2.25 0 0 0 1.59.66H18A2.25 2.25 0 0 1 20.25 8.25v9A2.25 2.25 0 0 1 18 19.5H6A2.25 2.25 0 0 1 3.75 17.25V6Z',
  automations: 'M12 6v6l4 2m5-2a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  settings: 'M10.5 6h3m-1.5-3v6m4.348-2.826 2.121 2.121m-12.728 0 2.121-2.121m8.486 8.486 2.121 2.121m-12.728 0 2.121-2.121M6 10.5H3m18 0h-3m-5.25 7.5v3m0-18v3',
  close: 'M6 18 18 6M6 6l12 12',
  pin: 'M12 17.25v4.5m0-4.5-4.243-4.243a1.5 1.5 0 0 1-.44-1.06V5.25L6.287 4.22A.75.75 0 0 1 6.818 3h10.364a.75.75 0 0 1 .53 1.28l-1.03 1.03v6.697a1.5 1.5 0 0 1-.44 1.06L12 17.25Z',
  unpin: 'M12 4.5v10.5m0 0-3-3m3 3 3-3M5.25 19.5h13.5',
  chevronDown: 'm6 9 6 6 6-6',
  chevronRight: 'm9 6 6 6-6 6',
  plus: 'M12 5v14M5 12h14',
};

const THREADS_COLLAPSED_CWD_GROUPS_STORAGE_KEY = buildSidebarNavSectionStorageKey('threads-collapsed-cwd-groups');

const SIDEBAR_BROWSER_NEW_CHAT_HOTKEY = 'Ctrl+Shift+N';
const DESKTOP_CONVERSATION_SHORTCUT_EVENT = 'personal-agent-desktop-shortcut';
const SETTINGS_ROUTE_PREFIXES = ['/settings', '/system', '/runs', '/automations', '/scheduled', '/tools', '/instructions'] as const;

type DesktopConversationShortcutAction =
  | 'close-conversation'
  | 'previous-conversation'
  | 'next-conversation'
  | 'toggle-conversation-pin'
  | 'toggle-conversation-archive';

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

function matchesLetterHotkey(event: KeyboardEvent, code: string, letter: string): boolean {
  return event.code === code || normalizeHotkeyKey(event.key) === letter;
}

function hasOverlayOpen(): boolean {
  return document.querySelector('.ui-overlay-backdrop') !== null;
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
  return value === 'close-conversation'
    || value === 'previous-conversation'
    || value === 'next-conversation'
    || value === 'toggle-conversation-pin'
    || value === 'toggle-conversation-archive';
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
      className={({ isActive }) => [
        'ui-sidebar-nav-item',
        (forceActive || isActive) && 'ui-sidebar-nav-item-active',
      ].filter(Boolean).join(' ')}
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 opacity-70">
        <path d={icon} />
      </svg>
      <span className="flex-1">{label}</span>
      {badge != null && badge > 0 && (
        <span className="ui-sidebar-nav-badge">{badge > 99 ? '99+' : badge}</span>
      )}
    </NavLink>
  );
}

function PinnedIndicator() {
  return (
    <span role="img" aria-label="Pinned" className="inline-flex items-center justify-center rounded-md p-1 text-accent/80">
      <Ico d={PATH.pin} size={10} />
    </span>
  );
}

function ConversationCwdGroupHeader({
  label,
  cwd,
  collapsed,
  onToggleCollapsed,
  onNewConversation,
}: {
  label: string;
  cwd: string | null;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onNewConversation: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const hoverTitle = cwd ?? label;
  const newConversationTitle = cwd
    ? `New conversation in ${cwd}`
    : 'New conversation';
  const toggleTitle = `${collapsed ? 'Expand' : 'Collapse'} ${label}`;
  const iconPath = hovered
    ? (collapsed ? PATH.chevronRight : PATH.chevronDown)
    : PATH.workspace;

  return (
    <div className="px-4 pt-3 pb-1">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onToggleCollapsed}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md py-1 text-left text-primary transition-colors hover:bg-white/5"
          title={hoverTitle}
          aria-label={toggleTitle}
          aria-expanded={!collapsed}
        >
          <span className="shrink-0 text-secondary">
            <Ico d={iconPath} size={13} />
          </span>
          <span className="min-w-0 truncate text-[14px] font-semibold tracking-tight">{label}</span>
        </button>
        <button
          type="button"
          onClick={onNewConversation}
          className="ui-icon-button ui-icon-button-compact shrink-0"
          title={newConversationTitle}
          aria-label={newConversationTitle}
        >
          <Ico d={PATH.plus} size={11} />
        </button>
      </div>
    </div>
  );
}

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
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}: {
  session: { id: string; title: string; timestamp: string; cwd: string; isRunning?: boolean };
  active: boolean;
  pinned?: boolean;
  canDrag?: boolean;
  isDragging?: boolean;
  dropPosition?: OpenConversationDropPosition | null;
  onPin?: () => void;
  onUnpin?: () => void;
  onClose?: () => void;
  onDragStart?: (event: DragEvent<HTMLDivElement>) => void;
  onDragOver?: (event: DragEvent<HTMLDivElement>) => void;
  onDrop?: (event: DragEvent<HTMLDivElement>) => void;
  onDragEnd?: (event: DragEvent<HTMLDivElement>) => void;
}) {
  const { hoverRef, hovered, onMouseEnter, onMouseLeave } = useSidebarRowHover<HTMLAnchorElement>();
  const needsAttention = sessionNeedsAttention(session as Parameters<typeof sessionNeedsAttention>[0]);

  const showTrailingControls = hovered || pinned;
  const rowTitle = canDrag ? 'Drag to reorder conversations' : undefined;

  return (
    <div
      className="relative"
      draggable={canDrag}
      onDragStart={canDrag ? onDragStart : undefined}
      onDragOver={canDrag ? onDragOver : undefined}
      onDrop={canDrag ? onDrop : undefined}
      onDragEnd={canDrag ? onDragEnd : undefined}
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
        ref={hoverRef}
        to={`/conversations/${session.id}`}
        draggable={false}
        className={[
          'ui-sidebar-session-row select-none',
          active && 'ui-sidebar-session-row-active',
          canDrag && (isDragging ? 'cursor-grabbing opacity-60' : 'cursor-grab'),
        ].filter(Boolean).join(' ')}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        title={rowTitle}
      >
        <div className="flex w-3 shrink-0 flex-col items-center self-stretch">
          {(session.isRunning || needsAttention) ? (
            <ConversationStatusText
              isRunning={session.isRunning}
              needsAttention={needsAttention}
              className="mt-0.5 shrink-0"
            />
          ) : null}
          <span
            aria-hidden="true"
            className={[
              'mt-0.5 w-px flex-1 rounded-full transition-colors',
              active ? 'bg-accent/80' : 'bg-border-subtle',
            ].join(' ')}
          />
        </div>
        <div className={[
          'min-w-0 flex-1',
          showTrailingControls && 'pr-11',
        ].filter(Boolean).join(' ')}>
          <p className="ui-row-title truncate">{session.title}</p>
          <p className="ui-sidebar-session-meta flex items-center min-w-0">
            <span className="shrink-0">{timeAgo(session.timestamp)}</span>
          </p>
        </div>
        {showTrailingControls ? (
          <div className="absolute right-1.5 top-1.5 flex items-center gap-0.5">
            {!hovered && pinned ? <PinnedIndicator /> : null}
            {hovered && pinned && onUnpin ? (
              <button
                type="button"
                onPointerDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                }}
                onMouseDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                }}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onUnpin();
                }}
                className="ui-icon-button ui-icon-button-compact"
                title="Unpin"
                aria-label="Unpin"
              >
                <Ico d={PATH.unpin} size={10} />
              </button>
            ) : null}
            {hovered && !pinned && onPin ? (
              <button
                type="button"
                onPointerDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                }}
                onMouseDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                }}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onPin();
                }}
                className="ui-icon-button ui-icon-button-compact"
                title="Pin"
                aria-label="Pin"
              >
                <Ico d={PATH.pin} size={10} />
              </button>
            ) : null}
            {hovered && !pinned && onClose ? (
              <button
                type="button"
                onPointerDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                }}
                onMouseDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                }}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onClose();
                }}
                className="ui-icon-button ui-icon-button-compact"
                title="Close"
                aria-label="Close"
              >
                <Ico d={PATH.close} size={10} />
              </button>
            ) : null}
          </div>
        ) : null}
      </Link>
    </div>
  );
}

export function Sidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const { activity } = useAppData();
  const {
    pinnedSessions,
    tabs,
    archivedSessions,
    archivedConversationIds,
    closeSession,
    pinSession,
    unpinSession,
    archiveSession,
    restoreSession,
    moveSession,
    shiftSession,
    loading,
  } = useConversations();

  const [draftComposer, setDraftComposer] = useState(() => readDraftConversationComposer());
  const [draftCwd, setDraftCwd] = useState(() => readDraftConversationCwd());
  const [draftHasAttachments, setDraftHasAttachments] = useState(() => hasDraftConversationAttachments());
  const [collapsedConversationGroupKeys, setCollapsedConversationGroupKeys] = useState(() => readCollapsedConversationGroupKeys());
  const [draggingSessionId, setDraggingSessionId] = useState<string | null>(null);
  const [draggingSection, setDraggingSection] = useState<ConversationShelf | null>(null);
  const [dropTarget, setDropTarget] = useState<{
    section: ConversationShelf;
    sessionId: string | null;
    position: OpenConversationDropPosition;
  } | null>(null);

  const draftTab = useMemo(() => {
    if (!shouldShowDraftConversationTab(location.pathname, draftComposer, draftCwd, draftHasAttachments)) {
      return null;
    }

    return buildDraftConversationSessionMeta(undefined, draftCwd);
  }, [draftComposer, draftCwd, draftHasAttachments, location.pathname]);

  const visibleConversationTabs = useMemo(
    () => draftTab ? [...tabs, draftTab] : tabs,
    [draftTab, tabs],
  );
  const workspaceConversationTabs = useMemo(
    () => [...pinnedSessions, ...visibleConversationTabs],
    [pinnedSessions, visibleConversationTabs],
  );

  const activeConversationId = useMemo(() => {
    const match = location.pathname.match(/^\/conversations\/([^/]+)$/);
    if (!match || match[1] === 'new') {
      return null;
    }

    return decodeURIComponent(match[1]);
  }, [location.pathname]);
  const activeConversationSurfaceId = useMemo(() => {
    if (location.pathname === DRAFT_CONVERSATION_ROUTE) {
      return DRAFT_CONVERSATION_ID;
    }

    return activeConversationId;
  }, [activeConversationId, location.pathname]);
  const resolveCloseRedirectPath = useCallback((closingId: string) => resolveConversationCloseRedirect({
    orderedIds: workspaceConversationTabs.map((session) => session.id),
    closingId,
  }), [workspaceConversationTabs]);
  const settingsRouteActive = useMemo(() => matchesSettingsRoute(location.pathname), [location.pathname]);
  const groupedConversationRows = useMemo(() => groupConversationItemsByCwd([
    ...pinnedSessions.map((session) => ({ session, section: 'pinned' as const, pinned: true })),
    ...visibleConversationTabs.map((session) => ({ session, section: 'open' as const, pinned: false })),
  ], (item) => item.session.cwd), [pinnedSessions, visibleConversationTabs]);
  const collapsedConversationGroupKeySet = useMemo(
    () => new Set(collapsedConversationGroupKeys),
    [collapsedConversationGroupKeys],
  );

  const activeAlertCount = 0;
  const activeAlertActivityIds = useMemo(() => new Set<string>(), []);
  const activeAlertConversationIds = useMemo(() => new Set<string>(), []);
  const standaloneUnreadCount = useMemo(() => {
    const knownConversationIds = new Set([...pinnedSessions, ...tabs, ...archivedSessions].map((session) => session.id));
    return (activity?.entries ?? []).filter((entry) => {
      if (entry.read || activeAlertActivityIds.has(entry.id)) {
        return false;
      }

      return !(entry.relatedConversationIds ?? []).some((conversationId) => knownConversationIds.has(conversationId));
    }).length;
  }, [activity?.entries, activeAlertActivityIds, archivedSessions, pinnedSessions, tabs]);
  const archivedConversationIdSet = useMemo(
    () => new Set(archivedConversationIds),
    [archivedConversationIds],
  );
  const attentionConversationCount = useMemo(
    () => archivedSessions.filter((session) => (
      sessionNeedsAttention(session)
      && !archivedConversationIdSet.has(session.id)
      && !activeAlertConversationIds.has(session.id)
    )).length,
    [activeAlertConversationIds, archivedConversationIdSet, archivedSessions],
  );
  const notificationCount = standaloneUnreadCount + activeAlertCount + attentionConversationCount;

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

  function clearDragState() {
    setDraggingSessionId(null);
    setDraggingSection(null);
    setDropTarget(null);
  }

  function getDropPosition(event: DragEvent<HTMLDivElement>): OpenConversationDropPosition {
    const bounds = event.currentTarget.getBoundingClientRect();
    return event.clientY < bounds.top + bounds.height / 2 ? 'before' : 'after';
  }

  function handleTabDragStart(section: ConversationShelf, sessionId: string, event: DragEvent<HTMLDivElement>) {
    setDraggingSessionId(sessionId);
    setDraggingSection(section);
    setDropTarget(null);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', sessionId);
  }

  function handleTabDragOver(section: ConversationShelf, sessionId: string, event: DragEvent<HTMLDivElement>) {
    const draggedId = draggingSessionId ?? event.dataTransfer.getData('text/plain');
    if (!draggedId || !draggingSection || draggingSection !== section) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';

    if (draggedId === sessionId) {
      setDropTarget(null);
      return;
    }

    const position = getDropPosition(event);
    setDropTarget((current) => (
      current?.section === section && current.sessionId === sessionId && current.position === position
        ? current
        : { section, sessionId, position }
    ));
  }

  function handleConversationDrop(targetSection: ConversationShelf, targetSessionId: string | null, position: OpenConversationDropPosition) {
    if (!draggingSessionId || !draggingSection || draggingSection !== targetSection) {
      clearDragState();
      return;
    }

    if (targetSessionId === draggingSessionId) {
      clearDragState();
      return;
    }

    moveSession(draggingSessionId, targetSection, targetSessionId, position);
    clearDragState();
  }

  function handleTabDrop(section: ConversationShelf, sessionId: string, event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    handleConversationDrop(section, sessionId, getDropPosition(event));
  }

  useEffect(() => {
    function syncDraftState() {
      setDraftComposer(readDraftConversationComposer());
      setDraftCwd(readDraftConversationCwd());
      setDraftHasAttachments(hasDraftConversationAttachments());
    }

    syncDraftState();
    window.addEventListener(DRAFT_CONVERSATION_STATE_CHANGED_EVENT, syncDraftState);
    return () => window.removeEventListener(DRAFT_CONVERSATION_STATE_CHANGED_EVENT, syncDraftState);
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

  const handleNewConversation = useCallback((cwd?: string | null) => {
    const explicitCwd = typeof cwd === 'string' ? cwd.trim() : '';
    if (explicitCwd) {
      persistDraftConversationCwd(explicitCwd);
    }

    navigate('/conversations/new');
  }, [navigate]);

  const navigateConversation = useCallback((direction: -1 | 1) => {
    const nextPath = resolveConversationAdjacentPath({
      orderedIds: workspaceConversationTabs.map((session) => session.id),
      activeId: activeConversationSurfaceId,
      direction,
    });

    if (nextPath) {
      navigate(nextPath);
    }
  }, [activeConversationSurfaceId, navigate, workspaceConversationTabs]);

  const jumpToConversation = useCallback((index: number) => {
    if (index < 0 || index >= workspaceConversationTabs.length) {
      return;
    }

    navigate(buildConversationSurfacePath(workspaceConversationTabs[index].id));
  }, [navigate, workspaceConversationTabs]);

  const shiftActiveConversation = useCallback((direction: -1 | 1) => {
    if (!activeConversationId) {
      return;
    }

    shiftSession(activeConversationId, direction);
    if (draggingSessionId === activeConversationId) {
      clearDragState();
    }
  }, [activeConversationId, draggingSessionId, shiftSession]);

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
      setDraftComposer('');
      setDraftCwd('');
      setDraftHasAttachments(false);
    };

    if (draggingSessionId === DRAFT_CONVERSATION_ID) {
      clearDragState();
    }

    if (location.pathname === DRAFT_CONVERSATION_ROUTE) {
      navigate(resolveCloseRedirectPath(DRAFT_CONVERSATION_ID));
      window.setTimeout(closeDraft, 0);
      return;
    }

    closeDraft();
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
      navigate(resolveCloseRedirectPath(activeConversationId));
      window.setTimeout(() => {
        archiveSession(activeConversationId);
      }, 0);
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

      if (action === 'close-conversation') {
        handleCloseActiveConversation();
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
  }, [handleCloseActiveConversation, handleToggleArchivedActiveConversation, handleTogglePinnedActiveConversation, navigateConversation]);

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

  const newConversationHotkeyLabel = getNewConversationHotkeyLabel();

  return (
    <aside className="flex-1 flex flex-col overflow-hidden">
      <div className="pt-3 pb-2 space-y-0.5">
        <div className="px-1">
          <button
            onClick={() => handleNewConversation()}
            className={[
              'ui-sidebar-nav-item mx-0 flex w-full text-secondary',
              location.pathname.startsWith('/conversations') && 'ui-sidebar-nav-item-active',
            ].filter(Boolean).join(' ')}
            title={`Chat (${newConversationHotkeyLabel})`}
          >
            <Ico d={PATH.plus} size={15} />
            <span className="flex-1 text-left">Chat</span>
          </button>
        </div>
        <TopNavItem to="/automations" icon={PATH.automations} label="Automations" forceActive={location.pathname.startsWith('/automations') || location.pathname.startsWith('/scheduled')} />
      </div>

      <div className="mx-3 border-t border-border-subtle my-2" />

      <div className="px-4 pb-1">
        <p className="ui-section-label">Threads</p>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0 pb-3">
        <div className="py-1 space-y-0.5">
          {!loading && pinnedSessions.length === 0 && visibleConversationTabs.length === 0 ? (
            <p className="px-4 py-2 text-[12px] text-dim">No open conversations yet.</p>
          ) : null}

          {groupedConversationRows.map((group) => {
            const collapsed = collapsedConversationGroupKeySet.has(group.key);

            return (
              <div key={`cwd:${group.key}`} className="space-y-0.5 pt-3 first:pt-0">
                <ConversationCwdGroupHeader
                  label={group.label}
                  cwd={group.cwd}
                  collapsed={collapsed}
                  onToggleCollapsed={() => toggleConversationGroupCollapsed(group.key)}
                  onNewConversation={() => handleNewConversation(group.cwd)}
                />
                {!collapsed ? group.items.map(({ session, section, pinned }) => {
                  const isDraftTab = session.id === DRAFT_CONVERSATION_ID;
                  const canDrag = !isDraftTab;
                  const dropPosition = canDrag && dropTarget?.section === section && dropTarget.sessionId === session.id && draggingSessionId !== session.id
                    ? dropTarget.position
                    : null;

                  return (
                    <OpenConversationRow
                      key={session.id}
                      session={session}
                      active={isDraftTab ? location.pathname === DRAFT_CONVERSATION_ROUTE : location.pathname === `/conversations/${session.id}`}
                      pinned={pinned}
                      canDrag={canDrag}
                      isDragging={canDrag && draggingSessionId === session.id}
                      dropPosition={dropPosition}
                      onPin={!pinned && !isDraftTab ? () => handlePinConversation(session.id) : undefined}
                      onUnpin={pinned ? () => handleUnpinConversation(session.id) : undefined}
                      onClose={isDraftTab ? handleCloseDraftTab : (!pinned ? () => handleCloseConversation(session.id) : undefined)}
                      onDragStart={canDrag ? (event) => handleTabDragStart(section, session.id, event) : undefined}
                      onDragOver={canDrag ? (event) => handleTabDragOver(section, session.id, event) : undefined}
                      onDrop={canDrag ? (event) => handleTabDrop(section, session.id, event) : undefined}
                      onDragEnd={canDrag ? () => clearDragState() : undefined}
                    />
                  );
                }) : null}
              </div>
            );
          })}
        </div>
      </div>

      <div className="border-t border-border-subtle px-2 py-2 shrink-0 space-y-0.5">
        <TopNavItem to="/inbox" icon={PATH.inbox} label="Notifications" badge={notificationCount} />
        <TopNavItem to="/settings" icon={PATH.settings} label="Settings" forceActive={settingsRouteActive} />
      </div>
    </aside>
  );
}

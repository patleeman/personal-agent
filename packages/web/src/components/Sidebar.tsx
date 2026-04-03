import { type DragEvent, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { ConversationStatusText } from './ConversationStatusText';
import { api } from '../api';
import { useApi } from '../hooks';
import { useConversations } from '../hooks/useConversations';
import { useAppData } from '../contexts';
import { sessionNeedsAttention } from '../sessionIndicators';
import {
  buildDraftConversationSessionMeta,
  clearDraftConversationAttachments,
  clearDraftConversationComposer,
  clearDraftConversationCwd,
  clearDraftConversationExecutionTarget,
  clearDraftConversationModel,
  clearDraftConversationProjectIds,
  clearDraftConversationThinkingLevel,
  DRAFT_CONVERSATION_ID,
  DRAFT_CONVERSATION_ROUTE,
  DRAFT_CONVERSATION_STATE_CHANGED_EVENT,
  hasDraftConversationAttachments,
  readDraftConversationComposer,
  readDraftConversationCwd,
  readDraftConversationProjectIds,
  shouldShowDraftConversationTab,
} from '../draftConversation';
import { getSidebarBrandLabel } from '../sidebarBrand';
import { timeAgo } from '../utils';
import { buildNodeCreateSearch, buildNodesHref, readCreatingNode, readSelectedNode } from '../nodeWorkspaceState';
import { baseName, buildWorkspacePath, buildWorkspaceSearch, readWorkspaceCwdFromSearch } from '../workspaceBrowser';
import {
  buildOpenNodeShelfId,
  useOpenResourceShelf,
  closeOpenResourceShelfItem,
  pinOpenResourceShelfItem,
  unpinOpenResourceShelfItem,
  parseOpenNodeShelfId,
} from '../openResourceShelves';
import { buildNestedSessionRows } from '../sessionLineage';
import type { ConversationShelf, OpenConversationDropPosition } from '../sessionTabs';

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
  projects: 'M3.75 6A2.25 2.25 0 0 1 6 3.75h12A2.25 2.25 0 0 1 20.25 6v12A2.25 2.25 0 0 1 18 20.25H6A2.25 2.25 0 0 1 3.75 18V6ZM8.25 8.25h7.5M8.25 12h7.5M8.25 15.75h4.5',
  skills: 'M12 3.75l7.5 4.125v8.25L12 20.25 4.5 16.125v-8.25L12 3.75Zm0 0v16.5M4.5 7.875 12 12l7.5-4.125',
  workspace: 'M3.75 6A2.25 2.25 0 0 1 6 3.75h4.19a2.25 2.25 0 0 1 1.59.66l.91.9a2.25 2.25 0 0 0 1.59.66H18A2.25 2.25 0 0 1 20.25 8.25v9A2.25 2.25 0 0 1 18 19.5H6A2.25 2.25 0 0 1 3.75 17.25V6Z',
  settings: 'M10.5 6h3m-1.5-3v6m4.348-2.826 2.121 2.121m-12.728 0 2.121-2.121m8.486 8.486 2.121 2.121m-12.728 0 2.121-2.121M6 10.5H3m18 0h-3m-5.25 7.5v3m0-18v3',
  close: 'M6 18 18 6M6 6l12 12',
  pin: 'M12 17.25v4.5m0-4.5-4.243-4.243a1.5 1.5 0 0 1-.44-1.06V5.25L6.287 4.22A.75.75 0 0 1 6.818 3h10.364a.75.75 0 0 1 .53 1.28l-1.03 1.03v6.697a1.5 1.5 0 0 1-.44 1.06L12 17.25Z',
  unpin: 'M12 4.5v10.5m0 0-3-3m3 3 3-3M5.25 19.5h13.5',
  chevronDown: 'm6 9 6 6 6-6',
};

const SIDEBAR_NEW_CHAT_HOTKEY = 'Ctrl+Shift+N';
const SETTINGS_ROUTE_PREFIXES = ['/settings', '/system', '/runs', '/scheduled', '/tools', '/instructions'] as const;

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

function matchesSettingsRoute(pathname: string): boolean {
  return SETTINGS_ROUTE_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function normalizeHotkeyKey(key: string): string {
  return key.length === 1 ? key.toLowerCase() : key;
}

function matchesLetterHotkey(event: KeyboardEvent, code: string, letter: string): boolean {
  return event.code === code || normalizeHotkeyKey(event.key) === letter;
}

function hasOverlayOpen(): boolean {
  return document.querySelector('.ui-overlay-backdrop') !== null;
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

function SectionHeader({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 px-4 pt-2 pb-1">
      <span className="ui-section-label">{label}</span>
    </div>
  );
}

function PinnedIndicator() {
  return (
    <span role="img" aria-label="Pinned" className="inline-flex items-center justify-center rounded-md p-1 text-accent/80">
      <Ico d={PATH.pin} size={10} />
    </span>
  );
}

function ShelfRow({
  to,
  active,
  title,
  meta,
  pinned,
  onPin,
  onUnpin,
  onClose,
}: {
  to: string;
  active: boolean;
  title: string;
  meta?: string;
  pinned?: boolean;
  onPin?: () => void;
  onUnpin?: () => void;
  onClose?: () => void;
}) {
  const { hoverRef, hovered, onMouseEnter, onMouseLeave } = useSidebarRowHover<HTMLAnchorElement>();

  const showTrailingControls = hovered || pinned;

  return (
    <Link
      ref={hoverRef}
      to={to}
      className={[
        'ui-sidebar-session-row select-none',
        active && 'ui-sidebar-session-row-active',
      ].filter(Boolean).join(' ')}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <span aria-hidden="true" className={['mt-0.5 self-stretch w-px rounded-full shrink-0 transition-colors', active ? 'bg-accent/80' : 'bg-border-subtle'].join(' ')} />
      <div className={[
        'min-w-0 flex-1',
        showTrailingControls && 'pr-11',
      ].filter(Boolean).join(' ')}>
        <p className="ui-row-title truncate">{title}</p>
        {meta && <p className="ui-sidebar-session-meta truncate">{meta}</p>}
      </div>
      {showTrailingControls ? (
        <div className="absolute right-1.5 top-1.5 flex items-center gap-0.5">
          {!hovered && pinned ? <PinnedIndicator /> : null}
          {hovered && pinned && onUnpin ? (
            <button
              type="button"
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
  );
}

function OpenConversationRow({
  session,
  active,
  pinned = false,
  canDrag = false,
  isDragging = false,
  dropPosition = null,
  depth = 0,
  nestedUnderTitle,
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
  depth?: number;
  nestedUnderTitle?: string;
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
  const rowTitle = [
    depth > 0 && nestedUnderTitle ? `Nested under ${nestedUnderTitle}` : undefined,
    canDrag ? 'Drag to reorder or move between pinned and open conversations' : undefined,
  ].filter((value): value is string => Boolean(value)).join(' · ') || undefined;

  return (
    <div
      className="relative"
      style={depth > 0 ? { paddingLeft: `${depth * 14}px` } : undefined}
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
        <span aria-hidden="true" className={['mt-0.5 self-stretch w-px rounded-full shrink-0 transition-colors', active ? 'bg-accent/80' : 'bg-border-subtle'].join(' ')} />
        <div className={[
          'min-w-0 flex-1',
          showTrailingControls && 'pr-11',
        ].filter(Boolean).join(' ')}>
          <p className="ui-row-title truncate">{session.title}</p>
          <p className="ui-sidebar-session-meta flex items-center gap-1.5 min-w-0">
            <span className="shrink-0">{timeAgo(session.timestamp)}</span>
            {session.cwd ? (
              <>
                <span className="shrink-0 opacity-40">·</span>
                <span className="truncate min-w-0 opacity-55" title={session.cwd}>{baseName(session.cwd)}</span>
              </>
            ) : null}
            {(session.isRunning || needsAttention) && (
              <>
                <span className="shrink-0 opacity-40">·</span>
                <ConversationStatusText isRunning={session.isRunning} needsAttention={needsAttention} className="shrink-0" />
              </>
            )}
          </p>
        </div>
        {showTrailingControls ? (
          <div className="absolute right-1.5 top-1.5 flex items-center gap-0.5">
            {!hovered && pinned ? <PinnedIndicator /> : null}
            {hovered && pinned && onUnpin ? (
              <button
                type="button"
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

function ShelfDropZone({
  label,
  active = false,
  onDragOver,
  onDrop,
}: {
  label: string;
  active?: boolean;
  onDragOver: (event: DragEvent<HTMLDivElement>) => void;
  onDrop: (event: DragEvent<HTMLDivElement>) => void;
}) {
  return (
    <div
      onDragOver={onDragOver}
      onDrop={onDrop}
      className={[
        'mx-3 rounded-lg border border-dashed px-3 py-2 text-[11px] transition-colors',
        active ? 'border-accent/60 bg-accent/8 text-accent' : 'border-border-subtle bg-elevated/35 text-dim',
      ].join(' ')}
    >
      {label}
    </div>
  );
}

function buildWorkspaceHref(cwd: string): string {
  return buildWorkspacePath('files', buildWorkspaceSearch('', { cwd, file: null, changeScope: null }));
}

export function Sidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const { activity, alerts, runs } = useAppData();
  const { data: status } = useApi(api.status);
  const { data: nodesData } = useApi(api.nodes);
  const {
    pinnedSessions,
    tabs,
    archivedSessions,
    closeSession,
    pinSession,
    unpinSession,
    moveSession,
    loading,
  } = useConversations();

  const nodeShelf = useOpenResourceShelf('node');
  const workspaceShelf = useOpenResourceShelf('workspace');

  const [draftComposer, setDraftComposer] = useState(() => readDraftConversationComposer());
  const [draftCwd, setDraftCwd] = useState(() => readDraftConversationCwd());
  const [draftHasAttachments, setDraftHasAttachments] = useState(() => hasDraftConversationAttachments());
  const [draftReferencedProjectIds, setDraftReferencedProjectIds] = useState(() => readDraftConversationProjectIds());
  const [draggingSessionId, setDraggingSessionId] = useState<string | null>(null);
  const [draggingSection, setDraggingSection] = useState<ConversationShelf | null>(null);
  const [dropTarget, setDropTarget] = useState<{
    section: ConversationShelf;
    sessionId: string | null;
    position: OpenConversationDropPosition;
  } | null>(null);

  const draftTab = useMemo(() => {
    if (!shouldShowDraftConversationTab(location.pathname, draftComposer, draftCwd, draftHasAttachments, draftReferencedProjectIds)) {
      return null;
    }

    return buildDraftConversationSessionMeta(undefined, draftCwd);
  }, [draftComposer, draftCwd, draftHasAttachments, draftReferencedProjectIds, location.pathname]);

  const visibleConversationTabs = useMemo(
    () => draftTab ? [...tabs, draftTab] : tabs,
    [draftTab, tabs],
  );

  const activeConversationId = useMemo(() => {
    const match = location.pathname.match(/^\/conversations\/([^/]+)$/);
    if (!match || match[1] === 'new') {
      return null;
    }

    return decodeURIComponent(match[1]);
  }, [location.pathname]);
  const creatingNote = useMemo(
    () => location.pathname.startsWith('/pages') && readCreatingNode(location.search),
    [location.pathname, location.search],
  );
  const selectedNodesPageItem = useMemo(
    () => (location.pathname.startsWith('/pages') || location.pathname.startsWith('/nodes')) ? readSelectedNode(location.search) : null,
    [location.pathname, location.search],
  );
  const nodesRouteActive = useMemo(
    () => location.pathname.startsWith('/pages') || location.pathname.startsWith('/nodes'),
    [location.pathname],
  );
  const selectedWorkspaceId = useMemo(
    () => location.pathname.startsWith('/workspace') ? readWorkspaceCwdFromSearch(location.search) : null,
    [location.pathname, location.search],
  );
  const settingsRouteActive = useMemo(() => matchesSettingsRoute(location.pathname), [location.pathname]);

  const nodesByKindAndId = useMemo(
    () => new Map((nodesData?.nodes ?? []).map((node) => [`${node.kind}:${node.id}`, node] as const)),
    [nodesData?.nodes],
  );

  const openNodeEntries = useMemo(
    () => [
      ...nodeShelf.pinnedIds.map((shelfId) => ({ shelfId, pinned: true })),
      ...nodeShelf.openIds.map((shelfId) => ({ shelfId, pinned: false })),
    ]
      .map((item) => {
        const parsed = parseOpenNodeShelfId(item.shelfId);
        return parsed ? { ...parsed, shelfId: item.shelfId, pinned: item.pinned } : null;
      })
      .filter((item): item is { kind: 'note' | 'project' | 'skill'; id: string; shelfId: string; pinned: boolean } => item !== null),
    [nodeShelf.openIds, nodeShelf.pinnedIds],
  );
  const openWorkspaces = useMemo(
    () => [
      ...workspaceShelf.pinnedIds.map((id) => ({ id, pinned: true })),
      ...workspaceShelf.openIds.map((id) => ({ id, pinned: false })),
    ],
    [workspaceShelf.openIds, workspaceShelf.pinnedIds],
  );
  const openNodes = useMemo(() => {
    return openNodeEntries.map((item) => {
      const node = nodesByKindAndId.get(`${item.kind}:${item.id}`) ?? null;
      return {
        kind: item.kind,
        id: item.id,
        shelfId: item.shelfId,
        pinned: item.pinned,
        title: node?.title ?? item.id,
        meta: node?.summary || `${item.kind} · @${item.id}`,
      };
    }).sort((left, right) => Number(right.pinned) - Number(left.pinned) || left.title.localeCompare(right.title));
  }, [nodesByKindAndId, openNodeEntries]);
  const runsById = useMemo(
    () => new Map((runs?.runs ?? []).map((run) => [run.runId, run] as const)),
    [runs],
  );
  const pinnedSessionRows = useMemo(
    () => buildNestedSessionRows(pinnedSessions, runsById),
    [pinnedSessions, runsById],
  );
  const openSessionRows = useMemo(
    () => buildNestedSessionRows(visibleConversationTabs, runsById),
    [runsById, visibleConversationTabs],
  );
  const pinnedSessionsById = useMemo(
    () => new Map(pinnedSessions.map((session) => [session.id, session] as const)),
    [pinnedSessions],
  );
  const openSessionsById = useMemo(
    () => new Map(visibleConversationTabs.map((session) => [session.id, session] as const)),
    [visibleConversationTabs],
  );

  const activeAlertCount = alerts?.activeCount ?? 0;
  const standaloneUnreadCount = useMemo(() => {
    const knownConversationIds = new Set([...pinnedSessions, ...tabs, ...archivedSessions].map((session) => session.id));
    return (activity?.entries ?? []).filter((entry) => {
      if (entry.read) {
        return false;
      }

      return !(entry.relatedConversationIds ?? []).some((conversationId) => knownConversationIds.has(conversationId));
    }).length;
  }, [activity?.entries, archivedSessions, pinnedSessions, tabs]);
  const notificationCount = standaloneUnreadCount + activeAlertCount;


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
    if (!draggedId) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';

    if (draggedId === sessionId && draggingSection === section) {
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

  function handleEmptyShelfDragOver(section: ConversationShelf, event: DragEvent<HTMLDivElement>) {
    const draggedId = draggingSessionId ?? event.dataTransfer.getData('text/plain');
    if (!draggedId) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setDropTarget((current) => (
      current?.section === section && current.sessionId === null
        ? current
        : { section, sessionId: null, position: 'after' }
    ));
  }

  function handleConversationDrop(targetSection: ConversationShelf, targetSessionId: string | null, position: OpenConversationDropPosition) {
    if (!draggingSessionId) {
      clearDragState();
      return;
    }

    if (targetSessionId === draggingSessionId && draggingSection === targetSection) {
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

  function handleEmptyShelfDrop(section: ConversationShelf, event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    handleConversationDrop(section, null, 'after');
  }

  useEffect(() => {
    function syncDraftState() {
      setDraftComposer(readDraftConversationComposer());
      setDraftCwd(readDraftConversationCwd());
      setDraftHasAttachments(hasDraftConversationAttachments());
      setDraftReferencedProjectIds(readDraftConversationProjectIds());
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

  const handleNewConversation = useCallback(() => {
    navigate('/conversations/new');
  }, [navigate]);

  const navigateOpenConversation = useCallback((direction: -1 | 1) => {
    if (tabs.length === 0) {
      return;
    }

    const activeIndex = activeConversationId
      ? tabs.findIndex((session) => session.id === activeConversationId)
      : -1;

    if (activeIndex === -1) {
      const fallbackIndex = direction > 0 ? 0 : tabs.length - 1;
      navigate(`/conversations/${tabs[fallbackIndex].id}`);
      return;
    }

    const nextIndex = (activeIndex + direction + tabs.length) % tabs.length;
    navigate(`/conversations/${tabs[nextIndex].id}`);
  }, [activeConversationId, navigate, tabs]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.repeat || hasOverlayOpen()) {
        return;
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
        navigateOpenConversation(-1);
        return;
      }

      if (event.code === 'BracketRight' || key === ']' || key === '}') {
        event.preventDefault();
        navigateOpenConversation(1);
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleNewConversation, navigateOpenConversation]);

  function handleCloseDraftTab() {
    clearDraftConversationAttachments();
    clearDraftConversationComposer();
    clearDraftConversationCwd();
    clearDraftConversationExecutionTarget();
    clearDraftConversationModel();
    clearDraftConversationProjectIds();
    clearDraftConversationThinkingLevel();
    setDraftComposer('');
    setDraftCwd('');
    setDraftHasAttachments(false);
    setDraftReferencedProjectIds([]);

    if (draggingSessionId === DRAFT_CONVERSATION_ID) {
      clearDragState();
    }

    if (location.pathname === DRAFT_CONVERSATION_ROUTE) {
      navigate('/conversations');
    }
  }

  function handleCloseConversation(sessionId: string) {
    closeSession(sessionId);

    if (draggingSessionId === sessionId) {
      clearDragState();
    }

    if (location.pathname === `/conversations/${sessionId}`) {
      navigate('/conversations');
    }
  }

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

  function handleCloseNode(kind: 'note' | 'project' | 'skill', nodeId: string) {
    closeOpenResourceShelfItem('node', buildOpenNodeShelfId(kind, nodeId));
    if (selectedNodesPageItem?.kind === kind && selectedNodesPageItem.id === nodeId) {
      navigate('/pages');
    }
  }

  function handleCloseWorkspace(workspaceId: string) {
    closeOpenResourceShelfItem('workspace', workspaceId);
    if (selectedWorkspaceId === workspaceId && location.pathname.startsWith('/workspace')) {
      navigate(buildWorkspacePath('files'));
    }
  }

  const pinnedDropTargetActive = dropTarget?.section === 'pinned' && dropTarget.sessionId === null;
  const openDropTargetActive = dropTarget?.section === 'open' && dropTarget.sessionId === null;

  return (
    <aside className="flex-1 flex flex-col overflow-hidden">
      <div className="flex items-center gap-2 px-4 pt-4 pb-3">
        <div className="ui-brand-mark">
          <span className="ui-brand-mark-text">pa</span>
        </div>
        <span className="text-[13px] font-semibold text-primary truncate flex-1">{getSidebarBrandLabel(status?.profile)}</span>
      </div>

      <div className="pb-1 space-y-0.5">
        <TopNavItem to="/inbox" icon={PATH.inbox} label="Inbox" badge={notificationCount} />
        <TopNavItem to="/conversations" icon={PATH.conversations} label="Conversations" />
        <TopNavItem to="/pages" icon={PATH.nodes} label="Vault" forceActive={nodesRouteActive} />
        <TopNavItem to="/workspace/files" icon={PATH.workspace} label="Workspace" />
      </div>

      <div className="mx-3 border-t border-border-subtle my-2" />

      <div className="px-1 pb-2">
        <div className="flex items-stretch gap-1 mx-1">
          <button
            onClick={handleNewConversation}
            className="ui-sidebar-nav-item mx-0 flex-1 text-secondary"
            title={`Chat (${SIDEBAR_NEW_CHAT_HOTKEY})`}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="shrink-0"><path d="M12 5v14M5 12h14" /></svg>
            <span className="flex-1 text-left">Chat</span>
          </button>
          <Link
            to={`/pages${buildNodeCreateSearch('', { creating: true, createKind: 'note' })}`}
            className="ui-sidebar-nav-item mx-0 flex-1 bg-accent/10 text-accent hover:bg-accent/20"
            title="Create note"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
              <path d="M12 5v14M5 12h14" />
            </svg>
            <span className="flex-1 text-left font-medium">Note</span>
          </Link>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0 pb-3">
        <SectionHeader label="Open Conversations" />
        <div className="py-1 space-y-0.5">
          {!loading && pinnedSessions.length === 0 && draggingSection === 'open' ? (
            <ShelfDropZone
              label="Drop here to pin this conversation."
              active={pinnedDropTargetActive}
              onDragOver={(event) => handleEmptyShelfDragOver('pinned', event)}
              onDrop={(event) => handleEmptyShelfDrop('pinned', event)}
            />
          ) : null}

          {pinnedSessionRows.map(({ session, depth, parentSessionId }) => {
            const canDrag = depth === 0;
            const dropPosition = canDrag && dropTarget?.section === 'pinned' && dropTarget.sessionId === session.id && draggingSessionId !== session.id
              ? dropTarget.position
              : null;
            const nestedUnderTitle = parentSessionId ? pinnedSessionsById.get(parentSessionId)?.title : undefined;

            return (
              <OpenConversationRow
                key={session.id}
                session={session}
                active={location.pathname === `/conversations/${session.id}`}
                pinned
                canDrag={canDrag}
                isDragging={canDrag && draggingSessionId === session.id}
                dropPosition={dropPosition}
                depth={depth}
                nestedUnderTitle={nestedUnderTitle}
                onUnpin={() => handleUnpinConversation(session.id)}
                onDragStart={canDrag ? (event) => handleTabDragStart('pinned', session.id, event) : undefined}
                onDragOver={canDrag ? (event) => handleTabDragOver('pinned', session.id, event) : undefined}
                onDrop={canDrag ? (event) => handleTabDrop('pinned', session.id, event) : undefined}
                onDragEnd={canDrag ? () => clearDragState() : undefined}
              />
            );
          })}

          {!loading && tabs.length === 0 && draggingSection === 'pinned' ? (
            <ShelfDropZone
              label="Drop here to move back into open conversations."
              active={openDropTargetActive}
              onDragOver={(event) => handleEmptyShelfDragOver('open', event)}
              onDrop={(event) => handleEmptyShelfDrop('open', event)}
            />
          ) : null}

          {!loading && pinnedSessions.length === 0 && visibleConversationTabs.length === 0 ? (
            <p className="px-4 py-2 text-[12px] text-dim">No open conversations yet.</p>
          ) : null}

          {openSessionRows.map(({ session, depth, parentSessionId }) => {
            const isDraftTab = session.id === DRAFT_CONVERSATION_ID;
            const canDrag = !isDraftTab && depth === 0;
            const dropPosition = canDrag && dropTarget?.section === 'open' && dropTarget.sessionId === session.id && draggingSessionId !== session.id
              ? dropTarget.position
              : null;
            const nestedUnderTitle = parentSessionId ? openSessionsById.get(parentSessionId)?.title : undefined;

            return (
              <OpenConversationRow
                key={session.id}
                session={session}
                active={isDraftTab ? location.pathname === DRAFT_CONVERSATION_ROUTE : location.pathname === `/conversations/${session.id}`}
                pinned={false}
                canDrag={canDrag}
                isDragging={canDrag && draggingSessionId === session.id}
                dropPosition={dropPosition}
                depth={depth}
                nestedUnderTitle={nestedUnderTitle}
                onPin={isDraftTab ? undefined : () => handlePinConversation(session.id)}
                onClose={isDraftTab ? handleCloseDraftTab : () => handleCloseConversation(session.id)}
                onDragStart={canDrag ? (event) => handleTabDragStart('open', session.id, event) : undefined}
                onDragOver={canDrag ? (event) => handleTabDragOver('open', session.id, event) : undefined}
                onDrop={canDrag ? (event) => handleTabDrop('open', session.id, event) : undefined}
                onDragEnd={canDrag ? () => clearDragState() : undefined}
              />
            );
          })}
        </div>

        {(openNodes.length > 0 || creatingNote) && (
          <>
            <SectionHeader label="Open Docs" />
            <div className="py-1 space-y-0.5">
              {creatingNote ? (
                <ShelfRow
                  to={`/pages${buildNodeCreateSearch(location.search, { creating: true, createKind: 'note' })}`}
                  active
                  title="new page"
                  meta="Draft page"
                  onClose={() => navigate(`/pages${buildNodeCreateSearch(location.search, { creating: false, createKind: null })}`)}
                />
              ) : null}
              {openNodes.map((item) => (
                <ShelfRow
                  key={`${item.kind}:${item.id}`}
                  to={buildNodesHref(item.kind, item.id)}
                  active={selectedNodesPageItem?.kind === item.kind && selectedNodesPageItem.id === item.id}
                  title={item.title}
                  meta={item.meta}
                  pinned={item.pinned}
                  onPin={item.pinned ? undefined : () => pinOpenResourceShelfItem('node', item.shelfId)}
                  onUnpin={item.pinned ? () => unpinOpenResourceShelfItem('node', item.shelfId) : undefined}
                  onClose={item.pinned ? undefined : () => handleCloseNode(item.kind, item.id)}
                />
              ))}
            </div>
          </>
        )}

        {openWorkspaces.length > 0 && (
          <>
            <SectionHeader label="Open Workspaces" />
            <div className="py-1 space-y-0.5">
              {openWorkspaces.map((item) => (
                <ShelfRow
                  key={item.id}
                  to={buildWorkspaceHref(item.id)}
                  active={location.pathname.startsWith('/workspace') && selectedWorkspaceId === item.id}
                  title={baseName(item.id)}
                  meta={item.id}
                  pinned={item.pinned}
                  onPin={item.pinned ? undefined : () => pinOpenResourceShelfItem('workspace', item.id)}
                  onUnpin={item.pinned ? () => unpinOpenResourceShelfItem('workspace', item.id) : undefined}
                  onClose={item.pinned ? undefined : () => handleCloseWorkspace(item.id)}
                />
              ))}
            </div>
          </>
        )}
      </div>

      <div className="border-t border-border-subtle px-2 py-2 shrink-0 space-y-0.5">
        <TopNavItem to="/settings" icon={PATH.settings} label="Settings" forceActive={settingsRouteActive} />
      </div>
    </aside>
  );
}

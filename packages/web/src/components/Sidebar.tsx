import { type DragEvent, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { ConversationStatusText } from './ConversationStatusText';
import { api } from '../api';
import { useConversations } from '../hooks/useConversations';
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
import { persistForkPromptDraft } from '../forking';
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
import { getOrCreateConversationSurfaceId, retryLiveSessionActionAfterTakeover } from '../hooks/useSessionStream';
import type { SessionMeta } from '../types';

function Ico({ d, size = 16 }: { d: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

const PATH = {
  conversations: 'M4.5 6.75A2.25 2.25 0 0 1 6.75 4.5h10.5a2.25 2.25 0 0 1 2.25 2.25v7.5a2.25 2.25 0 0 1-2.25 2.25H13.5l-3 3v-3H6.75A2.25 2.25 0 0 1 4.5 14.25v-7.5Z',
  nodes: 'M6 6.75h4.5v4.5H6v-4.5Zm7.5 0H18v4.5h-4.5v-4.5Zm-3.75 7.5h4.5v4.5h-4.5v-4.5Z',
  notes: 'M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25',
  skills: 'M12 3.75l7.5 4.125v8.25L12 20.25 4.5 16.125v-8.25L12 3.75Zm0 0v16.5M4.5 7.875 12 12l7.5-4.125',
  workspace: 'M3.75 6A2.25 2.25 0 0 1 6 3.75h4.19a2.25 2.25 0 0 1 1.59.66l.91.9a2.25 2.25 0 0 0 1.59.66H18A2.25 2.25 0 0 1 20.25 8.25v9A2.25 2.25 0 0 1 18 19.5H6A2.25 2.25 0 0 1 3.75 17.25V6Z',
  automations: 'M12 6v6l4 2m5-2a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  settings: 'M10.5 6h3m-1.5-3v6m4.348-2.826 2.121 2.121m-12.728 0 2.121-2.121m8.486 8.486 2.121 2.121m-12.728 0 2.121-2.121M6 10.5H3m18 0h-3m-5.25 7.5v3m0-18v3',
  close: 'M6 18 18 6M6 6l12 12',
  chevronDown: 'm6 9 6 6 6-6',
  chevronRight: 'm9 6 6 6-6 6',
  plus: 'M12 5v14M5 12h14',
};

const THREADS_COLLAPSED_CWD_GROUPS_STORAGE_KEY = buildSidebarNavSectionStorageKey('threads-collapsed-cwd-groups');

const SIDEBAR_BROWSER_NEW_CHAT_HOTKEY = 'Ctrl+Shift+N';
const DESKTOP_CONVERSATION_SHORTCUT_EVENT = 'personal-agent-desktop-shortcut';
const SETTINGS_ROUTE_PREFIXES = ['/settings', '/system', '/automations', '/scheduled'] as const;

type DesktopConversationShortcutAction =
  | 'close-conversation'
  | 'reopen-closed-conversation'
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
    || value === 'reopen-closed-conversation'
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
  onArchive,
  onDuplicate,
  onSummarizeAndNew,
  onCopyId,
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
  onDuplicate?: () => boolean | Promise<boolean>;
  onSummarizeAndNew?: () => boolean | Promise<boolean>;
  onCopyId?: () => boolean | Promise<boolean>;
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
  const [busyAction, setBusyAction] = useState<'duplicate' | 'summarize' | null>(null);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');

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

  useEffect(() => () => {
    if (copyResetTimeoutRef.current !== null) {
      window.clearTimeout(copyResetTimeoutRef.current);
    }
  }, []);

  useEffect(() => {
    if (!menuOpen) {
      if (copyResetTimeoutRef.current !== null) {
        window.clearTimeout(copyResetTimeoutRef.current);
        copyResetTimeoutRef.current = null;
      }
      setCopyState('idle');
      return;
    }

    if (copyState === 'idle') {
      return;
    }

    if (copyResetTimeoutRef.current !== null) {
      window.clearTimeout(copyResetTimeoutRef.current);
    }

    copyResetTimeoutRef.current = window.setTimeout(() => {
      setCopyState('idle');
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
  const showMenuButton = Boolean(onPin || onUnpin || onArchive || onDuplicate || onSummarizeAndNew || onCopyId)
    && (active || hovered || menuOpen);
  const showTrailingControls = showCloseButton || showMenuButton;
  const contentPaddingClass = showCloseButton && showMenuButton
    ? 'pr-16'
    : (showCloseButton || showMenuButton ? 'pr-9' : undefined);
  const rowTitle = canDrag ? 'Drag to reorder conversations' : undefined;
  const menuItemClass = 'flex w-full items-center rounded-lg px-3 py-2 text-left text-[13px] text-primary transition-colors hover:bg-elevated disabled:cursor-default disabled:opacity-40';

  function stopRowInteraction(event: { preventDefault: () => void; stopPropagation: () => void }) {
    event.preventDefault();
    event.stopPropagation();
  }

  async function runMenuAction(
    action: 'duplicate' | 'summarize',
    handler: () => boolean | Promise<boolean>,
  ) {
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

  async function handleCopyIdClick() {
    if (!onCopyId || busyAction) {
      return;
    }

    const succeeded = await onCopyId();
    setCopyState(succeeded === false ? 'failed' : 'copied');
  }

  return (
    <div
      ref={hoverRef}
      className="relative"
      draggable={canDrag}
      onDragStart={canDrag ? onDragStart : undefined}
      onDragOver={canDrag ? onDragOver : undefined}
      onDrop={canDrag ? onDrop : undefined}
      onDragEnd={canDrag ? onDragEnd : undefined}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
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
        className={[
          'ui-sidebar-session-row select-none',
          active && 'ui-sidebar-session-row-active',
          canDrag && (isDragging ? 'cursor-grabbing opacity-60' : 'cursor-grab'),
        ].filter(Boolean).join(' ')}
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
          contentPaddingClass,
        ].filter(Boolean).join(' ')}>
          <p className="ui-row-title truncate">{session.title}</p>
          <p className="ui-sidebar-session-meta flex items-center min-w-0">
            <span className="shrink-0">{timeAgo(session.timestamp)}</span>
          </p>
        </div>
      </Link>
      {showTrailingControls ? (
        <div className="absolute right-1.5 top-1.5 flex items-center gap-0.5">
          {showMenuButton ? (
            <div ref={menuRootRef} className="relative">
              <button
                type="button"
                onPointerDown={stopRowInteraction}
                onMouseDown={stopRowInteraction}
                onClick={() => {
                  if (busyAction) {
                    return;
                  }
                  setMenuOpen((current) => !current);
                }}
                className="ui-icon-button ui-icon-button-compact px-1.5"
                title="Conversation actions"
                aria-label={`Conversation actions: ${session.title}`}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                disabled={busyAction !== null}
              >
                <span aria-hidden="true" className="text-[15px] leading-none">⋯</span>
              </button>
              {menuOpen ? (
                <div
                  className="ui-menu-shell bottom-auto left-auto right-0 top-full mb-0 mt-1 min-w-[190px] px-2 py-2"
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                      event.preventDefault();
                      setMenuOpen(false);
                    }
                  }}
                  role="menu"
                  aria-label={`Conversation actions for ${session.title}`}
                >
                  <div className="space-y-0.5">
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
                    {onCopyId ? (
                      <button
                        type="button"
                        onPointerDown={stopRowInteraction}
                        onMouseDown={stopRowInteraction}
                        onClick={() => {
                          void handleCopyIdClick();
                        }}
                        className={menuItemClass}
                        disabled={busyAction !== null}
                        role="menuitem"
                      >
                        {copyState === 'copied' ? 'Copied ID' : copyState === 'failed' ? 'Copy Failed' : 'Copy ID'}
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
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
      ) : null}
    </div>
  );
}

export function Sidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const {
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
  const conversationSurfaceId = useMemo(() => getOrCreateConversationSurfaceId(), []);
  const sidebarNoticeTimeoutRef = useRef<number | null>(null);
  const [sidebarNotice, setSidebarNotice] = useState<{ tone: 'accent' | 'danger'; text: string } | null>(null);

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

  useEffect(() => () => {
    if (sidebarNoticeTimeoutRef.current !== null) {
      window.clearTimeout(sidebarNoticeTimeoutRef.current);
    }
  }, []);

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

  const resolveLiveConversationIdForAction = useCallback(async (
    session: Pick<SessionMeta, 'id' | 'isLive'>,
    actionDescription: string,
  ) => {
    if (session.isLive) {
      return session.id;
    }

    const recovered = await api.recoverConversation(session.id);
    if (!recovered.live) {
      throw new Error(`This conversation could not ${actionDescription}.`);
    }

    return recovered.conversationId;
  }, []);

  const openCreatedConversation = useCallback((sessionId: string, initialPromptText?: string) => {
    if (initialPromptText) {
      persistForkPromptDraft(sessionId, initialPromptText);
    }

    openSession(sessionId);
    void refetch().catch(() => {});
    navigate(buildConversationSurfacePath(sessionId));
  }, [navigate, openSession, refetch]);

  const handleDuplicateConversation = useCallback(async (session: Pick<SessionMeta, 'id' | 'isLive'>) => {
    try {
      const liveConversationId = await resolveLiveConversationIdForAction(session, 'be duplicated');
      const entries = await api.forkEntries(liveConversationId);
      const entry = entries[entries.length - 1];
      if (!entry) {
        throw new Error('No forkable messages yet.');
      }

      const { newSessionId } = await retryLiveSessionActionAfterTakeover({
        attemptAction: () => api.forkSession(liveConversationId, entry.entryId, { preserveSource: true }, conversationSurfaceId),
        takeOverSessionControl: () => api.takeoverLiveSession(liveConversationId, conversationSurfaceId),
      });
      openCreatedConversation(newSessionId, entry.text);
      return true;
    } catch (error) {
      showSidebarNotice('danger', `Duplicate failed: ${error instanceof Error ? error.message : String(error)}`, 4000);
      return false;
    }
  }, [conversationSurfaceId, openCreatedConversation, resolveLiveConversationIdForAction, showSidebarNotice]);

  const handleSummarizeConversation = useCallback(async (session: Pick<SessionMeta, 'id' | 'isLive'>) => {
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
  }, [conversationSurfaceId, openCreatedConversation, resolveLiveConversationIdForAction, showSidebarNotice]);

  const handleCopyConversationId = useCallback(async (conversationId: string) => {
    if (typeof navigator === 'undefined' || typeof navigator.clipboard?.writeText !== 'function') {
      showSidebarNotice('danger', 'Clipboard access is unavailable in this browser.', 4000);
      return false;
    }

    try {
      await navigator.clipboard.writeText(conversationId);
      return true;
    } catch {
      showSidebarNotice('danger', 'Copy to clipboard failed.', 4000);
      return false;
    }
  }, [showSidebarNotice]);

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

      if (action === 'close-conversation') {
        handleCloseActiveConversation();
        return;
      }

      if (action === 'reopen-closed-conversation') {
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
  }, [handleCloseActiveConversation, handleReopenClosedConversation, handleToggleArchivedActiveConversation, handleTogglePinnedActiveConversation, navigateConversation]);

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
                      onArchive={!isDraftTab ? () => {
                        handleArchiveConversation(session.id);
                        return true;
                      } : undefined}
                      onDuplicate={!isDraftTab ? () => handleDuplicateConversation(session) : undefined}
                      onSummarizeAndNew={!isDraftTab ? () => handleSummarizeConversation(session) : undefined}
                      onCopyId={!isDraftTab ? () => handleCopyConversationId(session.id) : undefined}
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

      <div className="shrink-0">
        {sidebarNotice ? (
          <div aria-live="polite" className={[
            'px-4 pb-2 text-[11px]',
            sidebarNotice.tone === 'danger' ? 'text-danger/90' : 'text-accent/80',
          ].join(' ')}>
            {sidebarNotice.text}
          </div>
        ) : null}
        <div className="border-t border-border-subtle px-2 py-2 space-y-0.5">
          <TopNavItem to="/settings" icon={PATH.settings} label="Settings" forceActive={settingsRouteActive} />
        </div>
      </div>
    </aside>
  );
}

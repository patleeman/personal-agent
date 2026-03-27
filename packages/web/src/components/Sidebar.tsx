import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  clearDraftConversationProjectIds,
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
import { buildNoteSearch, NOTE_ID_SEARCH_PARAM } from '../noteWorkspaceState';
import { buildProjectsHref } from '../projectWorkspaceState';
import { buildSkillsSearch, SKILL_SEARCH_PARAM } from '../skillWorkspaceState';
import { baseName, buildWorkspacePath, buildWorkspaceSearch, readWorkspaceCwdFromSearch } from '../workspaceBrowser';
import {
  useOpenResourceShelf,
  closeOpenResourceShelfItem,
  pinOpenResourceShelfItem,
  unpinOpenResourceShelfItem,
} from '../openResourceShelves';
import { humanizeSkillName } from '../memoryOverview';

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
}: {
  to: string;
  icon: string;
  label: string;
  badge?: number | null;
}) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) => [
        'ui-sidebar-nav-item',
        isActive && 'ui-sidebar-nav-item-active',
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

function SectionHeader({ label, count }: { label: string; count?: number | string }) {
  return (
    <div className="flex items-center gap-2 px-4 pt-2 pb-1">
      <span className="ui-section-label">{label}</span>
      {count != null && <span className="ui-section-count ml-auto">{count}</span>}
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
  const [hovered, setHovered] = useState(false);

  return (
    <Link
      to={to}
      className={[
        'ui-sidebar-session-row select-none',
        active && 'ui-sidebar-session-row-active',
      ].filter(Boolean).join(' ')}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <span aria-hidden="true" className={['mt-0.5 self-stretch w-px rounded-full shrink-0 transition-colors', active ? 'bg-accent/80' : 'bg-border-subtle'].join(' ')} />
      <div className="min-w-0 flex-1">
        <p className="ui-row-title truncate">{title}</p>
        {meta && <p className="ui-sidebar-session-meta truncate">{meta}</p>}
      </div>
      <div className="shrink-0 mt-0.5 min-w-[34px] flex items-center justify-end gap-0.5">
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
    </Link>
  );
}

function OpenConversationRow({
  session,
  active,
  pinned = false,
  onPin,
  onUnpin,
  onClose,
}: {
  session: { id: string; title: string; timestamp: string; cwd: string; isRunning?: boolean };
  active: boolean;
  pinned?: boolean;
  onPin?: () => void;
  onUnpin?: () => void;
  onClose?: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const needsAttention = sessionNeedsAttention(session as Parameters<typeof sessionNeedsAttention>[0]);

  return (
    <Link
      to={`/conversations/${session.id}`}
      className={[
        'ui-sidebar-session-row select-none',
        active && 'ui-sidebar-session-row-active',
      ].filter(Boolean).join(' ')}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <span aria-hidden="true" className={['mt-0.5 self-stretch w-px rounded-full shrink-0 transition-colors', active ? 'bg-accent/80' : 'bg-border-subtle'].join(' ')} />
      <div className="min-w-0 flex-1">
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
      <div className="shrink-0 mt-0.5 min-w-[34px] flex items-center justify-end gap-0.5">
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
    </Link>
  );
}

function parseSelectedProjectId(pathname: string): string | null {
  const parts = pathname.split('/').filter(Boolean);
  return parts[0] === 'projects' && parts[1] ? decodeURIComponent(parts[1]) : null;
}

function buildWorkspaceHref(cwd: string): string {
  return buildWorkspacePath('files', buildWorkspaceSearch('', { cwd, file: null, changeScope: null }));
}

export function Sidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const { activity, alerts, projects } = useAppData();
  const { data: status } = useApi(api.status);
  const { data: notesData } = useApi(api.notes);
  const { data: memoryData } = useApi(api.memory);
  const {
    pinnedSessions,
    tabs,
    archivedSessions,
    closeSession,
    pinSession,
    unpinSession,
    loading,
  } = useConversations();

  const noteShelf = useOpenResourceShelf('note');
  const projectShelf = useOpenResourceShelf('project');
  const skillShelf = useOpenResourceShelf('skill');
  const workspaceShelf = useOpenResourceShelf('workspace');

  const [draftComposer, setDraftComposer] = useState(() => readDraftConversationComposer());
  const [draftCwd, setDraftCwd] = useState(() => readDraftConversationCwd());
  const [draftHasAttachments, setDraftHasAttachments] = useState(() => hasDraftConversationAttachments());
  const [draftReferencedProjectIds, setDraftReferencedProjectIds] = useState(() => readDraftConversationProjectIds());
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const createMenuRef = useRef<HTMLDivElement | null>(null);

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
  const openConversationItems = useMemo(
    () => [
      ...pinnedSessions.map((session) => ({ session, pinned: true })),
      ...visibleConversationTabs.map((session) => ({ session, pinned: false })),
    ],
    [pinnedSessions, visibleConversationTabs],
  );

  const activeConversationId = useMemo(() => {
    const match = location.pathname.match(/^\/conversations\/([^/]+)$/);
    if (!match || match[1] === 'new') {
      return null;
    }

    return decodeURIComponent(match[1]);
  }, [location.pathname]);
  const selectedNoteId = useMemo(() => new URLSearchParams(location.search).get(NOTE_ID_SEARCH_PARAM)?.trim() || null, [location.search]);
  const selectedSkillName = useMemo(() => new URLSearchParams(location.search).get(SKILL_SEARCH_PARAM)?.trim() || null, [location.search]);
  const selectedProjectId = useMemo(() => parseSelectedProjectId(location.pathname), [location.pathname]);
  const selectedWorkspaceId = useMemo(
    () => location.pathname.startsWith('/workspace') ? readWorkspaceCwdFromSearch(location.search) : null,
    [location.pathname, location.search],
  );

  const notesById = useMemo(
    () => new Map((notesData?.memories ?? []).map((memory) => [memory.id, memory] as const)),
    [notesData?.memories],
  );
  const skillsByName = useMemo(
    () => new Map((memoryData?.skills ?? []).map((skill) => [skill.name, skill] as const)),
    [memoryData?.skills],
  );
  const projectsById = useMemo(
    () => new Map((projects ?? []).map((project) => [project.id, project] as const)),
    [projects],
  );

  const openNotes = useMemo(
    () => [
      ...noteShelf.pinnedIds.map((id) => ({ id, pinned: true })),
      ...noteShelf.openIds.map((id) => ({ id, pinned: false })),
    ],
    [noteShelf.openIds, noteShelf.pinnedIds],
  );
  const openProjects = useMemo(
    () => [
      ...projectShelf.pinnedIds.map((id) => ({ id, pinned: true })),
      ...projectShelf.openIds.map((id) => ({ id, pinned: false })),
    ],
    [projectShelf.openIds, projectShelf.pinnedIds],
  );
  const openSkills = useMemo(
    () => [
      ...skillShelf.pinnedIds.map((id) => ({ id, pinned: true })),
      ...skillShelf.openIds.map((id) => ({ id, pinned: false })),
    ],
    [skillShelf.openIds, skillShelf.pinnedIds],
  );
  const openWorkspaces = useMemo(
    () => [
      ...workspaceShelf.pinnedIds.map((id) => ({ id, pinned: true })),
      ...workspaceShelf.openIds.map((id) => ({ id, pinned: false })),
    ],
    [workspaceShelf.openIds, workspaceShelf.pinnedIds],
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
  const createProjectHref = useMemo(
    () => buildProjectsHref(status?.profile ?? 'shared', undefined, null, true),
    [status?.profile],
  );
  const createMenuItems = useMemo(
    () => [
      {
        id: 'note',
        label: 'New note',
        description: 'Create a durable note node.',
        to: `/notes${buildNoteSearch('', { view: 'main', item: null, creating: true })}`,
        icon: PATH.notes,
      },
      {
        id: 'project',
        label: 'New project',
        description: `Create a project in ${status?.profile ?? 'shared'}.`,
        to: createProjectHref,
        icon: PATH.projects,
      },
    ],
    [createProjectHref, status?.profile],
  );

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

  useEffect(() => {
    setCreateMenuOpen(false);
  }, [location.pathname, location.search]);

  useEffect(() => {
    if (!createMenuOpen) {
      return undefined;
    }

    function handlePointerDown(event: MouseEvent) {
      if (!createMenuRef.current || !(event.target instanceof Node)) {
        return;
      }

      if (!createMenuRef.current.contains(event.target)) {
        setCreateMenuOpen(false);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setCreateMenuOpen(false);
      }
    }

    window.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleEscape);
    return () => {
      window.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleEscape);
    };
  }, [createMenuOpen]);

  const handleNewConversation = useCallback(() => {
    setCreateMenuOpen(false);
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
    clearDraftConversationProjectIds();
    setDraftComposer('');
    setDraftCwd('');
    setDraftHasAttachments(false);
    setDraftReferencedProjectIds([]);

    if (location.pathname === DRAFT_CONVERSATION_ROUTE) {
      navigate('/conversations');
    }
  }

  function handleCloseConversation(sessionId: string) {
    closeSession(sessionId);

    if (location.pathname === `/conversations/${sessionId}`) {
      navigate('/conversations');
    }
  }

  function handleCloseNote(noteId: string) {
    closeOpenResourceShelfItem('note', noteId);
    if (selectedNoteId === noteId && location.pathname.startsWith('/notes')) {
      navigate('/notes');
    }
  }

  function handleCloseProject(projectId: string) {
    closeOpenResourceShelfItem('project', projectId);
    if (selectedProjectId === projectId && location.pathname.startsWith('/projects')) {
      navigate('/projects');
    }
  }

  function handleCloseSkill(skillName: string) {
    closeOpenResourceShelfItem('skill', skillName);
    if (selectedSkillName === skillName && location.pathname.startsWith('/skills')) {
      navigate('/skills');
    }
  }

  function handleCloseWorkspace(workspaceId: string) {
    closeOpenResourceShelfItem('workspace', workspaceId);
    if (selectedWorkspaceId === workspaceId && location.pathname.startsWith('/workspace')) {
      navigate(buildWorkspacePath('files'));
    }
  }

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
        <TopNavItem to="/notes" icon={PATH.notes} label="Notes" />
        <TopNavItem to="/projects" icon={PATH.projects} label="Projects" />
        <TopNavItem to="/skills" icon={PATH.skills} label="Skills" />
        <TopNavItem to="/workspace/files" icon={PATH.workspace} label="Workspace" />
      </div>

      <div className="mx-3 border-t border-border-subtle my-2" />

      <div className="px-1 pb-2">
        <div ref={createMenuRef} className="relative mx-1">
          <div className="flex items-stretch gap-1">
            <button
              onClick={handleNewConversation}
              className="ui-sidebar-nav-item mx-0 flex-1"
              title={`New chat (${SIDEBAR_NEW_CHAT_HOTKEY})`}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 opacity-70"><path d="M12 5v14M5 12h14" /></svg>
              <span className="flex-1 text-left">New chat</span>
            </button>
            <button
              type="button"
              onClick={() => setCreateMenuOpen((current) => !current)}
              className="ui-sidebar-nav-item mx-0 shrink-0 px-2.5"
              aria-haspopup="menu"
              aria-expanded={createMenuOpen}
              aria-label="Open create menu"
              title="Open create menu"
            >
              <Ico d={PATH.chevronDown} size={14} />
            </button>
          </div>

          {createMenuOpen ? (
            <div className="absolute left-0 right-0 top-full z-50 mt-2 overflow-hidden rounded-xl border border-border-default bg-surface shadow-xl" role="menu" aria-label="Create menu">
              <div className="border-b border-border-subtle px-3 py-2">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-dim">Create</p>
              </div>
              <div className="py-1.5">
                {createMenuItems.map((item) => (
                  <Link
                    key={item.id}
                    to={item.to}
                    role="menuitem"
                    className="flex items-start gap-2.5 px-3 py-2 text-[13px] text-secondary transition-colors hover:bg-elevated/60 hover:text-primary"
                    onClick={() => setCreateMenuOpen(false)}
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 shrink-0 opacity-70">
                      <path d={item.icon} />
                    </svg>
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium text-primary">{item.label}</span>
                      <span className="block text-[11px] text-dim">{item.description}</span>
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0 pb-3">
        <SectionHeader label="Open Conversations" count={loading ? '…' : openConversationItems.length} />
        <div className="py-1 space-y-0.5">
          {!loading && openConversationItems.length === 0 ? <p className="px-4 py-2 text-[12px] text-dim">No open conversations yet.</p> : null}
          {openConversationItems.map(({ session, pinned }) => {
            const isDraftTab = session.id === DRAFT_CONVERSATION_ID;
            return (
              <OpenConversationRow
                key={session.id}
                session={session}
                active={isDraftTab ? location.pathname === DRAFT_CONVERSATION_ROUTE : location.pathname === `/conversations/${session.id}`}
                pinned={pinned}
                onPin={pinned || isDraftTab ? undefined : () => pinSession(session.id)}
                onUnpin={pinned ? () => unpinSession(session.id) : undefined}
                onClose={pinned ? undefined : (isDraftTab ? handleCloseDraftTab : () => handleCloseConversation(session.id))}
              />
            );
          })}
        </div>

        {openNotes.length > 0 && (
          <>
            <SectionHeader label="Open Notes" count={openNotes.length} />
            <div className="py-1 space-y-0.5">
              {openNotes.map((item) => {
                const note = notesById.get(item.id) ?? null;
                return (
                  <ShelfRow
                    key={item.id}
                    to={`/notes${buildNoteSearch('', { memoryId: item.id, view: 'main', item: null, creating: false })}`}
                    active={location.pathname.startsWith('/notes') && selectedNoteId === item.id}
                    title={note?.title ?? item.id}
                    meta={note?.summary || `@${item.id}`}
                    pinned={item.pinned}
                    onPin={item.pinned ? undefined : () => pinOpenResourceShelfItem('note', item.id)}
                    onUnpin={item.pinned ? () => unpinOpenResourceShelfItem('note', item.id) : undefined}
                    onClose={item.pinned ? undefined : () => handleCloseNote(item.id)}
                  />
                );
              })}
            </div>
          </>
        )}

        {openProjects.length > 0 && (
          <>
            <SectionHeader label="Open Projects" count={openProjects.length} />
            <div className="py-1 space-y-0.5">
              {openProjects.map((item) => {
                const project = projectsById.get(item.id) ?? null;
                return (
                  <ShelfRow
                    key={item.id}
                    to={buildProjectsHref(project?.profile ?? 'shared', item.id)}
                    active={location.pathname.startsWith('/projects') && selectedProjectId === item.id}
                    title={project?.title ?? item.id}
                    meta={project?.summary || project?.description || `@${item.id}`}
                    pinned={item.pinned}
                    onPin={item.pinned ? undefined : () => pinOpenResourceShelfItem('project', item.id)}
                    onUnpin={item.pinned ? () => unpinOpenResourceShelfItem('project', item.id) : undefined}
                    onClose={item.pinned ? undefined : () => handleCloseProject(item.id)}
                  />
                );
              })}
            </div>
          </>
        )}

        {openSkills.length > 0 && (
          <>
            <SectionHeader label="Open Skills" count={openSkills.length} />
            <div className="py-1 space-y-0.5">
              {openSkills.map((item) => {
                const skill = skillsByName.get(item.id) ?? null;
                return (
                  <ShelfRow
                    key={item.id}
                    to={`/skills${buildSkillsSearch('', { skillName: item.id, view: 'definition', item: null })}`}
                    active={location.pathname.startsWith('/skills') && selectedSkillName === item.id}
                    title={humanizeSkillName(item.id)}
                    meta={skill?.description || skill?.source || item.id}
                    pinned={item.pinned}
                    onPin={item.pinned ? undefined : () => pinOpenResourceShelfItem('skill', item.id)}
                    onUnpin={item.pinned ? () => unpinOpenResourceShelfItem('skill', item.id) : undefined}
                    onClose={item.pinned ? undefined : () => handleCloseSkill(item.id)}
                  />
                );
              })}
            </div>
          </>
        )}

        {openWorkspaces.length > 0 && (
          <>
            <SectionHeader label="Open Workspaces" count={openWorkspaces.length} />
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
        <TopNavItem to="/settings" icon={PATH.settings} label="Settings" />
      </div>
    </aside>
  );
}

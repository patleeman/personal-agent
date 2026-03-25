import { type ReactNode, useCallback, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { getConversationDisplayTitle } from '../conversationTitle';
import { useAppData, useLiveTitles, useSseConnection } from '../contexts';
import { useApi } from '../hooks';
import { fetchSessionsSnapshot } from '../sessionSnapshot';
import { readConversationLayout, setConversationArchivedState } from '../sessionTabs';
import type { SessionMeta, SseConnectionStatus } from '../types';
import { useCompanionLayoutContext } from './CompanionLayout';
import { buildCompanionConversationPath } from './routes';

function parseSessionActivityAt(session: SessionMeta): number {
  const timestamp = session.lastActivityAt ?? session.timestamp;
  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatSessionActivityAt(session: SessionMeta): string {
  const timestamp = session.lastActivityAt ?? session.timestamp;
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return 'updated recently';
  }

  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatConnectionStatus(status: SseConnectionStatus): string {
  switch (status) {
    case 'open':
      return 'live';
    case 'reconnecting':
      return 'reconnecting';
    case 'offline':
      return 'offline';
    default:
      return 'connecting';
  }
}

function connectionStatusDotClass(status: SseConnectionStatus): string {
  switch (status) {
    case 'open':
      return 'bg-success';
    case 'reconnecting':
      return 'bg-warning';
    case 'offline':
      return 'bg-danger';
    default:
      return 'bg-dim/70';
  }
}

function buildCompanionOverviewLabel(input: {
  total: number;
  live: number;
  needsReview: number;
  active: number;
  archived: number;
}): string {
  if (input.total === 0) {
    return 'No conversations yet.';
  }

  const parts = [`${input.total} chats`];
  if (input.live > 0) {
    parts.push(`${input.live} live`);
  }
  if (input.needsReview > 0) {
    parts.push(`${input.needsReview} review`);
  }
  if (input.active > 0) {
    parts.push(`${input.active} active`);
  }
  if (input.archived > 0) {
    parts.push(`${input.archived} archived`);
  }

  return parts.join(' · ');
}

function buildCompanionStateNote(input: {
  standalone: boolean;
  installAvailable: boolean;
  secureContext: boolean;
  notificationsSupported: boolean;
  notificationPermission: NotificationPermission | 'unsupported';
}): { text: string; className: string } | null {
  const parts: string[] = [];

  if (input.standalone) {
    parts.push('Installed');
  } else if (input.installAvailable) {
    parts.push('Install available');
  } else if (input.secureContext) {
    parts.push('Add to home screen');
  }

  if (input.notificationsSupported) {
    if (input.notificationPermission === 'granted') {
      parts.push('Alerts on');
    } else if (input.notificationPermission === 'default') {
      parts.push('Alerts off');
    } else if (input.notificationPermission === 'denied') {
      parts.push('Alerts blocked');
    }
  }

  if (parts.length === 0) {
    return null;
  }

  const className = input.notificationPermission === 'denied'
    ? 'text-warning'
    : input.standalone || input.notificationPermission === 'granted'
      ? 'text-success'
      : 'text-dim';

  return {
    text: parts.join(' · '),
    className,
  };
}

function HeaderIconButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border-default bg-surface text-secondary transition-colors hover:border-accent/40 hover:text-primary disabled:cursor-default disabled:opacity-45"
    >
      {children}
    </button>
  );
}

export function sortCompanionSessions(sessions: SessionMeta[]): SessionMeta[] {
  return [...sessions].sort((left, right) => {
    if (Boolean(left.isLive) !== Boolean(right.isLive)) {
      return left.isLive ? -1 : 1;
    }

    if (Boolean(left.needsAttention) !== Boolean(right.needsAttention)) {
      return left.needsAttention ? -1 : 1;
    }

    if (Boolean(left.isRunning) !== Boolean(right.isRunning)) {
      return left.isRunning ? -1 : 1;
    }

    return parseSessionActivityAt(right) - parseSessionActivityAt(left);
  });
}

export function partitionCompanionSessions(
  sessions: SessionMeta[],
  workspaceSessionIds: ReadonlySet<string> | null,
): {
  live: SessionMeta[];
  needsReview: SessionMeta[];
  active: SessionMeta[];
  archived: SessionMeta[];
  recent: SessionMeta[];
} {
  const live: SessionMeta[] = [];
  const needsReview: SessionMeta[] = [];
  const active: SessionMeta[] = [];
  const archived: SessionMeta[] = [];
  const recent: SessionMeta[] = [];

  for (const session of sessions) {
    if (session.isLive) {
      live.push(session);
      continue;
    }

    if (session.needsAttention) {
      needsReview.push(session);
      continue;
    }

    if (workspaceSessionIds === null) {
      recent.push(session);
      continue;
    }

    if (workspaceSessionIds.has(session.id)) {
      active.push(session);
      continue;
    }

    archived.push(session);
  }

  return { live, needsReview, active, archived, recent };
}

function buildSessionFlags(session: SessionMeta): string[] {
  const flags: string[] = [];
  if (session.isLive) {
    flags.push('live');
  }
  if (session.isRunning) {
    flags.push('running');
  }
  if (session.needsAttention) {
    flags.push('needs review');
  }
  return flags;
}

function SessionSection({
  title,
  sessions,
  workspaceSessionIds,
  actionBusyId,
  onSetArchived,
}: {
  title: string;
  sessions: SessionMeta[];
  workspaceSessionIds: ReadonlySet<string> | null;
  actionBusyId: string | null;
  onSetArchived: (sessionId: string, archived: boolean) => void;
}) {
  if (sessions.length === 0) {
    return null;
  }

  return (
    <section className="pt-5 first:pt-0">
      <h2 className="px-4 text-[10px] font-semibold uppercase tracking-[0.18em] text-dim/70">{title}</h2>
      <div className="mt-2 border-y border-border-subtle">
        {sessions.map((session) => {
          const flags = buildSessionFlags(session);
          const titleText = getConversationDisplayTitle(session.title);
          const locationLabel = session.cwdSlug || session.cwd || 'default workspace';

          const inWorkspace = workspaceSessionIds?.has(session.id) ?? false;
          const archiveActionLabel = inWorkspace ? 'Archive' : 'Open';
          const archiveActionBusy = actionBusyId === session.id;

          return (
            <div key={session.id} className="border-b border-border-subtle px-4 py-3.5 last:border-b-0">
              <div className="flex items-start gap-3">
                <Link
                  to={buildCompanionConversationPath(session.id)}
                  className="min-w-0 flex-1 transition-colors hover:text-primary"
                >
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="truncate text-[15px] font-medium leading-tight text-primary">{titleText}</h3>
                        {session.attentionUnreadMessageCount && session.attentionUnreadMessageCount > 0 ? (
                          <span className="shrink-0 text-[11px] font-mono text-warning">+{session.attentionUnreadMessageCount}</span>
                        ) : null}
                      </div>
                      <p className="mt-1 truncate text-[12px] text-secondary">{locationLabel}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-dim">
                        {flags.map((flag) => (
                          <span key={flag} className="uppercase tracking-[0.12em] text-dim/85">{flag}</span>
                        ))}
                        <span>{session.messageCount} {session.messageCount === 1 ? 'message' : 'messages'}</span>
                        <span>{formatSessionActivityAt(session)}</span>
                      </div>
                    </div>
                    <span className="pt-0.5 text-accent" aria-hidden="true">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="m9 6 6 6-6 6" />
                      </svg>
                    </span>
                  </div>
                </Link>
                <button
                  type="button"
                  onClick={() => onSetArchived(session.id, inWorkspace)}
                  disabled={archiveActionBusy}
                  className="shrink-0 rounded-full border border-border-default px-3 py-1.5 text-[11px] font-medium text-secondary transition-colors hover:border-accent/35 hover:text-primary disabled:cursor-default disabled:opacity-45"
                >
                  {archiveActionBusy ? `${archiveActionLabel}…` : archiveActionLabel}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function CompanionConversationsPage() {
  const navigate = useNavigate();
  const { sessions, setSessions } = useAppData();
  const { titles } = useLiveTitles();
  const { status } = useSseConnection();
  const {
    installAvailable,
    installBusy,
    promptInstall,
    secureContext,
    standalone,
    notificationsSupported,
    notificationPermission,
    requestNotificationPermission,
  } = useCompanionLayoutContext();
  const [creating, setCreating] = useState(false);
  const [actionBusyId, setActionBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const {
    data: openTabs,
    replaceData: replaceOpenTabs,
  } = useApi(api.openConversationTabs, 'companion-open-conversation-tabs');

  const visibleSessions = useMemo(() => {
    const source = sessions ?? [];
    const withTitles = source.map((session) => {
      const title = getConversationDisplayTitle(titles.get(session.id), session.title);
      return title === session.title ? session : { ...session, title };
    });

    return sortCompanionSessions(withTitles);
  }, [sessions, titles]);
  const workspaceSessionIds = useMemo(() => {
    if (!openTabs) {
      return null;
    }

    return new Set([...openTabs.sessionIds, ...openTabs.pinnedSessionIds]);
  }, [openTabs]);
  const workspaceSections = useMemo(
    () => partitionCompanionSessions(visibleSessions, workspaceSessionIds),
    [visibleSessions, workspaceSessionIds],
  );
  const workspaceSectionsKnown = workspaceSessionIds !== null;
  const {
    live: liveSessions,
    needsReview: needsReviewSessions,
    active: activeSessions,
    archived: archivedSessions,
    recent: recentSessions,
  } = workspaceSections;
  const overviewLabel = buildCompanionOverviewLabel({
    total: visibleSessions.length,
    live: liveSessions.length,
    needsReview: needsReviewSessions.length,
    active: activeSessions.length,
    archived: archivedSessions.length,
  });
  const stateNote = buildCompanionStateNote({
    standalone,
    installAvailable,
    secureContext,
    notificationsSupported,
    notificationPermission,
  });

  const handleSetArchived = useCallback((sessionId: string, archived: boolean) => {
    if (actionBusyId) {
      return;
    }

    setActionBusyId(sessionId);
    setError(null);
    try {
      const nextLayout = setConversationArchivedState(sessionId, archived);
      replaceOpenTabs(nextLayout);
    } catch (nextError) {
      const fallbackLayout = readConversationLayout();
      replaceOpenTabs(fallbackLayout);
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setActionBusyId(null);
    }
  }, [actionBusyId, replaceOpenTabs]);

  const handleCreateConversation = useCallback(async () => {
    if (creating) {
      return;
    }

    setCreating(true);
    setError(null);

    try {
      const { id } = await api.createLiveSession();
      void fetchSessionsSnapshot().then(setSessions).catch(() => {});
      navigate(buildCompanionConversationPath(id));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setCreating(false);
    }
  }, [creating, navigate, setSessions]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="border-b border-border-subtle bg-base/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-3xl items-start justify-between gap-3 px-4 pb-3 pt-[calc(env(safe-area-inset-top)+0.75rem)]">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h1 className="text-[22px] font-semibold tracking-tight text-primary">Chats</h1>
              <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.16em] text-dim/80">
                <span className={`h-1.5 w-1.5 rounded-full ${connectionStatusDotClass(status)}`} />
                {formatConnectionStatus(status)}
              </span>
            </div>
            <p className="mt-1 text-[11px] text-dim">{workspaceSectionsKnown ? overviewLabel : `${visibleSessions.length} chats`}</p>
            {stateNote ? <p className={`mt-1 text-[11px] ${stateNote.className}`}>{stateNote.text}</p> : null}
            {error ? <p className="mt-2 text-[11px] text-danger">{error}</p> : null}
          </div>
          <div className="flex items-center gap-2">
            {notificationPermission === 'default' && notificationsSupported && secureContext ? (
              <HeaderIconButton label="Enable alerts" onClick={() => { void requestNotificationPermission(); }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M15 18H5a1 1 0 0 1-.8-1.6l1.8-2.4V10a5 5 0 1 1 10 0v4l1.8 2.4A1 1 0 0 1 17 18Z" />
                  <path d="M10 21a2 2 0 0 0 4 0" />
                </svg>
              </HeaderIconButton>
            ) : null}
            {installAvailable ? (
              <HeaderIconButton label={installBusy ? 'Installing app' : 'Install app'} onClick={() => { void promptInstall(); }} disabled={installBusy}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 4v10" />
                  <path d="m8 10 4 4 4-4" />
                  <path d="M5 19h14" />
                </svg>
              </HeaderIconButton>
            ) : null}
            <HeaderIconButton label={creating ? 'Starting conversation' : 'New conversation'} onClick={() => { void handleCreateConversation(); }} disabled={creating}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 5v14" />
                <path d="M5 12h14" />
              </svg>
            </HeaderIconButton>
          </div>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto pb-[calc(env(safe-area-inset-bottom)+1rem)]">
        <div className="mx-auto flex w-full max-w-3xl flex-col px-0 py-4">
          {sessions === null ? (
            <p className="px-4 text-[13px] text-dim">Loading conversations…</p>
          ) : visibleSessions.length === 0 ? (
            <div className="px-4 pt-5">
              <p className="text-[15px] text-primary">Start a conversation to make the companion app useful.</p>
              <p className="mt-2 text-[13px] leading-relaxed text-secondary">
                New live conversations and saved transcripts will appear here automatically, and archived conversations stay reachable from the same list.
              </p>
            </div>
          ) : (
            <>
              <SessionSection title="Live now" sessions={liveSessions} workspaceSessionIds={workspaceSessionIds} actionBusyId={actionBusyId} onSetArchived={handleSetArchived} />
              <SessionSection title="Needs review" sessions={needsReviewSessions} workspaceSessionIds={workspaceSessionIds} actionBusyId={actionBusyId} onSetArchived={handleSetArchived} />
              {workspaceSectionsKnown ? (
                <>
                  <SessionSection title="Active workspace" sessions={activeSessions} workspaceSessionIds={workspaceSessionIds} actionBusyId={actionBusyId} onSetArchived={handleSetArchived} />
                  <SessionSection title="Archived" sessions={archivedSessions} workspaceSessionIds={workspaceSessionIds} actionBusyId={actionBusyId} onSetArchived={handleSetArchived} />
                </>
              ) : (
                <SessionSection title={liveSessions.length > 0 || needsReviewSessions.length > 0 ? 'Recent' : 'Conversations'} sessions={recentSessions} workspaceSessionIds={workspaceSessionIds} actionBusyId={actionBusyId} onSetArchived={handleSetArchived} />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

import { useCallback, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { getConversationDisplayTitle } from '../conversationTitle';
import { useAppData, useLiveTitles, useSseConnection } from '../contexts';
import { fetchSessionsSnapshot } from '../sessionSnapshot';
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
}: {
  title: string;
  sessions: SessionMeta[];
}) {
  if (sessions.length === 0) {
    return null;
  }

  return (
    <section className="pt-6 first:pt-0">
      <h2 className="px-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-dim/70">{title}</h2>
      <div className="mt-3 border-y border-border-subtle">
        {sessions.map((session) => {
          const flags = buildSessionFlags(session);
          const titleText = getConversationDisplayTitle(session.title);
          const locationLabel = session.cwdSlug || session.cwd || 'default workspace';

          return (
            <Link
              key={session.id}
              to={buildCompanionConversationPath(session.id)}
              className="block border-b border-border-subtle px-4 py-4 transition-colors last:border-b-0 hover:bg-surface/55"
            >
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="truncate text-[16px] font-medium leading-tight text-primary">{titleText}</h3>
                    {session.attentionUnreadMessageCount && session.attentionUnreadMessageCount > 0 ? (
                      <span className="shrink-0 text-[11px] font-mono text-warning">+{session.attentionUnreadMessageCount}</span>
                    ) : null}
                  </div>
                  <p className="mt-1 truncate text-[13px] text-secondary">{locationLabel}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-dim">
                    {flags.map((flag) => (
                      <span key={flag} className="uppercase tracking-[0.12em] text-dim/85">{flag}</span>
                    ))}
                    <span>{session.messageCount} {session.messageCount === 1 ? 'message' : 'messages'}</span>
                    <span>{formatSessionActivityAt(session)}</span>
                  </div>
                </div>
                <span className="pt-0.5 text-[12px] text-accent">open</span>
              </div>
            </Link>
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
  const [error, setError] = useState<string | null>(null);

  const visibleSessions = useMemo(() => {
    const source = sessions ?? [];
    const withTitles = source.map((session) => {
      const title = getConversationDisplayTitle(titles.get(session.id), session.title);
      return title === session.title ? session : { ...session, title };
    });

    return sortCompanionSessions(withTitles);
  }, [sessions, titles]);

  const liveSessions = useMemo(
    () => visibleSessions.filter((session) => session.isLive),
    [visibleSessions],
  );
  const recentSessions = useMemo(
    () => visibleSessions.filter((session) => !session.isLive),
    [visibleSessions],
  );

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
        <div className="mx-auto flex w-full max-w-3xl flex-col px-4 pb-4 pt-[calc(env(safe-area-inset-top)+1rem)]">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-dim/70">assistant companion</p>
              <h1 className="mt-2 text-[28px] font-semibold tracking-tight text-primary">Continue conversations</h1>
            </div>
            <span className="text-[11px] uppercase tracking-[0.14em] text-dim/80">{formatConnectionStatus(status)}</span>
          </div>
          <p className="mt-2 max-w-xl text-[13px] leading-relaxed text-secondary">
            Live conversations stay mirrored here. Take over only when you want this device to become the active controller.
          </p>
          <div className="mt-4 flex items-center justify-between gap-3">
            <div>
              <p className="text-[12px] text-dim">
                {visibleSessions.length === 0 ? 'No conversations yet.' : `${visibleSessions.length} conversation${visibleSessions.length === 1 ? '' : 's'} available.`}
              </p>
              {standalone ? (
                <p className="mt-1 text-[11px] text-success">Installed companion app</p>
              ) : installAvailable ? (
                <p className="mt-1 text-[11px] text-dim">Install this companion app for faster reopen and future notifications.</p>
              ) : secureContext ? (
                <p className="mt-1 text-[11px] text-dim">Use your browser’s install or add-to-home-screen action when you’re ready.</p>
              ) : null}
              {notificationsSupported && notificationPermission === 'granted' ? (
                <p className="mt-1 text-[11px] text-success">Notifications enabled</p>
              ) : notificationsSupported && notificationPermission === 'default' && secureContext ? (
                <p className="mt-1 text-[11px] text-dim">Enable notifications for blocked, approval-needed, and completed conversation updates.</p>
              ) : notificationsSupported && notificationPermission === 'denied' ? (
                <p className="mt-1 text-[11px] text-warning">Notifications are blocked in this browser. Re-enable them in site settings to get companion alerts.</p>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              {notificationPermission === 'default' && notificationsSupported && secureContext ? (
                <button
                  type="button"
                  onClick={() => { void requestNotificationPermission(); }}
                  className="ui-action-button shrink-0"
                >
                  Enable notifications
                </button>
              ) : null}
              {installAvailable ? (
                <button
                  type="button"
                  onClick={() => { void promptInstall(); }}
                  disabled={installBusy}
                  className="ui-action-button shrink-0"
                >
                  {installBusy ? 'Installing…' : 'Install app'}
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => { void handleCreateConversation(); }}
                disabled={creating}
                className="ui-action-button shrink-0"
              >
                {creating ? 'Starting…' : 'New conversation'}
              </button>
            </div>
          </div>
          {error ? <p className="mt-3 text-[12px] text-danger">{error}</p> : null}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto pb-[calc(env(safe-area-inset-bottom)+1rem)]">
        <div className="mx-auto flex w-full max-w-3xl flex-col px-0 py-6">
          {sessions === null ? (
            <p className="px-4 text-[13px] text-dim">Loading conversations…</p>
          ) : visibleSessions.length === 0 ? (
            <div className="px-4 pt-6">
              <p className="text-[15px] text-primary">Start a conversation to make the companion app useful.</p>
              <p className="mt-2 text-[13px] leading-relaxed text-secondary">
                New live conversations will appear here automatically, and existing live work can be reopened from the same list.
              </p>
            </div>
          ) : (
            <>
              <SessionSection title="Live now" sessions={liveSessions} />
              <SessionSection title={liveSessions.length > 0 ? 'Recent' : 'Conversations'} sessions={recentSessions} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

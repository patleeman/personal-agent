import { memo, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type TouchEvent as ReactTouchEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { cx } from '../components/ui';
import { getConversationDisplayTitle } from '../conversationTitle';
import { buildDeferredResumeIndicatorText } from '../deferredResumeIndicator';
import { type SseConnectionStatus, useAppEvents, useLiveTitles, useSseConnection } from '../contexts';
import { useApi } from '../hooks';
import type { CompanionConversationListResult, SessionMeta } from '../types';
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

function canResumeCompanionSession(session: SessionMeta): boolean {
  return !session.isLive && session.file.trim().length > 0;
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

const COMPANION_TAP_HIGHLIGHT_COLOR = 'rgba(var(--color-accent) / 0.14)';
const COMPANION_TOUCH_BUTTON_STYLE = {
  WebkitTapHighlightColor: COMPANION_TAP_HIGHLIGHT_COLOR,
  touchAction: 'manipulation',
} as const;
const COMPANION_TOUCH_ROW_STYLE = {
  WebkitTapHighlightColor: COMPANION_TAP_HIGHLIGHT_COLOR,
  touchAction: 'pan-y',
} as const;
const SESSION_MESSAGE_COUNT_FORMATTER = new Intl.NumberFormat();
const COMPANION_ROW_SWIPE_SLOP = 12;
const COMPANION_ROW_SWIPE_REVEAL_THRESHOLD = 48;
const COMPANION_ROW_SWIPE_HIDE_THRESHOLD = 28;
const COMPANION_ARCHIVED_PAGE_SIZE = 30;
const COMPANION_ARCHIVE_SYNC_DELAY_MS = 180;

function buildCompanionOverviewLabel(input: {
  openCount: number;
  liveElsewhereCount: number;
  needsReviewCount: number;
  archivedCount: number;
}): string {
  const parts: string[] = [];
  if (input.openCount > 0) parts.push(`${input.openCount} open`);
  if (input.liveElsewhereCount > 0) parts.push(`${input.liveElsewhereCount} live elsewhere`);
  if (input.needsReviewCount > 0) parts.push(`${input.needsReviewCount} need review`);
  if (input.archivedCount > 0) parts.push(`${input.archivedCount} archived`);
  if (parts.length === 0) return 'No conversations yet.';
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

function buildCompanionArchivedLayout(
  current: { sessionIds: string[]; pinnedSessionIds: string[]; archivedSessionIds: string[] },
  sessionId: string,
  archived: boolean,
): { sessionIds: string[]; pinnedSessionIds: string[]; archivedSessionIds: string[] } {
  const normalizedSessionId = sessionId.trim();
  if (!normalizedSessionId) {
    return current;
  }

  const nextPinnedSessionIds = current.pinnedSessionIds.filter((id) => id !== normalizedSessionId);
  const openWithoutSession = current.sessionIds.filter((id) => id !== normalizedSessionId);
  const archivedWithoutSession = current.archivedSessionIds.filter((id) => id !== normalizedSessionId);

  return {
    sessionIds: archived
      ? openWithoutSession
      : [...openWithoutSession, normalizedSessionId],
    pinnedSessionIds: nextPinnedSessionIds,
    archivedSessionIds: archived
      ? [...archivedWithoutSession, normalizedSessionId]
      : archivedWithoutSession,
  };
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
  archivedSessionIds: ReadonlySet<string> = new Set(),
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
    if (archivedSessionIds.has(session.id)) {
      archived.push(session);
      continue;
    }

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

function applyCompanionConversationTitles(
  result: CompanionConversationListResult,
  liveTitles: ReadonlyMap<string, string>,
): CompanionConversationListResult {
  const applyTitles = (sessions: SessionMeta[]) => sessions.map((session) => {
    const title = getConversationDisplayTitle(liveTitles.get(session.id), session.title);
    return title === session.title ? session : { ...session, title };
  });

  return {
    ...result,
    live: applyTitles(result.live),
    needsReview: applyTitles(result.needsReview),
    active: applyTitles(result.active),
    archived: applyTitles(result.archived),
  };
}

function setCompanionConversationArchivedStateInList(
  current: CompanionConversationListResult,
  sessionId: string,
  archived: boolean,
): CompanionConversationListResult {
  const workspaceSessionIdSet = new Set(current.workspaceSessionIds);
  const removeSession = (sessions: SessionMeta[]) => sessions.filter((session) => session.id !== sessionId);
  const archivedWithoutSession = removeSession(current.archived);
  const activeWithoutSession = removeSession(current.active);
  const liveWithoutSession = removeSession(current.live);
  const needsReviewWithoutSession = removeSession(current.needsReview);
  const session = [
    ...current.live,
    ...current.needsReview,
    ...current.active,
    ...current.archived,
  ].find((entry) => entry.id === sessionId);

  if (!session) {
    return current;
  }

  if (archived) {
    workspaceSessionIdSet.delete(sessionId);
  } else {
    workspaceSessionIdSet.add(sessionId);
  }

  const destination = archived
    ? 'archived'
    : workspaceSessionIdSet.has(sessionId)
      ? 'active'
      : session.isLive
        ? 'live'
        : session.needsAttention
          ? 'needsReview'
          : 'archived';

  const nextLive = destination === 'live'
    ? sortCompanionSessions([...liveWithoutSession, session])
    : liveWithoutSession;
  const nextNeedsReview = destination === 'needsReview'
    ? sortCompanionSessions([...needsReviewWithoutSession, session])
    : needsReviewWithoutSession;
  const nextActive = destination === 'active'
    ? sortCompanionSessions([...activeWithoutSession, session])
    : activeWithoutSession;
  let nextArchived = destination === 'archived'
    ? sortCompanionSessions([...archivedWithoutSession, session])
    : archivedWithoutSession;

  if (destination === 'archived' && current.archived.length < current.archivedTotal) {
    nextArchived = nextArchived.slice(0, current.archived.length);
  }

  const wasArchived = current.archived.some((entry) => entry.id === sessionId);
  const willBeArchived = destination === 'archived';
  const nextArchivedTotal = Math.max(0, current.archivedTotal + Number(willBeArchived) - Number(wasArchived));

  return {
    ...current,
    live: nextLive,
    needsReview: nextNeedsReview,
    active: nextActive,
    archived: nextArchived,
    archivedTotal: nextArchivedTotal,
    hasMoreArchived: nextArchived.length < nextArchivedTotal,
    workspaceSessionIds: Array.from(workspaceSessionIdSet),
  };
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

export function getCompanionConversationRowSwipeIntent(input: {
  deltaX: number;
  deltaY: number;
  actionsRevealed: boolean;
}): 'none' | 'reveal' | 'hide' {
  const horizontalDelta = Math.abs(input.deltaX);
  const verticalDelta = Math.abs(input.deltaY);

  if (horizontalDelta < COMPANION_ROW_SWIPE_SLOP || horizontalDelta <= verticalDelta) {
    return 'none';
  }

  if (!input.actionsRevealed && input.deltaX <= -COMPANION_ROW_SWIPE_REVEAL_THRESHOLD) {
    return 'reveal';
  }

  if (input.actionsRevealed && input.deltaX >= COMPANION_ROW_SWIPE_HIDE_THRESHOLD) {
    return 'hide';
  }

  return 'none';
}

function findTouchByIdentifier(touches: TouchList, identifier: number): Touch | null {
  for (let index = 0; index < touches.length; index += 1) {
    const touch = touches.item(index);
    if (touch && touch.identifier === identifier) {
      return touch;
    }
  }

  return null;
}

const CompanionConversationRow = memo(function CompanionConversationRow({
  session,
  inWorkspace,
  actionBusy,
  busyAction,
  actionsRevealed,
  onSetArchived,
  onResume,
  onRevealActions,
}: {
  session: SessionMeta;
  inWorkspace: boolean;
  actionBusy: boolean;
  busyAction: 'archive' | 'resume' | null;
  actionsRevealed: boolean;
  onSetArchived: (sessionId: string, archived: boolean) => void;
  onResume: (session: SessionMeta) => void;
  onRevealActions: (sessionId: string | null) => void;
}) {
  const gestureRef = useRef<
    | { kind: 'pointer'; pointerId: number; startX: number; startY: number }
    | { kind: 'touch'; touchId: number; startX: number; startY: number }
    | null
  >(null);
  const suppressClickRef = useRef(false);
  const flags = buildSessionFlags(session);
  const deferredResumes = session.deferredResumes ?? [];
  const deferredResumeText = deferredResumes.length > 0
    ? buildDeferredResumeIndicatorText(deferredResumes, Date.now())
    : null;
  const hasReadyDeferredResumes = deferredResumes.some((resume) => resume.status === 'ready');
  const titleText = getConversationDisplayTitle(session.title);
  const archiveActionLabel = inWorkspace ? 'Archive' : 'Open';
  const canResume = canResumeCompanionSession(session);
  const formattedMessageCount = SESSION_MESSAGE_COUNT_FORMATTER.format(session.messageCount);
  const messageCountLabel = `${formattedMessageCount} ${session.messageCount === 1 ? 'message' : 'messages'}`;
  const actionsId = `companion-conversation-actions-${session.id}`;
  const toggleActionsLabel = `${actionsRevealed ? 'Hide' : 'Show'} actions for ${titleText}`;

  const handleGestureIntent = useCallback((deltaX: number, deltaY: number) => {
    const intent = getCompanionConversationRowSwipeIntent({
      deltaX,
      deltaY,
      actionsRevealed,
    });

    if (intent === 'reveal') {
      suppressClickRef.current = true;
      onRevealActions(session.id);
      return;
    }

    if (intent === 'hide') {
      suppressClickRef.current = true;
      onRevealActions(null);
    }
  }, [actionsRevealed, onRevealActions, session.id]);

  const handlePointerDown = useCallback((event: ReactPointerEvent<HTMLAnchorElement>) => {
    if (event.pointerType === 'mouse' || event.button !== 0) {
      return;
    }

    suppressClickRef.current = false;
    gestureRef.current = {
      kind: 'pointer',
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }, []);

  const handlePointerMove = useCallback((event: ReactPointerEvent<HTMLAnchorElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.kind !== 'pointer' || gesture.pointerId !== event.pointerId) {
      return;
    }

    const deltaX = event.clientX - gesture.startX;
    const deltaY = event.clientY - gesture.startY;
    if (Math.abs(deltaX) > COMPANION_ROW_SWIPE_SLOP && Math.abs(deltaX) > Math.abs(deltaY)) {
      suppressClickRef.current = true;
    }
  }, []);

  const handlePointerUp = useCallback((event: ReactPointerEvent<HTMLAnchorElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.kind !== 'pointer' || gesture.pointerId !== event.pointerId) {
      return;
    }

    handleGestureIntent(event.clientX - gesture.startX, event.clientY - gesture.startY);
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    gestureRef.current = null;
  }, [handleGestureIntent]);

  const handlePointerCancel = useCallback((event: ReactPointerEvent<HTMLAnchorElement>) => {
    if (gestureRef.current?.kind === 'pointer' && gestureRef.current.pointerId === event.pointerId) {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    }
    gestureRef.current = null;
    suppressClickRef.current = false;
  }, []);

  const handleTouchStart = useCallback((event: ReactTouchEvent<HTMLAnchorElement>) => {
    const touch = event.changedTouches.item(0);
    if (!touch || gestureRef.current) {
      return;
    }

    suppressClickRef.current = false;
    gestureRef.current = {
      kind: 'touch',
      touchId: touch.identifier,
      startX: touch.clientX,
      startY: touch.clientY,
    };
  }, []);

  const handleTouchMove = useCallback((event: ReactTouchEvent<HTMLAnchorElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.kind !== 'touch') {
      return;
    }

    const touch = findTouchByIdentifier(event.changedTouches, gesture.touchId)
      ?? findTouchByIdentifier(event.touches, gesture.touchId);
    if (!touch) {
      return;
    }

    const deltaX = touch.clientX - gesture.startX;
    const deltaY = touch.clientY - gesture.startY;
    if (Math.abs(deltaX) > COMPANION_ROW_SWIPE_SLOP && Math.abs(deltaX) > Math.abs(deltaY)) {
      suppressClickRef.current = true;
      event.preventDefault();
    }
  }, []);

  const handleTouchEnd = useCallback((event: ReactTouchEvent<HTMLAnchorElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.kind !== 'touch') {
      return;
    }

    const touch = findTouchByIdentifier(event.changedTouches, gesture.touchId);
    if (!touch) {
      return;
    }

    handleGestureIntent(touch.clientX - gesture.startX, touch.clientY - gesture.startY);
    gestureRef.current = null;
  }, [handleGestureIntent]);

  const handleTouchCancel = useCallback(() => {
    gestureRef.current = null;
    suppressClickRef.current = false;
  }, []);

  const handleConversationClick = useCallback((event: ReactMouseEvent<HTMLAnchorElement>) => {
    if (suppressClickRef.current) {
      event.preventDefault();
      suppressClickRef.current = false;
      return;
    }

    if (actionsRevealed) {
      event.preventDefault();
      onRevealActions(null);
    }
  }, [actionsRevealed, onRevealActions]);

  return (
    <div className="relative overflow-hidden border-b border-border-subtle last:border-b-0">
      <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-4">
        <div id={actionsId} role="group" aria-label={`Actions for ${titleText}`} className="pointer-events-none">
          <button
            type="button"
            onClick={() => {
              onRevealActions(null);
              onSetArchived(session.id, inWorkspace);
            }}
            disabled={!actionsRevealed || actionBusy}
            aria-label={`${archiveActionLabel} conversation`}
            title={`${archiveActionLabel} conversation`}
            className={cx(
              'pointer-events-auto flex h-[3.5rem] w-[4.5rem] select-none flex-col items-center justify-center gap-1 rounded-[1.1rem] text-[10px] font-medium leading-none transition-[transform,background-color,color,opacity] duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent/45 disabled:pointer-events-none disabled:opacity-40',
              inWorkspace
                ? 'bg-warning/12 text-warning hover:bg-warning/18 active:scale-[0.97]'
                : 'bg-success/12 text-success hover:bg-success/18 active:scale-[0.97]',
            )}
            style={COMPANION_TOUCH_BUTTON_STYLE}
          >
            {inWorkspace ? (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M3 6h18" />
                <path d="M6 10v8h12v-8" />
                <path d="m8 10 4 4 4-4" />
                <path d="M12 4v9" />
              </svg>
            ) : (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M3 18h18" />
                <path d="M6 6v8h12V6" />
                <path d="m8 10 4-4 4 4" />
                <path d="M12 20V7" />
              </svg>
            )}
            <span>{archiveActionLabel}</span>
          </button>
        </div>
      </div>

      <div className={cx(
        'relative flex items-start gap-1 bg-base px-4 py-2.5 transition-transform duration-150 ease-out',
        actionsRevealed ? '-translate-x-[5rem]' : 'translate-x-0',
      )}>
        <Link
          to={buildCompanionConversationPath(session.id)}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onTouchCancel={handleTouchCancel}
          onClick={handleConversationClick}
          className="min-w-0 flex-1 select-none rounded-[1.1rem] px-1 py-1 transition-[transform,color,background-color] duration-150 hover:text-primary active:scale-[0.99] active:bg-elevated/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent/45"
          style={COMPANION_TOUCH_ROW_STYLE}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h3 className="truncate text-[15px] font-medium leading-tight text-primary">{titleText}</h3>
                {session.attentionUnreadMessageCount && session.attentionUnreadMessageCount > 0 ? (
                  <span className="shrink-0 text-[10.5px] font-mono text-warning">+{session.attentionUnreadMessageCount}</span>
                ) : null}
              </div>
              {flags.length > 0 ? (
                <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[10px] text-dim/85">
                  {flags.map((flag) => (
                    <span key={flag} className="uppercase tracking-[0.12em]">{flag}</span>
                  ))}
                </div>
              ) : null}
              {deferredResumeText ? (
                <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-secondary">
                  <span className={cx('shrink-0', hasReadyDeferredResumes ? 'text-warning' : 'text-accent')} aria-hidden="true">⏰</span>
                  <span className="min-w-0 truncate">
                    <span className="text-dim">Wakeups </span>
                    <span className={hasReadyDeferredResumes ? 'text-warning' : 'text-secondary'}>{deferredResumeText}</span>
                  </span>
                </p>
              ) : null}
            </div>

            <div className="shrink-0 text-right text-[10.5px] text-dim tabular-nums">
              <div>{formatSessionActivityAt(session)}</div>
              <div className="mt-1 inline-flex items-center justify-end gap-1">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M7 18.5c-2.2 0-4-1.7-4-3.8V7.8C3 5.7 4.8 4 7 4h10c2.2 0 4 1.7 4 3.8v6.9c0 2.1-1.8 3.8-4 3.8H11l-4 2.5v-2.5H7Z" />
                </svg>
                <span aria-label={messageCountLabel}>{formattedMessageCount}</span>
              </div>
            </div>
          </div>
        </Link>

        {canResume ? (
          <button
            type="button"
            onClick={() => onResume(session)}
            disabled={actionBusy}
            aria-label={`Resume ${titleText}`}
            title={`Resume ${titleText}`}
            className="mt-0.5 inline-flex h-9 shrink-0 select-none items-center justify-center rounded-full border border-accent/25 bg-accent/10 px-3 text-[11px] font-medium text-accent transition-[transform,color,border-color,background-color] duration-150 hover:border-accent/35 hover:bg-accent/14 active:scale-[0.97] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent/45 disabled:cursor-default disabled:opacity-45"
            style={COMPANION_TOUCH_BUTTON_STYLE}
          >
            {busyAction === 'resume' ? 'Resuming…' : 'Resume'}
          </button>
        ) : null}

        <button
          type="button"
          onClick={() => onRevealActions(actionsRevealed ? null : session.id)}
          aria-label={toggleActionsLabel}
          aria-controls={actionsId}
          aria-expanded={actionsRevealed}
          title={toggleActionsLabel}
          className="mt-0.5 flex h-9 w-9 shrink-0 select-none items-center justify-center rounded-full text-dim transition-[transform,color,background-color] duration-150 hover:bg-elevated hover:text-primary active:scale-[0.97] active:bg-elevated/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent/45"
          style={COMPANION_TOUCH_BUTTON_STYLE}
        >
          {actionsRevealed ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="1.5" />
              <circle cx="19" cy="12" r="1.5" />
              <circle cx="5" cy="12" r="1.5" />
            </svg>
          )}
        </button>
      </div>
    </div>
  );
});

function SessionSection({
  title,
  sessions,
  workspaceSessionIds,
  actionBusyId,
  actionBusyKind,
  revealedActionId,
  onSetArchived,
  onResume,
  onRevealActions,
  footer,
}: {
  title: string;
  sessions: SessionMeta[];
  workspaceSessionIds: ReadonlySet<string>;
  actionBusyId: string | null;
  actionBusyKind: 'archive' | 'resume' | null;
  revealedActionId: string | null;
  onSetArchived: (sessionId: string, archived: boolean) => void;
  onResume: (session: SessionMeta) => void;
  onRevealActions: (sessionId: string | null) => void;
  footer?: ReactNode;
}) {
  if (sessions.length === 0) {
    return null;
  }

  return (
    <section className="pt-5 first:pt-0">
      <h2 className="px-4 text-[10px] font-semibold uppercase tracking-[0.18em] text-dim/70">{title}</h2>
      <div className="mt-2 border-y border-border-subtle">
        {sessions.map((session) => (
          <CompanionConversationRow
            key={session.id}
            session={session}
            inWorkspace={workspaceSessionIds.has(session.id)}
            actionBusy={actionBusyId === session.id}
            busyAction={actionBusyId === session.id ? actionBusyKind : null}
            actionsRevealed={revealedActionId === session.id}
            onSetArchived={onSetArchived}
            onResume={onResume}
            onRevealActions={onRevealActions}
          />
        ))}
        {footer ? <div className="border-t border-border-subtle px-4 py-3">{footer}</div> : null}
      </div>
    </section>
  );
}

export function CompanionConversationsPage() {
  const navigate = useNavigate();
  const { titles } = useLiveTitles();
  const { versions } = useAppEvents();
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
  const [actionBusyId, setActionBusyId] = useState<string | null>(null);
  const [actionBusyKind, setActionBusyKind] = useState<'archive' | 'resume' | null>(null);
  const [revealedActionId, setRevealedActionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const syncTimerRef = useRef<number | null>(null);
  const fetchConversationList = useCallback(
    () => api.companionConversationList({ archivedOffset: 0, archivedLimit: COMPANION_ARCHIVED_PAGE_SIZE }),
    [],
  );
  const {
    data,
    loading,
    refreshing,
    error: loadError,
    refetch,
    replaceData,
  } = useApi(fetchConversationList, `companion-conversation-list:${versions.sessions}`);
  const [sections, setSections] = useState<CompanionConversationListResult | null>(() => data);

  useEffect(() => {
    if (data) {
      setSections(data);
    }
  }, [data]);

  useEffect(() => () => {
    if (syncTimerRef.current !== null) {
      window.clearTimeout(syncTimerRef.current);
    }
  }, []);

  const refreshSections = useCallback(async (archivedLimit: number) => {
    try {
      const next = await api.companionConversationList({
        archivedOffset: 0,
        archivedLimit: Math.max(COMPANION_ARCHIVED_PAGE_SIZE, archivedLimit),
      });
      replaceData(next);
      setSections(next);
      return next;
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
      return null;
    }
  }, [replaceData]);

  const titledSections = useMemo(
    () => (sections ? applyCompanionConversationTitles(sections, titles) : null),
    [sections, titles],
  );
  const workspaceSessionIds = useMemo(
    () => new Set(titledSections?.workspaceSessionIds ?? []),
    [titledSections],
  );
  const orderedOpenSessions = useMemo(() => {
    if (!titledSections) {
      return [];
    }

    const sessionById = new Map(titledSections.active.map((session) => [session.id, session]));
    return titledSections.workspaceSessionIds
      .map((id) => sessionById.get(id) ?? null)
      .filter((session): session is SessionMeta => session !== null);
  }, [titledSections]);
  const orderedLiveElsewhereSessions = useMemo(
    () => sortCompanionSessions(titledSections?.live ?? []).filter((session) => !workspaceSessionIds.has(session.id)),
    [titledSections, workspaceSessionIds],
  );
  const orderedNeedsReviewSessions = useMemo(
    () => sortCompanionSessions((titledSections?.needsReview ?? []).filter((session) => !workspaceSessionIds.has(session.id))),
    [titledSections, workspaceSessionIds],
  );
  const orderedArchivedSessions = useMemo(
    () => sortCompanionSessions(titledSections?.archived ?? []),
    [titledSections],
  );
  const totalConversationCount = orderedOpenSessions.length
    + orderedLiveElsewhereSessions.length
    + orderedNeedsReviewSessions.length
    + orderedArchivedSessions.length;
  const overviewLabel = buildCompanionOverviewLabel({
    openCount: orderedOpenSessions.length,
    liveElsewhereCount: orderedLiveElsewhereSessions.length,
    needsReviewCount: orderedNeedsReviewSessions.length,
    archivedCount: orderedArchivedSessions.length,
  });
  const stateNote = buildCompanionStateNote({
    standalone,
    installAvailable,
    secureContext,
    notificationsSupported,
    notificationPermission,
  });
  const visibleError = error ?? loadError;

  const handleRefresh = useCallback(async () => {
    setError(null);
    const next = await refetch({ resetLoading: sections === null });
    if (next) {
      setSections(next);
    }
  }, [refetch, sections]);

  const handleSetArchived = useCallback(async (sessionId: string, archived: boolean) => {
    if (actionBusyId) {
      return;
    }

    setRevealedActionId((current) => (current === sessionId ? null : current));
    setActionBusyId(sessionId);
    setActionBusyKind('archive');
    setError(null);
    try {
      setSections((current) => current ? setCompanionConversationArchivedStateInList(current, sessionId, archived) : current);

      const currentLayout = await api.openConversationTabs();
      const nextLayout = buildCompanionArchivedLayout(currentLayout, sessionId, archived);
      await api.setOpenConversationTabs(nextLayout.sessionIds, nextLayout.pinnedSessionIds, nextLayout.archivedSessionIds);

      if (typeof window !== 'undefined') {
        if (syncTimerRef.current !== null) {
          window.clearTimeout(syncTimerRef.current);
        }

        const archivedLimit = Math.max(sections?.archived.length ?? COMPANION_ARCHIVED_PAGE_SIZE, COMPANION_ARCHIVED_PAGE_SIZE);
        syncTimerRef.current = window.setTimeout(() => {
          syncTimerRef.current = null;
          void refreshSections(archivedLimit);
        }, COMPANION_ARCHIVE_SYNC_DELAY_MS);
      }
    } catch (nextError) {
      await refreshSections(Math.max(sections?.archived.length ?? COMPANION_ARCHIVED_PAGE_SIZE, COMPANION_ARCHIVED_PAGE_SIZE));
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setActionBusyId(null);
      setActionBusyKind(null);
    }
  }, [actionBusyId, refreshSections, sections?.archived.length]);

  const handleResumeConversation = useCallback(async (session: SessionMeta) => {
    if (actionBusyId) {
      return;
    }

    if (!canResumeCompanionSession(session)) {
      setError('This transcript cannot be resumed because its session file is unavailable.');
      return;
    }

    setActionBusyId(session.id);
    setActionBusyKind('resume');
    setError(null);
    try {
      const resumed = await api.resumeSession(session.file);
      navigate(buildCompanionConversationPath(resumed.id));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setActionBusyId(null);
      setActionBusyKind(null);
    }
  }, [actionBusyId, navigate]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto pb-[calc(env(safe-area-inset-bottom)+1rem)]">
        <div className="mx-auto flex w-full max-w-3xl flex-col px-0 py-4">
          <div className="px-4 pb-2">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.16em] text-dim/80">
                <span className={`h-1.5 w-1.5 rounded-full ${connectionStatusDotClass(status)}`} />
                {formatConnectionStatus(status)}
              </span>
              {titledSections ? <span className="text-[11px] text-dim">{overviewLabel}</span> : null}
              {stateNote ? <span className={`text-[11px] ${stateNote.className}`}>{stateNote.text}</span> : null}
            </div>
            {status !== 'open' ? (
              <p className="mt-1 text-[11px] text-secondary">
                {status === 'offline'
                  ? 'Live updates are offline. Refresh to resync the companion with the desktop workspace.'
                  : 'Live updates are reconnecting. You can refresh if this view looks stale.'}
              </p>
            ) : null}
            {visibleError ? <p className="mt-1 text-[11px] text-danger">{visibleError}</p> : null}
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => { void handleRefresh(); }}
                disabled={refreshing}
                className="inline-flex h-9 select-none items-center rounded-full border border-border-default bg-surface px-3 text-[12px] font-medium text-secondary transition-[transform,color,border-color,background-color] duration-150 hover:border-accent/30 hover:text-primary active:scale-[0.97] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent/45 disabled:cursor-default disabled:opacity-50"
                style={COMPANION_TOUCH_BUTTON_STYLE}
              >
                {refreshing ? 'Refreshing…' : 'Refresh'}
              </button>
              {installAvailable ? (
                <button
                  type="button"
                  onClick={() => { void promptInstall(); }}
                  disabled={installBusy}
                  className="inline-flex h-9 select-none items-center rounded-full border border-border-default bg-surface px-3 text-[12px] font-medium text-secondary transition-[transform,color,border-color,background-color] duration-150 hover:border-accent/30 hover:text-primary active:scale-[0.97] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent/45 disabled:cursor-default disabled:opacity-50"
                  style={COMPANION_TOUCH_BUTTON_STYLE}
                >
                  {installBusy ? 'Installing…' : 'Install app'}
                </button>
              ) : null}
              {notificationsSupported && secureContext && notificationPermission === 'default' ? (
                <button
                  type="button"
                  onClick={() => { void requestNotificationPermission(); }}
                  className="inline-flex h-9 select-none items-center rounded-full border border-border-default bg-surface px-3 text-[12px] font-medium text-secondary transition-[transform,color,border-color,background-color] duration-150 hover:border-accent/30 hover:text-primary active:scale-[0.97] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent/45"
                  style={COMPANION_TOUCH_BUTTON_STYLE}
                >
                  Enable alerts
                </button>
              ) : null}
            </div>
          </div>
          {loading && !titledSections ? (
            <p className="px-4 text-[13px] text-dim">Loading conversations…</p>
          ) : titledSections && totalConversationCount === 0 ? (
            <div className="px-4 pt-5">
              <p className="text-[15px] text-primary">Start a conversation to make the companion app useful.</p>
              <p className="mt-2 text-[13px] leading-relaxed text-secondary">
                New live conversations and saved transcripts will appear here automatically, and archived conversations stay reachable from the same list.
              </p>
            </div>
          ) : titledSections ? (
            <>
              {orderedOpenSessions.length > 0 ? (
                <SessionSection title="Open in workspace" sessions={orderedOpenSessions} workspaceSessionIds={workspaceSessionIds} actionBusyId={actionBusyId} actionBusyKind={actionBusyKind} revealedActionId={revealedActionId} onSetArchived={handleSetArchived} onResume={handleResumeConversation} onRevealActions={setRevealedActionId} />
              ) : null}

              {orderedLiveElsewhereSessions.length > 0 ? (
                <SessionSection title="Live elsewhere" sessions={orderedLiveElsewhereSessions} workspaceSessionIds={new Set()} actionBusyId={actionBusyId} actionBusyKind={actionBusyKind} revealedActionId={revealedActionId} onSetArchived={handleSetArchived} onResume={handleResumeConversation} onRevealActions={setRevealedActionId} />
              ) : null}

              {orderedNeedsReviewSessions.length > 0 ? (
                <SessionSection title="Needs review" sessions={orderedNeedsReviewSessions} workspaceSessionIds={new Set()} actionBusyId={actionBusyId} actionBusyKind={actionBusyKind} revealedActionId={revealedActionId} onSetArchived={handleSetArchived} onResume={handleResumeConversation} onRevealActions={setRevealedActionId} />
              ) : null}

              {orderedArchivedSessions.length > 0 ? (
                <section className="pt-5">
                  <div className="px-4">
                    <button
                      type="button"
                      onClick={() => setShowArchived((current) => !current)}
                      className="inline-flex h-9 select-none items-center rounded-full border border-border-default bg-surface px-3 text-[12px] font-medium text-secondary transition-[transform,color,border-color,background-color] duration-150 hover:border-accent/30 hover:text-primary active:scale-[0.97] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent/45"
                      style={COMPANION_TOUCH_BUTTON_STYLE}
                    >
                      {showArchived
                        ? 'Hide archived chats'
                        : `Show ${orderedArchivedSessions.length} archived chat${orderedArchivedSessions.length === 1 ? '' : 's'}`}
                    </button>
                  </div>
                </section>
              ) : null}

              {showArchived ? (
                <SessionSection
                  title="Archived"
                  sessions={orderedArchivedSessions}
                  workspaceSessionIds={new Set()}
                  actionBusyId={actionBusyId}
                  actionBusyKind={actionBusyKind}
                  revealedActionId={revealedActionId}
                  onSetArchived={handleSetArchived}
                  onResume={handleResumeConversation}
                  onRevealActions={setRevealedActionId}
                  footer={orderedArchivedSessions.length > 0 ? (
                    <p className="text-[11px] text-dim">
                      {orderedArchivedSessions.length} archived chat{orderedArchivedSessions.length === 1 ? '' : 's'}
                    </p>
                  ) : undefined}
                />
              ) : null}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

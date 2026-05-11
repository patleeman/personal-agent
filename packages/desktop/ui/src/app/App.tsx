import { Component, type ReactNode, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useParams } from 'react-router-dom';

import { api } from '../client/api';
import { Layout } from '../components/Layout';
import { bumpConversationScopedEventVersions, INITIAL_CONVERSATION_SCOPED_EVENT_VERSIONS } from '../conversation/conversationEventVersions';
import { resolveConversationIndexRedirect } from '../conversation/conversationRoutes';
import {
  hasDraftConversationAttachments,
  hasDraftConversationContextDocs,
  readDraftConversationComposer,
  readDraftConversationCwd,
} from '../conversation/draftConversation';
import { subscribeDesktopAppEvents } from '../desktop/desktopAppEvents';
import { useConversations } from '../hooks/useConversations';
import { lazyRouteWithRecovery } from '../navigation/lazyRouteRecovery';
import {
  mergeSessionSnapshotPreservingOrder,
  removeSessionMetaPreservingOrder,
  replaceSessionMetaPreservingOrder,
  updateSessionRunningPreservingOrder,
} from '../session/sessionListState';
import { fetchSessionsSnapshot } from '../session/sessionSnapshot';
import { openConversationTab } from '../session/sessionTabs';
import type { DaemonState, DesktopAppEvent, DurableRunListResult, ScheduledTaskSummary, SessionMeta } from '../shared/types';
import { ThemeProvider } from '../ui-state/theme';
import {
  AppDataContext,
  AppEventsContext,
  INITIAL_APP_EVENT_VERSIONS,
  LiveTitlesContext,
  SseConnectionContext,
  SystemStatusContext,
} from './contexts';

// ── Top-level error boundary ────────────────────────────────────────────────
// Catches render crashes outside of route content (context providers, hooks, etc.)
// so the user sees a recovery UI instead of a white screen.

interface AppErrorBoundaryState {
  hasError: boolean;
  errorMessage: string | null;
}

class AppErrorBoundary extends Component<{ children: ReactNode }, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { hasError: false, errorMessage: null };

  static getDerivedStateFromError(error: unknown): AppErrorBoundaryState {
    return {
      hasError: true,
      errorMessage: error instanceof Error ? (error.stack ?? error.message) : String(error ?? ''),
    };
  }

  componentDidCatch(error: unknown, _errorInfo: { componentStack?: string }) {
    window.dispatchEvent(
      new CustomEvent('pa-notification', {
        detail: {
          message: 'Application crash recovered',
          type: 'error',
          details: error instanceof Error ? (error.stack ?? error.message) : String(error ?? ''),
          source: 'core',
        },
      }),
    );
  }

  componentDidUpdate(_prevProps: { children: ReactNode }, prevState: AppErrorBoundaryState) {
    // If we recovered (e.g., hot reload), clear the error state.
    if (prevState.hasError && !this.state.hasError) {
      return;
    }
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <main className="flex min-h-screen items-center justify-center bg-base px-6">
        <div className="max-w-lg rounded-2xl border border-border-subtle bg-surface px-6 py-6 shadow-sm">
          <p className="text-[11px] uppercase tracking-[0.18em] text-dim">Something went wrong</p>
          <h1 className="mt-2 text-[22px] font-semibold text-primary">Personal Agent encountered an error</h1>
          <p className="mt-2 text-[13px] leading-6 text-secondary">
            The application crashed unexpectedly. You can try reloading, or start a new conversation.
          </p>
          {this.state.errorMessage ? (
            <div className="mt-4 rounded-2xl border border-amber-500/20 bg-amber-500/8 px-4 py-3">
              <p className="text-[11px] uppercase tracking-[0.16em] text-dim">Error details</p>
              <p className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap break-words font-mono text-[12px] leading-5 text-primary">
                {this.state.errorMessage}
              </p>
            </div>
          ) : null}
          <div className="mt-5 flex flex-wrap gap-2">
            <button className="ui-action-button" onClick={() => window.location.reload()}>
              Reload application
            </button>
            <a href="/conversations/new" className="ui-action-button">
              New conversation
            </a>
          </div>
        </div>
      </main>
    );
  }
}

function ConversationsRouteRedirect() {
  const { openIds, pinnedIds } = useConversations();
  const redirectPath = resolveConversationIndexRedirect({
    openIds,
    pinnedIds,
    hasDraft:
      readDraftConversationComposer().trim().length > 0 ||
      readDraftConversationCwd().trim().length > 0 ||
      hasDraftConversationAttachments() ||
      hasDraftConversationContextDocs(),
  });

  return <Navigate to={redirectPath} replace />;
}

const ConversationPage = lazyRouteWithRecovery('conversation-page', () =>
  import('../pages/ConversationPage').then((module) => ({ default: module.ConversationPage })),
);
const ExtensionPage = lazyRouteWithRecovery('extension-page', () =>
  import('../extensions/ExtensionPage').then((module) => ({ default: module.ExtensionPage })),
);

function suspendRoute(element: React.ReactNode) {
  return (
    <Suspense fallback={<div className="flex h-full items-center justify-center px-6 text-[12px] text-dim">Loading…</div>}>
      {element}
    </Suspense>
  );
}

function DraftConversationRoute() {
  return suspendRoute(<ConversationPage key="draft" draft />);
}

function SavedConversationRoute() {
  const { id } = useParams<{ id?: string }>();
  return suspendRoute(<ConversationPage key={id ?? 'conversation'} />);
}

export function App() {
  const [titleMap, setTitleMap] = useState<Map<string, string>>(new Map());
  const [eventVersions, setEventVersions] = useState(INITIAL_APP_EVENT_VERSIONS);
  const [conversationVersions, setConversationVersions] = useState(INITIAL_CONVERSATION_SCOPED_EVENT_VERSIONS);
  const [sseStatus, setSseStatus] = useState<'connecting' | 'open' | 'reconnecting' | 'offline'>('connecting');

  const projects = null;
  const [sessions, setSessionsState] = useState<SessionMeta[] | null>(null);
  const [tasks, setTasksState] = useState<ScheduledTaskSummary[] | null>(null);
  const [runs, setRunsState] = useState<DurableRunListResult | null>(null);
  const [daemon, setDaemonState] = useState<DaemonState | null>(null);
  const openedOnceRef = useRef(false);
  // Session meta requests can resolve out of order during fast run transitions.
  // Track the latest request per session so stale HTTP responses cannot undo the
  // authoritative running state already pushed over the desktop event stream.
  const refreshSessionMetaSeqRef = useRef(new Map<string, number>());

  const setTitle = useCallback((id: string, title: string) => {
    setTitleMap((prev) => {
      if (prev.get(id) === title) return prev;
      const next = new Map(prev);
      next.set(id, title);
      return next;
    });
  }, []);

  const setProjects = useCallback(() => {}, []);

  const setSessions = useCallback((items: SessionMeta[]) => {
    setSessionsState((previous) => mergeSessionSnapshotPreservingOrder(previous, items));
  }, []);

  const applySessionMetaUpdate = useCallback((sessionId: string, nextSession: SessionMeta | null) => {
    setSessionsState((previous) => {
      if (!previous) {
        return previous;
      }

      if (!nextSession) {
        return removeSessionMetaPreservingOrder(previous, sessionId);
      }

      return replaceSessionMetaPreservingOrder(previous, nextSession);
    });
  }, []);

  const bumpConversationVersion = useCallback((sessionId: string) => {
    setConversationVersions((previous) => bumpConversationScopedEventVersions(previous, sessionId));
  }, []);

  const refreshSessionMeta = useCallback(
    (sessionId: string, running?: boolean) => {
      const nextSeq = (refreshSessionMetaSeqRef.current.get(sessionId) ?? 0) + 1;
      refreshSessionMetaSeqRef.current.set(sessionId, nextSeq);

      void api
        .sessionMeta(sessionId)
        .then((session) => {
          if (refreshSessionMetaSeqRef.current.get(sessionId) !== nextSeq) {
            return;
          }
          applySessionMetaUpdate(sessionId, session && running !== undefined ? { ...session, isRunning: running } : session);
        })
        .catch((error) => {
          if (refreshSessionMetaSeqRef.current.get(sessionId) !== nextSeq) {
            return;
          }
          const message = error instanceof Error ? error.message : String(error);
          if (/not found/i.test(message)) {
            applySessionMetaUpdate(sessionId, null);
          }
        });
    },
    [applySessionMetaUpdate],
  );

  const setTasks = useCallback((items: ScheduledTaskSummary[]) => {
    setTasksState(items);
  }, []);

  const setRuns = useCallback((result: DurableRunListResult) => {
    setRunsState(result);
  }, []);

  const setDaemon = useCallback((state: DaemonState) => {
    setDaemonState(state);
  }, []);

  const handleDesktopAppEvent = useCallback(
    (payload: DesktopAppEvent) => {
      switch (payload.type) {
        case 'live_title':
          setTitle(payload.sessionId, payload.title);
          return;
        case 'session_meta_changed':
          bumpConversationVersion(payload.sessionId);
          if (payload.running !== undefined) {
            setSessionsState((previous) =>
              previous ? updateSessionRunningPreservingOrder(previous, payload.sessionId, payload.running) : previous,
            );
          }
          void refreshSessionMeta(payload.sessionId, payload.running);
          return;
        case 'session_file_changed':
          bumpConversationVersion(payload.sessionId);
          return;
        case 'open_session':
          openConversationTab(payload.sessionId);
          return;

        case 'sessions':
          setSessions(payload.sessions);
          return;
        case 'tasks':
          setTasks(payload.tasks);
          return;
        case 'runs':
          setRuns(payload.result);
          return;
        case 'daemon':
          setDaemon(payload.state);
          return;
        case 'notification':
          window.dispatchEvent(
            new CustomEvent('pa-notification', {
              detail: {
                message: payload.message,
                type: (payload as { severity?: string }).severity ?? 'info',
                details: payload.details,
                source: payload.extensionId,
              },
            }),
          );
          return;
        case 'invalidate':
          if (payload.topics.includes('runs')) {
            void api
              .runs()
              .then((result) => {
                setRuns(result);
              })
              .catch(() => {
                // Keep the last known snapshot until the next app event or manual refresh.
              });
          }
          setEventVersions((prev) => {
            const next = { ...prev };
            for (const topic of payload.topics) {
              if (topic in next) {
                const trackedTopic = topic as keyof typeof next;
                next[trackedTopic] += 1;
              }
            }
            return next;
          });
          return;
        default:
          return;
      }
    },
    [bumpConversationVersion, refreshSessionMeta, setDaemon, setSessions, setTasks, setTitle],
  );

  const bootstrapSnapshots = useCallback(() => {
    void fetchSessionsSnapshot()
      .then((items) => {
        setSessions(items);
      })
      .catch(() => {
        // Keep waiting for SSE or a later retry.
      });

    void api
      .tasks()
      .then((items) => {
        setTasks(items);
      })
      .catch(() => {
        // Keep waiting for SSE or a later retry.
      });

    void api
      .runs()
      .then((result) => {
        setRuns(result);
      })
      .catch(() => {
        // Keep waiting for SSE or a later retry.
      });

    void api
      .daemon()
      .then((state) => {
        setDaemon(state);
      })
      .catch(() => {
        // Keep waiting for SSE or a later retry.
      });
  }, [setDaemon, setRuns, setSessions, setTasks]);

  // Track the latest subscription so we don't re-subscribe after a fresh mount.
  const subscriptionGenerationRef = useRef(0);

  const subscribe = useCallback(() => {
    const generation = ++subscriptionGenerationRef.current;
    let cancelled = false;
    let cleanup = () => {};
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const scheduleReconnect = (delayMs: number) => {
      if (cancelled) return;
      reconnectTimer = window.setTimeout(() => {
        if (cancelled) return;
        cleanup();
        void subscribeDesktopAppEvents({
          onopen: () => {
            openedOnceRef.current = true;
            setSseStatus('open');
          },
          onevent: handleDesktopAppEvent,
          onerror: () => {
            setSseStatus(openedOnceRef.current ? 'reconnecting' : 'connecting');
          },
          onclose: () => {
            setSseStatus('offline');
            // Schedule a reconnect if we were previously connected.
            if (openedOnceRef.current) {
              scheduleReconnect(3000);
            }
          },
        })
          .then((localCleanup) => {
            if (cancelled || generation !== subscriptionGenerationRef.current) {
              localCleanup();
              return;
            }
            cleanup = localCleanup;
          })
          .catch(() => {
            if (cancelled || generation !== subscriptionGenerationRef.current) return;
            setSseStatus('offline');
            void bootstrapSnapshots();
          });
      }, delayMs);
    };

    const bootstrapTimer = window.setTimeout(() => {
      if (!openedOnceRef.current) {
        setSseStatus('offline');
        void bootstrapSnapshots();
      }
    }, 1500);

    void subscribeDesktopAppEvents({
      onopen: () => {
        openedOnceRef.current = true;
        window.clearTimeout(bootstrapTimer);
        setSseStatus('open');
      },
      onevent: handleDesktopAppEvent,
      onerror: () => {
        setSseStatus(openedOnceRef.current ? 'reconnecting' : 'connecting');
      },
      onclose: () => {
        setSseStatus('offline');
        // Schedule a reconnect if we were previously connected.
        if (openedOnceRef.current) {
          scheduleReconnect(3000);
        }
      },
    })
      .then((localCleanup) => {
        if (cancelled || generation !== subscriptionGenerationRef.current) {
          localCleanup();
          return;
        }

        cleanup = localCleanup;
      })
      .catch(() => {
        if (cancelled || generation !== subscriptionGenerationRef.current) return;
        setSseStatus('offline');
        void bootstrapSnapshots();
      });

    return () => {
      cancelled = true;
      window.clearTimeout(bootstrapTimer);
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
      }
      cleanup();
      setSseStatus('offline');
    };
  }, [bootstrapSnapshots, handleDesktopAppEvent]);

  useEffect(() => {
    let cleanup = () => {};
    const bootstrapTimer = window.setTimeout(() => {
      void bootstrapSnapshots();
    }, 500);
    const subscribeTimer = window.setTimeout(() => {
      cleanup = subscribe();
    }, 5_000);

    return () => {
      window.clearTimeout(bootstrapTimer);
      window.clearTimeout(subscribeTimer);
      cleanup();
    };
  }, [bootstrapSnapshots, subscribe]);

  return (
    <AppErrorBoundary>
      <AppEventsContext.Provider value={{ versions: eventVersions, conversationVersions }}>
        <SseConnectionContext.Provider value={{ status: sseStatus }}>
          <AppDataContext.Provider value={{ projects, sessions, tasks, runs, setProjects, setSessions, setTasks, setRuns }}>
            <SystemStatusContext.Provider value={{ daemon, setDaemon }}>
              <LiveTitlesContext.Provider value={{ titles: titleMap, setTitle }}>
                <ThemeProvider>
                  <BrowserRouter>
                    <Routes>
                      <Route path="/" element={<Layout />}>
                        <Route index element={<Navigate to="/conversations/new" replace />} />
                        <Route path="conversations" element={<ConversationsRouteRedirect />} />
                        <Route path="conversations/new" element={<DraftConversationRoute />} />
                        <Route path="conversations/:id" element={<SavedConversationRoute />} />
                        <Route path="*" element={suspendRoute(<ExtensionPage />)} />
                      </Route>
                    </Routes>
                  </BrowserRouter>
                </ThemeProvider>
              </LiveTitlesContext.Provider>
            </SystemStatusContext.Provider>
          </AppDataContext.Provider>
        </SseConnectionContext.Provider>
      </AppEventsContext.Provider>
    </AppErrorBoundary>
  );
}

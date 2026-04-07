import React from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppDataContext, AppEventsContext, INITIAL_APP_EVENT_VERSIONS, SseConnectionContext, SystemStatusContext } from '../contexts.js';
import { useApi } from '../hooks.js';
import { CompanionInboxPage } from './CompanionInboxPage.js';
import { CompanionSystemPage } from './CompanionSystemPage.js';
import { CompanionTaskDetailPage } from './CompanionTaskDetailPage.js';
import { CompanionTasksPage } from './CompanionTasksPage.js';

vi.mock('../hooks', () => ({
  useApi: vi.fn(),
}));

(globalThis as typeof globalThis & { React?: typeof React }).React = React;

function renderWithProviders(node: React.ReactNode) {
  return renderToString(
    <MemoryRouter>
      <SseConnectionContext.Provider value={{ status: 'open' }}>
        <AppEventsContext.Provider value={{ versions: INITIAL_APP_EVENT_VERSIONS }}>
          <AppDataContext.Provider value={{
            activity: {
              entries: [
                {
                  id: 'activity-1',
                  createdAt: '2026-03-25T12:00:00.000Z',
                  profile: 'shared',
                  kind: 'scheduled-task',
                  summary: 'Morning brief task failed',
                  details: 'The last scheduled run could not reach the weather service.',
                  read: false,
                  relatedConversationIds: [],
                },
              ],
              unreadCount: 1,
            },
            alerts: {
              activeCount: 1,
              entries: [
                {
                  id: 'alert-1',
                  profile: 'shared',
                  kind: 'reminder',
                  severity: 'disruptive',
                  status: 'active',
                  title: 'Approve the lunch order',
                  body: 'The reminder fired for the lunch order check-in.',
                  createdAt: '2026-03-25T12:05:00.000Z',
                  updatedAt: '2026-03-25T12:05:00.000Z',
                  conversationId: 'attention-1',
                  wakeupId: 'resume-1',
                  sourceKind: 'reminder-tool',
                  sourceId: 'reminder-1',
                  requiresAck: true,
                },
              ],
            },
            projects: null,
            sessions: null,
            tasks: [
              {
                id: 'morning-brief',
                filePath: '/tmp/morning-brief.task.md',
                scheduleType: 'cron',
                running: false,
                enabled: true,
                cron: '0 8 * * *',
                prompt: 'Summarize the day ahead.',
                lastStatus: 'failure',
                lastRunAt: '2026-03-25T11:50:00.000Z',
              },
              {
                id: 'cleanup',
                filePath: '/tmp/cleanup.task.md',
                scheduleType: 'cron',
                running: true,
                enabled: true,
                cron: '0 * * * *',
                prompt: 'Clean up old runs.',
                lastStatus: 'success',
                lastRunAt: '2026-03-25T11:55:00.000Z',
              },
            ],
            runs: {
              scannedAt: '2026-03-25T12:00:00.000Z',
              runsRoot: '/tmp/runs',
              summary: {
                total: 3,
                statuses: { running: 1, completed: 1, failed: 1 },
                recoveryActions: { attention: 1 },
              },
              runs: [
                {
                  runId: 'run-1',
                  paths: {
                    root: '/tmp/runs/run-1',
                    manifestPath: '/tmp/runs/run-1/manifest.json',
                    statusPath: '/tmp/runs/run-1/status.json',
                    checkpointPath: '/tmp/runs/run-1/checkpoint.json',
                    eventsPath: '/tmp/runs/run-1/events.jsonl',
                    outputLogPath: '/tmp/runs/run-1/output.log',
                    resultPath: '/tmp/runs/run-1/result.json',
                  },
                  problems: [],
                  recoveryAction: 'attention',
                },
              ],
            },
            setActivity: vi.fn(),
            setAlerts: vi.fn(),
            setProjects: vi.fn(),
            setSessions: vi.fn(),
            setTasks: vi.fn(),
            setRuns: vi.fn(),
          }}>
            <SystemStatusContext.Provider value={{
              daemon: {
                warnings: [],
                service: {
                  platform: 'launchd',
                  identifier: 'pi-daemon',
                  manifestPath: '/tmp/daemon.plist',
                  installed: true,
                  running: true,
                },
                runtime: {
                  running: true,
                  socketPath: '/tmp/daemon.sock',
                  moduleCount: 4,
                  queueDepth: 1,
                  maxQueueDepth: 8,
                  startedAt: '2026-03-25T09:00:00.000Z',
                },
                log: { path: '/tmp/daemon.log', lines: ['daemon started', 'queue idle'] },
              },
              webUi: {
                warnings: [],
                service: {
                  platform: 'launchd',
                  identifier: 'pi-web',
                  manifestPath: '/tmp/web.plist',
                  installed: true,
                  running: true,
                  repoRoot: '/repo',
                  port: 3741,
                  url: 'http://127.0.0.1:3741',
                  companionPort: 3742,
                  companionUrl: 'http://127.0.0.1:3742',
                  tailscaleServe: true,
                  tailscaleUrl: 'https://agent.tail.ts.net',
                  resumeFallbackPrompt: 'Resume work.',
                },
                log: { path: '/tmp/web.log', lines: ['web ui started'] },
              },
              setDaemon: vi.fn(),
              setWebUi: vi.fn(),
            }}>
              {node}
            </SystemStatusContext.Provider>
          </AppDataContext.Provider>
        </AppEventsContext.Provider>
      </SseConnectionContext.Provider>
    </MemoryRouter>,
  );
}

describe('companion operational pages', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  const originalConsoleError = console.error;

  beforeEach(() => {
    vi.mocked(useApi).mockImplementation((_, key) => {
      if (key?.startsWith('companion-inbox:')) {
        return {
          data: {
            live: [],
            needsReview: [
              {
                id: 'conversation-1',
                file: '/tmp/conversation-1.jsonl',
                timestamp: '2026-03-25T11:45:00.000Z',
                cwd: '/repo',
                cwdSlug: 'repo',
                model: 'openai/gpt-5.4',
                title: 'Investigate daemon warnings',
                messageCount: 12,
                needsAttention: true,
                attentionUnreadActivityCount: 1,
              },
            ],
            active: [],
            archived: [],
            archivedTotal: 0,
            archivedOffset: 0,
            archivedLimit: 30,
            hasMoreArchived: false,
            workspaceSessionIds: [],
          },
          loading: false,
          refreshing: false,
          error: null,
          refetch: vi.fn(),
          replaceData: vi.fn(),
        };
      }

      if (key?.startsWith('companion-task:')) {
        return {
          data: {
            task: {
              id: 'morning-brief',
              running: false,
              enabled: true,
              scheduleType: 'cron',
              cron: '0 8 * * *',
              prompt: 'Summarize the day ahead.',
              lastStatus: 'failure',
              lastRunAt: '2026-03-25T11:50:00.000Z',
              fileContent: '---\nid: morning-brief\n---\nSummarize the day ahead.',
            },
            log: {
              path: '/tmp/morning-brief.log',
              log: 'run started\nweather lookup failed',
            },
          },
          loading: false,
          refreshing: false,
          error: null,
          refetch: vi.fn(),
          replaceData: vi.fn(),
        };
      }

      return {
        data: null,
        loading: false,
        refreshing: false,
        error: null,
        refetch: vi.fn(),
        replaceData: vi.fn(),
      };
    });

    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation((message?: unknown, ...args: unknown[]) => {
      if (typeof message === 'string' && message.includes('useLayoutEffect does nothing on the server')) {
        return;
      }

      originalConsoleError(message, ...args);
    });
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    vi.clearAllMocks();
  });

  it('renders the companion inbox with reminder notifications, attention conversations, and standalone activity', () => {
    const html = renderWithProviders(<CompanionInboxPage />);

    expect(html).toContain('Approve the lunch order');
    expect(html).toContain('Investigate daemon warnings');
    expect(html).toContain('Morning brief task failed');
    expect(html).toContain('Start conversation');
    expect(html).toContain('Mark all read');
  });

  it('renders the companion task list with quick actions', () => {
    const html = renderWithProviders(<CompanionTasksPage />);

    expect(html).toContain('morning-brief');
    expect(html).toContain('cleanup');
    expect(html).toContain('Run now');
    expect(html).toContain('Disable');
    expect(html).toContain('/app/tasks/morning-brief');
  });

  it('renders the companion task detail with prompt, log, and definition', () => {
    const html = renderToString(
      <MemoryRouter initialEntries={['/app/tasks/morning-brief']}>
        <AppEventsContext.Provider value={{ versions: INITIAL_APP_EVENT_VERSIONS }}>
          <AppDataContext.Provider value={{
            activity: null,
            projects: null,
            sessions: null,
            tasks: [],
            runs: null,
            setActivity: vi.fn(),
            setProjects: vi.fn(),
            setSessions: vi.fn(),
            setTasks: vi.fn(),
            setRuns: vi.fn(),
          }}>
            <Routes>
              <Route path="/app/tasks/:id" element={<CompanionTaskDetailPage />} />
            </Routes>
          </AppDataContext.Provider>
        </AppEventsContext.Provider>
      </MemoryRouter>,
    );

    expect(html).toContain('Scheduled task');
    expect(html).toContain('Summarize the day ahead.');
    expect(html).toContain('Recent log');
    expect(html).toContain('weather lookup failed');
    expect(html).toContain('Definition');
  });

  it('renders the companion system page with runtime controls and background-run summary', () => {
    const html = renderWithProviders(<CompanionSystemPage />);

    expect(html).toContain('Application controls');
    expect(html).toContain('Daemon');
    expect(html).toContain('Web UI');
    expect(html).toContain('Background runs');
    expect(html).toContain('Restart app');
    expect(html).toContain('Update app');
  });
});

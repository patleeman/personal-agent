import React from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppDataContext, SseConnectionContext, SystemStatusContext } from '../contexts.js';
import { SystemPage } from './SystemPage.js';

(globalThis as typeof globalThis & { React?: typeof React }).React = React;

describe('SystemPage', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  const originalConsoleError = console.error;

  beforeEach(() => {
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

  it('renders a compact core-services list on the system page', () => {
    const html = renderToString(
      <MemoryRouter initialEntries={['/system?component=sync']}>
        <SseConnectionContext.Provider value={{ status: 'open' }}>
          <AppDataContext.Provider value={{
            activity: null,
            projects: null,
            sessions: [{
              id: 'conv-123',
              file: '/tmp/conv-123.jsonl',
              timestamp: '2026-03-18T00:00:00.000Z',
              cwd: '/repo',
              cwdSlug: 'repo',
              model: 'openai/gpt-5.4',
              title: 'Fix runs navigation',
              messageCount: 6,
            }],
            tasks: null,
            runs: {
              scannedAt: '2026-03-18T00:02:00.000Z',
              runsRoot: '/tmp/runs',
              summary: { total: 1, recoveryActions: {}, statuses: { waiting: 1 } },
              runs: [{
                runId: 'conversation-live-conv-123',
                paths: {
                  root: '/tmp/runs/conversation-live-conv-123',
                  manifestPath: '/tmp/runs/conversation-live-conv-123/manifest.json',
                  statusPath: '/tmp/runs/conversation-live-conv-123/status.json',
                  checkpointPath: '/tmp/runs/conversation-live-conv-123/checkpoint.json',
                  eventsPath: '/tmp/runs/conversation-live-conv-123/events.jsonl',
                  outputLogPath: '/tmp/runs/conversation-live-conv-123/output.log',
                  resultPath: '/tmp/runs/conversation-live-conv-123/result.json',
                },
                manifest: {
                  version: 1,
                  id: 'conversation-live-conv-123',
                  kind: 'conversation',
                  resumePolicy: 'continue',
                  createdAt: '2026-03-18T00:00:00.000Z',
                  spec: { conversationId: 'conv-123' },
                  source: { type: 'web-live-session', id: 'conv-123', filePath: '/tmp/conv-123.jsonl' },
                },
                status: {
                  version: 1,
                  runId: 'conversation-live-conv-123',
                  status: 'waiting',
                  createdAt: '2026-03-18T00:00:00.000Z',
                  updatedAt: '2026-03-18T00:01:00.000Z',
                  activeAttempt: 1,
                },
                checkpoint: {
                  version: 1,
                  runId: 'conversation-live-conv-123',
                  updatedAt: '2026-03-18T00:01:00.000Z',
                  step: 'web-live-session.waiting',
                  payload: { conversationId: 'conv-123', title: 'Fix runs navigation' },
                },
                problems: [],
                recoveryAction: 'none',
              }],
            },
            setActivity: vi.fn(),
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
                identifier: 'io.test.daemon',
                manifestPath: '/tmp/io.test.daemon.plist',
                installed: true,
                running: true,
              },
              runtime: {
                running: true,
                socketPath: '/tmp/personal-agentd.sock',
                pid: 123,
                startedAt: '2026-03-18T17:00:00.000Z',
                moduleCount: 4,
                queueDepth: 0,
                maxQueueDepth: 1000,
              },
              log: {
                path: '/tmp/daemon.log',
                lines: [],
              },
            },
            sync: {
              warnings: [],
              config: {
                enabled: true,
                repoDir: '/tmp/sync',
                remote: 'origin',
                branch: 'main',
                intervalSeconds: 120,
                autoResolveWithAgent: true,
                conflictResolverTaskSlug: 'sync-conflict-resolver',
                resolverCooldownMinutes: 30,
                autoResolveErrorsWithAgent: true,
                errorResolverTaskSlug: 'sync-error-resolver',
                errorResolverCooldownMinutes: 30,
              },
              git: {
                hasRepo: true,
                dirtyEntries: 1,
              },
              daemon: {
                connected: true,
                moduleLoaded: true,
                moduleEnabled: true,
                moduleDetail: {
                  running: false,
                  lastRunAt: '2026-03-18T17:01:00.000Z',
                  lastSuccessAt: '2026-03-18T17:01:10.000Z',
                  lastCommitAt: '2026-03-18T17:01:12.000Z',
                  lastConflictFiles: [],
                },
              },
              log: {
                path: '/tmp/daemon.log',
                lines: [],
              },
            },
            gateway: {
              provider: 'telegram',
              currentProfile: 'assistant',
              configuredProfile: 'assistant',
              configFilePath: '/tmp/gateway.json',
              envOverrideKeys: [],
              warnings: [],
              service: {
                provider: 'telegram',
                platform: 'launchd',
                identifier: 'io.test.gateway',
                manifestPath: '/tmp/io.test.gateway.plist',
                installed: true,
                running: true,
              },
              access: {
                tokenConfigured: true,
                tokenSource: 'plain',
                allowlistChatIds: ['123'],
                allowedUserIds: [],
                blockedUserIds: [],
              },
              conversations: [],
              pendingMessages: [],
              gatewayLog: {
                path: '/tmp/gateway.log',
                lines: [],
              },
            },
            webUi: {
              warnings: [],
              service: {
                platform: 'launchd',
                identifier: 'io.test.web-ui',
                manifestPath: '/tmp/io.test.web-ui.plist',
                installed: true,
                running: true,
                repoRoot: '/repo',
                port: 3741,
                url: 'http://127.0.0.1:3741',
                companionPort: 3742,
                companionUrl: 'http://127.0.0.1:3742',
                tailscaleServe: false,
                resumeFallbackPrompt: 'Resume the conversation from the latest durable state.',
                deployment: {
                  stablePort: 3741,
                  activeSlot: 'green',
                  activeRelease: {
                    slot: 'green',
                    slotDir: '/tmp/web-ui/green',
                    distDir: '/tmp/web-ui/green/dist',
                    serverDir: '/tmp/web-ui/green/server',
                    serverEntryFile: '/tmp/web-ui/green/server/index.js',
                    sourceRepoRoot: '/repo',
                    builtAt: '2026-03-18T17:00:00.000Z',
                    revision: '123abc',
                  },
                  badReleases: [],
                },
              },
              log: {
                path: '/tmp/web-ui.log',
                lines: [],
              },
            },
            setDaemon: vi.fn(),
            setGateway: vi.fn(),
            setSync: vi.fn(),
            setWebUi: vi.fn(),
          }}>
            <Routes>
              <Route path="/system" element={<SystemPage />} />
            </Routes>
          </SystemStatusContext.Provider>
          </AppDataContext.Provider>
        </SseConnectionContext.Provider>
      </MemoryRouter>,
    );

    expect(html).toContain('Update + restart');
    expect(html).toContain('Restart everything');
    expect(html).toContain('Services');
    expect(html).toContain('Web UI');
    expect(html).toContain('Daemon');
    expect(html).toContain('Gateway');
    expect(html).toContain('Sync');
    expect(html).toContain('1 local file changed in the sync repo');
    expect(html).toContain('via SSE');
    expect(html).toContain('Runs');
    expect(html).toContain('Fix runs navigation');
  });
});

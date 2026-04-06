import React from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppDataContext, SseConnectionContext } from '../contexts.js';
import { RunsPage } from './RunsPage.js';

(globalThis as typeof globalThis & { React?: typeof React }).React = React;

describe('RunsPage', () => {
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

  it('opens linked conversations from the runs list when a run has conversation context', () => {
    const html = renderToString(
      <MemoryRouter initialEntries={['/runs/conversation-live-conv-123']}>
        <SseConnectionContext.Provider value={{ status: 'open' }}>
          <AppDataContext.Provider value={{
            activity: null,
            alerts: null,
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
            setAlerts: vi.fn(),
            setProjects: vi.fn(),
            setSessions: vi.fn(),
            setTasks: vi.fn(),
            setRuns: vi.fn(),
          }}>
            <Routes>
              <Route path="/runs">
                <Route path=":id" element={<RunsPage />} />
              </Route>
            </Routes>
          </AppDataContext.Provider>
        </SseConnectionContext.Provider>
      </MemoryRouter>,
    );

    expect(html).toContain('Runs');
    expect(html).toContain('Fix runs navigation');
    expect(html).toContain('href="/conversations/conv-123?run=conversation-live-conv-123"');
    expect(html).toContain('conversation');
  });
});

import React from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppDataContext, SseConnectionContext } from '../contexts.js';
import type { DurableRunListResult } from '../types.js';
import { RunsPage } from './RunsPage.js';

(globalThis as typeof globalThis & { React?: typeof React }).React = React;

function createRuns(): DurableRunListResult {
  return {
    scannedAt: '2026-03-19T15:00:00.000Z',
    runsRoot: '/tmp/runs',
    summary: {
      total: 2,
      recoveryActions: {},
      statuses: { completed: 2 },
    },
    runs: [
      {
        runId: 'run-local-1',
        paths: {
          root: '/tmp/runs/run-local-1',
          manifestPath: '/tmp/runs/run-local-1/manifest.json',
          statusPath: '/tmp/runs/run-local-1/status.json',
          checkpointPath: '/tmp/runs/run-local-1/checkpoint.json',
          eventsPath: '/tmp/runs/run-local-1/events.jsonl',
          outputLogPath: '/tmp/runs/run-local-1/output.log',
          resultPath: '/tmp/runs/run-local-1/result.json',
        },
        manifest: {
          version: 1,
          id: 'run-local-1',
          kind: 'background-run',
          resumePolicy: 'manual',
          createdAt: '2026-03-19T15:00:00.000Z',
          spec: { shellCommand: 'echo local' },
          source: { type: 'background-run', id: 'local-task' },
        },
        status: {
          version: 1,
          runId: 'run-local-1',
          status: 'completed',
          createdAt: '2026-03-19T15:00:00.000Z',
          updatedAt: '2026-03-19T15:01:00.000Z',
          activeAttempt: 1,
          completedAt: '2026-03-19T15:01:00.000Z',
        },
        checkpoint: {
          version: 1,
          runId: 'run-local-1',
          updatedAt: '2026-03-19T15:01:00.000Z',
          payload: {},
        },
        problems: [],
        recoveryAction: 'none',
        location: 'local',
      },
      {
        runId: 'run-remote-1',
        paths: {
          root: '/tmp/runs/run-remote-1',
          manifestPath: '/tmp/runs/run-remote-1/manifest.json',
          statusPath: '/tmp/runs/run-remote-1/status.json',
          checkpointPath: '/tmp/runs/run-remote-1/checkpoint.json',
          eventsPath: '/tmp/runs/run-remote-1/events.jsonl',
          outputLogPath: '/tmp/runs/run-remote-1/output.log',
          resultPath: '/tmp/runs/run-remote-1/result.json',
        },
        manifest: {
          version: 1,
          id: 'run-remote-1',
          kind: 'background-run',
          resumePolicy: 'manual',
          createdAt: '2026-03-19T15:00:00.000Z',
          spec: {},
          source: { type: 'conversation-remote-run', id: 'conv-123', filePath: '/tmp/conv-123.jsonl' },
        },
        status: {
          version: 1,
          runId: 'run-remote-1',
          status: 'completed',
          createdAt: '2026-03-19T15:00:00.000Z',
          updatedAt: '2026-03-19T15:02:00.000Z',
          activeAttempt: 1,
          completedAt: '2026-03-19T15:02:00.000Z',
        },
        checkpoint: {
          version: 1,
          runId: 'run-remote-1',
          updatedAt: '2026-03-19T15:02:00.000Z',
          payload: {},
        },
        problems: [],
        recoveryAction: 'none',
        location: 'remote',
        remoteExecution: {
          targetId: 'gpu-box',
          targetLabel: 'GPU Box',
          transport: 'ssh',
          conversationId: 'conv-123',
          localCwd: '/repo',
          remoteCwd: '/srv/agent/repo',
          prompt: 'Investigate remotely',
          submittedAt: '2026-03-19T15:00:00.000Z',
          importStatus: 'ready',
          transcriptAvailable: true,
          transcriptFileName: 'run-remote-1-remote-transcript.md',
        },
      },
    ],
  };
}

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
  });

  it('renders remote location and import facets without introducing a remote category', () => {
    const html = renderToString(
      <MemoryRouter initialEntries={['/runs']}>
        <SseConnectionContext.Provider value={{ status: 'open' }}>
          <AppDataContext.Provider value={{
            activity: null,
            projects: null,
            sessions: null,
            tasks: null,
            runs: createRuns(),
            setActivity: vi.fn(),
            setProjects: vi.fn(),
            setSessions: vi.fn(),
            setTasks: vi.fn(),
            setRuns: vi.fn(),
          }}>
            <Routes>
              <Route path="/runs" element={<RunsPage />} />
            </Routes>
          </AppDataContext.Provider>
        </SseConnectionContext.Provider>
      </MemoryRouter>,
    );

    expect(html).toContain('All locations');
    expect(html).toContain('Remote');
    expect(html).toContain('All imports');
    expect(html).toContain('Ready');
    expect(html).toContain('Remote work stays in the same list');
    expect(html).not.toContain('>Remote execution<');
  });
});

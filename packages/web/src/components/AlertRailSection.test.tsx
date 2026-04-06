import React from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { AppDataContext } from '../contexts.js';
import type { AlertSnapshot } from '../types.js';
import { AlertRailSection } from './AlertRailSection.js';

(globalThis as typeof globalThis & { React?: typeof React }).React = React;

function createSnapshot(entries: AlertSnapshot['entries']): AlertSnapshot {
  return {
    entries,
    activeCount: entries.filter((entry) => entry.status === 'active').length,
  };
}

describe('AlertRailSection', () => {
  it('shows only active alerts for the current conversation in the conversation rail', () => {
    const html = renderToString(
      <MemoryRouter initialEntries={['/conversations/conv-123']}>
        <AppDataContext.Provider value={{
          activity: null,
          alerts: createSnapshot([
            {
              id: 'alert-1',
              profile: 'shared',
              kind: 'deferred-resume',
              severity: 'passive',
              status: 'active',
              title: 'Review the failed validation run',
              body: 'The validation server exited early.',
              createdAt: '2026-04-06T14:00:00.000Z',
              updatedAt: '2026-04-06T14:00:00.000Z',
              conversationId: 'conv-123',
              wakeupId: 'resume-1',
              sourceKind: 'background-run',
              sourceId: 'run-1',
              requiresAck: false,
            },
            {
              id: 'alert-2',
              profile: 'shared',
              kind: 'task-failed',
              severity: 'disruptive',
              status: 'active',
              title: 'Unrelated background task failed',
              body: 'This belongs to a different conversation.',
              createdAt: '2026-04-06T14:05:00.000Z',
              updatedAt: '2026-04-06T14:05:00.000Z',
              conversationId: 'conv-999',
              sourceKind: 'background-run',
              sourceId: 'run-2',
              requiresAck: true,
            },
            {
              id: 'alert-3',
              profile: 'shared',
              kind: 'reminder',
              severity: 'disruptive',
              status: 'acknowledged',
              title: 'Already handled reminder',
              body: 'No longer active.',
              createdAt: '2026-04-06T14:10:00.000Z',
              updatedAt: '2026-04-06T14:10:00.000Z',
              conversationId: 'conv-123',
              sourceKind: 'reminder-tool',
              sourceId: 'reminder-1',
              requiresAck: false,
            },
          ]),
          projects: null,
          sessions: null,
          tasks: null,
          runs: null,
          setActivity: vi.fn(),
          setAlerts: vi.fn(),
          setProjects: vi.fn(),
          setSessions: vi.fn(),
          setTasks: vi.fn(),
          setRuns: vi.fn(),
        }}>
          <AlertRailSection />
        </AppDataContext.Provider>
      </MemoryRouter>,
    );

    expect(html).toContain('Alerts');
    expect(html).toContain('Review the failed validation run');
    expect(html).toContain('Clear all');
    expect(html).toContain('Snooze 15m');
    expect(html).not.toContain('Unrelated background task failed');
    expect(html).not.toContain('Already handled reminder');
  });

  it('shows all active alerts outside a conversation route', () => {
    const html = renderToString(
      <MemoryRouter initialEntries={['/runs/run-1']}>
        <AppDataContext.Provider value={{
          activity: null,
          alerts: createSnapshot([
            {
              id: 'alert-1',
              profile: 'shared',
              kind: 'deferred-resume',
              severity: 'passive',
              status: 'active',
              title: 'Review the failed validation run',
              body: 'The validation server exited early.',
              createdAt: '2026-04-06T14:00:00.000Z',
              updatedAt: '2026-04-06T14:00:00.000Z',
              conversationId: 'conv-123',
              sourceKind: 'background-run',
              sourceId: 'run-1',
              requiresAck: false,
            },
            {
              id: 'alert-2',
              profile: 'shared',
              kind: 'task-failed',
              severity: 'disruptive',
              status: 'active',
              title: 'Unrelated background task failed',
              body: 'This belongs to a different conversation.',
              createdAt: '2026-04-06T14:05:00.000Z',
              updatedAt: '2026-04-06T14:05:00.000Z',
              conversationId: 'conv-999',
              sourceKind: 'background-run',
              sourceId: 'run-2',
              requiresAck: true,
            },
          ]),
          projects: null,
          sessions: null,
          tasks: null,
          runs: null,
          setActivity: vi.fn(),
          setAlerts: vi.fn(),
          setProjects: vi.fn(),
          setSessions: vi.fn(),
          setTasks: vi.fn(),
          setRuns: vi.fn(),
        }}>
          <AlertRailSection />
        </AppDataContext.Provider>
      </MemoryRouter>,
    );

    expect(html).toContain('Review the failed validation run');
    expect(html).toContain('Unrelated background task failed');
    expect(html).toContain('Acknowledge');
    expect(html).toContain('Dismiss');
  });
});

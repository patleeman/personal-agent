import React from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { AlertToaster } from './AlertToaster';
import { AppDataContext } from '../contexts';
import type { AlertSnapshot } from '../types';

function createAlertsSnapshot(permission: NotificationPermission = 'default'): AlertSnapshot {
  vi.stubGlobal('Notification', class NotificationMock {
    static permission = permission;
    static requestPermission = vi.fn(async () => permission);
    onclick: (() => void) | null = null;

    constructor(_title: string, _options?: NotificationOptions) {}
  });

  return {
    activeCount: 1,
    entries: [{
      id: 'alert-1',
      profile: 'shared',
      kind: 'reminder',
      severity: 'disruptive',
      status: 'active',
      title: 'Watch the prod gates',
      body: 'Approve the kube changes when the prompt appears.',
      createdAt: '2026-03-26T14:00:00.000Z',
      updatedAt: '2026-03-26T14:00:00.000Z',
      conversationId: 'conv-123',
      wakeupId: 'resume_123',
      sourceKind: 'reminder-tool',
      sourceId: 'reminder-1',
      requiresAck: true,
    }],
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AlertToaster', () => {
  it('does not render an in-app permission prompt when notifications are still off', () => {
    const html = renderToString(
      <MemoryRouter initialEntries={['/conversations/conv-123']}>
        <AppDataContext.Provider value={{
          activity: null,
          alerts: createAlertsSnapshot('default'),
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
          <AlertToaster />
        </AppDataContext.Provider>
      </MemoryRouter>,
    );

    expect(html).toBe('');
  });

  it('still renders nothing once browser notifications are already enabled', () => {
    const html = renderToString(
      <MemoryRouter initialEntries={['/conversations/conv-123']}>
        <AppDataContext.Provider value={{
          activity: null,
          alerts: createAlertsSnapshot('granted'),
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
          <AlertToaster />
        </AppDataContext.Provider>
      </MemoryRouter>,
    );

    expect(html).toBe('');
  });
});

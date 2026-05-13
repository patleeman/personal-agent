// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AutomationsPage } from '../../../../../../extensions/system-automations/src/frontend';
import type { NativeExtensionClient } from '../nativePaClient';

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

const mountedRoots: Root[] = [];

afterEach(() => {
  vi.useRealTimers();
  for (const root of mountedRoots) {
    act(() => root.unmount());
  }
  mountedRoots.length = 0;
});

function createPa(
  overrides: Partial<NativeExtensionClient['automations']> = {},
  uiOverrides: Partial<NativeExtensionClient['ui']> = {},
): NativeExtensionClient {
  return {
    extension: { invoke: vi.fn(), getManifest: vi.fn(), listSurfaces: vi.fn() },
    runs: { start: vi.fn(), get: vi.fn(), list: vi.fn(), readLog: vi.fn(), cancel: vi.fn() },
    storage: { get: vi.fn(), put: vi.fn(), delete: vi.fn(), list: vi.fn() },
    ui: { toast: vi.fn(), notify: vi.fn(), confirm: vi.fn(async () => true), ...uiOverrides },
    automations: {
      list: vi.fn(async () => [
        {
          id: 'daily-check',
          title: 'Daily check',
          scheduleType: 'cron',
          targetType: 'background-agent',
          running: false,
          enabled: true,
          cron: '0 9 * * 1-5',
          prompt: 'Check the repo',
        },
      ]),
      readSchedulerHealth: vi.fn(async () => ({
        status: 'healthy',
        lastEvaluatedAt: '2026-05-08T00:00:00.000Z',
        staleAfterSeconds: 60,
        checkedAt: '2026-05-08T00:00:01.000Z',
      })),
      get: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      run: vi.fn(),
      readLog: vi.fn(),
      ...overrides,
    },
  } as unknown as NativeExtensionClient;
}

async function renderPage(pa = createPa()) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  mountedRoots.push(root);

  await act(async () => {
    root.render(<AutomationsPage pa={pa} />);
  });
  await act(async () => {
    await Promise.resolve();
  });

  return { container, pa };
}

describe('AutomationsPage', () => {
  it('renders scheduler health and automation rows', async () => {
    const { container } = await renderPage();

    expect(container.textContent).toContain('Automations');
    expect(container.innerHTML).toContain('aria-label="Scheduler healthy.');
    expect(container.textContent).toContain('Daily check');
    expect(container.textContent).toContain('Cron 0 9 * * 1-5');
  });

  it('starts an automation run from the row action', async () => {
    const pa = createPa();
    const { container } = await renderPage(pa);
    const runButton = container.querySelector('button[aria-label="Run Daily check now"]');
    if (!runButton) throw new Error('Run button not found');

    await act(async () => {
      runButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(pa.automations.run).toHaveBeenCalledWith('daily-check');
  });

  it('deletes an automation from the row actions menu', async () => {
    const confirm = vi.fn(async () => true);
    const pa = createPa({}, { confirm });
    const { container } = await renderPage(pa);
    const moreButton = container.querySelector('button[aria-label="More actions for Daily check"]');
    if (!moreButton) throw new Error('More actions button not found');

    await act(async () => {
      moreButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const deleteButton = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Delete');
    if (!deleteButton) throw new Error('Delete button not found');

    await act(async () => {
      deleteButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(confirm).toHaveBeenCalledWith({ title: 'Delete automation', message: 'Delete Daily check? This cannot be undone.' });
    expect(pa.automations.delete).toHaveBeenCalledWith('daily-check');
  });

  it('moves overdue one-time automations into a past-due section', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-13T12:00:00.000Z'));

    const { container } = await renderPage(
      createPa({
        list: vi.fn(async () => [
          {
            id: 'missed-check',
            title: 'Missed check',
            scheduleType: 'at',
            targetType: 'conversation',
            running: false,
            enabled: true,
            at: '2026-05-12T07:13:01.347Z',
            prompt: 'Missed the scheduled slot',
          },
          {
            id: 'later-check',
            title: 'Later check',
            scheduleType: 'at',
            targetType: 'conversation',
            running: false,
            enabled: true,
            at: '2026-05-14T13:10:00.000Z',
            prompt: 'Still upcoming',
          },
        ]),
      }),
    );

    expect(container.textContent).toContain('1 past due');
    expect(container.textContent).toContain('Past due');
    expect(container.textContent).toContain('Missed check');
    expect(container.textContent).toContain('Scheduled time passed');
    expect(container.textContent).toContain('Later check');
  });

  it('links conversation automations to their thread', async () => {
    const { container } = await renderPage(
      createPa({
        list: vi.fn(async () => [
          {
            id: 'thread-check',
            title: 'Thread check',
            scheduleType: 'cron',
            targetType: 'conversation',
            running: false,
            enabled: true,
            cron: '0 9 * * 1-5',
            prompt: 'Check the thread',
            threadConversationId: 'conv-123',
          },
        ]),
      }),
    );

    const openThreadLink = container.querySelector('a[aria-label="Open thread for Thread check"]');

    expect(openThreadLink?.getAttribute('href')).toBe('/conversations/conv-123');
  });
});

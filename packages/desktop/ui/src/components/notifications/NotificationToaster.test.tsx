// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  useNotificationStore: vi.fn(),
}));

vi.mock('./notificationStore', () => ({
  useNotificationStore: () => mocks.useNotificationStore(),
}));

import { NotificationToaster } from './NotificationToaster';

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

describe('NotificationToaster', () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    if (root) {
      act(() => root.unmount());
      root = null;
    }
    container.remove();
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('updates the toast count when a notification repeats', () => {
    const markRead = vi.fn();
    let storeState = {
      notifications: [
        {
          id: 'notif-1',
          type: 'error' as const,
          message: 'Build failed',
          source: 'system',
          timestamp: '2026-05-11T12:00:00.000Z',
          count: 1,
          read: false,
          dismissed: false,
        },
      ],
      markRead,
    };

    mocks.useNotificationStore.mockImplementation(() => storeState);

    root = createRoot(container);
    act(() => {
      root?.render(<NotificationToaster />);
    });

    expect(container.textContent).toContain('Build failed');
    expect(container.textContent).not.toContain('(2)');

    storeState = {
      ...storeState,
      notifications: [{ ...storeState.notifications[0], count: 2 }],
    };

    act(() => {
      root?.render(<NotificationToaster />);
    });

    expect(container.textContent).toContain('(2)');
    expect(markRead).not.toHaveBeenCalled();
  });
});

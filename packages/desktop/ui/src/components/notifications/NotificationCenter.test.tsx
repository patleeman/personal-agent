import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  useNotificationStore: vi.fn(),
}));

vi.mock('./notificationStore', () => ({
  useNotificationStore: () => mocks.useNotificationStore(),
}));

import { NotificationCenter } from './NotificationCenter';

(globalThis as typeof globalThis & { React?: typeof React }).React = React;

describe('NotificationCenter', () => {
  it('renders unread notifications without throwing', () => {
    mocks.useNotificationStore.mockReturnValue({
      notifications: [
        {
          id: 'notif-1',
          type: 'error',
          message: 'Build failed',
          details: 'ReferenceError: boom',
          source: 'system',
          timestamp: '2026-05-11T12:00:00.000Z',
          count: 1,
          read: false,
          dismissed: false,
        },
      ],
      unreadCount: 1,
      dismiss: vi.fn(),
      dismissAll: vi.fn(),
      markRead: vi.fn(),
      markAllRead: vi.fn(),
    });

    const html = renderToStaticMarkup(<NotificationCenter onClose={() => undefined} />);

    expect(html).toContain('Notifications');
    expect(html).toContain('Build failed');
  });
});

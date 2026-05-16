/** @vitest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/react';
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
  const storeValue = {
    notifications: [
      {
        id: 'notif-1',
        type: 'error' as const,
        message: 'Build failed',
        details: 'ReferenceError: boom',
        source: 'system',
        timestamp: '2026-05-11T12:00:00.000Z',
        count: 2,
        read: false,
        dismissed: false,
      },
    ],
    unreadCount: 1,
    dismiss: vi.fn(),
    dismissAll: vi.fn(),
    markRead: vi.fn(),
    markAllRead: vi.fn(),
  };

  it('renders unread notifications without throwing', () => {
    mocks.useNotificationStore.mockReturnValue(storeValue);

    const html = renderToStaticMarkup(<NotificationCenter onClose={() => undefined} />);

    expect(html).toContain('Notifications');
    expect(html).toContain('Build failed');
  });

  it('copies the notification summary, message, details, source, and repeat count', () => {
    const writeText = vi.fn(() => new Promise<void>(() => {}));
    Object.assign(navigator, { clipboard: { writeText } });
    mocks.useNotificationStore.mockReturnValue(storeValue);

    render(<NotificationCenter onClose={() => undefined} />);
    fireEvent.click(screen.getByLabelText('Copy notification'));

    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('Type: Error'));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('Source: system'));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('Repeated: 2x'));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('Build failed'));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('Details:\nReferenceError: boom'));
  });
});

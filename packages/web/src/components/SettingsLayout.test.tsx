import React from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsSplitLayout } from './SettingsLayout.js';

(globalThis as typeof globalThis & { React?: typeof React }).React = React;

function renderLayout(pathname: string): string {
  return renderToString(
    <MemoryRouter initialEntries={[pathname]}>
      <SettingsSplitLayout>
        <div>content</div>
      </SettingsSplitLayout>
    </MemoryRouter>,
  );
}

describe('SettingsSplitLayout', () => {
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

  it('renders links for settings pages and related control-center views', () => {
    const html = renderLayout('/runs/conversation-live-conv-123');

    expect(html).toContain('Defaults');
    expect(html).toContain('Appearance');
    expect(html).toContain('Providers');
    expect(html).toContain('Interface');
    expect(html).toContain('Workspace');
    expect(html).toContain('System');
    expect(html).toContain('Runs');
    expect(html).toContain('Scheduled tasks');
    expect(html).toContain('Capabilities');
    expect(html).toContain('Tools');
    expect(html).toContain('Instructions');
    expect(html).toContain('href="/settings?page=providers"');
    expect(html).toContain('href="/runs"');
    expect(html).toContain('href="/scheduled"');
    expect(html).toContain('href="/plans"');
  });

  it('highlights the active settings-related route in the shared rail', () => {
    const html = renderLayout('/runs/conversation-live-conv-123');
    expect(html).toContain('class="group ui-list-row ui-list-row-selected" href="/runs"');

    const settingsHtml = renderLayout('/settings?page=providers');
    expect(settingsHtml).toContain('class="group ui-list-row ui-list-row-selected" href="/settings?page=providers"');
  });
});

import React from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CompanionSkillsPage } from '../companion/CompanionSkillsPage';
import { useApi } from '../hooks';

vi.mock('../hooks', () => ({
  useApi: vi.fn(),
}));

(globalThis as typeof globalThis & { React?: typeof React }).React = React;

describe('CompanionSkillsPage', () => {
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

  function renderPage() {
    return renderToString(
      <MemoryRouter>
        <CompanionSkillsPage />
      </MemoryRouter>,
    );
  }

  it('renders the empty state when there are no skills', () => {
    vi.mocked(useApi).mockReturnValue({
      data: { skills: [] },
      loading: false,
      refreshing: false,
      error: null,
      refetch: vi.fn(),
    });

    const html = renderPage();

    expect(html).toContain('No skills yet.');
    expect(html).toContain('Add profile skills in the main workspace and they will appear here automatically.');
  });

  it('renders skills sorted by recent usage', () => {
    vi.mocked(useApi).mockReturnValue({
      data: {
        skills: [
          {
            source: 'shared',
            name: 'z-last',
            description: 'Least recently used.',
            path: '/tmp/z-last/SKILL.md',
            recentSessionCount: 0,
            lastUsedAt: '2026-03-20T12:00:00.000Z',
            usedInLastSession: false,
          },
          {
            source: 'shared',
            name: 'agent-browser',
            description: 'Automate browsers and Electron apps with agent-browser.',
            path: '/tmp/agent-browser/SKILL.md',
            recentSessionCount: 4,
            lastUsedAt: '2026-03-27T12:00:00.000Z',
            usedInLastSession: true,
          },
        ],
      },
      loading: false,
      refreshing: false,
      error: null,
      refetch: vi.fn(),
    });

    const html = renderPage();

    expect(html).toContain('Agent Browser');
    expect(html).toContain('Automate browsers and Electron apps with agent-browser.');
    expect(html).toContain('Used recently');
    expect(html).toContain('Shared skill');
    expect(html.indexOf('Agent Browser')).toBeLessThan(html.indexOf('Z Last'));
  });
});

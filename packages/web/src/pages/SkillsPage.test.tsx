import React from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SkillsPage } from './SkillsPage.js';
import { useApi } from '../hooks';
import { ThemeProvider } from '../theme';

vi.mock('../hooks', () => ({
  useApi: vi.fn(),
}));

(globalThis as typeof globalThis & { React?: typeof React }).React = React;

describe('SkillsPage', () => {
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

  function renderPage(path: string) {
    return renderToString(
      <ThemeProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/skills" element={<SkillsPage />} />
          </Routes>
        </MemoryRouter>
      </ThemeProvider>,
    );
  }

  it('renders the selected skill in the main workspace instead of the skills table', () => {
    vi.mocked(useApi).mockImplementation((_, key) => {
      if (key === 'skill-workspace:agent-browser') {
        return {
          data: {
            skill: {
              source: 'shared',
              name: 'agent-browser',
              description: 'Automate browsers and Electron apps with agent-browser.',
              path: '/tmp/agent-browser/INDEX.md',
              recentSessionCount: 4,
              lastUsedAt: '2026-03-27T12:00:00.000Z',
              usedInLastSession: true,
            },
            content: '---\nname: agent-browser\n---\n\n# agent-browser\n\nUse agent-browser effectively.',
            references: [],
            links: {
              outgoing: [],
              incoming: [],
              unresolved: [],
            },
          },
          loading: false,
          refreshing: false,
          error: null,
          refetch: vi.fn(),
        };
      }

      return {
        data: {
          skills: [
            {
              source: 'shared',
              name: 'agent-browser',
              description: 'Automate browsers and Electron apps with agent-browser.',
              path: '/tmp/agent-browser/INDEX.md',
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
      };
    });

    const html = renderPage('/skills?skill=agent-browser');

    expect(html).toContain('agent-browser');
    expect(html).toContain('Automate browsers and Electron apps with agent-browser.');
    expect(html).toContain('Autosave on');
    expect(html).toContain('Files');
    expect(html).not.toContain('Relationships');
    expect(html).not.toContain('Browse reusable workflows');
    expect(html).not.toContain('Search skills');
  });

  it('renders a skills table from the top-level skills page', () => {
    vi.mocked(useApi).mockReturnValue({
      data: {
        skills: [
          {
            source: 'shared',
            name: 'agent-browser',
            description: 'Automate browsers and Electron apps with agent-browser.',
            path: '/tmp/agent-browser/INDEX.md',
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

    const html = renderPage('/skills');

    expect(html).toContain('Browse reusable workflows');
    expect(html).toContain('Search skills');
    expect(html).toContain('Agent Browser');
    expect(html).toContain('Automate browsers and Electron apps with agent-browser.');
    expect(html).toContain('Skill');
    expect(html).toContain('Source');
    expect(html).toContain('Usage');
    expect(html).toContain('Path');
  });

  it('shows the empty state when there are no skills', () => {
    vi.mocked(useApi).mockReturnValue({
      data: {
        skills: [],
      },
      loading: false,
      refreshing: false,
      error: null,
      refetch: vi.fn(),
    });

    const html = renderPage('/skills');

    expect(html).toContain('No skills yet');
    expect(html).toContain('Add a skill to the active profile to make reusable workflows available to the agent.');
    expect(html).toContain('Search skills');
  });
});

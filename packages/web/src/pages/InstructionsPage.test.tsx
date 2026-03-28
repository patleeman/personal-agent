import React from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InstructionsPage } from './InstructionsPage.js';
import { useApi } from '../hooks';
import { ThemeProvider } from '../theme';

vi.mock('../hooks', () => ({
  useApi: vi.fn(),
}));

(globalThis as typeof globalThis & { React?: typeof React }).React = React;

describe('InstructionsPage', () => {
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

  it('renders the selected instruction in an editable detail pane', () => {
    vi.mocked(useApi).mockReturnValue({
      data: {
        profile: 'datadog',
        agentsMd: [
          {
            source: 'shared',
            path: '/repo/defaults/agent/AGENTS.md',
            exists: true,
            content: '# Shared\n',
          },
          {
            source: 'datadog',
            path: '/repo/profiles/datadog/agent/AGENTS.md',
            exists: true,
            content: '# Datadog\n',
          },
        ],
        skills: [],
        memoryDocs: [],
      },
      loading: false,
      refreshing: false,
      error: null,
      refetch: vi.fn(),
    });

    const html = renderToString(
      <ThemeProvider>
        <MemoryRouter initialEntries={['/instructions?instruction=%2Frepo%2Fprofiles%2Fdatadog%2Fagent%2FAGENTS.md']}>
          <Routes>
            <Route path="/instructions" element={<InstructionsPage />} />
          </Routes>
        </MemoryRouter>
      </ThemeProvider>,
    );

    expect(html).toContain('Shared defaults');
    expect(html).toContain('datadog profile');
    expect(html).toContain('href="/instructions?instruction=%2Frepo%2Fprofiles%2Fdatadog%2Fagent%2FAGENTS.md"');
    expect(html).toContain('class="group ui-list-row ui-list-row-selected"');
    expect(html).toContain('/repo/profiles/datadog/agent/AGENTS.md');
    expect(html).toContain('Reload');
    expect(html).toContain('Save');
    expect(html).toContain('Press ⌘/Ctrl+S to save.');
  });
});

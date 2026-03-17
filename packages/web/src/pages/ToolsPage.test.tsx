import React from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToolsPage } from './ToolsPage.js';
import { useApi } from '../hooks';

vi.mock('../hooks', () => ({
  useApi: vi.fn(),
}));

(globalThis as typeof globalThis & { React?: typeof React }).React = React;

describe('ToolsPage', () => {
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

  it('renders selectable tools and instruction sources that target the right-panel query params', () => {
    vi.mocked(useApi)
      .mockReturnValueOnce({
        data: {
          profile: 'datadog',
          cwd: '/repo',
          activeTools: ['project'],
          tools: [
            {
              name: 'project',
              description: 'Inspect and update durable projects.',
              active: true,
              parameters: {
                type: 'object',
                properties: {
                  action: { type: 'string', description: 'Action to perform.' },
                },
                required: ['action'],
              },
            },
          ],
          newSessionSystemPrompt: 'You are an expert coding assistant.',
          newSessionInjectedMessages: [],
          newSessionToolDefinitions: [
            {
              name: 'project',
              description: 'Inspect and update durable projects.',
              active: true,
              parameters: {
                type: 'object',
                properties: {
                  action: { type: 'string', description: 'Action to perform.' },
                },
                required: ['action'],
              },
            },
          ],
          dependentCliTools: [],
          mcpCli: {
            binary: { available: false, command: 'mcp-cli' },
            configPath: '',
            configExists: false,
            searchedPaths: [],
            servers: [],
          },
          packageInstall: {
            currentProfile: 'datadog',
            profileTargets: [{
              target: 'profile',
              profileName: 'datadog',
              current: true,
              settingsPath: '/tmp/datadog-settings.json',
              packages: [],
            }],
            localTarget: {
              target: 'local',
              settingsPath: '/tmp/local-settings.json',
              packages: [],
            },
          },
        },
        loading: false,
        refreshing: false,
        error: null,
        refetch: vi.fn(),
      })
      .mockReturnValueOnce({
        data: {
          profile: 'datadog',
          agentsMd: [{
            source: 'datadog',
            path: '/tmp/AGENTS.md',
            exists: true,
            content: '# AGENTS',
          }],
          skills: [{
            source: 'datadog',
            name: 'dd-skill',
            description: 'Datadog workflow skill.',
            path: '/tmp/SKILL.md',
          }],
          memoryDocs: [],
        },
        loading: false,
        refreshing: false,
        error: null,
        refetch: vi.fn(),
      });

    const html = renderToString(
      <MemoryRouter initialEntries={['/tools?inspect=tool&name=project']}>
        <Routes>
          <Route path="/tools" element={<ToolsPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(html).toContain('href="/tools?inspect=agents&amp;path=%2Ftmp%2FAGENTS.md"');
    expect(html).toContain('href="/tools?inspect=skill&amp;path=%2Ftmp%2FSKILL.md"');
    expect(html).toContain('href="/tools?inspect=tool&amp;name=project"');
    expect(html).toContain('ui-list-row-selected');
    expect(html).toContain('Brand-new conversation prompt');
    expect(html).toContain('Install package sources');
  });
});

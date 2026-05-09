import React from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { McpSettingsPanel } from './frontend';

const mocks = vi.hoisted(() => ({
  api: { invokeExtensionAction: vi.fn() },
  useApi: vi.fn(),
}));

vi.mock('@personal-agent/extensions/settings', () => ({
  api: mocks.api,
  cx: (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(' '),
  Pill: ({ children }: { children: React.ReactNode }) => children,
  useApi: mocks.useApi,
}));

function buildUseApiResult<T>(data: T) {
  return {
    data,
    loading: false,
    refreshing: false,
    error: null,
    refetch: vi.fn().mockResolvedValue(data),
    replaceData: vi.fn(),
  };
}

describe('McpSettingsPanel', () => {
  it('renders MCP wrapper and effective server state', () => {
    mocks.useApi.mockReturnValue(
      buildUseApiResult({
        configPath: '/tmp/mcp_servers.json',
        configExists: true,
        searchedPaths: ['/tmp/mcp_servers.json'],
        servers: [
          {
            name: 'atlassian',
            transport: 'remote',
            args: [],
            url: 'https://mcp.atlassian.com/v1/mcp',
            source: 'skill',
            sourcePath: '/vault/skills/dd-atlassian-mcp/mcp.json',
            skillName: 'dd-atlassian-mcp',
            skillPath: '/vault/skills/dd-atlassian-mcp',
            manifestPath: '/vault/skills/dd-atlassian-mcp/mcp.json',
            hasOAuth: true,
            callbackUrl: 'http://localhost:3118/callback',
            authorizeResource: 'https://datadoghq.atlassian.net/',
            raw: {},
          },
          {
            name: 'github',
            transport: 'stdio',
            command: 'npx',
            args: ['@mcp/github'],
            source: 'config',
            sourcePath: '/tmp/mcp_servers.json',
            hasOAuth: false,
            raw: {},
          },
        ],
        bundledSkills: [
          {
            skillName: 'dd-atlassian-mcp',
            skillPath: '/vault/skills/dd-atlassian-mcp',
            manifestPath: '/vault/skills/dd-atlassian-mcp/mcp.json',
            serverNames: ['atlassian'],
            overriddenServerNames: [],
          },
        ],
      }),
    );

    const html = renderToString(<McpSettingsPanel />);

    expect(mocks.useApi).toHaveBeenCalledWith(expect.any(Function), 'system-mcp-settings');
    expect(html).toContain('Bundled MCP wrappers');
    expect(html).toContain('Bundled with dd-atlassian-mcp');
    expect(html).toContain('Callback');
    expect(html).toContain('http://localhost:3118/callback');
    expect(html).toContain('Manifest');
    expect(html).toContain('npx @mcp/github');
  });
});

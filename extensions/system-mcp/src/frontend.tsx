import { api, cx, Pill, useApi } from '@personal-agent/extensions/settings';
import React, { type ReactNode } from 'react';

type McpServerConfig = {
  name: string;
  transport: 'stdio' | 'remote';
  command?: string;
  args: string[];
  cwd?: string;
  url?: string;
  source?: 'config' | 'skill';
  sourcePath?: string;
  skillName?: string;
  skillPath?: string;
  manifestPath?: string;
  hasOAuth?: boolean;
  callbackUrl?: string;
  authorizeResource?: string;
  raw: Record<string, unknown>;
};

type McpSettingsState = {
  configPath: string;
  configExists: boolean;
  searchedPaths: string[];
  servers: McpServerConfig[];
  bundledSkills: Array<{
    skillName: string;
    skillPath: string;
    manifestPath: string;
    serverNames: string[];
    overriddenServerNames: string[];
  }>;
};

async function inspectMcpSettings(): Promise<McpSettingsState> {
  const response = await api.invokeExtensionAction('system-mcp', 'inspectSettings', {});
  return response.result as McpSettingsState;
}

function formatMcpServerSource(server: McpServerConfig): string {
  if (server.source === 'skill' && server.skillName) {
    return `Bundled with ${server.skillName}`;
  }

  return 'Explicit config';
}

function formatMcpServerCommand(server: McpServerConfig): string {
  if (server.transport === 'remote') {
    return server.url ?? 'Remote endpoint';
  }

  const commandLine = [server.command, ...server.args].filter(
    (value): value is string => typeof value === 'string' && value.trim().length > 0,
  );
  return commandLine.length > 0 ? commandLine.join(' ') : 'Local stdio wrapper';
}

function formatMcpServerSourcePathLabel(server: McpServerConfig): string {
  return server.source === 'skill' ? 'Manifest' : 'Config';
}

function SettingsPanel({
  title,
  description,
  children,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cx(
        'scroll-mt-24 grid gap-5 border-t border-border-subtle/70 py-6 first:border-t-0 first:pt-0 lg:grid-cols-[minmax(0,15rem)_minmax(0,1fr)] lg:items-start lg:gap-8',
        className,
      )}
    >
      <div className="min-w-0 space-y-2">
        <div className="space-y-1.5">
          <h3 className="text-[15px] font-medium tracking-tight text-primary">{title}</h3>
          {description ? <p className="max-w-sm text-[12px] leading-5 text-secondary">{description}</p> : null}
        </div>
      </div>
      <div className="min-w-0 space-y-3.5">{children}</div>
    </section>
  );
}

export function McpSettingsPanel() {
  const { data: mcpState, loading: mcpLoading, error: mcpError } = useApi(inspectMcpSettings, 'system-mcp-settings');

  return (
    <div className="space-y-0">
      <SettingsPanel
        title="Bundled MCP wrappers"
        description="Skills can keep their MCP CLI wrapper config in mcp.json next to SKILL.md. Explicit config still wins when server names collide."
      >
        {mcpLoading && !mcpState ? (
          <p className="ui-card-meta">Loading MCP wrappers…</p>
        ) : mcpError && !mcpState ? (
          <p className="text-[12px] text-danger">Failed to load MCP wrappers: {mcpError}</p>
        ) : mcpState ? (
          <div className="space-y-5">
            <p className="ui-card-meta break-all">
              {mcpState.configExists ? (
                <>
                  Explicit config file: <span className="font-mono text-[11px]">{mcpState.configPath}</span>
                </>
              ) : (
                'No explicit MCP config file found. Using bundled skill manifests only.'
              )}
            </p>

            {mcpState.bundledSkills.length > 0 ? (
              <div className="space-y-3">
                <p className="ui-card-meta">
                  {mcpState.bundledSkills.length} bundled skill wrapper
                  {mcpState.bundledSkills.length === 1 ? '' : 's'} active.
                </p>
                {mcpState.bundledSkills.map((bundle) => (
                  <div key={bundle.manifestPath} className="space-y-1.5 border-t border-border-subtle/60 pt-3 first:border-t-0 first:pt-0">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="text-[13px] font-medium text-primary">{bundle.skillName}</span>
                      <span className="ui-card-meta">
                        {bundle.serverNames.length} server{bundle.serverNames.length === 1 ? '' : 's'}
                      </span>
                    </div>
                    <p className="ui-card-meta break-all">
                      <span className="font-mono text-[11px]">{bundle.manifestPath}</span>
                    </p>
                    <p className="ui-card-meta break-all">
                      <span className="font-mono text-[11px]">{bundle.serverNames.join(', ')}</span>
                    </p>
                    {bundle.overriddenServerNames.length > 0 ? (
                      <p className="text-[12px] text-secondary">
                        Overridden by explicit config:{' '}
                        <span className="font-mono text-[11px]">{bundle.overriddenServerNames.join(', ')}</span>
                      </p>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : (
              <p className="ui-card-meta">No skill-local mcp.json wrappers found in the active skill set.</p>
            )}

            {mcpState.servers.length > 0 ? (
              <div className="space-y-3">
                <p className="ui-card-meta">Effective MCP servers</p>
                {mcpState.servers.map((server) => (
                  <div key={server.name} className="space-y-2 border-t border-border-subtle/60 pt-3 first:border-t-0 first:pt-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[12px] text-primary">{server.name}</span>
                      <Pill tone={server.transport === 'remote' ? 'teal' : 'muted'}>{server.transport}</Pill>
                      {server.hasOAuth ? <Pill tone="accent">oauth</Pill> : null}
                      <span className="ui-card-meta">{formatMcpServerSource(server)}</span>
                    </div>
                    <p className="ui-card-meta break-all">
                      <span className="font-mono text-[11px]">{formatMcpServerCommand(server)}</span>
                    </p>
                    <div className="grid gap-y-1 text-[11px] leading-5 text-dim sm:grid-cols-[max-content_minmax(0,1fr)] sm:gap-x-3">
                      {server.sourcePath ? (
                        <>
                          <span className="text-secondary">{formatMcpServerSourcePathLabel(server)}</span>
                          <span className="break-all font-mono">{server.sourcePath}</span>
                        </>
                      ) : null}
                      {server.callbackUrl ? (
                        <>
                          <span className="text-secondary">Callback</span>
                          <span className="break-all font-mono">{server.callbackUrl}</span>
                        </>
                      ) : null}
                      {server.authorizeResource ? (
                        <>
                          <span className="text-secondary">Resource</span>
                          <span className="break-all font-mono">{server.authorizeResource}</span>
                        </>
                      ) : null}
                      {server.cwd ? (
                        <>
                          <span className="text-secondary">Working dir</span>
                          <span className="break-all font-mono">{server.cwd}</span>
                        </>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="ui-card-meta">No MCP servers are currently available.</p>
            )}
          </div>
        ) : null}
      </SettingsPanel>
    </div>
  );
}

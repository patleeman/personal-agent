import { useMemo, useState } from 'react';
import { api } from '../api';
import { ChatView } from '../components/chat/ChatView';
import { PageHeader, PageHeading, SectionLabel, ToolbarButton, cx } from '../components/ui';
import { AGENT_OUTPUT_PREVIEW_BLOCKS, AGENT_OUTPUT_PREVIEW_MARKDOWN, AGENT_OUTPUT_PREVIEW_MARKDOWN_PATH } from '../fixtures/agentOutputPreview';
import { useApi } from '../hooks';
import type { AgentToolInfo, McpCliServerDetail, McpCliToolDetail, ToolParameterSchema } from '../types';

const INPUT_CLASS = 'w-full rounded-lg border border-border-default bg-base px-3 py-2 text-[14px] text-primary focus:outline-none focus:border-accent/60 disabled:opacity-50';
const ACTION_BUTTON_CLASS = 'inline-flex items-center rounded-lg border border-border-subtle bg-base px-3 py-1.5 text-[12px] font-medium text-primary transition-colors hover:bg-surface disabled:opacity-50';
const LINK_BUTTON_CLASS = 'font-mono text-[12px] text-accent hover:text-accent/80';

function formatSchemaValue(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  if (value === null) {
    return 'null';
  }

  return JSON.stringify(value);
}

function getSchemaAllowedValues(schema: ToolParameterSchema | undefined): string | null {
  if (!schema) {
    return null;
  }

  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    return schema.enum.map(formatSchemaValue).join(', ');
  }

  const variants = [
    ...(Array.isArray(schema.anyOf) ? schema.anyOf : []),
    ...(Array.isArray(schema.oneOf) ? schema.oneOf : []),
  ];
  const constValues = variants
    .map((variant) => variant?.const)
    .filter((value) => value !== undefined);

  return constValues.length > 0 ? constValues.map(formatSchemaValue).join(', ') : null;
}

function getSchemaTypeLabel(schema: ToolParameterSchema | undefined): string {
  if (!schema) {
    return 'value';
  }

  if (schema.type === 'array') {
    const itemType = schema.items ? getSchemaTypeLabel(schema.items) : 'value';
    return `array<${itemType}>`;
  }

  if (typeof schema.type === 'string' && schema.type.length > 0) {
    return schema.type;
  }

  const variants = [
    ...(Array.isArray(schema.anyOf) ? schema.anyOf : []),
    ...(Array.isArray(schema.oneOf) ? schema.oneOf : []),
  ];
  if (variants.length > 0) {
    const types = [...new Set(variants.map((variant) => getSchemaTypeLabel(variant)).filter(Boolean))];
    return types.join(' | ');
  }

  if (schema.properties) {
    return 'object';
  }

  if (schema.const !== undefined) {
    return typeof schema.const;
  }

  return 'value';
}

function getToolParameters(tool: Pick<AgentToolInfo, 'parameters'>): Array<{ name: string; schema: ToolParameterSchema; required: boolean }> {
  const properties = tool.parameters.properties ?? {};
  const required = new Set(tool.parameters.required ?? []);

  return Object.entries(properties).map(([name, schema]) => ({
    name,
    schema,
    required: required.has(name),
  }));
}

interface Loadable<T> {
  loading: boolean;
  error: string | null;
  data?: T;
}

type ToolFilter = 'active' | 'all' | 'inactive';

function summarizeDescription(description: string): string {
  const trimmed = description.trim();
  if (trimmed.length <= 160) {
    return trimmed;
  }

  const sentence = trimmed.match(/^(.{0,160}[.!?])\s/);
  if (sentence?.[1]) {
    return sentence[1];
  }

  return `${trimmed.slice(0, 157)}…`;
}

function summarizeParameters(tool: AgentToolInfo): string {
  const parameters = getToolParameters(tool);
  if (parameters.length === 0) {
    return 'No parameters';
  }

  const required = parameters.filter((parameter) => parameter.required).map((parameter) => parameter.name);
  const optional = parameters.filter((parameter) => !parameter.required).map((parameter) => parameter.name);
  const orderedNames = [...required, ...optional];
  const preview = orderedNames.slice(0, 4);
  const suffix = orderedNames.length > preview.length ? ` +${orderedNames.length - preview.length} more` : '';
  return `${preview.join(', ')}${suffix}`;
}

function toolMatchesQuery(tool: AgentToolInfo, query: string): boolean {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return true;
  }

  const haystacks = [
    tool.name,
    tool.description,
    ...getToolParameters(tool).flatMap((parameter) => [parameter.name, parameter.schema.description ?? '']),
  ];

  return haystacks.some((value) => value.toLowerCase().includes(normalizedQuery));
}

export function ToolsPage() {
  const {
    data: toolsState,
    loading,
    error,
    refreshing,
    refetch,
  } = useApi(api.tools);
  const [serverDetails, setServerDetails] = useState<Record<string, Loadable<McpCliServerDetail>>>({});
  const [toolDetails, setToolDetails] = useState<Record<string, Loadable<McpCliToolDetail>>>({});
  const [toolFilter, setToolFilter] = useState<ToolFilter>('active');
  const [toolQuery, setToolQuery] = useState('');
  const [expandedTools, setExpandedTools] = useState<string[]>([]);

  const pageMeta = toolsState
    ? `${toolsState.tools.length} tools · ${toolsState.activeTools.length} active by default · profile ${toolsState.profile}`
    : 'Inspect available tools, schemas, and CLI integrations.';
  const mcpCli = toolsState?.mcpCli ?? {
    binary: {
      available: false,
      command: 'mcp-cli',
      error: toolsState ? 'MCP inspection metadata unavailable. Restart the web server to load the latest API shape.' : undefined,
    },
    configPath: '',
    configExists: false,
    searchedPaths: [] as string[],
    servers: [],
  };
  const hasMcpCliMetadata = Boolean(toolsState?.mcpCli);

  const filteredTools = useMemo(() => {
    const tools = toolsState?.tools ?? [];
    return tools.filter((tool) => {
      if (toolFilter === 'active' && !tool.active) {
        return false;
      }

      if (toolFilter === 'inactive' && tool.active) {
        return false;
      }

      return toolMatchesQuery(tool, toolQuery);
    });
  }, [toolFilter, toolQuery, toolsState?.tools]);

  function toggleExpandedTool(toolName: string) {
    setExpandedTools((current) => (
      current.includes(toolName)
        ? current.filter((name) => name !== toolName)
        : [...current, toolName]
    ));
  }

  async function loadServer(server: string) {
    setServerDetails((current) => ({
      ...current,
      [server]: { loading: true, error: null, data: current[server]?.data },
    }));

    try {
      const data = await api.mcpCliServer(server);
      setServerDetails((current) => ({
        ...current,
        [server]: { loading: false, error: null, data },
      }));
    } catch (loadError) {
      setServerDetails((current) => ({
        ...current,
        [server]: { loading: false, error: loadError instanceof Error ? loadError.message : String(loadError), data: current[server]?.data },
      }));
    }
  }

  async function loadTool(server: string, tool: string) {
    const key = `${server}/${tool}`;
    setToolDetails((current) => ({
      ...current,
      [key]: { loading: true, error: null, data: current[key]?.data },
    }));

    try {
      const data = await api.mcpCliTool(server, tool);
      setToolDetails((current) => ({
        ...current,
        [key]: { loading: false, error: null, data },
      }));
    } catch (loadError) {
      setToolDetails((current) => ({
        ...current,
        [key]: { loading: false, error: loadError instanceof Error ? loadError.message : String(loadError), data: current[key]?.data },
      }));
    }
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader actions={<ToolbarButton onClick={() => { void refetch({ resetLoading: false }); }} disabled={refreshing}>↻ Refresh</ToolbarButton>}>
        <PageHeading
          title="Tools"
          meta={pageMeta}
        />
      </PageHeader>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        <div className="max-w-5xl space-y-8 pb-6">
          <section className="space-y-5">
            <SectionLabel label="Rendering preview" />

            <div className="space-y-1">
              <h2 className="text-[15px] font-medium text-primary">Agent output preview</h2>
              <p className="ui-card-meta max-w-3xl">
                Manual QA surface for assistant markdown rendering plus every non-text chat block type. Edit the fixture file and refresh this page to inspect changes.
              </p>
            </div>

            <p className="break-all font-mono text-[12px] leading-relaxed text-primary">{AGENT_OUTPUT_PREVIEW_MARKDOWN_PATH}</p>

            <ChatView messages={AGENT_OUTPUT_PREVIEW_BLOCKS} />

            <details>
              <summary className="ui-card-meta cursor-pointer select-none">Show raw markdown fixture</summary>
              <pre className="mt-2 overflow-x-auto rounded-lg bg-surface/70 px-3 py-2 text-[11px] leading-relaxed text-secondary whitespace-pre-wrap break-words">
                {AGENT_OUTPUT_PREVIEW_MARKDOWN}
              </pre>
            </details>
          </section>

          <section className="space-y-4 border-t border-border-subtle pt-6">
            <SectionLabel label="Agent tools" />

            <div className="space-y-1">
              <h2 className="text-[15px] font-medium text-primary">Available tools</h2>
              <p className="ui-card-meta max-w-3xl">
                Inspect the tools available to new live sessions in this workspace, including descriptions and parameter schemas.
              </p>
            </div>

            {loading && !toolsState ? (
              <p className="ui-card-meta">Loading tools…</p>
            ) : error && !toolsState ? (
              <p className="text-[12px] text-danger">Failed to load tools: {error}</p>
            ) : toolsState ? (
              <div className="space-y-4">
                <div className="space-y-1">
                  <p className="ui-card-meta">
                    {toolsState.activeTools.length} active by default · {toolsState.tools.length} total available tools · profile {toolsState.profile}
                  </p>
                  <p className="break-all font-mono text-[12px] leading-relaxed text-primary">
                    {toolsState.cwd}
                  </p>
                </div>

                <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                  <div className="min-w-0 flex-1 space-y-1">
                    <label htmlFor="tools-query" className="ui-card-meta">Search tools</label>
                    <input
                      id="tools-query"
                      value={toolQuery}
                      onChange={(event) => setToolQuery(event.target.value)}
                      placeholder="Filter by tool name, description, or parameter"
                      className={INPUT_CLASS}
                    />
                  </div>

                  <div className="space-y-1">
                    <span className="ui-card-meta">Show</span>
                    <div className="ui-segmented-control" role="group" aria-label="Tool filter">
                      {([
                        ['active', 'Active defaults'],
                        ['all', 'All tools'],
                        ['inactive', 'Inactive only'],
                      ] as const).map(([value, label]) => (
                        <button
                          key={value}
                          type="button"
                          className={cx('ui-segmented-button', toolFilter === value && 'ui-segmented-button-active')}
                          aria-pressed={toolFilter === value}
                          onClick={() => setToolFilter(value)}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <p className="ui-card-meta">
                  Showing {filteredTools.length} {filteredTools.length === 1 ? 'tool' : 'tools'}
                  {toolFilter !== 'all' ? ` · filter ${toolFilter}` : ''}
                  {toolQuery.trim() ? ` · matching “${toolQuery.trim()}”` : ''}
                </p>

                <div>
                  {filteredTools.length === 0 ? (
                    <p className="ui-card-meta py-3">No tools match the current filter.</p>
                  ) : filteredTools.map((tool, index) => {
                    const parameters = getToolParameters(tool);
                    const expanded = expandedTools.includes(tool.name);

                    return (
                      <div
                        key={tool.name}
                        className={cx('space-y-3 py-4', index > 0 && 'border-t border-border-subtle')}
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0 flex-1 space-y-1">
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                              <h3 className="font-mono text-[13px] font-medium text-primary">{tool.name}</h3>
                              <span className="ui-card-meta">{tool.active ? 'active by default' : 'available but inactive by default'}</span>
                              <span className="ui-card-meta">{parameters.length} {parameters.length === 1 ? 'parameter' : 'parameters'}</span>
                            </div>
                            <p className="max-w-4xl text-[13px] leading-relaxed text-primary/90">{summarizeDescription(tool.description)}</p>
                            <p className="ui-card-meta">{summarizeParameters(tool)}</p>
                          </div>

                          <button
                            type="button"
                            className={ACTION_BUTTON_CLASS}
                            onClick={() => toggleExpandedTool(tool.name)}
                          >
                            {expanded ? 'Hide details' : 'Show details'}
                          </button>
                        </div>

                        {expanded && (
                          <div className="space-y-3">
                            <p className="max-w-4xl text-[13px] leading-relaxed text-primary/90">{tool.description}</p>

                            {parameters.length > 0 ? (
                              <div className="space-y-2">
                                {parameters.map((parameter) => {
                                  const allowedValues = getSchemaAllowedValues(parameter.schema);
                                  const typeLabel = getSchemaTypeLabel(parameter.schema);

                                  return (
                                    <div
                                      key={parameter.name}
                                      className="grid gap-x-4 gap-y-1 sm:grid-cols-[minmax(0,12rem)_minmax(0,14rem)_1fr]"
                                    >
                                      <div className="flex min-w-0 items-center gap-2">
                                        <span className="break-all font-mono text-[12px] text-primary">{parameter.name}</span>
                                        <span className="ui-card-meta">{parameter.required ? 'required' : 'optional'}</span>
                                      </div>
                                      <div className="ui-card-meta break-words">
                                        {typeLabel}
                                        {allowedValues ? ` · ${allowedValues}` : ''}
                                      </div>
                                      <div className="ui-card-meta break-words">
                                        {parameter.schema.description ?? 'No description.'}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            ) : (
                              <p className="ui-card-meta">No parameters.</p>
                            )}

                            <details>
                              <summary className="ui-card-meta cursor-pointer select-none">Show raw schema</summary>
                              <pre className="mt-2 overflow-x-auto rounded-lg bg-surface/70 px-3 py-2 text-[11px] leading-relaxed text-secondary">
                                {JSON.stringify(tool.parameters, null, 2)}
                              </pre>
                            </details>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </section>

          <section className="space-y-5 border-t border-border-subtle pt-6">
            <SectionLabel label="CLI integrations" />

            <div className="space-y-1">
              <h2 className="text-[15px] font-medium text-primary">mcp-cli</h2>
              <p className="ui-card-meta max-w-3xl">
                Browse configured MCP servers from your local mcp-cli config. This is an inspection surface only — the agent can use these via the bash tool by running mcp-cli directly. Inspecting a server or tool may trigger OAuth in the browser on first use.
              </p>
            </div>

            {!toolsState ? null : (
              <div className="space-y-4">
                <div className="space-y-1">
                  <p className="ui-card-meta">
                    {mcpCli.binary.available
                      ? `Installed${mcpCli.binary.version ? ` · ${mcpCli.binary.version}` : ''}`
                      : `Unavailable${mcpCli.binary.error ? ` · ${mcpCli.binary.error}` : ''}`}
                  </p>
                  {mcpCli.binary.path && (
                    <p className="break-all font-mono text-[12px] leading-relaxed text-primary">{mcpCli.binary.path}</p>
                  )}
                  {mcpCli.configPath && (
                    <p className="break-all font-mono text-[12px] leading-relaxed text-primary">{mcpCli.configPath}</p>
                  )}
                  {!mcpCli.configExists && mcpCli.searchedPaths.length > 1 && (
                    <p className="ui-card-meta">Searched: {mcpCli.searchedPaths.join(' · ')}</p>
                  )}
                </div>

                {!hasMcpCliMetadata ? (
                  <p className="text-[12px] text-danger">Restart the web server to load MCP inspection metadata.</p>
                ) : !mcpCli.binary.available ? (
                  <p className="text-[12px] text-danger">mcp-cli is not available in this environment.</p>
                ) : !mcpCli.configExists ? (
                  <p className="ui-card-meta">No mcp_servers.json found for this workspace.</p>
                ) : mcpCli.servers.length === 0 ? (
                  <p className="ui-card-meta">No MCP servers are configured in the current mcp_servers.json.</p>
                ) : (
                  <div>
                    {mcpCli.servers.map((server, index) => {
                      const serverState = serverDetails[server.name];
                      const commandLine = [server.command, ...server.args].filter(Boolean).join(' ');

                      return (
                        <div key={server.name} className={cx('space-y-3 py-4', index > 0 && 'border-t border-border-subtle')}>
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="min-w-0 space-y-1">
                              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                                <h3 className="font-mono text-[13px] font-medium text-primary">{server.name}</h3>
                                {server.url && <span className="ui-card-meta break-all">{server.url}</span>}
                              </div>
                              {commandLine && <p className="break-all font-mono text-[12px] leading-relaxed text-primary">{commandLine}</p>}
                              {server.cwd && <p className="break-all font-mono text-[12px] leading-relaxed text-primary">cwd {server.cwd}</p>}
                            </div>

                            <button
                              type="button"
                              className={ACTION_BUTTON_CLASS}
                              onClick={() => { void loadServer(server.name); }}
                              disabled={serverState?.loading}
                            >
                              {serverState?.loading ? 'Inspecting…' : serverState?.data ? 'Refresh tools' : 'Inspect tools'}
                            </button>
                          </div>

                          {serverState?.error && (
                            <p className="text-[12px] text-danger">{serverState.error}</p>
                          )}

                          {serverState?.data && (
                            <div className="space-y-3">
                              <p className="ui-card-meta">
                                {serverState.data.toolCount ?? serverState.data.tools.length} reported tools
                                {serverState.data.transport ? ` · ${serverState.data.transport}` : ''}
                              </p>

                              {serverState.data.tools.length > 0 ? (
                                <div className="flex flex-wrap gap-x-3 gap-y-2">
                                  {serverState.data.tools.map((tool) => {
                                    const key = `${server.name}/${tool.name}`;
                                    const toolState = toolDetails[key];
                                    const active = Boolean(toolState?.data);

                                    return (
                                      <button
                                        key={tool.name}
                                        type="button"
                                        className={cx(LINK_BUTTON_CLASS, active && 'underline underline-offset-4')}
                                        onClick={() => { void loadTool(server.name, tool.name); }}
                                        disabled={toolState?.loading}
                                      >
                                        {toolState?.loading ? `Loading ${tool.name}…` : tool.name}
                                      </button>
                                    );
                                  })}
                                </div>
                              ) : (
                                <p className="ui-card-meta">No tools returned.</p>
                              )}

                              {Object.entries(toolDetails)
                                .filter(([key, state]) => key.startsWith(`${server.name}/`) && state.data)
                                .map(([key, state]) => {
                                  const toolDetail = state.data!;
                                  const parameters = getToolParameters({ parameters: toolDetail.schema ?? {} });

                                  return (
                                    <div key={key} className="space-y-3 border-t border-border-subtle pt-3">
                                      <div className="space-y-1">
                                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                                          <h4 className="font-mono text-[13px] font-medium text-primary">{toolDetail.tool}</h4>
                                          <span className="ui-card-meta">{parameters.length} {parameters.length === 1 ? 'parameter' : 'parameters'}</span>
                                        </div>
                                        {toolDetail.description && <p className="max-w-4xl text-[13px] leading-relaxed text-primary/90">{toolDetail.description}</p>}
                                      </div>

                                      {parameters.length > 0 ? (
                                        <div className="space-y-2">
                                          {parameters.map((parameter) => {
                                            const allowedValues = getSchemaAllowedValues(parameter.schema);
                                            const typeLabel = getSchemaTypeLabel(parameter.schema);

                                            return (
                                              <div
                                                key={parameter.name}
                                                className="grid gap-x-4 gap-y-1 sm:grid-cols-[minmax(0,12rem)_minmax(0,14rem)_1fr]"
                                              >
                                                <div className="flex min-w-0 items-center gap-2">
                                                  <span className="break-all font-mono text-[12px] text-primary">{parameter.name}</span>
                                                  <span className="ui-card-meta">{parameter.required ? 'required' : 'optional'}</span>
                                                </div>
                                                <div className="ui-card-meta break-words">
                                                  {typeLabel}
                                                  {allowedValues ? ` · ${allowedValues}` : ''}
                                                </div>
                                                <div className="ui-card-meta break-words">
                                                  {parameter.schema.description ?? 'No description.'}
                                                </div>
                                              </div>
                                            );
                                          })}
                                        </div>
                                      ) : (
                                        <p className="ui-card-meta">No top-level parameters.</p>
                                      )}

                                      <details>
                                        <summary className="ui-card-meta cursor-pointer select-none">Show raw schema</summary>
                                        <pre className="mt-2 overflow-x-auto rounded-lg bg-surface/70 px-3 py-2 text-[11px] leading-relaxed text-secondary">
                                          {JSON.stringify(toolDetail.schema ?? {}, null, 2)}
                                        </pre>
                                      </details>
                                    </div>
                                  );
                                })}

                              {Object.entries(toolDetails)
                                .filter(([key, state]) => key.startsWith(`${server.name}/`) && state.error)
                                .map(([key, state]) => (
                                  <p key={key} className="text-[12px] text-danger">{state.error}</p>
                                ))}

                              <details>
                                <summary className="ui-card-meta cursor-pointer select-none">Show raw server output</summary>
                                <pre className="mt-2 overflow-x-auto rounded-lg bg-surface/70 px-3 py-2 text-[11px] leading-relaxed text-secondary">
                                  {serverState.data.rawOutput}
                                </pre>
                              </details>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

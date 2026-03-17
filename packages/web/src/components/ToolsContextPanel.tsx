import { useCallback, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useApi } from '../hooks';
import type {
  AgentToolInfo,
  CliBinaryState,
  McpCliServerConfig,
  PackageSourceTargetState,
  ToolParameterSchema,
  ToolsState,
  MemoryAgentsItem,
  MemorySkillItem,
  DependentCliToolState,
} from '../types';
import { buildToolsSearch, parseToolsSelection, type ToolsRailSelection } from '../toolsSelection';
import { ErrorState, LoadingState, ToolbarButton } from './ui';

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

function summarizeCliBinary(binary: CliBinaryState): string {
  return binary.available
    ? `Installed${binary.version ? ` · ${binary.version}` : ''}`
    : `Unavailable${binary.error ? ` · ${binary.error}` : ''}`;
}

function commandLineForServer(server: McpCliServerConfig): string {
  return [server.command, ...server.args].filter(Boolean).join(' ');
}

function EmptyPrompt({ text }: { text: string }) {
  return (
    <div className="flex h-full items-center justify-center px-6 py-8">
      <p className="text-center text-[12px] text-dim">{text}</p>
    </div>
  );
}

function DetailHeader({
  title,
  meta,
  actions,
}: {
  title: string;
  meta?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="space-y-1 border-b border-border-subtle px-4 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="ui-card-title break-words">{title}</p>
          {meta && <p className="ui-card-meta mt-0.5 break-words">{meta}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

function DetailBody({ children }: { children: React.ReactNode }) {
  return <div className="space-y-5 px-4 py-4">{children}</div>;
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="ui-detail-row">
      <span className="ui-detail-label">{label}</span>
      <span className="ui-detail-value break-words">{value}</span>
    </div>
  );
}

function MarkdownPreview({ content }: { content: string }) {
  return (
    <pre className="overflow-x-auto whitespace-pre-wrap break-words text-[12px] leading-relaxed text-secondary">
      {content}
    </pre>
  );
}

function SchemaParameters({ tool }: { tool: Pick<AgentToolInfo, 'parameters'> }) {
  const parameters = getToolParameters(tool);

  if (parameters.length === 0) {
    return <p className="ui-card-meta">No parameters.</p>;
  }

  return (
    <div className="space-y-3">
      {parameters.map((parameter) => {
        const allowedValues = getSchemaAllowedValues(parameter.schema);
        const typeLabel = getSchemaTypeLabel(parameter.schema);

        return (
          <div key={parameter.name} className="space-y-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="break-all font-mono text-[12px] text-primary">{parameter.name}</span>
              <span className="ui-card-meta">{parameter.required ? 'required' : 'optional'}</span>
            </div>
            <p className="ui-card-meta break-words">
              {typeLabel}
              {allowedValues ? ` · ${allowedValues}` : ''}
            </p>
            <p className="text-[12px] leading-relaxed text-secondary break-words">{parameter.schema.description ?? 'No description.'}</p>
          </div>
        );
      })}
    </div>
  );
}

function RawSchema({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-2 border-t border-border-subtle pt-4">
      <p className="ui-section-label">{label}</p>
      <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-lg bg-surface/70 px-3 py-2 text-[11px] leading-relaxed text-secondary">
        {value}
      </pre>
    </div>
  );
}

function AgentsDetailPanel({ item }: { item: MemoryAgentsItem }) {
  return (
    <div className="flex h-full flex-col">
      <DetailHeader title={`${item.source} AGENTS.md`} meta={item.path} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <DetailBody>
          <DetailRow label="Source" value={item.source} />
          <DetailRow label="Path" value={<span className="font-mono text-[12px] text-secondary">{item.path}</span>} />
          <div className="space-y-2 border-t border-border-subtle pt-4">
            <p className="ui-section-label">Instructions</p>
            {item.content ? <MarkdownPreview content={item.content} /> : <p className="ui-card-meta">This AGENTS.md file does not exist.</p>}
          </div>
        </DetailBody>
      </div>
    </div>
  );
}

function SkillDetailPanel({ skill }: { skill: MemorySkillItem }) {
  const fetcher = useCallback(() => api.memoryFile(skill.path), [skill.path]);
  const { data, loading, refreshing, error, refetch } = useApi(fetcher, skill.path);

  return (
    <div className="flex h-full flex-col">
      <DetailHeader
        title={skill.name}
        meta={skill.path}
        actions={(
          <ToolbarButton onClick={() => { void refetch({ resetLoading: false }); }} disabled={refreshing}>
            {refreshing ? 'Refreshing…' : '↻ Refresh'}
          </ToolbarButton>
        )}
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <DetailBody>
          <DetailRow label="Source" value={skill.source} />
          <DetailRow label="Path" value={<span className="font-mono text-[12px] text-secondary">{skill.path}</span>} />
          <div className="space-y-2 border-t border-border-subtle pt-4">
            <p className="ui-section-label">Summary</p>
            <p className="text-[12px] leading-relaxed text-secondary">{skill.description || 'No description provided.'}</p>
          </div>
          <div className="space-y-2 border-t border-border-subtle pt-4">
            <p className="ui-section-label">Definition</p>
            {loading && !data ? (
              <LoadingState label="Loading skill…" />
            ) : error && !data ? (
              <ErrorState message={`Failed to load skill: ${error}`} />
            ) : data ? (
              <MarkdownPreview content={data.content} />
            ) : (
              <p className="ui-card-meta">No skill content available.</p>
            )}
          </div>
        </DetailBody>
      </div>
    </div>
  );
}

function ToolDetailPanel({ tool }: { tool: AgentToolInfo }) {
  return (
    <div className="flex h-full flex-col">
      <DetailHeader
        title={tool.name}
        meta={tool.active ? 'Active by default' : 'Available but inactive by default'}
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <DetailBody>
          <div className="space-y-2">
            <p className="ui-section-label">Description</p>
            <p className="text-[12px] leading-relaxed text-secondary">{tool.description}</p>
          </div>

          <div className="space-y-2 border-t border-border-subtle pt-4">
            <p className="ui-section-label">Parameters</p>
            <SchemaParameters tool={tool} />
          </div>

          <RawSchema label="Raw schema" value={JSON.stringify(tool.parameters, null, 2)} />
        </DetailBody>
      </div>
    </div>
  );
}

function PackageTargetDetailPanel({
  title,
  description,
  state,
}: {
  title: string;
  description: string;
  state: PackageSourceTargetState;
}) {
  return (
    <div className="flex h-full flex-col">
      <DetailHeader title={title} meta={state.settingsPath} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <DetailBody>
          <p className="text-[12px] leading-relaxed text-secondary">{description}</p>
          <DetailRow label="Target" value={state.target} />
          <DetailRow label="Path" value={<span className="font-mono text-[12px] text-secondary">{state.settingsPath}</span>} />

          <div className="space-y-2 border-t border-border-subtle pt-4">
            <p className="ui-section-label">Package sources</p>
            {state.packages.length === 0 ? (
              <p className="ui-card-meta">No package sources configured.</p>
            ) : (
              <div className="space-y-3">
                {state.packages.map((entry) => (
                  <div key={`${state.target}:${entry.source}`} className="space-y-1">
                    <p className="break-all font-mono text-[12px] text-primary">{entry.source}</p>
                    <p className="ui-card-meta">{entry.filtered ? 'Filtered package config' : 'Package source'}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </DetailBody>
      </div>
    </div>
  );
}

function CliDetailPanel({ tool }: { tool: DependentCliToolState }) {
  return (
    <div className="flex h-full flex-col">
      <DetailHeader title={tool.name} meta={tool.binary.command} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <DetailBody>
          <p className="text-[12px] leading-relaxed text-secondary">{tool.description}</p>
          <DetailRow label="Binary" value={tool.binary.command} />
          <DetailRow label="Status" value={summarizeCliBinary(tool.binary)} />
          {tool.binary.path && <DetailRow label="Path" value={<span className="font-mono text-[12px] text-secondary">{tool.binary.path}</span>} />}
          {tool.configuredBy && <DetailRow label="Override" value={tool.configuredBy} />}
          {tool.usedBy.length > 0 && <DetailRow label="Used by" value={tool.usedBy.join(' · ')} />}
        </DetailBody>
      </div>
    </div>
  );
}

function McpServerDetailPanel({
  server,
  onSelect,
}: {
  server: McpCliServerConfig;
  onSelect: (selection: ToolsRailSelection | null) => void;
}) {
  const fetcher = useCallback(() => api.mcpCliServer(server.name), [server.name]);
  const { data, loading, refreshing, error, refetch } = useApi(fetcher, server.name);
  const commandLine = commandLineForServer(server);

  return (
    <div className="flex h-full flex-col">
      <DetailHeader
        title={server.name}
        meta={server.url ?? commandLine ?? 'Configured MCP server'}
        actions={(
          <ToolbarButton onClick={() => { void refetch({ resetLoading: false }); }} disabled={refreshing}>
            {refreshing ? 'Refreshing…' : '↻ Refresh'}
          </ToolbarButton>
        )}
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <DetailBody>
          {commandLine && <DetailRow label="Command" value={<span className="font-mono text-[12px] text-secondary">{commandLine}</span>} />}
          {server.cwd && <DetailRow label="cwd" value={<span className="font-mono text-[12px] text-secondary">{server.cwd}</span>} />}
          {server.url && <DetailRow label="URL" value={server.url} />}

          <div className="space-y-2 border-t border-border-subtle pt-4">
            <p className="ui-section-label">Reported tools</p>
            {loading && !data ? (
              <LoadingState label="Inspecting MCP server…" />
            ) : error && !data ? (
              <ErrorState message={`Failed to inspect MCP server: ${error}`} />
            ) : data ? (
              data.tools.length > 0 ? (
                <div className="space-y-2">
                  <p className="ui-card-meta">
                    {data.toolCount ?? data.tools.length} tools
                    {data.transport ? ` · ${data.transport}` : ''}
                  </p>
                  <div className="flex flex-wrap gap-x-3 gap-y-2">
                    {data.tools.map((tool) => (
                      <button
                        key={tool.name}
                        type="button"
                        className="font-mono text-[12px] text-accent transition-colors hover:text-accent/80"
                        onClick={() => onSelect({ kind: 'mcp-tool', server: server.name, tool: tool.name })}
                      >
                        {tool.name}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="ui-card-meta">No tools returned.</p>
              )
            ) : null}
          </div>

          {data && <RawSchema label="Raw server output" value={data.rawOutput} />}
        </DetailBody>
      </div>
    </div>
  );
}

function McpToolDetailPanel({
  server,
  tool,
  onSelect,
}: {
  server: string;
  tool: string;
  onSelect: (selection: ToolsRailSelection | null) => void;
}) {
  const fetcher = useCallback(() => api.mcpCliTool(server, tool), [server, tool]);
  const { data, loading, refreshing, error, refetch } = useApi(fetcher, `${server}/${tool}`);

  return (
    <div className="flex h-full flex-col">
      <DetailHeader
        title={tool}
        meta={`MCP tool · ${server}`}
        actions={(
          <>
            <ToolbarButton onClick={() => onSelect({ kind: 'mcp-server', server })}>Inspect server</ToolbarButton>
            <ToolbarButton onClick={() => { void refetch({ resetLoading: false }); }} disabled={refreshing}>
              {refreshing ? 'Refreshing…' : '↻ Refresh'}
            </ToolbarButton>
          </>
        )}
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading && !data ? (
          <LoadingState label="Loading MCP tool…" className="px-4 py-4" />
        ) : error && !data ? (
          <ErrorState message={`Failed to load MCP tool: ${error}`} className="px-4 py-4" />
        ) : data ? (
          <DetailBody>
            {data.description && (
              <div className="space-y-2">
                <p className="ui-section-label">Description</p>
                <p className="text-[12px] leading-relaxed text-secondary">{data.description}</p>
              </div>
            )}

            <div className="space-y-2 border-t border-border-subtle pt-4">
              <p className="ui-section-label">Parameters</p>
              <SchemaParameters tool={{ parameters: data.schema ?? {} }} />
            </div>

            <RawSchema label="Raw schema" value={JSON.stringify(data.schema ?? {}, null, 2)} />
            <RawSchema label="Raw tool output" value={data.rawOutput} />
          </DetailBody>
        ) : (
          <EmptyPrompt text="No MCP tool details are available." />
        )}
      </div>
    </div>
  );
}

function renderSelectionPanel(input: {
  selection: ToolsRailSelection;
  toolsState: ToolsState | null;
  toolsLoading: boolean;
  toolsError: string | null;
  memoryData: Awaited<ReturnType<typeof api.memory>> | null;
  memoryLoading: boolean;
  memoryError: string | null;
  onSelect: (selection: ToolsRailSelection | null) => void;
}): React.ReactNode {
  const {
    selection,
    toolsState,
    toolsLoading,
    toolsError,
    memoryData,
    memoryLoading,
    memoryError,
    onSelect,
  } = input;

  if (selection.kind === 'agents') {
    if (memoryLoading && !memoryData) {
      return <LoadingState label="Loading instructions…" className="px-4 py-4" />;
    }
    if (memoryError && !memoryData) {
      return <ErrorState message={`Failed to load instructions: ${memoryError}`} className="px-4 py-4" />;
    }

    const item = memoryData?.agentsMd.find((candidate) => candidate.path === selection.path) ?? null;
    return item ? <AgentsDetailPanel item={item} /> : <EmptyPrompt text="That AGENTS.md source is no longer available." />;
  }

  if (selection.kind === 'skill') {
    if (memoryLoading && !memoryData) {
      return <LoadingState label="Loading skills…" className="px-4 py-4" />;
    }
    if (memoryError && !memoryData) {
      return <ErrorState message={`Failed to load skills: ${memoryError}`} className="px-4 py-4" />;
    }

    const skill = memoryData?.skills.find((candidate) => candidate.path === selection.path) ?? null;
    return skill ? <SkillDetailPanel skill={skill} /> : <EmptyPrompt text="That skill is no longer available." />;
  }

  if (toolsLoading && !toolsState) {
    return <LoadingState label="Loading tools…" className="px-4 py-4" />;
  }
  if (toolsError && !toolsState) {
    return <ErrorState message={`Failed to load tools: ${toolsError}`} className="px-4 py-4" />;
  }

  if (!toolsState) {
    return <EmptyPrompt text="Tool data is unavailable." />;
  }

  switch (selection.kind) {
    case 'tool': {
      const tool = toolsState.tools.find((candidate) => candidate.name === selection.name) ?? null;
      return tool ? <ToolDetailPanel tool={tool} /> : <EmptyPrompt text="That tool is no longer available." />;
    }
    case 'package-target': {
      const state = selection.target === 'profile'
        ? toolsState.packageInstall.profileTargets.find((candidate) => candidate.profileName === selection.profileName)
          ?? toolsState.packageInstall.profileTargets.find((candidate) => candidate.current)
          ?? null
        : toolsState.packageInstall.localTarget;

      if (!state) {
        return <EmptyPrompt text="That package target is no longer available." />;
      }

      const title = selection.target === 'profile'
        ? `Profile · ${'profileName' in state ? state.profileName : selection.profileName ?? 'unknown'}`
        : 'Local overlay';
      const description = selection.target === 'profile'
        ? 'Package sources saved into a profile travel with the repo and become defaults for that profile on every machine.'
        : 'Machine-local package sources stay outside the repo. Use this for personal experiments or tools that should not be committed.';
      return <PackageTargetDetailPanel title={title} description={description} state={state} />;
    }
    case 'cli': {
      const tool = toolsState.dependentCliTools.find((candidate) => candidate.id === selection.id) ?? null;
      return tool ? <CliDetailPanel tool={tool} /> : <EmptyPrompt text="That CLI dependency is no longer available." />;
    }
    case 'mcp-server': {
      const server = toolsState.mcpCli.servers.find((candidate) => candidate.name === selection.server) ?? null;
      return server ? <McpServerDetailPanel server={server} onSelect={onSelect} /> : <EmptyPrompt text="That MCP server is no longer configured." />;
    }
    case 'mcp-tool':
      return <McpToolDetailPanel server={selection.server} tool={selection.tool} onSelect={onSelect} />;
    default:
      return <EmptyPrompt text="Select an item from the tools page to inspect it here." />;
  }
}

export function ToolsContextPanel() {
  const location = useLocation();
  const navigate = useNavigate();
  const selection = useMemo(() => parseToolsSelection(location.search), [location.search]);
  const {
    data: toolsState,
    loading: toolsLoading,
    error: toolsError,
  } = useApi(api.tools);
  const {
    data: memoryData,
    loading: memoryLoading,
    error: memoryError,
  } = useApi(api.memory);

  const handleSelect = useCallback((nextSelection: ToolsRailSelection | null) => {
    navigate(`/tools${buildToolsSearch(location.search, nextSelection)}`);
  }, [location.search, navigate]);

  if (!selection) {
    return <EmptyPrompt text="Select an instruction, tool, package target, CLI, or MCP server to inspect it here." />;
  }

  return renderSelectionPanel({
    selection,
    toolsState,
    toolsLoading,
    toolsError,
    memoryData,
    memoryLoading,
    memoryError,
    onSelect: handleSelect,
  });
}

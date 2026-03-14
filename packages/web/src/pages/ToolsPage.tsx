import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { PageHeader, PageHeading, SectionLabel, ToolbarButton, cx } from '../components/ui';
import { useApi } from '../hooks';
import type {
  AgentToolInfo,
  CliBinaryState,
  DependentCliToolState,
  McpCliServerDetail,
  McpCliToolDetail,
  PackageSourceTargetState,
  ProfilePackageSourceTargetState,
  ToolParameterSchema,
} from '../types';

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

function summarizeCliBinary(binary: CliBinaryState): string {
  return binary.available
    ? `Installed${binary.version ? ` · ${binary.version}` : ''}`
    : `Unavailable${binary.error ? ` · ${binary.error}` : ''}`;
}

function PackageTargetBlock({
  title,
  description,
  state,
}: {
  title: string;
  description: string;
  state: PackageSourceTargetState;
}) {
  return (
    <div className="space-y-3 min-w-0">
      <div className="space-y-1">
        <h3 className="text-[14px] font-medium text-primary">{title}</h3>
        <p className="ui-card-meta max-w-2xl">{description}</p>
        <p className="break-all font-mono text-[12px] leading-relaxed text-primary">{state.settingsPath}</p>
      </div>

      {state.packages.length === 0 ? (
        <p className="ui-card-meta">No package sources configured.</p>
      ) : (
        <div>
          {state.packages.map((entry, index) => (
            <div key={`${state.target}:${entry.source}`} className={cx('space-y-1 py-3', index > 0 && 'border-t border-border-subtle')}>
              <p className="break-all font-mono text-[12px] leading-relaxed text-primary">{entry.source}</p>
              <p className="ui-card-meta">
                {entry.filtered ? 'Filtered package config' : 'Package source'}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function ToolsPage() {
  const {
    data: toolsState,
    loading,
    error,
    refreshing,
    refetch,
  } = useApi(api.tools);
  const {
    data: memoryData,
    loading: memoryLoading,
    error: memoryError,
    refetch: refetchMemory,
  } = useApi(api.memory);
  const [serverDetails, setServerDetails] = useState<Record<string, Loadable<McpCliServerDetail>>>({});
  const [toolDetails, setToolDetails] = useState<Record<string, Loadable<McpCliToolDetail>>>({});
  const [toolFilter, setToolFilter] = useState<ToolFilter>('active');
  const [toolQuery, setToolQuery] = useState('');
  const [expandedTools, setExpandedTools] = useState<string[]>([]);
  const [packageSource, setPackageSource] = useState('');
  const [packageTarget, setPackageTarget] = useState<'profile' | 'local'>('profile');
  const [selectedProfileName, setSelectedProfileName] = useState('');
  const [installingPackage, setInstallingPackage] = useState(false);
  const [installMessage, setInstallMessage] = useState<string | null>(null);
  const [installError, setInstallError] = useState<string | null>(null);

  const pageMeta = toolsState
    ? `${toolsState.tools.length} tools · ${toolsState.activeTools.length} active by default · profile ${toolsState.profile}`
    : 'Inspect available tools, schemas, and CLI integrations.';
  const dependentCliTools = toolsState?.dependentCliTools ?? [];
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
  const packageInstall = toolsState?.packageInstall ?? {
    currentProfile: '',
    profileTargets: [] as ProfilePackageSourceTargetState[],
    localTarget: { target: 'local' as const, settingsPath: '', packages: [] },
  };
  const selectedProfileTarget = packageInstall.profileTargets.find((target) => target.profileName === selectedProfileName)
    ?? packageInstall.profileTargets.find((target) => target.current)
    ?? packageInstall.profileTargets[0]
    ?? null;
  const availableAgentsInstructions = memoryData?.agentsMd.filter((item) => item.exists) ?? [];
  const availableSkills = useMemo(() => {
    if (!memoryData) {
      return [];
    }

    return [...memoryData.skills].sort((left, right) => {
      return left.source.localeCompare(right.source)
        || left.name.localeCompare(right.name);
    });
  }, [memoryData]);

  useEffect(() => {
    if (packageInstall.profileTargets.length === 0) {
      if (selectedProfileName !== '') {
        setSelectedProfileName('');
      }
      return;
    }

    if (selectedProfileTarget && selectedProfileTarget.profileName === selectedProfileName) {
      return;
    }

    setSelectedProfileName(selectedProfileTarget?.profileName ?? '');
  }, [packageInstall.profileTargets, selectedProfileName, selectedProfileTarget]);

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

  async function handleInstallPackage() {
    const trimmedSource = packageSource.trim();
    if (!trimmedSource || installingPackage) {
      return;
    }

    if (packageTarget === 'profile' && !selectedProfileTarget) {
      setInstallError('No profile is available for package installs.');
      return;
    }

    setInstallMessage(null);
    setInstallError(null);
    setInstallingPackage(true);

    try {
      const targetLabel = packageTarget === 'profile'
        ? `profile ${selectedProfileTarget?.profileName ?? ''}`
        : 'the local overlay';
      const result = await api.installPackageSource({
        source: trimmedSource,
        target: packageTarget,
        profileName: packageTarget === 'profile' ? selectedProfileTarget?.profileName : undefined,
      });
      setInstallMessage(
        result.alreadyPresent
          ? `Package source already exists in ${targetLabel}.`
          : `Installed into ${targetLabel}. Start a new pa session to load it.`,
      );
      if (!result.alreadyPresent) {
        setPackageSource('');
      }
      await refetch({ resetLoading: false });
    } catch (installPackageError) {
      setInstallError(installPackageError instanceof Error ? installPackageError.message : String(installPackageError));
    } finally {
      setInstallingPackage(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader actions={<ToolbarButton onClick={() => { void Promise.all([refetch({ resetLoading: false }), refetchMemory({ resetLoading: false })]); }} disabled={refreshing}>↻ Refresh</ToolbarButton>}>
        <PageHeading
          title="Tools"
          meta={pageMeta}
        />
      </PageHeader>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        <div className="max-w-5xl space-y-8 pb-6">
          <section className="space-y-5">
            <SectionLabel label="Agent instructions" />

            <div className="space-y-1">
              <h2 className="text-[15px] font-medium text-primary">AGENTS.md and skills</h2>
              <p className="ui-card-meta max-w-3xl">
                Durable profile instructions and reusable skills live here. This replaces the old memory page sections for identity and capabilities.
              </p>
            </div>

            {memoryLoading && !memoryData ? (
              <p className="ui-card-meta">Loading agent instructions…</p>
            ) : memoryError && !memoryData ? (
              <p className="text-[12px] text-danger">Failed to load agent instructions: {memoryError}</p>
            ) : memoryData ? (
              <div className="space-y-6">
                <div className="space-y-2">
                  <h3 className="text-[13px] font-medium text-primary">AGENTS.md sources</h3>
                  {availableAgentsInstructions.length === 0 ? (
                    <p className="ui-card-meta">No AGENTS.md files found for the active profile stack.</p>
                  ) : (
                    <div>
                      {availableAgentsInstructions.map((item, index) => (
                        <div key={`${item.source}:${item.path}`} className={cx('space-y-1 py-3', index > 0 && 'border-t border-border-subtle')}>
                          <p className="text-[13px] text-primary">{item.source}</p>
                          <p className="break-all font-mono text-[12px] leading-relaxed text-primary">{item.path}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="space-y-2 border-t border-border-subtle pt-5">
                  <h3 className="text-[13px] font-medium text-primary">Skills</h3>
                  {availableSkills.length === 0 ? (
                    <p className="ui-card-meta">No skills are available in the active profile layers.</p>
                  ) : (
                    <div>
                      {availableSkills.map((skill, index) => (
                        <div key={`${skill.source}:${skill.name}:${skill.path}`} className={cx('space-y-1 py-3', index > 0 && 'border-t border-border-subtle')}>
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                            <p className="font-mono text-[12px] text-primary">{skill.name}</p>
                            <span className="ui-card-meta">source {skill.source}</span>
                          </div>
                          <p className="text-[13px] text-primary/90">{skill.description || 'No description provided.'}</p>
                          <p className="break-all font-mono text-[12px] leading-relaxed text-primary">{skill.path}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ) : null}
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
            <SectionLabel label="Pi packages" />

            <div className="space-y-1">
              <h2 className="text-[15px] font-medium text-primary">Install package sources</h2>
              <p className="ui-card-meta max-w-3xl">
                Add npm, git, GitHub, or local Pi package sources to durable <code>pa</code> settings without leaving the UI. New <code>pa</code> sessions will load newly installed packages.
              </p>
            </div>

            {!toolsState ? null : (
              <div className="grid gap-8 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
                <div className="space-y-4 min-w-0">
                  <div className="space-y-1">
                    <label htmlFor="package-source" className="ui-card-meta">Package source</label>
                    <input
                      id="package-source"
                      value={packageSource}
                      onChange={(event) => setPackageSource(event.target.value)}
                      placeholder="https://github.com/user/repo · npm:@scope/package · ./local-package"
                      className={INPUT_CLASS}
                      disabled={installingPackage}
                    />
                  </div>

                  <div className="space-y-3">
                    <div className="space-y-1">
                      <span className="ui-card-meta">Install into</span>
                      <div className="ui-segmented-control" role="group" aria-label="Package install target">
                        <button
                          type="button"
                          className={cx('ui-segmented-button', packageTarget === 'profile' && 'ui-segmented-button-active')}
                          aria-pressed={packageTarget === 'profile'}
                          onClick={() => setPackageTarget('profile')}
                          disabled={installingPackage}
                        >
                          Profile
                        </button>
                        <button
                          type="button"
                          className={cx('ui-segmented-button', packageTarget === 'local' && 'ui-segmented-button-active')}
                          aria-pressed={packageTarget === 'local'}
                          onClick={() => setPackageTarget('local')}
                          disabled={installingPackage}
                        >
                          Local overlay
                        </button>
                      </div>
                    </div>

                    {packageTarget === 'profile' && (
                      <div className="space-y-1">
                        <label htmlFor="package-profile" className="ui-card-meta">Profile</label>
                        <select
                          id="package-profile"
                          value={selectedProfileTarget?.profileName ?? ''}
                          onChange={(event) => setSelectedProfileName(event.target.value)}
                          disabled={installingPackage || packageInstall.profileTargets.length === 0}
                          className={INPUT_CLASS}
                        >
                          {packageInstall.profileTargets.map((target) => (
                            <option key={target.profileName} value={target.profileName}>
                              {target.profileName}{target.current ? ' (active)' : ''}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    <div className="flex justify-start">
                      <button
                        type="button"
                        className={ACTION_BUTTON_CLASS}
                        onClick={() => { void handleInstallPackage(); }}
                        disabled={installingPackage || packageSource.trim().length === 0 || (packageTarget === 'profile' && !selectedProfileTarget)}
                      >
                        {installingPackage ? 'Installing…' : 'Install package'}
                      </button>
                    </div>
                  </div>

                  <p className="ui-card-meta break-words">
                    {packageTarget === 'profile'
                      ? `Writes to ${selectedProfileTarget?.settingsPath ?? 'No profile settings file available.'}`
                      : `Writes to ${packageInstall.localTarget.settingsPath}`}
                  </p>

                  {installMessage && <p className="text-[12px] text-success">{installMessage}</p>}
                  {installError && <p className="text-[12px] text-danger">{installError}</p>}
                </div>

                <div className="grid gap-8 lg:grid-cols-2">
                  {selectedProfileTarget ? (
                    <PackageTargetBlock
                      title={`Profile · ${selectedProfileTarget.profileName}${selectedProfileTarget.current ? ' (active)' : ''}`}
                      description="Package sources saved into a profile travel with the repo and become defaults for that profile on every machine."
                      state={selectedProfileTarget}
                    />
                  ) : (
                    <div className="space-y-2 min-w-0">
                      <h3 className="text-[14px] font-medium text-primary">Profile</h3>
                      <p className="ui-card-meta">No profile settings are available.</p>
                    </div>
                  )}
                  <PackageTargetBlock
                    title="Local overlay"
                    description="Machine-local package sources stay outside the repo. Use this for personal experiments or tools that should not be committed."
                    state={packageInstall.localTarget}
                  />
                </div>
              </div>
            )}
          </section>

          <section className="space-y-5 border-t border-border-subtle pt-6">
            <SectionLabel label="CLI integrations" />

            <div className="space-y-1">
              <h2 className="text-[15px] font-medium text-primary">Dependent CLI tools</h2>
              <p className="ui-card-meta max-w-3xl">
                Some runtime features depend on host-installed CLIs. Check availability here when tools rely on local binaries such as 1Password secret resolution.
              </p>
            </div>

            {!toolsState ? null : (
              <div className="space-y-6">
                {dependentCliTools.length === 0 ? (
                  <p className="ui-card-meta">No dependent CLI tools are declared for this workspace.</p>
                ) : (
                  <div>
                    {dependentCliTools.map((tool: DependentCliToolState, index) => (
                      <div key={tool.id} className={cx('space-y-2 py-4', index > 0 && 'border-t border-border-subtle')}>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                          <h3 className="text-[14px] font-medium text-primary">{tool.name}</h3>
                          <span className="font-mono text-[12px] text-primary">{tool.binary.command}</span>
                          <span className="ui-card-meta">{summarizeCliBinary(tool.binary)}</span>
                        </div>
                        <p className="max-w-4xl text-[13px] leading-relaxed text-primary/90">{tool.description}</p>
                        {tool.binary.path && (
                          <p className="break-all font-mono text-[12px] leading-relaxed text-primary">{tool.binary.path}</p>
                        )}
                        {tool.configuredBy && (
                          <p className="ui-card-meta">Command override: {tool.configuredBy}</p>
                        )}
                        {tool.usedBy.length > 0 && (
                          <p className="ui-card-meta">Used by {tool.usedBy.join(' · ')}</p>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                <div className="space-y-1 border-t border-border-subtle pt-6">
                  <h2 className="text-[15px] font-medium text-primary">mcp-cli</h2>
                  <p className="ui-card-meta max-w-3xl">
                    Browse configured MCP servers from your local mcp-cli config. This is an inspection surface only — the agent can use these via the bash tool by running mcp-cli directly. Inspecting a server or tool may trigger OAuth in the browser on first use.
                  </p>
                </div>

                <div className="space-y-1">
                  <p className="ui-card-meta">{summarizeCliBinary(mcpCli.binary)}</p>
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

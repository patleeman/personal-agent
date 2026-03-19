import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { EmptyState, ListLinkRow, PageHeader, PageHeading, SectionLabel, ToolbarButton, cx } from '../components/ui';
import { useApi } from '../hooks';
import type {
  AgentToolInfo,
  CliBinaryState,
  DependentCliToolState,
  McpServerConfig,
  PackageSourceTargetState,
  ProfilePackageSourceTargetState,
} from '../types';
import { buildToolsSearch, getToolsSelectionKey, parseToolsSelection, type ToolsRailSelection } from '../toolsSelection';

const INPUT_CLASS = 'w-full rounded-lg border border-border-default bg-base px-3 py-2 text-[14px] text-primary focus:outline-none focus:border-accent/60 disabled:opacity-50';
const ACTION_BUTTON_CLASS = 'inline-flex items-center rounded-lg border border-border-subtle bg-base px-3 py-1.5 text-[12px] font-medium text-primary transition-colors hover:bg-surface disabled:opacity-50';
const PROMPT_TEXTAREA_CLASS = 'min-h-[24rem] w-full resize-y rounded-lg border border-border-default bg-base px-3 py-3 font-mono text-[12px] leading-relaxed text-primary outline-none transition-colors focus:border-accent/60';
const VIEW_PROFILE_QUERY_PARAM = 'viewProfile';

type ToolFilter = 'active' | 'all' | 'inactive';
type PromptInspectorView = 'prompt' | 'messages' | 'tools';

function getToolParameters(tool: Pick<AgentToolInfo, 'parameters'>): Array<{ name: string; required: boolean }> {
  const properties = tool.parameters.properties ?? {};
  const required = new Set(tool.parameters.required ?? []);

  return Object.keys(properties).map((name) => ({
    name,
    required: required.has(name),
  }));
}

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
    ...getToolParameters(tool).map((parameter) => parameter.name),
  ];

  return haystacks.some((value) => value.toLowerCase().includes(normalizedQuery));
}

function summarizeCliBinary(binary: CliBinaryState): string {
  return binary.available
    ? `Installed${binary.version ? ` · ${binary.version}` : ''}`
    : `Unavailable${binary.error ? ` · ${binary.error}` : ''}`;
}

function commandLineForServer(server: McpServerConfig): string {
  return [server.command, ...server.args].filter(Boolean).join(' ');
}

function packageSourceCountLabel(count: number): string {
  return `${count} package ${count === 1 ? 'source' : 'sources'}`;
}

function selectionKey(selection: ToolsRailSelection | null): string | null {
  return getToolsSelectionKey(selection);
}

function toolRowSelection(locationSearch: string, selection: ToolsRailSelection | null): string {
  const nextSearch = buildToolsSearch(locationSearch, selection);
  return `/tools${nextSearch}`;
}

function selectionMatches(current: ToolsRailSelection | null, candidate: ToolsRailSelection): boolean {
  return selectionKey(current) === selectionKey(candidate);
}

function dotClass(active: boolean): string {
  return active ? 'bg-accent' : 'bg-border-default';
}

function PackageTargetRow({
  title,
  description,
  target,
  locationSearch,
  currentSelection,
}: {
  title: string;
  description: string;
  target: ProfilePackageSourceTargetState | PackageSourceTargetState;
  locationSearch: string;
  currentSelection: ToolsRailSelection | null;
}) {
  const selection: ToolsRailSelection = target.target === 'profile'
    ? { kind: 'package-target', target: 'profile', profileName: 'profileName' in target ? target.profileName : undefined }
    : { kind: 'package-target', target: 'local' };

  return (
    <ListLinkRow
      to={toolRowSelection(locationSearch, selection)}
      selected={selectionMatches(currentSelection, selection)}
      leading={<span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-teal" />}
    >
      <p className="ui-row-title">{title}</p>
      <p className="ui-row-summary">{description}</p>
      <p className="ui-row-meta break-words">
        {packageSourceCountLabel(target.packages.length)}
        {target.settingsPath ? ` · ${target.settingsPath}` : ''}
      </p>
    </ListLinkRow>
  );
}

function CliRow({
  tool,
  locationSearch,
  currentSelection,
}: {
  tool: DependentCliToolState;
  locationSearch: string;
  currentSelection: ToolsRailSelection | null;
}) {
  const selection: ToolsRailSelection = { kind: 'cli', id: tool.id };

  return (
    <ListLinkRow
      to={toolRowSelection(locationSearch, selection)}
      selected={selectionMatches(currentSelection, selection)}
      leading={<span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${tool.binary.available ? 'bg-accent' : 'bg-warning'}`} />}
    >
      <p className="ui-row-title">{tool.name}</p>
      <p className="ui-row-summary">{tool.description}</p>
      <p className="ui-row-meta break-words">
        {tool.binary.command} · {summarizeCliBinary(tool.binary)}
        {tool.usedBy.length > 0 ? ` · used by ${tool.usedBy.join(' · ')}` : ''}
      </p>
    </ListLinkRow>
  );
}

function McpServerRow({
  server,
  locationSearch,
  currentSelection,
}: {
  server: McpServerConfig;
  locationSearch: string;
  currentSelection: ToolsRailSelection | null;
}) {
  const selection: ToolsRailSelection = { kind: 'mcp-server', server: server.name };
  const commandLine = commandLineForServer(server);

  return (
    <ListLinkRow
      to={toolRowSelection(locationSearch, selection)}
      selected={selectionMatches(currentSelection, selection)}
      leading={<span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-teal" />}
    >
      <p className="ui-row-title font-mono">{server.name}</p>
      <p className="ui-row-summary break-words">{server.url ?? commandLine ?? 'Configured MCP server'}</p>
      <p className="ui-row-meta break-words">
        {server.cwd ? `cwd ${server.cwd}` : 'Inspect to load reported tools'}
      </p>
    </ListLinkRow>
  );
}

export function ToolsPage() {
  const location = useLocation();
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
    refreshing: memoryRefreshing,
    error: memoryError,
    refetch: refetchMemory,
  } = useApi(api.memory);
  const [toolFilter, setToolFilter] = useState<ToolFilter>('active');
  const [toolQuery, setToolQuery] = useState('');
  const [packageSource, setPackageSource] = useState('');
  const [packageTarget, setPackageTarget] = useState<'profile' | 'local'>('profile');
  const [selectedProfileName, setSelectedProfileName] = useState('');
  const [installingPackage, setInstallingPackage] = useState(false);
  const [installMessage, setInstallMessage] = useState<string | null>(null);
  const [installError, setInstallError] = useState<string | null>(null);
  const [promptInspectorView, setPromptInspectorView] = useState<PromptInspectorView>('prompt');
  const [copiedPromptInspectorView, setCopiedPromptInspectorView] = useState<PromptInspectorView | null>(null);

  const currentSelection = useMemo(() => parseToolsSelection(location.search), [location.search]);

  const pageMeta = toolsState
    ? `${toolsState.tools.length} tools · ${toolsState.activeTools.length} active by default · profile ${toolsState.profile}`
    : 'Inspect available tools, schemas, and CLI integrations.';
  const dependentCliTools = toolsState?.dependentCliTools ?? [];
  const mcp = toolsState?.mcp ?? {
    configPath: '',
    configExists: false,
    searchedPaths: [] as string[],
    servers: [] as McpServerConfig[],
  };
  const hasMcpMetadata = Boolean(toolsState?.mcp);
  const packageInstall = toolsState?.packageInstall ?? {
    currentProfile: '',
    profileTargets: [] as ProfilePackageSourceTargetState[],
    localTarget: { target: 'local' as const, settingsPath: '', packages: [] },
  };
  const selectedProfileTarget = packageInstall.profileTargets.find((target) => target.profileName === selectedProfileName)
    ?? packageInstall.profileTargets.find((target) => target.current)
    ?? packageInstall.profileTargets[0]
    ?? null;
  const newSessionSystemPrompt = toolsState?.newSessionSystemPrompt ?? '';
  const newSessionInjectedMessages = toolsState?.newSessionInjectedMessages ?? [];
  const newSessionToolDefinitions = toolsState?.newSessionToolDefinitions ?? [];
  const newSessionInjectedMessagesJson = useMemo(
    () => JSON.stringify(newSessionInjectedMessages, null, 2),
    [newSessionInjectedMessages],
  );
  const newSessionToolDefinitionsJson = useMemo(
    () => JSON.stringify(newSessionToolDefinitions, null, 2),
    [newSessionToolDefinitions],
  );
  const promptInspectorValue = promptInspectorView === 'prompt'
    ? newSessionSystemPrompt
    : promptInspectorView === 'messages'
      ? newSessionInjectedMessagesJson
      : newSessionToolDefinitionsJson;
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

  async function handleCopyPromptInspector() {
    if (!promptInspectorValue || typeof navigator === 'undefined' || !navigator.clipboard) {
      return;
    }

    await navigator.clipboard.writeText(promptInspectorValue);
    setCopiedPromptInspectorView(promptInspectorView);
    window.setTimeout(() => {
      setCopiedPromptInspectorView((current) => current === promptInspectorView ? null : current);
    }, 1200);
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
      <PageHeader
        className="flex-wrap items-start gap-y-3"
        actions={<ToolbarButton onClick={() => { void Promise.all([refetch({ resetLoading: false }), refetchMemory({ resetLoading: false })]); }} disabled={refreshing || memoryRefreshing}>↻ Refresh</ToolbarButton>}
      >
        <PageHeading
          title="Tools"
          meta={pageMeta}
        />
      </PageHeader>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        <div className="max-w-3xl space-y-8 pb-6">
          <section className="space-y-5">
            <SectionLabel label="Agent instructions" />

            <div className="space-y-1">
              <h2 className="text-[15px] font-medium text-primary">AGENTS.md and skills</h2>
              <p className="ui-card-meta max-w-2xl">
                Durable profile instructions and reusable skills live here. Select an item to inspect its contents in the right panel.
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
                    <div className="space-y-px">
                      {availableAgentsInstructions.map((item) => {
                        const selection: ToolsRailSelection = { kind: 'agents', path: item.path };

                        return (
                          <ListLinkRow
                            key={`${item.source}:${item.path}`}
                            to={toolRowSelection(location.search, selection)}
                            selected={selectionMatches(currentSelection, selection)}
                            leading={<span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-accent" />}
                          >
                            <p className="ui-row-title">{item.source}</p>
                            <p className="ui-row-summary">Profile instructions and durable operating policy.</p>
                            <p className="ui-row-meta break-words">{item.path}</p>
                          </ListLinkRow>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="space-y-2 border-t border-border-subtle pt-5">
                  <h3 className="text-[13px] font-medium text-primary">Skills</h3>
                  {availableSkills.length === 0 ? (
                    <p className="ui-card-meta">No skills are available in the active profile layers.</p>
                  ) : (
                    <div className="space-y-px">
                      {availableSkills.map((skill) => {
                        const selection: ToolsRailSelection = { kind: 'skill', path: skill.path };

                        return (
                          <ListLinkRow
                            key={`${skill.source}:${skill.name}:${skill.path}`}
                            to={toolRowSelection(location.search, selection)}
                            selected={selectionMatches(currentSelection, selection)}
                            leading={<span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${skill.usedInLastSession ? 'bg-accent' : 'bg-teal'}`} />}
                          >
                            <p className="ui-row-title font-mono">{skill.name}</p>
                            <p className="ui-row-summary">{skill.description || 'No description provided.'}</p>
                            <p className="ui-row-meta break-words">source {skill.source} · {skill.path}</p>
                          </ListLinkRow>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            ) : null}
          </section>

          <section className="space-y-4 border-t border-border-subtle pt-6">
            <SectionLabel label="New session request" />

            <div className="space-y-1">
              <h2 className="text-[15px] font-medium text-primary">Brand-new conversation prompt</h2>
              <p className="ui-card-meta max-w-2xl">
                Inspect the fully rendered first-turn system prompt for a new live session in this workspace. The active tool schemas and any extension-injected pre-turn messages are included here too.
              </p>
            </div>

            {loading && !toolsState ? (
              <p className="ui-card-meta">Loading rendered prompt…</p>
            ) : error && !toolsState ? (
              <p className="text-[12px] text-danger">Failed to load rendered prompt: {error}</p>
            ) : toolsState ? (
              <div className="space-y-4">
                <div className="space-y-1">
                  <p className="ui-card-meta">
                    {newSessionSystemPrompt.length.toLocaleString()} prompt chars · {newSessionInjectedMessages.length} injected {newSessionInjectedMessages.length === 1 ? 'message' : 'messages'} · {newSessionToolDefinitions.length} active tool definitions
                  </p>
                  <p className="ui-card-meta max-w-2xl">
                    Computed with a neutral first turn so runtime prompt extensions are applied without needing a real user prompt.
                  </p>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="ui-segmented-control" role="group" aria-label="Prompt inspector view">
                    {([
                      ['prompt', 'System prompt'],
                      ['messages', 'Injected messages'],
                      ['tools', 'Tool definitions'],
                    ] as const).map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        className={cx('ui-segmented-button', promptInspectorView === value && 'ui-segmented-button-active')}
                        aria-pressed={promptInspectorView === value}
                        onClick={() => setPromptInspectorView(value)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  <button
                    type="button"
                    className={ACTION_BUTTON_CLASS}
                    onClick={() => { void handleCopyPromptInspector(); }}
                    disabled={promptInspectorValue.length === 0}
                  >
                    {copiedPromptInspectorView === promptInspectorView
                      ? 'Copied'
                      : promptInspectorView === 'prompt'
                        ? 'Copy prompt'
                        : promptInspectorView === 'messages'
                          ? 'Copy messages'
                          : 'Copy tool JSON'}
                  </button>
                </div>

                <textarea
                  readOnly
                  spellCheck={false}
                  value={promptInspectorValue}
                  className={PROMPT_TEXTAREA_CLASS}
                  aria-label="Brand-new session request inspector"
                />
              </div>
            ) : null}
          </section>

          <section className="space-y-4 border-t border-border-subtle pt-6">
            <SectionLabel label="Agent tools" />

            <div className="space-y-1">
              <h2 className="text-[15px] font-medium text-primary">Available tools</h2>
              <p className="ui-card-meta max-w-2xl">
                Inspect the tools available to new live sessions in this workspace. Select a tool to inspect its full schema and parameter descriptions in the right panel.
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

                <div className="space-y-3">
                  <div className="min-w-0 space-y-1">
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

                {filteredTools.length === 0 ? (
                  <EmptyState
                    title="No tools match"
                    body="Try a broader search or a different filter."
                  />
                ) : (
                  <div className="space-y-px">
                    {filteredTools.map((tool) => {
                      const selection: ToolsRailSelection = { kind: 'tool', name: tool.name };
                      const parameters = getToolParameters(tool);

                      return (
                        <ListLinkRow
                          key={tool.name}
                          to={toolRowSelection(location.search, selection)}
                          selected={selectionMatches(currentSelection, selection)}
                          leading={<span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${dotClass(tool.active)}`} />}
                        >
                          <p className="ui-row-title font-mono">{tool.name}</p>
                          <p className="ui-row-summary">{summarizeDescription(tool.description)}</p>
                          <p className="ui-row-meta break-words">
                            {tool.active ? 'active by default' : 'available but inactive by default'}
                            {' · '}
                            {parameters.length} {parameters.length === 1 ? 'parameter' : 'parameters'}
                            {' · '}
                            {summarizeParameters(tool)}
                          </p>
                        </ListLinkRow>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : null}
          </section>

          <section className="space-y-5 border-t border-border-subtle pt-6">
            <SectionLabel label="Pi packages" />

            <div className="space-y-1">
              <h2 className="text-[15px] font-medium text-primary">Install package sources</h2>
              <p className="ui-card-meta max-w-2xl">
                Add npm, git, GitHub, or local Pi package sources to durable <code>pa</code> settings without leaving the UI. New <code>pa</code> sessions will load newly installed packages.
              </p>
            </div>

            {!toolsState ? null : (
              <div className="space-y-6">
                <div className="space-y-4">
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

                <div className="space-y-2 border-t border-border-subtle pt-5">
                  <h3 className="text-[13px] font-medium text-primary">Current package targets</h3>
                  <p className="ui-card-meta max-w-2xl">Select a target to inspect its settings file and configured sources in the right panel.</p>
                  <div className="space-y-px">
                    {selectedProfileTarget ? (
                      <PackageTargetRow
                        title={`Profile · ${selectedProfileTarget.profileName}${selectedProfileTarget.current ? ' (active)' : ''}`}
                        description="Package sources saved into a profile travel with the repo and become defaults for that profile on every machine."
                        target={selectedProfileTarget}
                        locationSearch={location.search}
                        currentSelection={currentSelection}
                      />
                    ) : (
                      <p className="ui-card-meta">No profile settings are available.</p>
                    )}
                    <PackageTargetRow
                      title="Local overlay"
                      description="Machine-local package sources stay outside the repo. Use this for personal experiments or tools that should not be committed."
                      target={packageInstall.localTarget}
                      locationSearch={location.search}
                      currentSelection={currentSelection}
                    />
                  </div>
                </div>
              </div>
            )}
          </section>

          <section className="space-y-5 border-t border-border-subtle pt-6">
            <SectionLabel label="CLI integrations" />

            <div className="space-y-1">
              <h2 className="text-[15px] font-medium text-primary">Dependent CLI tools</h2>
              <p className="ui-card-meta max-w-2xl">
                Some runtime features depend on host-installed CLIs. Select a dependency or MCP server to inspect it in the right panel.
              </p>
            </div>

            {!toolsState ? null : (
              <div className="space-y-6">
                {dependentCliTools.length === 0 ? (
                  <p className="ui-card-meta">No dependent CLI tools are declared for this workspace.</p>
                ) : (
                  <div className="space-y-px">
                    {dependentCliTools.map((tool) => (
                      <CliRow
                        key={tool.id}
                        tool={tool}
                        locationSearch={location.search}
                        currentSelection={currentSelection}
                      />
                    ))}
                  </div>
                )}

                <div className="space-y-1 border-t border-border-subtle pt-6">
                  <h2 className="text-[15px] font-medium text-primary">MCP</h2>
                  <p className="ui-card-meta max-w-2xl">
                    Browse configured MCP servers from your local MCP config. This inspection surface uses pa’s native MCP client. Inspecting a server or tool may still trigger OAuth in the browser on first use.
                  </p>
                </div>

                <div className="space-y-1">
                  {mcp.configPath && (
                    <p className="break-all font-mono text-[12px] leading-relaxed text-primary">{mcp.configPath}</p>
                  )}
                  {!mcp.configExists && mcp.searchedPaths.length > 1 && (
                    <p className="ui-card-meta">Searched: {mcp.searchedPaths.join(' · ')}</p>
                  )}
                </div>

                {!hasMcpMetadata ? (
                  <p className="text-[12px] text-danger">Restart the web server to load MCP inspection metadata.</p>
                ) : !mcp.configExists ? (
                  <p className="ui-card-meta">No mcp_servers.json found for this workspace.</p>
                ) : mcp.servers.length === 0 ? (
                  <p className="ui-card-meta">No MCP servers are configured in the current mcp_servers.json.</p>
                ) : (
                  <div className="space-y-px">
                    {mcp.servers.map((server) => (
                      <McpServerRow
                        key={server.name}
                        server={server}
                        locationSearch={location.search}
                        currentSelection={currentSelection}
                      />
                    ))}
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

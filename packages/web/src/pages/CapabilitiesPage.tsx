import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api';
import {
  buildCapabilitiesSearch,
  getCapabilitiesPresetId,
  getCapabilitiesSection,
  getCapabilitiesTaskId,
  getCapabilitiesToolName,
  type CapabilitySection,
} from '../capabilitiesSelection';
import { useApi } from '../hooks';
import type {
  AgentToolInfo,
  ConversationAutomationWorkflowPreset,
  ScheduledTaskSummary,
} from '../types';
import { formatTaskSchedule } from '../taskSchedule';
import { timeAgo } from '../utils';
import {
  EmptyState,
  ListLinkRow,
  LoadingState,
  PageHeader,
  PageHeading,
  ToolbarButton,
} from '../components/ui';

type ToolFilter = 'active' | 'all' | 'inactive';
const INPUT_CLASS = 'w-full rounded-lg border border-border-default bg-base px-3 py-2 text-[14px] text-primary placeholder:text-dim focus:outline-none focus:border-accent/60';
const SECTION_OPTIONS: Array<{ value: CapabilitySection; label: string }> = [
  { value: 'overview', label: 'Overview' },
  { value: 'presets', label: 'Todo Presets' },
  { value: 'scheduled', label: 'Scheduled Tasks' },
  { value: 'tools', label: 'Tools' },
];
const TOOL_FILTER_OPTIONS: Array<{ value: ToolFilter; label: string }> = [
  { value: 'active', label: 'Active' },
  { value: 'all', label: 'All' },
  { value: 'inactive', label: 'Inactive' },
];

function normalizeQuery(query: string): string {
  return query.trim().toLowerCase();
}

function SectionTabs({
  locationSearch,
  section,
  onNavigate,
}: {
  locationSearch: string;
  section: CapabilitySection;
  onNavigate: (search: string) => void;
}) {
  return (
    <div className="ui-segmented-control" role="group" aria-label="Capabilities section">
      {SECTION_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onNavigate(buildCapabilitiesSearch(locationSearch, {
            section: option.value,
            presetId: null,
            taskId: null,
            toolName: null,
          }))}
          className={section === option.value ? 'ui-segmented-button ui-segmented-button-active' : 'ui-segmented-button'}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function matchesPreset(preset: ConversationAutomationWorkflowPreset, query: string): boolean {
  const normalized = normalizeQuery(query);
  if (!normalized) {
    return true;
  }

  const haystack = [
    preset.id,
    preset.name,
    ...preset.items.map((item) => item.kind === 'instruction'
      ? `${item.label} ${item.text}`
      : `${item.label} ${item.skillName} ${item.skillArgs ?? ''}`),
  ].join('\n').toLowerCase();

  return haystack.includes(normalized);
}

function matchesTask(task: ScheduledTaskSummary, query: string): boolean {
  const normalized = normalizeQuery(query);
  if (!normalized) {
    return true;
  }

  const haystack = [
    task.id,
    task.prompt,
    task.model,
    task.filePath,
    task.cron,
    task.at,
    task.lastStatus,
  ].join('\n').toLowerCase();

  return haystack.includes(normalized);
}

function getToolParameters(tool: Pick<AgentToolInfo, 'parameters'>): Array<{ name: string; required: boolean; description?: string; type?: string }> {
  const properties = tool.parameters.properties ?? {};
  const required = new Set(tool.parameters.required ?? []);

  return Object.entries(properties).map(([name, schema]) => ({
    name,
    required: required.has(name),
    description: schema.description,
    type: typeof schema.type === 'string' ? schema.type : undefined,
  }));
}

function matchesTool(tool: AgentToolInfo, query: string): boolean {
  const normalized = normalizeQuery(query);
  if (!normalized) {
    return true;
  }

  const haystack = [
    tool.name,
    tool.description,
    ...getToolParameters(tool).map((parameter) => `${parameter.name} ${parameter.description ?? ''}`),
  ].join('\n').toLowerCase();

  return haystack.includes(normalized);
}

function taskStatusDotClass(task: ScheduledTaskSummary): string {
  if (task.running) return 'bg-accent animate-pulse';
  if (task.lastStatus === 'failure') return 'bg-danger';
  if (task.lastStatus === 'success') return 'bg-success';
  if (!task.enabled) return 'bg-border-default';
  return 'bg-teal';
}

function taskStatusLabel(task: ScheduledTaskSummary): string {
  if (task.running) return 'running';
  if (task.lastStatus === 'failure') return 'failed';
  if (task.lastStatus === 'success') return 'ok';
  if (!task.enabled) return 'disabled';
  return 'pending';
}

function toolDotClass(tool: AgentToolInfo): string {
  return tool.active ? 'bg-accent' : 'bg-border-default';
}

function sortTasks(items: ScheduledTaskSummary[]): ScheduledTaskSummary[] {
  return [...items].sort((left, right) => {
    const leftWeight = Number(left.running) * 10 + Number(left.lastStatus === 'failure') * 5 + Number(left.enabled);
    const rightWeight = Number(right.running) * 10 + Number(right.lastStatus === 'failure') * 5 + Number(right.enabled);
    return rightWeight - leftWeight
      || (right.lastRunAt ?? '').localeCompare(left.lastRunAt ?? '')
      || left.id.localeCompare(right.id);
  });
}

function sortTools(items: AgentToolInfo[]): AgentToolInfo[] {
  return [...items].sort((left, right) => Number(right.active) - Number(left.active) || left.name.localeCompare(right.name));
}

function sortPresets(items: ConversationAutomationWorkflowPreset[]): ConversationAutomationWorkflowPreset[] {
  return [...items].sort((left, right) => (right.updatedAt ?? '').localeCompare(left.updatedAt ?? '') || left.name.localeCompare(right.name));
}

function OverviewSection({
  label,
  title,
  body,
  children,
}: {
  label: string;
  title: string;
  body?: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-2 border-t border-border-subtle pt-5 first:border-t-0 first:pt-0">
      <div className="space-y-1">
        <p className="ui-section-label">{label}</p>
        <p className="text-[14px] font-medium text-primary">{title}</p>
        {body && <p className="ui-card-body max-w-3xl">{body}</p>}
      </div>
      {children}
    </section>
  );
}

export function CapabilitiesPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [query, setQuery] = useState('');
  const [toolFilter, setToolFilter] = useState<ToolFilter>('active');
  const {
    data: presetsData,
    loading: presetsLoading,
    refreshing: presetsRefreshing,
    error: presetsError,
    refetch: refetchPresets,
  } = useApi(api.conversationPlansWorkspace, 'capabilities-presets');
  const {
    data: tasksData,
    loading: tasksLoading,
    refreshing: tasksRefreshing,
    error: tasksError,
    refetch: refetchTasks,
  } = useApi(api.tasks, 'capabilities-tasks');
  const {
    data: toolsData,
    loading: toolsLoading,
    refreshing: toolsRefreshing,
    error: toolsError,
    refetch: refetchTools,
  } = useApi(api.tools, 'capabilities-tools');

  const section = useMemo<CapabilitySection>(() => getCapabilitiesSection(location.search), [location.search]);
  const selectedPresetId = useMemo(() => getCapabilitiesPresetId(location.search), [location.search]);
  const selectedTaskId = useMemo(() => getCapabilitiesTaskId(location.search), [location.search]);
  const selectedToolName = useMemo(() => getCapabilitiesToolName(location.search), [location.search]);

  const presets = useMemo(() => sortPresets(presetsData?.presetLibrary.presets ?? []), [presetsData?.presetLibrary.presets]);
  const tasks = useMemo(() => sortTasks(tasksData ?? []), [tasksData]);
  const tools = useMemo(() => sortTools(toolsData?.tools ?? []), [toolsData?.tools]);

  const filteredPresets = useMemo(() => presets.filter((preset) => matchesPreset(preset, query)), [presets, query]);
  const filteredTasks = useMemo(() => tasks.filter((task) => matchesTask(task, query)), [query, tasks]);
  const filteredTools = useMemo(() => {
    const matching = tools.filter((tool) => matchesTool(tool, query));
    if (toolFilter === 'all') {
      return matching;
    }
    if (toolFilter === 'inactive') {
      return matching.filter((tool) => !tool.active);
    }
    return matching.filter((tool) => tool.active);
  }, [query, toolFilter, tools]);

  const defaultPresetNames = useMemo(
    () => (presetsData?.presetLibrary.defaultPresetIds ?? []).map((presetId) => presets.find((preset) => preset.id === presetId)?.name ?? presetId),
    [presets, presetsData?.presetLibrary.defaultPresetIds],
  );
  const failingTasks = useMemo(() => tasks.filter((task) => task.lastStatus === 'failure'), [tasks]);
  const enabledTasks = useMemo(() => tasks.filter((task) => task.enabled), [tasks]);
  const runningTasks = useMemo(() => tasks.filter((task) => task.running), [tasks]);
  const unavailableCli = useMemo(() => (toolsData?.dependentCliTools ?? []).filter((tool) => !tool.binary.available), [toolsData?.dependentCliTools]);
  const mcpServers = toolsData?.mcp.servers ?? [];
  const activeTools = useMemo(() => tools.filter((tool) => tool.active), [tools]);

  const totalItems = presets.length + tasks.length + tools.length;
  const loading = !presetsData && !tasksData && !toolsData && (presetsLoading || tasksLoading || toolsLoading);
  const errorMessage = [presetsError, tasksError, toolsError].filter(Boolean).join(' · ');

  const refreshAll = useCallback(async () => {
    await Promise.all([
      refetchPresets({ resetLoading: false }),
      refetchTasks({ resetLoading: false }),
      refetchTools({ resetLoading: false }),
    ]);
  }, [refetchPresets, refetchTasks, refetchTools]);

  function navigateSearch(search: string) {
    navigate(`/capabilities${search}`);
  }

  const searchPlaceholder = section === 'presets'
    ? 'Search presets, labels, skills, or instructions'
    : section === 'scheduled'
      ? 'Search task IDs, prompts, schedules, or models'
      : section === 'tools'
        ? 'Search tools, descriptions, or parameters'
        : 'Search this capabilities section';

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        className="flex-wrap items-start gap-y-3"
        actions={(
          <ToolbarButton onClick={() => { void refreshAll(); }} disabled={presetsRefreshing || tasksRefreshing || toolsRefreshing}>
            {(presetsRefreshing || tasksRefreshing || toolsRefreshing) ? 'Refreshing…' : '↻ Refresh'}
          </ToolbarButton>
        )}
      >
        <PageHeading
          title="Capabilities"
          meta={`${presets.length} presets · ${enabledTasks.length} enabled tasks · ${activeTools.length} active tools${runningTasks.length > 0 ? ` · ${runningTasks.length} running` : ''}${failingTasks.length > 0 ? ` · ${failingTasks.length} failing` : ''}`}
        />
      </PageHeader>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        {loading && <LoadingState label="Loading capabilities…" />}
        {!loading && errorMessage && totalItems === 0 && <EmptyState title="Unable to load capabilities" body={errorMessage} />}
        {!loading && !errorMessage && totalItems === 0 && (
          <EmptyState
            title="No capabilities yet"
            body="Create presets, scheduled tasks, or install tools to build up the agent's execution surface."
          />
        )}

        {!loading && totalItems > 0 && (
          <div className="space-y-5 pb-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <SectionTabs locationSearch={location.search} section={section} onNavigate={navigateSearch} />
              {section !== 'overview' && (
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={searchPlaceholder}
                  className={`${INPUT_CLASS} max-w-xl`}
                  autoComplete="off"
                  spellCheck={false}
                />
              )}
            </div>

            {errorMessage && <p className="text-[12px] text-danger/80">{errorMessage}</p>}

            {section === 'overview' ? (
              <div className="space-y-8">
                <OverviewSection
                  label="Automation health"
                  title={failingTasks.length > 0 ? `${failingTasks.length} scheduled task${failingTasks.length === 1 ? '' : 's'} need attention` : 'Automation looks healthy'}
                  body="Capabilities combine reusable presets, unattended scheduled tasks, and the runtime tools available to new sessions."
                >
                  <div className="space-y-1">
                    <p className="text-[12px] leading-relaxed text-secondary">{enabledTasks.length} enabled scheduled task{enabledTasks.length === 1 ? '' : 's'} · {runningTasks.length} running · {defaultPresetNames.length} default preset{defaultPresetNames.length === 1 ? '' : 's'}.</p>
                    {failingTasks.slice(0, 4).map((task) => (
                      <p key={task.id} className="text-[12px] leading-relaxed text-secondary">• {task.id} · failed {task.lastRunAt ? timeAgo(task.lastRunAt) : 'recently'}</p>
                    ))}
                  </div>
                </OverviewSection>

                <div className="grid gap-8 xl:grid-cols-2">
                  <OverviewSection
                    label="Todo presets"
                    title={presets.length > 0 ? 'Reusable automation templates' : 'No presets'}
                    body="Presets seed conversation todo lists so repeated workflows start from the same ordered steps."
                  >
                    {presets.length > 0 ? (
                      <div className="space-y-px">
                        {presets.slice(0, 5).map((preset) => (
                          <ListLinkRow
                            key={preset.id}
                            to={`/capabilities${buildCapabilitiesSearch(location.search, { section: 'presets', presetId: preset.id })}`}
                            leading={<span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${(presetsData?.presetLibrary.defaultPresetIds ?? []).includes(preset.id) ? 'bg-accent' : 'bg-teal'}`} />}
                          >
                            <p className="ui-row-title">{preset.name}</p>
                            <p className="ui-row-summary">{preset.items.length} {preset.items.length === 1 ? 'item' : 'items'}</p>
                            <p className="ui-row-meta">{(presetsData?.presetLibrary.defaultPresetIds ?? []).includes(preset.id) ? 'default preset' : 'saved preset'}</p>
                          </ListLinkRow>
                        ))}
                      </div>
                    ) : (
                      <p className="text-[12px] text-secondary">No presets defined yet.</p>
                    )}
                  </OverviewSection>

                  <OverviewSection
                    label="Scheduled tasks"
                    title={enabledTasks.length > 0 ? 'Unattended automation' : 'No scheduled tasks'}
                    body="Scheduled tasks keep automation running on cron or one-time schedules outside live conversations."
                  >
                    {tasks.length > 0 ? (
                      <div className="space-y-px">
                        {tasks.slice(0, 5).map((task) => (
                          <ListLinkRow
                            key={task.id}
                            to={`/capabilities${buildCapabilitiesSearch(location.search, { section: 'scheduled', taskId: task.id })}`}
                            leading={<span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${taskStatusDotClass(task)}`} />}
                          >
                            <p className="ui-row-title">{task.id}</p>
                            <p className="ui-row-summary">{task.prompt || '(no prompt summary)'}</p>
                            <p className="ui-row-meta">{taskStatusLabel(task)} · {formatTaskSchedule(task)}</p>
                          </ListLinkRow>
                        ))}
                      </div>
                    ) : (
                      <p className="text-[12px] text-secondary">No scheduled tasks configured.</p>
                    )}
                  </OverviewSection>
                </div>

                <OverviewSection
                  label="Tools"
                  title={activeTools.length > 0 ? 'Runtime tools and integrations' : 'No tools available'}
                  body="Tools are the runtime primitives the agent can call directly. CLI dependencies and MCP servers expand what those tools can do."
                >
                  <div className="space-y-2">
                    <p className="text-[12px] leading-relaxed text-secondary">{activeTools.length} active tools by default · {tools.length} total available · {mcpServers.length} MCP server{mcpServers.length === 1 ? '' : 's'} configured.</p>
                    {unavailableCli.length > 0 && (
                      <div className="space-y-1">
                        <p className="ui-card-meta">CLI issues</p>
                        {unavailableCli.map((tool) => (
                          <p key={tool.id} className="text-[12px] leading-relaxed text-secondary">• {tool.name} · {tool.binary.error ?? 'Unavailable'}</p>
                        ))}
                      </div>
                    )}
                    <div className="pt-1">
                      <button
                        type="button"
                        className="ui-toolbar-button"
                        onClick={() => navigateSearch(buildCapabilitiesSearch(location.search, { section: 'tools', toolName: activeTools[0]?.name ?? tools[0]?.name ?? null }))}
                      >
                        Inspect tools
                      </button>
                    </div>
                  </div>
                </OverviewSection>
              </div>
            ) : section === 'presets' ? (
              <div className="space-y-5">
                <p className="ui-card-meta">Todo presets are reusable ordered lists of skills and instructions for conversation automation. Inspect the selected preset in the right sidebar.</p>

                {filteredPresets.length === 0 ? (
                  <EmptyState
                    title="No presets in this view"
                    body={query.trim() ? 'Try a broader search across preset names and item labels.' : 'Create presets in the dedicated preset editor.'}
                    action={<Link to="/plans" className="ui-toolbar-button">Open preset editor</Link>}
                  />
                ) : (
                  <div className="space-y-px">
                    {filteredPresets.map((preset) => {
                      const isDefault = (presetsData?.presetLibrary.defaultPresetIds ?? []).includes(preset.id);
                      return (
                        <ListLinkRow
                          key={preset.id}
                          to={`/capabilities${buildCapabilitiesSearch(location.search, { section: 'presets', presetId: preset.id })}`}
                          selected={preset.id === selectedPresetId}
                          leading={<span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${isDefault ? 'bg-accent' : 'bg-teal'}`} />}
                        >
                          <p className="ui-row-title">{preset.name}</p>
                          <p className="ui-row-summary">{preset.items.length} {preset.items.length === 1 ? 'item' : 'items'}</p>
                          <p className="ui-row-meta">{isDefault ? 'default' : 'saved preset'} · {preset.updatedAt ? `updated ${timeAgo(preset.updatedAt)}` : 'saved in settings'}</p>
                        </ListLinkRow>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : section === 'scheduled' ? (
              <div className="space-y-5">
                <p className="ui-card-meta">Scheduled tasks run automation on cron or one-time schedules, independent of live conversations. Inspect the selected task in the right sidebar.</p>

                {filteredTasks.length === 0 ? (
                  <EmptyState
                    title="No scheduled tasks in this view"
                    body={query.trim() ? 'Try a broader search across task IDs, prompts, or schedules.' : 'Create a task from the dedicated scheduled tasks editor.'}
                    action={<Link to="/scheduled" className="ui-toolbar-button">Open scheduled tasks</Link>}
                  />
                ) : (
                  <div className="space-y-px">
                    {filteredTasks.map((task) => (
                      <ListLinkRow
                        key={task.id}
                        to={`/capabilities${buildCapabilitiesSearch(location.search, { section: 'scheduled', taskId: task.id })}`}
                        selected={task.id === selectedTaskId}
                        leading={<span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${taskStatusDotClass(task)}`} />}
                      >
                        <p className="ui-row-title">{task.id}</p>
                        <p className="ui-row-summary">{task.prompt || '(no prompt summary)'}</p>
                        <p className="ui-row-meta break-words">{taskStatusLabel(task)} · {formatTaskSchedule(task)}{task.lastRunAt ? ` · last run ${timeAgo(task.lastRunAt)}` : ''}</p>
                      </ListLinkRow>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-5">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="ui-segmented-control" role="group" aria-label="Tool filter">
                    {TOOL_FILTER_OPTIONS.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setToolFilter(option.value)}
                        className={toolFilter === option.value ? 'ui-segmented-button ui-segmented-button-active' : 'ui-segmented-button'}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                  <span className="ui-card-meta">Tools are the runtime primitives available to new sessions. Inspect the selected tool in the right sidebar.</span>
                </div>

                {filteredTools.length === 0 ? (
                  <EmptyState
                    title="No tools in this view"
                    body={query.trim() ? 'Try a broader search across tool names, descriptions, and parameters.' : 'Switch tool filters or install additional capabilities.'}
                    action={<Link to="/tools" className="ui-toolbar-button">Open full tools page</Link>}
                  />
                ) : (
                  <div className="space-y-px">
                    {filteredTools.map((tool) => (
                      <ListLinkRow
                        key={tool.name}
                        to={`/capabilities${buildCapabilitiesSearch(location.search, { section: 'tools', toolName: tool.name })}`}
                        selected={tool.name === selectedToolName}
                        leading={<span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${toolDotClass(tool)}`} />}
                      >
                        <p className="ui-row-title">{tool.name}</p>
                        <p className="ui-row-summary">{tool.description}</p>
                        <p className="ui-row-meta">{tool.active ? 'active by default' : 'available'} · {getToolParameters(tool).length} parameter{getToolParameters(tool).length === 1 ? '' : 's'}</p>
                      </ListLinkRow>
                    ))}
                  </div>
                )}

                <div className="space-y-3 border-t border-border-subtle pt-5">
                  <div className="space-y-1">
                    <p className="ui-section-label">Integrations</p>
                    <p className="ui-card-meta">Runtime dependencies that back the tools surface.</p>
                  </div>
                  <p className="text-[12px] leading-relaxed text-secondary">{(toolsData?.dependentCliTools ?? []).length} CLI dependencies · {mcpServers.length} MCP server{mcpServers.length === 1 ? '' : 's'}.</p>
                  {unavailableCli.length > 0 && (
                    <div className="space-y-1">
                      {unavailableCli.map((tool) => (
                        <p key={tool.id} className="text-[12px] leading-relaxed text-secondary">• {tool.name} · {tool.binary.error ?? 'Unavailable'}</p>
                      ))}
                    </div>
                  )}
                  {mcpServers.length > 0 && (
                    <div className="space-y-1">
                      {mcpServers.slice(0, 5).map((server) => (
                        <p key={server.name} className="text-[12px] leading-relaxed text-secondary">• {server.name} · {server.url ?? server.command}</p>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

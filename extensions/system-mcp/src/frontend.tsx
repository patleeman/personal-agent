import { api, cx, Pill, ToolbarButton, useApi } from '@personal-agent/extensions/settings';
import React, { type FormEvent, type ReactNode, useEffect, useMemo, useState } from 'react';

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
  explicitConfigJson: string;
  servers: McpServerConfig[];
  bundledSkills: Array<{
    skillName: string;
    skillPath: string;
    manifestPath: string;
    serverNames: string[];
    overriddenServerNames: string[];
  }>;
};

type ExplicitMcpConfig = { mcpServers: Record<string, Record<string, unknown>> };
type ServerDraft = {
  originalName?: string;
  name: string;
  transport: 'stdio' | 'remote';
  command: string;
  args: string;
  cwd: string;
  url: string;
};
type OperationResult = { ok: boolean; message: string; toolCount?: number };

const emptyDraft: ServerDraft = { name: '', transport: 'stdio', command: '', args: '', cwd: '', url: '' };

async function inspectMcpSettings(): Promise<McpSettingsState> {
  const response = await api.invokeExtensionAction('system-mcp', 'inspectSettings', {});
  return response.result as McpSettingsState;
}

async function saveExplicitMcpConfig(config: ExplicitMcpConfig): Promise<McpSettingsState> {
  const response = await api.invokeExtensionAction('system-mcp', 'saveExplicitConfig', { json: JSON.stringify(config, null, 2) });
  return response.result as McpSettingsState;
}

async function runServerAction(action: 'testServer' | 'authServer' | 'logoutServer', server: string): Promise<OperationResult> {
  const response = await api.invokeExtensionAction('system-mcp', action, { server });
  return response.result as OperationResult;
}

function parseExplicitConfig(json: string): ExplicitMcpConfig {
  const parsed = JSON.parse(json) as { mcpServers?: unknown };
  const mcpServers =
    parsed.mcpServers && typeof parsed.mcpServers === 'object' && !Array.isArray(parsed.mcpServers) ? parsed.mcpServers : {};
  return { mcpServers: mcpServers as Record<string, Record<string, unknown>> };
}

function draftFromServer(server: McpServerConfig): ServerDraft {
  return {
    originalName: server.name,
    name: server.name,
    transport: server.transport,
    command: server.command ?? '',
    args: server.args.join('\n'),
    cwd: server.cwd ?? '',
    url: server.url ?? '',
  };
}

function configFromDraft(draft: ServerDraft): Record<string, unknown> {
  if (draft.transport === 'remote') {
    return { type: 'remote', url: draft.url.trim() };
  }

  const args = draft.args
    .split('\n')
    .map((arg) => arg.trim())
    .filter(Boolean);
  return {
    command: draft.command.trim(),
    ...(args.length > 0 ? { args } : {}),
    ...(draft.cwd.trim() ? { cwd: draft.cwd.trim() } : {}),
  };
}

function validateDraft(draft: ServerDraft): string | null {
  if (!draft.name.trim()) return 'Server name is required.';
  if (!/^[a-zA-Z0-9._-]+$/.test(draft.name.trim())) return 'Server name can only use letters, numbers, dot, underscore, and dash.';
  if (draft.transport === 'remote' && !draft.url.trim()) return 'Remote URL is required.';
  if (draft.transport === 'stdio' && !draft.command.trim()) return 'Command is required.';
  return null;
}

function formatMcpServerCommand(server: McpServerConfig): string {
  if (server.transport === 'remote') return server.url ?? 'Remote endpoint';
  const commandLine = [server.command, ...server.args].filter((value): value is string => Boolean(value?.trim()));
  return commandLine.length > 0 ? commandLine.join(' ') : 'Local stdio wrapper';
}

function SettingsPanel({ title, description, children }: { title: ReactNode; description?: ReactNode; children: ReactNode }) {
  return (
    <section className="scroll-mt-24 grid gap-5 border-t border-border-subtle/70 py-6 first:border-t-0 first:pt-0 lg:grid-cols-[minmax(0,15rem)_minmax(0,1fr)] lg:items-start lg:gap-8">
      <div className="min-w-0 space-y-1.5">
        <h3 className="text-[15px] font-medium tracking-tight text-primary">{title}</h3>
        {description ? <p className="max-w-sm text-[12px] leading-5 text-secondary">{description}</p> : null}
      </div>
      <div className="min-w-0 space-y-3.5">{children}</div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="space-y-1.5 text-[12px] text-secondary">
      <span>{label}</span>
      {children}
    </label>
  );
}

const inputClass =
  'w-full rounded-md border border-border-subtle bg-elevated/40 px-2.5 py-1.5 text-[12px] text-primary outline-none focus:border-border-strong';
const buttonClass =
  'rounded-md border border-border-default px-2.5 py-1 text-[12px] text-primary hover:border-border-strong disabled:cursor-not-allowed disabled:opacity-50';

export function McpSettingsPanel() {
  const { data: mcpState, loading: mcpLoading, error: mcpError, refetch } = useApi(inspectMcpSettings, 'system-mcp-settings');
  const [explicitConfig, setExplicitConfig] = useState<ExplicitMcpConfig>({ mcpServers: {} });
  const [draft, setDraft] = useState<ServerDraft | null>(null);
  const [saveState, setSaveState] = useState<{ busy: boolean; error: string | null; message: string | null }>({
    busy: false,
    error: null,
    message: null,
  });
  const [operation, setOperation] = useState<Record<string, { busy?: boolean; message?: string; error?: string }>>({});

  useEffect(() => {
    if (mcpState) {
      setExplicitConfig(parseExplicitConfig(mcpState.explicitConfigJson));
      setDraft(null);
      setSaveState({ busy: false, error: null, message: null });
    }
  }, [mcpState?.explicitConfigJson]);

  const visibleExplicitConfig = useMemo(
    () => (mcpState ? parseExplicitConfig(mcpState.explicitConfigJson) : explicitConfig),
    [explicitConfig, mcpState],
  );
  const explicitServers = useMemo(
    () => Object.keys(visibleExplicitConfig.mcpServers).sort((a, b) => a.localeCompare(b)),
    [visibleExplicitConfig],
  );

  async function persist(nextConfig: ExplicitMcpConfig, message: string) {
    setSaveState({ busy: true, error: null, message: null });
    try {
      await saveExplicitMcpConfig(nextConfig);
      await refetch();
      setSaveState({ busy: false, error: null, message });
    } catch (error) {
      setSaveState({ busy: false, error: error instanceof Error ? error.message : String(error), message: null });
    }
  }

  async function handleSubmitDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft) return;
    const validationError = validateDraft(draft);
    if (validationError) {
      setSaveState({ busy: false, error: validationError, message: null });
      return;
    }

    const name = draft.name.trim();
    const nextServers = { ...explicitConfig.mcpServers };
    if (draft.originalName && draft.originalName !== name) delete nextServers[draft.originalName];
    nextServers[name] = configFromDraft(draft);
    await persist({ mcpServers: nextServers }, `${name} saved.`);
  }

  async function removeServer(name: string) {
    const nextServers = { ...explicitConfig.mcpServers };
    delete nextServers[name];
    await persist({ mcpServers: nextServers }, `${name} removed.`);
  }

  async function handleServerAction(action: 'testServer' | 'authServer' | 'logoutServer', server: string) {
    setOperation((current) => ({ ...current, [server]: { busy: true } }));
    const result = await runServerAction(action, server).catch((error: unknown) => ({
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    }));
    setOperation((current) => ({ ...current, [server]: result.ok ? { message: result.message } : { error: result.message } }));
  }

  return (
    <div className="space-y-0">
      <SettingsPanel
        title="MCP servers"
        description="Add, edit, remove, test, and authenticate explicit MCP servers. Skill-bundled servers stay read-only here."
      >
        {mcpLoading && !mcpState ? (
          <p className="ui-card-meta">Loading MCP servers…</p>
        ) : mcpError && !mcpState ? (
          <p className="text-[12px] text-danger">Failed to load MCP servers: {mcpError}</p>
        ) : mcpState ? (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="ui-card-meta break-all">
                Explicit config: <span className="font-mono text-[11px]">{mcpState.configPath}</span>
              </p>
              <div className="flex gap-2">
                <button type="button" className={buttonClass} disabled={mcpLoading} onClick={() => void refetch()}>
                  Refresh
                </button>
                <button type="button" className={buttonClass} onClick={() => setDraft({ ...emptyDraft })}>
                  Add server
                </button>
              </div>
            </div>

            {saveState.error ? <p className="text-[12px] text-danger">{saveState.error}</p> : null}
            {saveState.message ? <p className="text-[12px] text-success">{saveState.message}</p> : null}

            {draft ? (
              <form className="space-y-3 border-t border-border-subtle/60 pt-3" onSubmit={handleSubmitDraft}>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Name">
                    <input
                      className={inputClass}
                      value={draft.name}
                      onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                    />
                  </Field>
                  <Field label="Transport">
                    <select
                      className={inputClass}
                      value={draft.transport}
                      onChange={(event) => setDraft({ ...draft, transport: event.target.value as 'stdio' | 'remote' })}
                    >
                      <option value="stdio">Local command</option>
                      <option value="remote">Remote URL</option>
                    </select>
                  </Field>
                  {draft.transport === 'remote' ? (
                    <Field label="URL">
                      <input
                        className={inputClass}
                        value={draft.url}
                        onChange={(event) => setDraft({ ...draft, url: event.target.value })}
                        placeholder="https://example.com/mcp"
                      />
                    </Field>
                  ) : (
                    <>
                      <Field label="Command">
                        <input
                          className={inputClass}
                          value={draft.command}
                          onChange={(event) => setDraft({ ...draft, command: event.target.value })}
                          placeholder="node, npx, uvx…"
                        />
                      </Field>
                      <Field label="Working directory">
                        <input
                          className={inputClass}
                          value={draft.cwd}
                          onChange={(event) => setDraft({ ...draft, cwd: event.target.value })}
                          placeholder="Optional"
                        />
                      </Field>
                      <Field label="Args, one per line">
                        <textarea
                          className={cx(inputClass, 'min-h-24 resize-y font-mono')}
                          value={draft.args}
                          onChange={(event) => setDraft({ ...draft, args: event.target.value })}
                        />
                      </Field>
                    </>
                  )}
                </div>
                <div className="flex gap-2">
                  <ToolbarButton type="submit" disabled={saveState.busy || Boolean(validateDraft(draft))}>
                    {saveState.busy ? 'Saving…' : 'Save server'}
                  </ToolbarButton>
                  <ToolbarButton type="button" onClick={() => setDraft(null)}>
                    Cancel
                  </ToolbarButton>
                </div>
              </form>
            ) : null}

            <div className="space-y-3">
              <p className="ui-card-meta">Explicit servers</p>
              {explicitServers.length > 0 ? (
                explicitServers.map((name) => {
                  const server = mcpState.servers.find((entry) => entry.name === name);
                  const status = operation[name];
                  return (
                    <div key={name} className="space-y-2 border-t border-border-subtle/60 pt-3 first:border-t-0 first:pt-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-[12px] text-primary">{name}</span>
                        <Pill tone={server?.transport === 'remote' ? 'teal' : 'muted'}>{server?.transport ?? 'config'}</Pill>
                        {server?.hasOAuth ? <Pill tone="accent">oauth</Pill> : null}
                        <span className="ui-card-meta break-all">{server ? formatMcpServerCommand(server) : 'Unparsed server config'}</span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {server ? (
                          <button type="button" className={buttonClass} onClick={() => setDraft(draftFromServer(server))}>
                            Edit
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className={buttonClass}
                          onClick={() => void handleServerAction('testServer', name)}
                          disabled={status?.busy}
                        >
                          Test
                        </button>
                        {server?.hasOAuth ? (
                          <button
                            type="button"
                            className={buttonClass}
                            onClick={() => void handleServerAction('authServer', name)}
                            disabled={status?.busy}
                          >
                            Auth
                          </button>
                        ) : null}
                        {server?.hasOAuth ? (
                          <button
                            type="button"
                            className={buttonClass}
                            onClick={() => void handleServerAction('logoutServer', name)}
                            disabled={status?.busy}
                          >
                            Logout
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className={cx(buttonClass, 'text-danger hover:text-danger')}
                          onClick={() => void removeServer(name)}
                          disabled={saveState.busy}
                        >
                          Remove
                        </button>
                      </div>
                      {status?.message ? <p className="text-[12px] text-success">{status.message}</p> : null}
                      {status?.error ? <p className="text-[12px] text-danger">{status.error}</p> : null}
                    </div>
                  );
                })
              ) : (
                <p className="ui-card-meta">No explicit servers. Add one above instead of spelunking through JSON like an animal.</p>
              )}
            </div>

            <div className="space-y-3">
              <p className="ui-card-meta">Skill-bundled servers</p>
              {mcpState.bundledSkills.length > 0 ? (
                mcpState.bundledSkills.map((bundle) => (
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
                ))
              ) : (
                <p className="ui-card-meta">No skill-local mcp.json wrappers found in the active skill set.</p>
              )}
            </div>

            <div className="space-y-3">
              <p className="ui-card-meta">Effective MCP servers</p>
              {mcpState.servers.length > 0 ? (
                mcpState.servers.map((server) => (
                  <div key={server.name} className="space-y-2 border-t border-border-subtle/60 pt-3 first:border-t-0 first:pt-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[12px] text-primary">{server.name}</span>
                      <Pill tone={server.transport === 'remote' ? 'teal' : 'muted'}>{server.transport}</Pill>
                      {server.hasOAuth ? <Pill tone="accent">oauth</Pill> : null}
                      <span className="ui-card-meta">
                        {server.source === 'skill' && server.skillName ? `Bundled with ${server.skillName}` : 'Explicit config'}
                      </span>
                    </div>
                    <p className="ui-card-meta break-all">
                      <span className="font-mono text-[11px]">{formatMcpServerCommand(server)}</span>
                    </p>
                    {server.sourcePath ? (
                      <p className="ui-card-meta break-all">
                        <span className="font-mono text-[11px]">{server.sourcePath}</span>
                      </p>
                    ) : null}
                  </div>
                ))
              ) : (
                <p className="ui-card-meta">No MCP servers are currently available.</p>
              )}
            </div>
          </div>
        ) : null}
      </SettingsPanel>
    </div>
  );
}

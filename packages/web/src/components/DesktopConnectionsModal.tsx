import { useEffect, useState } from 'react';
import { getDesktopBridge, readDesktopConnections, readDesktopEnvironment } from '../desktopBridge';
import { resolveDesktopHostEditorSelection, type DesktopHostEditorMode } from '../desktopConnections';
import type { DesktopConnectionsState, DesktopEnvironmentState, DesktopHostRecord, DesktopWorkspaceServerState } from '../types';
import { ToolbarButton, cx } from './ui';

const INPUT_CLASS = 'w-full rounded-xl border border-border-subtle bg-surface/70 px-3.5 py-2.5 text-[14px] text-primary shadow-sm transition-colors focus:border-accent/50 focus:bg-surface focus:outline-none disabled:opacity-50';
const ACTION_BUTTON_CLASS = 'ui-toolbar-button';
const CHECKBOX_CLASS = 'h-4 w-4 rounded border-border-default bg-base text-accent focus:ring-0 focus:outline-none';

interface DesktopHostDraft {
  id: string;
  label: string;
  kind: 'web' | 'ssh';
  websocketUrl: string;
  workspaceRoot: string;
  sshTarget: string;
  remoteRepoRoot: string;
  remotePort: string;
  autoConnect: boolean;
}

interface DesktopWorkspaceServerDraft {
  enabled: boolean;
  port: string;
  useTailscaleServe: boolean;
}

function createDesktopWorkspaceServerDraft(state?: DesktopWorkspaceServerState | null): DesktopWorkspaceServerDraft {
  return {
    enabled: state?.enabled ?? false,
    port: String(state?.port ?? 8390),
    useTailscaleServe: state?.useTailscaleServe ?? false,
  };
}

function createDesktopHostDraft(host?: Extract<DesktopHostRecord, { kind: 'web' | 'ssh' }>): DesktopHostDraft {
  if (!host) {
    return {
      id: '',
      label: '',
      kind: 'web',
      websocketUrl: '',
      workspaceRoot: '',
      sshTarget: '',
      remoteRepoRoot: '',
      remotePort: '8390',
      autoConnect: false,
    };
  }

  if (host.kind === 'web') {
    return {
      id: host.id,
      label: host.label,
      kind: 'web',
      websocketUrl: host.websocketUrl,
      workspaceRoot: host.workspaceRoot ?? '',
      sshTarget: '',
      remoteRepoRoot: '',
      remotePort: '8390',
      autoConnect: host.autoConnect ?? false,
    };
  }

  return {
    id: host.id,
    label: host.label,
    kind: 'ssh',
    websocketUrl: '',
    workspaceRoot: host.workspaceRoot ?? '',
    sshTarget: host.sshTarget,
    remoteRepoRoot: host.remoteRepoRoot ?? '',
    remotePort: host.remotePort ? String(host.remotePort) : '8390',
    autoConnect: host.autoConnect ?? false,
  };
}

function formatDesktopHostDetails(host: DesktopHostRecord): string {
  if (host.kind === 'local') {
    return 'Managed by the desktop app.';
  }

  if (host.kind === 'web') {
    return [host.websocketUrl, host.workspaceRoot || null].filter(Boolean).join(' · ');
  }

  return [host.sshTarget, host.workspaceRoot || null, host.remoteRepoRoot || null, host.remotePort ? `port ${host.remotePort}` : null]
    .filter(Boolean)
    .join(' · ');
}

export function DesktopConnectionsModal({ onClose }: { onClose: () => void }) {
  const [environment, setEnvironment] = useState<DesktopEnvironmentState | null>(null);
  const [connections, setConnections] = useState<DesktopConnectionsState | null>(null);
  const [selectedHostId, setSelectedHostId] = useState<string>('');
  const [editorMode, setEditorMode] = useState<DesktopHostEditorMode>('new');
  const [draft, setDraft] = useState<DesktopHostDraft>(() => createDesktopHostDraft());
  const [workspaceServerState, setWorkspaceServerState] = useState<DesktopWorkspaceServerState | null>(null);
  const [workspaceServerDraft, setWorkspaceServerDraft] = useState<DesktopWorkspaceServerDraft>(() => createDesktopWorkspaceServerDraft());
  const [litterShimState, setLitterShimState] = useState<{ installed: boolean; shimPath: string; command: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState<'connect' | 'open' | 'save' | 'delete' | 'save-workspace-server' | 'install-shim' | 'uninstall-shim' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  useEffect(() => {
    const bridge = getDesktopBridge();
    if (!bridge) {
      setError('Desktop bridge unavailable. Restart the desktop app and try again.');
      setLoading(false);
      return;
    }

    let cancelled = false;

    Promise.all([readDesktopEnvironment(), readDesktopConnections()])
      .then(([nextEnvironment, nextConnections]) => {
        if (cancelled) {
          return;
        }

        setEnvironment(nextEnvironment);
        setConnections(nextConnections);
        setLoading(false);
      })
      .catch((nextError) => {
        if (cancelled) {
          return;
        }

        setError(nextError instanceof Error ? nextError.message : String(nextError));
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const resolved = resolveDesktopHostEditorSelection(connections, selectedHostId, editorMode);
    if (!resolved) {
      return;
    }

    if (resolved.editorMode !== editorMode) {
      setEditorMode(resolved.editorMode);
    }
    if (resolved.selectedHostId !== selectedHostId) {
      setSelectedHostId(resolved.selectedHostId);
    }
    setDraft(createDesktopHostDraft(resolved.selectedHost ?? undefined));
  }, [connections, editorMode, selectedHostId]);

  useEffect(() => {
    const bridge = getDesktopBridge();
    if (!bridge) {
      setWorkspaceServerState(null);
      setLitterShimState(null);
      return;
    }

    let cancelled = false;
    void Promise.all([
      bridge.readWorkspaceServerState().catch(() => null),
      bridge.readLitterShimState().catch(() => null),
    ]).then(([serverState, shimState]) => {
      if (cancelled) {
        return;
      }

      setWorkspaceServerState(serverState);
      setWorkspaceServerDraft(createDesktopWorkspaceServerDraft(serverState));
      setLitterShimState(shimState);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  async function refreshDesktopState() {
    const [nextEnvironment, nextConnections] = await Promise.all([
      readDesktopEnvironment(),
      readDesktopConnections(),
    ]);
    setEnvironment(nextEnvironment);
    setConnections(nextConnections);
  }

  function startNewHostDraft() {
    setEditorMode('new');
    setSelectedHostId('');
    setDraft(createDesktopHostDraft());
    setError(null);
    setNotice(null);
  }

  function selectHost(host: DesktopHostRecord) {
    if (host.kind === 'local') {
      startNewHostDraft();
      return;
    }

    setEditorMode('existing');
    setSelectedHostId(host.id);
    setDraft(createDesktopHostDraft(host));
    setError(null);
    setNotice(null);
  }

  async function handleConnect(hostId: string) {
    const bridge = getDesktopBridge();
    if (!bridge) {
      return;
    }

    setAction('connect');
    setError(null);
    setNotice(null);

    try {
      await bridge.switchHost(hostId);
      onClose();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
      setAction(null);
    }
  }

  async function handleOpenWindow(hostId: string) {
    const bridge = getDesktopBridge();
    if (!bridge) {
      return;
    }

    setAction('open');
    setError(null);
    setNotice(null);

    try {
      await bridge.openHostWindow(hostId);
      onClose();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
      setAction(null);
    }
  }

  async function handleSave() {
    const bridge = getDesktopBridge();
    if (!bridge) {
      return;
    }

    if (!draft.id.trim() || !draft.label.trim()) {
      setError('Host id and label are required.');
      return;
    }

    let host: Extract<DesktopHostRecord, { kind: 'web' | 'ssh' }>;
    if (draft.kind === 'web') {
      if (!draft.websocketUrl.trim()) {
        setError('WebSocket URL is required for remote workspaces.');
        return;
      }

      host = {
        id: draft.id.trim(),
        label: draft.label.trim(),
        kind: 'web',
        websocketUrl: draft.websocketUrl.trim(),
        ...(draft.workspaceRoot.trim() ? { workspaceRoot: draft.workspaceRoot.trim() } : {}),
        autoConnect: draft.autoConnect,
      };
    } else {
      if (!draft.sshTarget.trim()) {
        setError('SSH target is required for SSH hosts.');
        return;
      }

      const parsedPort = Number(draft.remotePort.trim());
      host = {
        id: draft.id.trim(),
        label: draft.label.trim(),
        kind: 'ssh',
        sshTarget: draft.sshTarget.trim(),
        ...(draft.workspaceRoot.trim() ? { workspaceRoot: draft.workspaceRoot.trim() } : {}),
        remoteRepoRoot: draft.remoteRepoRoot.trim() || undefined,
        remotePort: Number.isInteger(parsedPort) && parsedPort > 0 ? parsedPort : undefined,
        autoConnect: draft.autoConnect,
      };
    }

    setAction('save');
    setError(null);
    setNotice(null);

    try {
      const nextConnections = await bridge.saveHost(host);
      setConnections(nextConnections);
      await refreshDesktopState();
      setEditorMode('existing');
      setSelectedHostId(host.id);
      setDraft(createDesktopHostDraft(host));
      setNotice(draft.kind === 'ssh' ? 'SSH workspace saved.' : 'Remote workspace saved.');
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setAction(null);
    }
  }

  async function handleDelete(hostId: string) {
    const bridge = getDesktopBridge();
    if (!bridge) {
      return;
    }

    setAction('delete');
    setError(null);
    setNotice(null);

    try {
      const nextConnections = await bridge.deleteHost(hostId);
      setConnections(nextConnections);
      await refreshDesktopState();
      startNewHostDraft();
      setNotice('Remote workspace deleted.');
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setAction(null);
    }
  }

  async function handleSaveWorkspaceServer() {
    const bridge = getDesktopBridge();
    if (!bridge) {
      return;
    }

    const parsedPort = Number(workspaceServerDraft.port.trim());
    if (!Number.isInteger(parsedPort) || parsedPort <= 0 || parsedPort > 65535) {
      setError('Workspace server port must be a number between 1 and 65535.');
      return;
    }

    setAction('save-workspace-server');
    setError(null);
    setNotice(null);

    try {
      const nextState = await bridge.updateWorkspaceServerConfig({
        enabled: workspaceServerDraft.enabled,
        port: parsedPort,
        useTailscaleServe: workspaceServerDraft.enabled && workspaceServerDraft.useTailscaleServe,
      });
      setWorkspaceServerState(nextState);
      setWorkspaceServerDraft(createDesktopWorkspaceServerDraft(nextState));
      setNotice(nextState.enabled
        ? nextState.running
          ? 'Desktop workspace server updated.'
          : 'Desktop workspace server settings saved, but the server is not healthy yet.'
        : 'Stopped hosting this desktop as a remote workspace.');
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setAction(null);
    }
  }

  async function handleInstallLitterShim() {
    const bridge = getDesktopBridge();
    if (!bridge) {
      return;
    }

    setAction('install-shim');
    setError(null);
    setNotice(null);

    try {
      const state = await bridge.installLitterShim();
      setLitterShimState(state);
      setNotice(`Installed Litter Codex shim at ${state.shimPath}.`);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setAction(null);
    }
  }

  async function handleUninstallLitterShim() {
    const bridge = getDesktopBridge();
    if (!bridge) {
      return;
    }

    setAction('uninstall-shim');
    setError(null);
    setNotice(null);

    try {
      const state = await bridge.uninstallLitterShim();
      setLitterShimState(state);
      setNotice(`Removed Litter Codex shim from ${state.shimPath}.`);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setAction(null);
    }
  }

  return (
    <div
      className="ui-overlay-backdrop"
      style={{ background: 'rgb(0 0 0 / 0.52)', backdropFilter: 'blur(8px)', alignItems: 'center', justifyContent: 'center', paddingTop: 0 }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Desktop connections"
        className="ui-dialog-shell"
        style={{
          maxWidth: '1040px',
          height: 'min(780px, calc(100vh - 4rem))',
          background: 'rgb(var(--color-surface) / 0.97)',
          backdropFilter: 'blur(22px)',
          overscrollBehavior: 'contain',
        }}
      >
        <div className="flex items-start justify-between gap-6 border-b border-border-subtle px-6 py-5">
          <div className="min-w-0 space-y-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-dim">Desktop connections</p>
            <h2 className="text-[22px] font-semibold tracking-tight text-primary">Connect to a remote workspace</h2>
            <p className="max-w-2xl text-[13px] leading-6 text-secondary">
              Open a saved workspace in this window or a dedicated remote window. Saved workspace connections stay machine-local to this desktop app.
            </p>
            {environment ? (
              <p className="text-[12px] text-secondary">
                Active workspace: <span className="text-primary">{environment.activeHostLabel}</span> · {environment.activeHostSummary}
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <ToolbarButton
              onClick={startNewHostDraft}
              disabled={action !== null}
            >
              New remote workspace
            </ToolbarButton>
            <ToolbarButton onClick={onClose}>Close</ToolbarButton>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {loading ? <p className="ui-card-meta">Loading desktop connections…</p> : null}
          {!connections && !loading ? (
            <div className="rounded-2xl border border-border-subtle bg-surface px-4 py-4">
              <p className="text-[13px] font-medium text-primary">Desktop connections unavailable</p>
              <p className="ui-card-meta mt-1">
                The desktop shell loaded without its IPC bridge, so remote workspace management is unavailable in this window.
              </p>
            </div>
          ) : null}
          {connections ? (
            <div className="grid gap-8 lg:grid-cols-[minmax(0,1.1fr)_minmax(18rem,0.9fr)]">
              <section className="min-w-0 space-y-3">
                <div className="space-y-1">
                  <h3 className="text-[15px] font-medium text-primary">Saved workspaces</h3>
                  <p className="ui-card-meta">Use Connect to move this window, or Open window to keep the workspace separate.</p>
                </div>
                <div className="space-y-px">
                  {connections.hosts.map((host) => {
                    const active = host.id === connections.activeHostId;
                    const isDefault = host.id === connections.defaultHostId;
                    return (
                      <div key={host.id} className={cx('ui-list-row px-3 py-3', active && 'ui-list-row-selected')}>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span className="text-[13px] font-medium text-primary">{host.label}</span>
                            <span className="ui-card-meta">{host.kind === 'local' ? 'local' : host.kind === 'web' ? 'websocket' : 'ssh'}</span>
                            {active ? <span className="ui-card-meta">active</span> : null}
                            {isDefault ? <span className="ui-card-meta">default on launch</span> : null}
                          </div>
                          <p className="ui-card-meta mt-1 break-all">{formatDesktopHostDetails(host)}</p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          {!active ? (
                            <button
                              type="button"
                              onClick={() => { void handleConnect(host.id); }}
                              disabled={action !== null}
                              className={ACTION_BUTTON_CLASS}
                            >
                              Connect
                            </button>
                          ) : null}
                          {host.kind !== 'local' ? (
                            <>
                              <button
                                type="button"
                                onClick={() => { void handleOpenWindow(host.id); }}
                                disabled={action !== null}
                                className={ACTION_BUTTON_CLASS}
                              >
                                Open window
                              </button>
                              <button
                                type="button"
                                onClick={() => { selectHost(host); }}
                                disabled={action !== null}
                                className={ACTION_BUTTON_CLASS}
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                onClick={() => { void handleDelete(host.id); }}
                                disabled={action !== null}
                                className={ACTION_BUTTON_CLASS}
                              >
                                Delete
                              </button>
                            </>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>

              <section className="min-w-0 space-y-4 border-t border-border-subtle pt-5 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
                <div className="space-y-1">
                  <h3 className="text-[15px] font-medium text-primary">{editorMode === 'existing' ? 'Edit remote workspace' : 'New remote workspace'}</h3>
                  <p className="ui-card-meta">Save workspace preferences here so they are available from the top bar later.</p>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2 min-w-0">
                    <label className="ui-card-meta" htmlFor="desktop-modal-host-id">Host id</label>
                    <input
                      id="desktop-modal-host-id"
                      value={draft.id}
                      onChange={(event) => setDraft((current) => ({ ...current, id: event.target.value }))}
                      disabled={action !== null || editorMode === 'existing'}
                      className={`${INPUT_CLASS} font-mono text-[13px]`}
                      autoComplete="off"
                      spellCheck={false}
                      placeholder="home-tailnet"
                    />
                  </div>
                  <div className="space-y-2 min-w-0">
                    <label className="ui-card-meta" htmlFor="desktop-modal-host-label">Label</label>
                    <input
                      id="desktop-modal-host-label"
                      value={draft.label}
                      onChange={(event) => setDraft((current) => ({ ...current, label: event.target.value }))}
                      disabled={action !== null}
                      className={INPUT_CLASS}
                      autoComplete="off"
                      spellCheck={false}
                      placeholder="Home desktop"
                    />
                  </div>
                  <div className="space-y-2 min-w-0">
                    <label className="ui-card-meta" htmlFor="desktop-modal-host-kind">Connection type</label>
                    <select
                      id="desktop-modal-host-kind"
                      value={draft.kind}
                      onChange={(event) => setDraft((current) => ({ ...current, kind: event.target.value as 'web' | 'ssh' }))}
                      disabled={action !== null}
                      className={INPUT_CLASS}
                    >
                      <option value="web">WebSocket</option>
                      <option value="ssh">SSH</option>
                    </select>
                  </div>
                  {draft.kind === 'web' ? (
                    <>
                      <div className="space-y-2 min-w-0 md:col-span-2">
                        <label className="ui-card-meta" htmlFor="desktop-modal-host-base-url">WebSocket URL</label>
                        <input
                          id="desktop-modal-host-base-url"
                          value={draft.websocketUrl}
                          onChange={(event) => setDraft((current) => ({ ...current, websocketUrl: event.target.value }))}
                          disabled={action !== null}
                          className={`${INPUT_CLASS} font-mono text-[13px]`}
                          autoComplete="off"
                          spellCheck={false}
                          placeholder="wss://my-machine.tailnet.ts.net/codex"
                        />
                        <p className="ui-card-meta">Point this at a live Codex-compatible app-server endpoint, not the normal Personal Agent web UI URL.</p>
                      </div>
                      <div className="space-y-2 min-w-0 md:col-span-2">
                        <label className="ui-card-meta" htmlFor="desktop-modal-web-workspace-root">Workspace root</label>
                        <input
                          id="desktop-modal-web-workspace-root"
                          value={draft.workspaceRoot}
                          onChange={(event) => setDraft((current) => ({ ...current, workspaceRoot: event.target.value }))}
                          disabled={action !== null}
                          className={`${INPUT_CLASS} font-mono text-[13px]`}
                          autoComplete="off"
                          spellCheck={false}
                          placeholder="/workspace/project"
                        />
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="space-y-2 min-w-0">
                        <label className="ui-card-meta" htmlFor="desktop-modal-host-ssh-target">SSH target</label>
                        <input
                          id="desktop-modal-host-ssh-target"
                          value={draft.sshTarget}
                          onChange={(event) => setDraft((current) => ({ ...current, sshTarget: event.target.value }))}
                          disabled={action !== null}
                          className={`${INPUT_CLASS} font-mono text-[13px]`}
                          autoComplete="off"
                          spellCheck={false}
                          placeholder="patrick@desktop-gpu"
                        />
                      </div>
                      <div className="space-y-2 min-w-0">
                        <label className="ui-card-meta" htmlFor="desktop-modal-host-workspace-root">Workspace root</label>
                        <input
                          id="desktop-modal-host-workspace-root"
                          value={draft.workspaceRoot}
                          onChange={(event) => setDraft((current) => ({ ...current, workspaceRoot: event.target.value }))}
                          disabled={action !== null}
                          className={`${INPUT_CLASS} font-mono text-[13px]`}
                          autoComplete="off"
                          spellCheck={false}
                          placeholder="~/workingdir/project"
                        />
                      </div>
                      <div className="space-y-2 min-w-0">
                        <label className="ui-card-meta" htmlFor="desktop-modal-host-remote-port">Remote codex port</label>
                        <input
                          id="desktop-modal-host-remote-port"
                          value={draft.remotePort}
                          onChange={(event) => setDraft((current) => ({ ...current, remotePort: event.target.value }))}
                          disabled={action !== null}
                          className={`${INPUT_CLASS} font-mono text-[13px]`}
                          autoComplete="off"
                          spellCheck={false}
                          placeholder="8390"
                        />
                      </div>
                      <div className="space-y-2 min-w-0 md:col-span-2">
                        <label className="ui-card-meta" htmlFor="desktop-modal-host-repo-root">Remote repo root</label>
                        <input
                          id="desktop-modal-host-repo-root"
                          value={draft.remoteRepoRoot}
                          onChange={(event) => setDraft((current) => ({ ...current, remoteRepoRoot: event.target.value }))}
                          disabled={action !== null}
                          className={`${INPUT_CLASS} font-mono text-[13px]`}
                          autoComplete="off"
                          spellCheck={false}
                          placeholder="~/workingdir/personal-agent"
                        />
                      </div>
                    </>
                  )}
                </div>

                <label className="inline-flex items-center gap-3 text-[14px] text-primary" htmlFor="desktop-modal-host-auto-connect">
                  <input
                    id="desktop-modal-host-auto-connect"
                    type="checkbox"
                    checked={draft.autoConnect}
                    onChange={(event) => setDraft((current) => ({ ...current, autoConnect: event.target.checked }))}
                    disabled={action !== null}
                    className={CHECKBOX_CLASS}
                  />
                  <span>Use as default workspace on launch</span>
                </label>

                <p className="ui-card-meta">
                  The active workspace controls this window right now. The default workspace controls which connection opens the next time the desktop app launches.
                </p>

                <div className="space-y-3 rounded-2xl border border-border-subtle bg-surface px-4 py-4">
                  <div className="space-y-1">
                    <p className="text-[13px] font-medium text-primary">Host this desktop as a remote workspace</p>
                    <p className="ui-card-meta">Run the managed Codex-compatible server from the desktop app so direct WebSocket remotes and Tailnet publishing stop requiring manual shell nonsense.</p>
                  </div>
                  <label className="inline-flex items-center gap-3 text-[14px] text-primary" htmlFor="desktop-modal-workspace-server-enabled">
                    <input
                      id="desktop-modal-workspace-server-enabled"
                      type="checkbox"
                      checked={workspaceServerDraft.enabled}
                      onChange={(event) => setWorkspaceServerDraft((current) => ({
                        ...current,
                        enabled: event.target.checked,
                        useTailscaleServe: event.target.checked ? current.useTailscaleServe : false,
                      }))}
                      disabled={action !== null}
                      className={CHECKBOX_CLASS}
                    />
                    <span>Host this desktop as a remote workspace</span>
                  </label>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2 min-w-0">
                      <label className="ui-card-meta" htmlFor="desktop-modal-workspace-server-port">Local port</label>
                      <input
                        id="desktop-modal-workspace-server-port"
                        value={workspaceServerDraft.port}
                        onChange={(event) => setWorkspaceServerDraft((current) => ({ ...current, port: event.target.value }))}
                        disabled={action !== null}
                        className={`${INPUT_CLASS} font-mono text-[13px]`}
                        autoComplete="off"
                        spellCheck={false}
                        placeholder="8390"
                      />
                    </div>
                    <div className="space-y-2 min-w-0">
                      <label className="ui-card-meta">Status</label>
                      <p className="text-[13px] text-primary">{workspaceServerState?.running ? 'Running' : workspaceServerState?.enabled ? 'Starting or unhealthy' : 'Disabled'}</p>
                    </div>
                  </div>
                  <label className="inline-flex items-center gap-3 text-[14px] text-primary" htmlFor="desktop-modal-workspace-server-tailnet">
                    <input
                      id="desktop-modal-workspace-server-tailnet"
                      type="checkbox"
                      checked={workspaceServerDraft.enabled && workspaceServerDraft.useTailscaleServe}
                      onChange={(event) => setWorkspaceServerDraft((current) => ({ ...current, useTailscaleServe: event.target.checked }))}
                      disabled={action !== null || !workspaceServerDraft.enabled}
                      className={CHECKBOX_CLASS}
                    />
                    <span>Publish over Tailscale at <span className="font-mono text-[11px]">/codex</span></span>
                  </label>
                  <div className="space-y-1">
                    <p className="ui-card-meta break-all">Local URL: <span className="font-mono text-[11px] text-primary">{workspaceServerState?.localWebsocketUrl ?? `ws://127.0.0.1:${workspaceServerDraft.port || '8390'}/codex`}</span></p>
                    {workspaceServerState?.tailnetWebsocketUrl ? (
                      <p className="ui-card-meta break-all">Tailnet URL: <span className="font-mono text-[11px] text-primary">{workspaceServerState.tailnetWebsocketUrl}</span></p>
                    ) : null}
                    <p className="ui-card-meta break-all">Log: <span className="font-mono text-[11px]">{workspaceServerState?.logFile ?? 'desktop/logs/codex-app-server.log'}</span></p>
                    {workspaceServerState?.error ? <p className="text-[12px] text-danger">{workspaceServerState.error}</p> : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => { void handleSaveWorkspaceServer(); }}
                      disabled={action !== null}
                      className={ACTION_BUTTON_CLASS}
                    >
                      {action === 'save-workspace-server' ? 'Saving…' : 'Save server settings'}
                    </button>
                  </div>
                </div>

                <div className="space-y-2 rounded-2xl border border-border-subtle bg-surface px-4 py-4">
                  <p className="text-[13px] font-medium text-primary">Litter SSH shim</p>
                  <p className="ui-card-meta">
                    Install a machine-local <span className="font-mono text-[11px]">~/.litter/bin/codex</span> shim so Litter can SSH in and launch the desktop app's Codex-compatible server.
                  </p>
                  <p className="ui-card-meta break-all">
                    {litterShimState?.installed
                      ? `Installed at ${litterShimState.shimPath}`
                      : `Not installed. Expected path: ${litterShimState?.shimPath ?? '~/.litter/bin/codex'}`}
                  </p>
                  {litterShimState?.command ? (
                    <p className="ui-card-meta break-all">Command: <span className="font-mono text-[11px]">{litterShimState.command}</span></p>
                  ) : null}
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => { void handleInstallLitterShim(); }}
                      disabled={action !== null}
                      className={ACTION_BUTTON_CLASS}
                    >
                      {action === 'install-shim' ? 'Installing…' : litterShimState?.installed ? 'Reinstall shim' : 'Install shim'}
                    </button>
                    {litterShimState?.installed ? (
                      <button
                        type="button"
                        onClick={() => { void handleUninstallLitterShim(); }}
                        disabled={action !== null}
                        className={ACTION_BUTTON_CLASS}
                      >
                        {action === 'uninstall-shim' ? 'Removing…' : 'Remove shim'}
                      </button>
                    ) : null}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => { void handleSave(); }}
                    disabled={action !== null}
                    className={ACTION_BUTTON_CLASS}
                  >
                    {action === 'save' ? 'Saving…' : editorMode === 'existing' ? 'Save host' : 'Add host'}
                  </button>
                  {editorMode === 'existing' ? (
                    <button
                      type="button"
                      onClick={startNewHostDraft}
                      disabled={action !== null}
                      className={ACTION_BUTTON_CLASS}
                    >
                      New host
                    </button>
                  ) : null}
                  {connections.activeHostId !== 'local' ? (
                    <button
                      type="button"
                      onClick={() => { void handleConnect('local'); }}
                      disabled={action !== null}
                      className={ACTION_BUTTON_CLASS}
                    >
                      Switch to local
                    </button>
                  ) : null}
                </div>
              </section>
            </div>
          ) : null}

          {notice ? <p className="mt-4 text-[12px] text-success">{notice}</p> : null}
          {error ? <p className="mt-4 text-[12px] text-danger">{error}</p> : null}
        </div>
      </div>
    </div>
  );
}

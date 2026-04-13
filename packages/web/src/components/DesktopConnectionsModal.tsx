import { useEffect, useState } from 'react';
import { getDesktopBridge, readDesktopConnections, readDesktopEnvironment } from '../desktopBridge';
import { resolveDesktopHostEditorSelection, type DesktopHostEditorMode } from '../desktopConnections';
import type { DesktopConnectionsState, DesktopEnvironmentState, DesktopHostRecord, DesktopRemoteHostAuthState } from '../types';
import { ToolbarButton, cx } from './ui';

const INPUT_CLASS = 'w-full rounded-xl border border-border-subtle bg-surface/70 px-3.5 py-2.5 text-[14px] text-primary shadow-sm transition-colors focus:border-accent/50 focus:bg-surface focus:outline-none disabled:opacity-50';
const ACTION_BUTTON_CLASS = 'ui-toolbar-button';
const CHECKBOX_CLASS = 'h-4 w-4 rounded border-border-default bg-base text-accent focus:ring-0 focus:outline-none';

interface DesktopHostDraft {
  id: string;
  label: string;
  kind: 'web' | 'ssh';
  baseUrl: string;
  sshTarget: string;
  remoteRepoRoot: string;
  remotePort: string;
  autoConnect: boolean;
}

function createDesktopHostDraft(host?: Extract<DesktopHostRecord, { kind: 'web' | 'ssh' }>): DesktopHostDraft {
  if (!host) {
    return {
      id: '',
      label: '',
      kind: 'web',
      baseUrl: '',
      sshTarget: '',
      remoteRepoRoot: '',
      remotePort: '3741',
      autoConnect: false,
    };
  }

  if (host.kind === 'web') {
    return {
      id: host.id,
      label: host.label,
      kind: 'web',
      baseUrl: host.baseUrl,
      sshTarget: '',
      remoteRepoRoot: '',
      remotePort: '3741',
      autoConnect: host.autoConnect ?? false,
    };
  }

  return {
    id: host.id,
    label: host.label,
    kind: 'ssh',
    baseUrl: '',
    sshTarget: host.sshTarget,
    remoteRepoRoot: host.remoteRepoRoot ?? '',
    remotePort: host.remotePort ? String(host.remotePort) : '3741',
    autoConnect: host.autoConnect ?? false,
  };
}

function formatDesktopHostDetails(host: DesktopHostRecord): string {
  if (host.kind === 'local') {
    return 'Managed by the desktop app.';
  }

  if (host.kind === 'web') {
    return host.baseUrl;
  }

  return [host.sshTarget, host.remoteRepoRoot || null, host.remotePort ? `port ${host.remotePort}` : null]
    .filter(Boolean)
    .join(' · ');
}

export function DesktopConnectionsModal({ onClose }: { onClose: () => void }) {
  const [environment, setEnvironment] = useState<DesktopEnvironmentState | null>(null);
  const [connections, setConnections] = useState<DesktopConnectionsState | null>(null);
  const [selectedHostId, setSelectedHostId] = useState<string>('');
  const [editorMode, setEditorMode] = useState<DesktopHostEditorMode>('new');
  const [draft, setDraft] = useState<DesktopHostDraft>(() => createDesktopHostDraft());
  const [selectedHostAuth, setSelectedHostAuth] = useState<DesktopRemoteHostAuthState | null>(null);
  const [pairingCodeDraft, setPairingCodeDraft] = useState('');
  const [deviceLabelDraft, setDeviceLabelDraft] = useState('Desktop app');
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState<'connect' | 'open' | 'save' | 'delete' | 'pair' | 'clear-auth' | null>(null);
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
    const selectedHost = connections?.hosts.find((host) => host.id === selectedHostId) ?? null;
    if (!bridge || !selectedHost || selectedHost.kind !== 'web') {
      setSelectedHostAuth(null);
      return;
    }

    let cancelled = false;
    void bridge.readHostAuthState(selectedHost.id)
      .then((state) => {
        if (!cancelled) {
          setSelectedHostAuth(state);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSelectedHostAuth(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [connections, selectedHostId]);

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
    setSelectedHostAuth(null);
    setPairingCodeDraft('');
    setDeviceLabelDraft('Desktop app');
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
    setPairingCodeDraft('');
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
      if (!draft.baseUrl.trim()) {
        setError('Base URL is required for web hosts.');
        return;
      }

      host = {
        id: draft.id.trim(),
        label: draft.label.trim(),
        kind: 'web',
        baseUrl: draft.baseUrl.trim(),
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
      setNotice(draft.kind === 'ssh' ? 'SSH host saved.' : 'Remote web host saved.');
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
      setNotice('Remote host deleted.');
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setAction(null);
    }
  }

  async function handlePairHost(hostId: string) {
    const bridge = getDesktopBridge();
    if (!bridge) {
      return;
    }

    const normalizedCode = pairingCodeDraft.trim();
    if (!normalizedCode) {
      setError('Pairing code is required.');
      return;
    }

    setAction('pair');
    setError(null);
    setNotice(null);

    try {
      const authState = await bridge.pairHost({
        hostId,
        code: normalizedCode,
        ...(deviceLabelDraft.trim().length > 0
          ? { deviceLabel: deviceLabelDraft.trim() }
          : {}),
      });
      setSelectedHostAuth(authState);
      setPairingCodeDraft('');
      setNotice(authState.deviceLabel
        ? `Stored bearer token for ${authState.deviceLabel}.`
        : 'Stored bearer token for this remote host.');
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setAction(null);
    }
  }

  async function handleClearHostAuth(hostId: string) {
    const bridge = getDesktopBridge();
    if (!bridge) {
      return;
    }

    setAction('clear-auth');
    setError(null);
    setNotice(null);

    try {
      const authState = await bridge.clearHostAuth(hostId);
      setSelectedHostAuth(authState);
      setNotice('Cleared stored bearer token.');
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
            <h2 className="text-[22px] font-semibold tracking-tight text-primary">Connect to a remote host</h2>
            <p className="max-w-2xl text-[13px] leading-6 text-secondary">
              Open a saved remote in this window or a dedicated remote window. Saved hosts stay machine-local to this desktop app.
            </p>
            {environment ? (
              <p className="text-[12px] text-secondary">
                Active host: <span className="text-primary">{environment.activeHostLabel}</span> · {environment.activeHostSummary}
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <ToolbarButton
              onClick={startNewHostDraft}
              disabled={action !== null}
            >
              New remote host
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
                The desktop shell loaded without its IPC bridge, so remote host management is unavailable in this window.
              </p>
            </div>
          ) : null}
          {connections ? (
            <div className="grid gap-8 lg:grid-cols-[minmax(0,1.1fr)_minmax(18rem,0.9fr)]">
              <section className="min-w-0 space-y-3">
                <div className="space-y-1">
                  <h3 className="text-[15px] font-medium text-primary">Saved hosts</h3>
                  <p className="ui-card-meta">Use Connect to move this window, or Open window to keep the remote separate.</p>
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
                            <span className="ui-card-meta">{host.kind === 'local' ? 'local' : host.kind === 'web' ? 'web' : 'ssh'}</span>
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
                  <h3 className="text-[15px] font-medium text-primary">{editorMode === 'existing' ? 'Edit remote host' : 'New remote host'}</h3>
                  <p className="ui-card-meta">Save host preferences here so they are available from the top bar later.</p>
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
                      <option value="web">Web / Tailscale</option>
                      <option value="ssh">SSH</option>
                    </select>
                  </div>
                  {draft.kind === 'web' ? (
                    <div className="space-y-2 min-w-0 md:col-span-2">
                      <label className="ui-card-meta" htmlFor="desktop-modal-host-base-url">Base URL</label>
                      <input
                        id="desktop-modal-host-base-url"
                        value={draft.baseUrl}
                        onChange={(event) => setDraft((current) => ({ ...current, baseUrl: event.target.value }))}
                        disabled={action !== null}
                        className={`${INPUT_CLASS} font-mono text-[13px]`}
                        autoComplete="off"
                        spellCheck={false}
                        placeholder="https://my-machine.ts.net"
                      />
                    </div>
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
                        <label className="ui-card-meta" htmlFor="desktop-modal-host-remote-port">Remote web UI port</label>
                        <input
                          id="desktop-modal-host-remote-port"
                          value={draft.remotePort}
                          onChange={(event) => setDraft((current) => ({ ...current, remotePort: event.target.value }))}
                          disabled={action !== null}
                          className={`${INPUT_CLASS} font-mono text-[13px]`}
                          autoComplete="off"
                          spellCheck={false}
                          placeholder="3741"
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
                  <span>Use as default host on launch</span>
                </label>

                <p className="ui-card-meta">
                  The active host controls this window right now. The default host controls which host opens the next time the desktop app launches.
                </p>

                {editorMode === 'existing' && selectedHostId && draft.kind === 'web' ? (
                  <div className="space-y-2 rounded-2xl border border-border-subtle bg-surface px-4 py-4">
                    <p className="text-[13px] font-medium text-primary">Direct remote auth</p>
                    <p className="ui-card-meta">
                      Direct web remotes use a stored bearer token for the app-server WebSocket. Generate a short-lived pairing code on the remote host, then pair this saved host once.
                    </p>
                    <p className="ui-card-meta">
                      {selectedHostAuth?.hasBearerToken
                        ? `Stored token${selectedHostAuth.deviceLabel ? ` for ${selectedHostAuth.deviceLabel}` : ''}${selectedHostAuth.expiresAt ? ` · expires ${new Date(selectedHostAuth.expiresAt).toLocaleString()}` : ''}`
                        : 'No stored bearer token for this host.'}
                    </p>
                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="space-y-2 min-w-0">
                        <label className="ui-card-meta" htmlFor="desktop-modal-host-pairing-code">Pairing code</label>
                        <input
                          id="desktop-modal-host-pairing-code"
                          value={pairingCodeDraft}
                          onChange={(event) => setPairingCodeDraft(event.target.value)}
                          disabled={action !== null}
                          className={`${INPUT_CLASS} font-mono text-[13px]`}
                          autoComplete="off"
                          spellCheck={false}
                          placeholder="ABCD-EFGH-JKLM"
                        />
                      </div>
                      <div className="space-y-2 min-w-0">
                        <label className="ui-card-meta" htmlFor="desktop-modal-host-device-label">Device label</label>
                        <input
                          id="desktop-modal-host-device-label"
                          value={deviceLabelDraft}
                          onChange={(event) => setDeviceLabelDraft(event.target.value)}
                          disabled={action !== null}
                          className={INPUT_CLASS}
                          autoComplete="off"
                          spellCheck={false}
                          placeholder="Desktop app"
                        />
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => { void handlePairHost(selectedHostId); }}
                        disabled={action !== null || pairingCodeDraft.trim().length === 0}
                        className={ACTION_BUTTON_CLASS}
                      >
                        {action === 'pair' ? 'Pairing…' : selectedHostAuth?.hasBearerToken ? 'Replace token' : 'Pair with code'}
                      </button>
                      {selectedHostAuth?.hasBearerToken ? (
                        <button
                          type="button"
                          onClick={() => { void handleClearHostAuth(selectedHostId); }}
                          disabled={action !== null}
                          className={ACTION_BUTTON_CLASS}
                        >
                          {action === 'clear-auth' ? 'Clearing…' : 'Clear token'}
                        </button>
                      ) : null}
                    </div>
                  </div>
                ) : null}

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

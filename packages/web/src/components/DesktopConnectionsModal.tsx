import { useEffect, useState } from 'react';
import { getDesktopBridge, readDesktopConnections } from '../desktop/desktopBridge';
import { resolveDesktopHostEditorSelection, type DesktopHostEditorMode } from '../desktop/desktopConnections';
import {
  describeDesktopWorkspaceServerTailnetPublish,
  formatDesktopWorkspaceServerStatus,
  labelDesktopWorkspaceServerTailnetUrl,
} from '../desktop/desktopWorkspaceServer';
import type { DesktopConnectionsState, DesktopHostRecord, DesktopWorkspaceServerState } from '../shared/types';
import { ToolbarButton, cx } from './ui';

const INPUT_CLASS = 'w-full rounded-xl border border-border-subtle bg-surface/70 px-3.5 py-2.5 text-[14px] text-primary shadow-sm transition-colors focus:border-accent/50 focus:bg-surface focus:outline-none disabled:opacity-50';
const ACTION_BUTTON_CLASS = 'ui-toolbar-button';
const CHECKBOX_CLASS = 'h-4 w-4 rounded border-border-default bg-base text-accent focus:ring-0 focus:outline-none';
const ACTIVITY_LIMIT = 14;

let nextActivityEntryId = 1;

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

interface ActivityEntry {
  id: number;
  timestamp: number;
  tone: 'info' | 'success' | 'error';
  message: string;
}

const activityTimeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

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

function hostKindLabel(host: DesktopHostRecord): string {
  if (host.kind === 'local') {
    return 'Local';
  }

  return host.kind === 'web' ? 'WebSocket' : 'SSH';
}

function formatActivityTime(timestamp: number): string {
  return activityTimeFormatter.format(timestamp);
}

function renderHostTargetMessage(host: DesktopHostRecord): string | null {
  if (host.kind === 'web') {
    return `Target ${host.websocketUrl}`;
  }

  if (host.kind === 'ssh') {
    return `Target ${host.sshTarget} · port ${host.remotePort ?? 8390}`;
  }

  return null;
}

function schedulePendingActivityNotes(hostLabel: string, appendActivity: (tone: ActivityEntry['tone'], message: string) => void): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }

  const timers = [
    window.setTimeout(() => {
      appendActivity('info', `Still connecting to ${hostLabel}…`);
    }, 1400),
    window.setTimeout(() => {
      appendActivity('info', `Still waiting for ${hostLabel} to answer…`);
    }, 4200),
  ];

  return () => {
    for (const timer of timers) {
      window.clearTimeout(timer);
    }
  };
}

function ValueRow({
  label,
  value,
  actionLabel,
  onAction,
}: {
  label: string;
  value: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0 space-y-1">
        <p className="text-[12px] text-secondary">{label}</p>
        <p className="break-all font-mono text-[12px] text-primary">{value}</p>
      </div>
      {actionLabel && onAction ? (
        <ToolbarButton className="shrink-0" onClick={onAction}>
          {actionLabel}
        </ToolbarButton>
      ) : null}
    </div>
  );
}

export function DesktopConnectionsModal({
  onClose,
  onWorkspaceServerStateChange,
}: {
  onClose: () => void;
  onWorkspaceServerStateChange?: (state: DesktopWorkspaceServerState | null) => void;
}) {
  const [connections, setConnections] = useState<DesktopConnectionsState | null>(null);
  const [selectedHostId, setSelectedHostId] = useState<string>('');
  const [editorMode, setEditorMode] = useState<DesktopHostEditorMode>('new');
  const [draft, setDraft] = useState<DesktopHostDraft>(() => createDesktopHostDraft());
  const [showEditor, setShowEditor] = useState(false);
  const [workspaceServerState, setWorkspaceServerState] = useState<DesktopWorkspaceServerState | null>(null);
  const [workspaceServerDraft, setWorkspaceServerDraft] = useState<DesktopWorkspaceServerDraft>(() => createDesktopWorkspaceServerDraft());
  const [litterShimState, setLitterShimState] = useState<{ installed: boolean; shimPath: string; command: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState<'connect' | 'open' | 'save' | 'delete' | 'save-workspace-server' | 'install-shim' | 'uninstall-shim' | 'open-log' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);

  function appendActivity(tone: ActivityEntry['tone'], message: string) {
    setActivity((current) => {
      const nextEntry: ActivityEntry = {
        id: nextActivityEntryId++,
        timestamp: Date.now(),
        tone,
        message,
      };
      return [...current, nextEntry].slice(-ACTIVITY_LIMIT);
    });
  }

  function requireBridge() {
    const bridge = getDesktopBridge();
    if (!bridge) {
      throw new Error('Desktop bridge unavailable. Restart the desktop app and try again.');
    }

    return bridge;
  }

  async function refreshConnectionsState() {
    const nextConnections = await readDesktopConnections();
    setConnections(nextConnections);
  }

  async function refreshHostingState() {
    const bridge = requireBridge();
    const [serverState, shimState] = await Promise.all([
      bridge.readWorkspaceServerState(),
      bridge.readLitterShimState(),
    ]);
    setWorkspaceServerState(serverState);
    setWorkspaceServerDraft(createDesktopWorkspaceServerDraft(serverState));
    setLitterShimState(shimState);
  }

  function resetEditor() {
    setShowEditor(false);
    setEditorMode('new');
    setSelectedHostId('');
    setDraft(createDesktopHostDraft());
  }

  function startNewHostDraft() {
    setShowEditor(true);
    setEditorMode('new');
    setSelectedHostId('');
    setDraft(createDesktopHostDraft());
    setError(null);
    setNotice(null);
  }

  function selectHost(host: DesktopHostRecord) {
    if (host.kind === 'local') {
      return;
    }

    setShowEditor(true);
    setEditorMode('existing');
    setSelectedHostId(host.id);
    setDraft(createDesktopHostDraft(host));
    setError(null);
    setNotice(null);
  }

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
      onWorkspaceServerStateChange?.(null);
      setError('Desktop bridge unavailable. Restart the desktop app and try again.');
      setLoading(false);
      return;
    }

    let cancelled = false;

    Promise.all([
      readDesktopConnections(),
      bridge.readWorkspaceServerState().catch(() => null),
      bridge.readLitterShimState().catch(() => null),
    ])
      .then(([nextConnections, serverState, shimState]) => {
        if (cancelled) {
          return;
        }

        setConnections(nextConnections);
        setWorkspaceServerState(serverState);
        setWorkspaceServerDraft(createDesktopWorkspaceServerDraft(serverState));
        setLitterShimState(shimState);
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
    onWorkspaceServerStateChange?.(workspaceServerState);
  }, [onWorkspaceServerStateChange, workspaceServerState]);

  async function handleConnect(hostId: string) {
    let cancelPendingNotes = () => {};

    try {
      const bridge = requireBridge();
      const host = connections?.hosts.find((entry) => entry.id === hostId);

      setAction('connect');
      setError(null);
      setNotice(null);
      appendActivity('info', host ? `Connecting to ${host.label}…` : `Connecting to ${hostId}…`);
      if (host) {
        const targetMessage = renderHostTargetMessage(host);
        if (targetMessage) {
          appendActivity('info', targetMessage);
        }
        cancelPendingNotes = schedulePendingActivityNotes(host.label, appendActivity);
      }

      await bridge.switchHost(hostId);
      appendActivity('success', host ? `Connected to ${host.label}.` : `Connected to ${hostId}.`);
      onClose();
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : String(nextError);
      appendActivity('error', `Connection failed: ${message}`);
      setError(message);
      setAction(null);
    } finally {
      cancelPendingNotes();
    }
  }

  async function handleOpenWindow(hostId: string) {
    let cancelPendingNotes = () => {};

    try {
      const bridge = requireBridge();
      const host = connections?.hosts.find((entry) => entry.id === hostId);

      setAction('open');
      setError(null);
      setNotice(null);
      appendActivity('info', host ? `Opening ${host.label} in a new window…` : `Opening ${hostId} in a new window…`);
      if (host) {
        cancelPendingNotes = schedulePendingActivityNotes(host.label, appendActivity);
      }

      await bridge.openHostWindow(hostId);
      appendActivity('success', host ? `Opened ${host.label} in a new window.` : `Opened ${hostId} in a new window.`);
      onClose();
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : String(nextError);
      appendActivity('error', `Open window failed: ${message}`);
      setError(message);
      setAction(null);
    } finally {
      cancelPendingNotes();
    }
  }

  async function handleSave() {
    try {
      const bridge = requireBridge();

      if (!draft.id.trim() || !draft.label.trim()) {
        setError('Host id and label are required.');
        return;
      }

      let host: Extract<DesktopHostRecord, { kind: 'web' | 'ssh' }>;
      if (draft.kind === 'web') {
        if (!draft.websocketUrl.trim()) {
          setError('WebSocket URL is required for this remote.');
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
      appendActivity('info', `${editorMode === 'existing' ? 'Saving' : 'Adding'} ${host.label}…`);

      const nextConnections = await bridge.saveHost(host);
      setConnections(nextConnections);
      await refreshConnectionsState();
      setEditorMode('existing');
      setSelectedHostId(host.id);
      setDraft(createDesktopHostDraft(host));
      setShowEditor(true);
      setNotice(draft.kind === 'ssh' ? 'SSH remote saved.' : 'Remote saved.');
      appendActivity('success', `${host.label} saved.`);
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : String(nextError);
      appendActivity('error', `Save failed: ${message}`);
      setError(message);
    } finally {
      setAction(null);
    }
  }

  async function handleDelete(hostId: string) {
    try {
      const bridge = requireBridge();
      const host = connections?.hosts.find((entry) => entry.id === hostId);

      setAction('delete');
      setError(null);
      setNotice(null);
      appendActivity('info', host ? `Deleting ${host.label}…` : `Deleting ${hostId}…`);

      const nextConnections = await bridge.deleteHost(hostId);
      setConnections(nextConnections);
      await refreshConnectionsState();
      resetEditor();
      setNotice('Remote deleted.');
      appendActivity('success', host ? `${host.label} deleted.` : `${hostId} deleted.`);
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : String(nextError);
      appendActivity('error', `Delete failed: ${message}`);
      setError(message);
    } finally {
      setAction(null);
    }
  }

  async function handleSaveWorkspaceServer() {
    try {
      const bridge = requireBridge();
      const parsedPort = Number(workspaceServerDraft.port.trim());
      if (!Number.isInteger(parsedPort) || parsedPort <= 0 || parsedPort > 65535) {
        setError('Workspace server port must be a number between 1 and 65535.');
        return;
      }

      setAction('save-workspace-server');
      setError(null);
      setNotice(null);
      appendActivity('info', workspaceServerDraft.enabled
        ? `Updating this desktop's remote server on port ${parsedPort}…`
        : 'Stopping this desktop\'s remote server…');

      const nextState = await bridge.updateWorkspaceServerConfig({
        enabled: workspaceServerDraft.enabled,
        port: parsedPort,
        useTailscaleServe: workspaceServerDraft.enabled && workspaceServerDraft.useTailscaleServe,
      });
      const nextDraft = createDesktopWorkspaceServerDraft(nextState);
      const nextTailnetPublish = describeDesktopWorkspaceServerTailnetPublish(nextState, nextDraft);
      setWorkspaceServerState(nextState);
      setWorkspaceServerDraft(nextDraft);
      if (nextState.enabled) {
        setNotice(nextState.running
          ? nextState.useTailscaleServe && nextState.tailscalePublishState.status !== 'published'
            ? `Desktop workspace server updated, but Tailnet publish is ${nextTailnetPublish.label.toLowerCase()}.`
            : 'Desktop workspace server updated.'
          : 'Desktop workspace server settings saved, but the server is not healthy yet.');
        appendActivity('success', nextState.running
          ? nextState.useTailscaleServe && nextState.tailscalePublishState.status !== 'published'
            ? `Remote server is running locally, but Tailnet publish is ${nextTailnetPublish.label.toLowerCase()}.`
            : `Remote server running at ${nextState.localWebsocketUrl}.`
          : 'Remote server settings saved, but the server is not healthy yet.');
      } else {
        setNotice('Remote server stopped.');
        appendActivity('success', 'Remote server stopped.');
      }
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : String(nextError);
      appendActivity('error', `Server update failed: ${message}`);
      setError(message);
    } finally {
      setAction(null);
    }
  }

  async function handleOpenWorkspaceServerLog() {
    try {
      const bridge = requireBridge();
      const logPath = workspaceServerState?.logFile;
      if (!logPath) {
        setError('No workspace server log file is available yet.');
        return;
      }

      setAction('open-log');
      setError(null);
      setNotice(null);
      const result = await bridge.openPath(logPath);
      if (!result.opened) {
        throw new Error(result.error || `Could not open ${logPath}`);
      }
      setNotice('Opened workspace server log.');
      appendActivity('info', `Opened log ${logPath}.`);
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : String(nextError);
      appendActivity('error', `Open log failed: ${message}`);
      setError(message);
    } finally {
      setAction(null);
    }
  }

  async function handleCopyValue(label: string, value: string) {
    if (typeof navigator === 'undefined' || typeof navigator.clipboard?.writeText !== 'function') {
      setError('Clipboard copy is unavailable in this window.');
      return;
    }

    try {
      await navigator.clipboard.writeText(value);
      setNotice(`${label} copied.`);
      appendActivity('info', `Copied ${label.toLowerCase()}.`);
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : String(nextError);
      setError(message);
    }
  }

  async function handleInstallLitterShim() {
    try {
      const bridge = requireBridge();

      setAction('install-shim');
      setError(null);
      setNotice(null);
      appendActivity('info', 'Installing the Litter SSH shim…');

      const state = await bridge.installLitterShim();
      setLitterShimState(state);
      setNotice(`Installed Litter Codex shim at ${state.shimPath}.`);
      appendActivity('success', `Installed Litter shim at ${state.shimPath}.`);
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : String(nextError);
      appendActivity('error', `Shim install failed: ${message}`);
      setError(message);
    } finally {
      setAction(null);
    }
  }

  async function handleUninstallLitterShim() {
    try {
      const bridge = requireBridge();

      setAction('uninstall-shim');
      setError(null);
      setNotice(null);
      appendActivity('info', 'Removing the Litter SSH shim…');

      const state = await bridge.uninstallLitterShim();
      setLitterShimState(state);
      setNotice(`Removed Litter Codex shim from ${state.shimPath}.`);
      appendActivity('success', `Removed Litter shim from ${state.shimPath}.`);
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : String(nextError);
      appendActivity('error', `Shim removal failed: ${message}`);
      setError(message);
    } finally {
      setAction(null);
    }
  }

  const workspaceServerStatus = formatDesktopWorkspaceServerStatus(workspaceServerState, workspaceServerDraft);
  const tailnetPublishSummary = describeDesktopWorkspaceServerTailnetPublish(workspaceServerState, workspaceServerDraft);
  const workspaceServerLogPath = workspaceServerState?.logFile ?? 'desktop/logs/codex-app-server.log';
  const showWorkspaceServerDetails = workspaceServerDraft.enabled || Boolean(workspaceServerState?.error) || Boolean(workspaceServerState?.logFile);
  const remoteHosts = connections?.hosts.filter((host) => host.kind !== 'local') ?? [];
  const localHostActive = connections?.activeHostId === 'local';

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
          maxWidth: '760px',
          height: 'min(820px, calc(100vh - 3rem))',
          background: 'rgb(var(--color-surface) / 0.97)',
          backdropFilter: 'blur(22px)',
          overscrollBehavior: 'contain',
        }}
      >
        <div className="flex items-center justify-between gap-4 border-b border-border-subtle px-6 py-4">
          <div className="min-w-0">
            <h2 className="text-[19px] font-semibold tracking-tight text-primary">Connections</h2>
          </div>
          <div className="flex items-center gap-2">
            <ToolbarButton onClick={startNewHostDraft} disabled={action !== null}>New remote</ToolbarButton>
            <ToolbarButton onClick={onClose}>Close</ToolbarButton>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {loading ? <p className="ui-card-meta">Loading connections…</p> : null}
          {!connections && !loading ? (
            <div className="rounded-2xl border border-border-subtle bg-surface px-4 py-4">
              <p className="text-[13px] font-medium text-primary">Desktop connections unavailable</p>
              <p className="ui-card-meta mt-1">The desktop shell loaded without its IPC bridge, so connection controls are unavailable in this window.</p>
            </div>
          ) : null}

          {connections ? (
            <div className="space-y-6">
              <section className="space-y-3 border-b border-border-subtle pb-6">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-[15px] font-medium text-primary">Remote server</h3>
                  <p className={cx('text-[13px] font-medium', workspaceServerStatus.className)}>{workspaceServerStatus.label}</p>
                </div>

                <div className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
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
                      <span>Allow remote connections</span>
                    </label>

                    <div className="flex items-center gap-2">
                      <label className="ui-card-meta" htmlFor="desktop-modal-workspace-server-port">Port</label>
                      <input
                        id="desktop-modal-workspace-server-port"
                        value={workspaceServerDraft.port}
                        onChange={(event) => setWorkspaceServerDraft((current) => ({ ...current, port: event.target.value }))}
                        disabled={action !== null}
                        className={`${INPUT_CLASS} w-[116px] px-3 py-2 font-mono text-[13px]`}
                        autoComplete="off"
                        spellCheck={false}
                        placeholder="8390"
                      />
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
                    <span>Publish on Tailscale at <span className="font-mono text-[11px]">/codex</span></span>
                  </label>

                  {showWorkspaceServerDetails ? (
                    <div className="space-y-3 rounded-2xl bg-base/35 px-4 py-4">
                      <ValueRow
                        label="Local URL"
                        value={workspaceServerState?.localWebsocketUrl ?? `ws://127.0.0.1:${workspaceServerDraft.port || '8390'}/codex`}
                        actionLabel="Copy"
                        onAction={() => {
                          void handleCopyValue('Local URL', workspaceServerState?.localWebsocketUrl ?? `ws://127.0.0.1:${workspaceServerDraft.port || '8390'}/codex`);
                        }}
                      />
                      <div className="space-y-1">
                        <ValueRow label="Tailnet publish" value={`${tailnetPublishSummary.label} · ${tailnetPublishSummary.value}`} />
                        {tailnetPublishSummary.detail ? (
                          <p className={cx('text-[12px]', tailnetPublishSummary.className)}>{tailnetPublishSummary.detail}</p>
                        ) : null}
                      </div>
                      {workspaceServerState?.tailnetWebsocketUrl ? (
                        <ValueRow
                          label={labelDesktopWorkspaceServerTailnetUrl(workspaceServerState)}
                          value={workspaceServerState.tailnetWebsocketUrl}
                          actionLabel="Copy"
                          onAction={() => {
                            void handleCopyValue(labelDesktopWorkspaceServerTailnetUrl(workspaceServerState), workspaceServerState.tailnetWebsocketUrl ?? '');
                          }}
                        />
                      ) : null}
                      <ValueRow label="Log file" value={workspaceServerLogPath} actionLabel="Open" onAction={() => { void handleOpenWorkspaceServerLog(); }} />
                    </div>
                  ) : null}

                  {workspaceServerState?.error ? <p className="text-[12px] text-danger">{workspaceServerState.error}</p> : null}

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => { void handleSaveWorkspaceServer(); }}
                      disabled={action !== null}
                      className={ACTION_BUTTON_CLASS}
                    >
                      {action === 'save-workspace-server' ? 'Saving…' : 'Save'}
                    </button>
                    <button
                      type="button"
                      onClick={() => { void refreshHostingState().catch((nextError) => setError(nextError instanceof Error ? nextError.message : String(nextError))); }}
                      disabled={action !== null}
                      className={ACTION_BUTTON_CLASS}
                    >
                      Refresh
                    </button>
                  </div>

                  <details className="border-t border-border-subtle pt-4">
                    <summary className="cursor-pointer text-[13px] font-medium text-primary">Litter SSH shim</summary>
                    <div className="mt-3 space-y-3">
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
                  </details>
                </div>
              </section>

              <section className="space-y-3 border-b border-border-subtle pb-6">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-[15px] font-medium text-primary">Saved remotes</h3>
                  {!localHostActive ? (
                    <ToolbarButton onClick={() => { void handleConnect('local'); }} disabled={action !== null}>Use this desktop</ToolbarButton>
                  ) : null}
                </div>

                {remoteHosts.length > 0 ? (
                  <div className="space-y-px">
                    {remoteHosts.map((host) => {
                      const active = host.id === connections.activeHostId;
                      const isDefault = host.id === connections.defaultHostId;
                      return (
                        <div key={host.id} className={cx('ui-list-row gap-3 px-3 py-3', active ? 'bg-surface/60' : 'ui-list-row-hover')}>
                          <div className="min-w-0 flex-1 space-y-1">
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                              <span className="text-[13px] font-medium text-primary">{host.label}</span>
                              <span className="ui-card-meta">{hostKindLabel(host)}</span>
                              {active ? <span className="ui-card-meta">active</span> : null}
                              {isDefault ? <span className="ui-card-meta">launch default</span> : null}
                            </div>
                            <p className="ui-card-meta break-all">{formatDesktopHostDetails(host)}</p>
                          </div>
                          <div className="flex flex-wrap items-center justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => { void handleOpenWindow(host.id); }}
                              disabled={action !== null}
                              className={ACTION_BUTTON_CLASS}
                            >
                              {action === 'open' ? 'Opening…' : 'Open window'}
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
                              {action === 'delete' ? 'Deleting…' : 'Delete'}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="rounded-2xl bg-base/35 px-4 py-4">
                    <p className="ui-card-meta">No saved remotes yet.</p>
                  </div>
                )}
              </section>

              {showEditor ? (
                <section className="space-y-4 border-b border-border-subtle pb-6">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-[15px] font-medium text-primary">{editorMode === 'existing' ? 'Edit remote' : 'New remote'}</h3>
                    <ToolbarButton onClick={resetEditor} disabled={action !== null}>Hide</ToolbarButton>
                  </div>

                  <div className="space-y-4 rounded-2xl bg-base/35 px-4 py-4">
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
                        <div className="space-y-2 min-w-0">
                          <label className="ui-card-meta" htmlFor="desktop-modal-host-base-url">WebSocket URL</label>
                          <input
                            id="desktop-modal-host-base-url"
                            value={draft.websocketUrl}
                            onChange={(event) => setDraft((current) => ({ ...current, websocketUrl: event.target.value }))}
                            disabled={action !== null}
                            className={`${INPUT_CLASS} font-mono text-[13px]`}
                            autoComplete="off"
                            spellCheck={false}
                            placeholder="wss://my-machine.tailnet.ts.net/codex/codex"
                          />
                        </div>
                        <div className="space-y-2 min-w-0">
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
                        <div className="space-y-2 min-w-0">
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

                    <label className="inline-flex items-center gap-3 text-[14px] text-primary" htmlFor="desktop-modal-host-auto-connect">
                      <input
                        id="desktop-modal-host-auto-connect"
                        type="checkbox"
                        checked={draft.autoConnect}
                        onChange={(event) => setDraft((current) => ({ ...current, autoConnect: event.target.checked }))}
                        disabled={action !== null}
                        className={CHECKBOX_CLASS}
                      />
                      <span>Use on launch</span>
                    </label>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => { void handleSave(); }}
                      disabled={action !== null}
                      className={ACTION_BUTTON_CLASS}
                    >
                      {action === 'save' ? 'Saving…' : editorMode === 'existing' ? 'Save remote' : 'Add remote'}
                    </button>
                    {editorMode === 'existing' ? (
                      <button
                        type="button"
                        onClick={startNewHostDraft}
                        disabled={action !== null}
                        className={ACTION_BUTTON_CLASS}
                      >
                        New remote
                      </button>
                    ) : null}
                  </div>
                </section>
              ) : null}

              <section className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-[15px] font-medium text-primary">Activity</h3>
                  {activity.length > 0 ? (
                    <ToolbarButton onClick={() => setActivity([])} disabled={action !== null}>Clear</ToolbarButton>
                  ) : null}
                </div>

                <div className="rounded-2xl border border-border-subtle bg-base/35 px-4 py-4" aria-live="polite">
                  {activity.length > 0 ? (
                    <ol className="space-y-2 font-mono text-[12px] text-primary">
                      {activity.map((entry) => (
                        <li key={entry.id} className="flex items-start gap-3">
                          <span className="shrink-0 text-secondary">{formatActivityTime(entry.timestamp)}</span>
                          <span className={cx(
                            'min-w-0 break-words',
                            entry.tone === 'success' && 'text-success',
                            entry.tone === 'error' && 'text-danger',
                          )}
                          >
                            {entry.message}
                          </span>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p className="ui-card-meta">No recent activity.</p>
                  )}
                </div>
              </section>
            </div>
          ) : null}

          {notice ? <p className="mt-4 text-[12px] text-success" aria-live="polite">{notice}</p> : null}
          {error ? <p className="mt-4 text-[12px] text-danger" aria-live="polite">{error}</p> : null}
        </div>
      </div>
    </div>
  );
}

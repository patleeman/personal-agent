import { useEffect, useMemo, useState } from 'react';
import { getDesktopBridge, readDesktopConnections } from '../desktop/desktopBridge';
import type { DesktopConnectionsState, DesktopHostRecord } from '../shared/types';
import { ToolbarButton } from './ui';

const INPUT_CLASS = 'w-full rounded-xl border border-border-subtle bg-surface/70 px-3.5 py-2.5 text-[14px] text-primary shadow-sm transition-colors focus:border-accent/50 focus:bg-surface focus:outline-none disabled:opacity-50';
const ACTION_BUTTON_CLASS = 'ui-toolbar-button';

interface DesktopHostDraft {
  id: string;
  label: string;
  sshTarget: string;
}

function createDesktopHostDraft(host?: Extract<DesktopHostRecord, { kind: 'ssh' }>): DesktopHostDraft {
  return {
    id: host?.id ?? '',
    label: host?.label ?? '',
    sshTarget: host?.sshTarget ?? '',
  };
}

function formatDesktopHostDetails(host: Extract<DesktopHostRecord, { kind: 'ssh' }>): string {
  return host.sshTarget;
}

export function DesktopConnectionsModal({
  onClose,
}: {
  onClose: () => void;
}) {
  const [connections, setConnections] = useState<DesktopConnectionsState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedHostId, setSelectedHostId] = useState('');
  const [editorMode, setEditorMode] = useState<'new' | 'existing'>('new');
  const [draft, setDraft] = useState<DesktopHostDraft>(() => createDesktopHostDraft());
  const [action, setAction] = useState<'save' | 'delete' | null>(null);

  const selectedHost = useMemo(
    () => connections?.hosts.find((host) => host.id === selectedHostId) ?? null,
    [connections, selectedHostId],
  );

  useEffect(() => {
    const bridge = getDesktopBridge();
    if (!bridge) {
      setLoading(false);
      setError('Desktop bridge unavailable. Restart the desktop app and try again.');
      return;
    }

    let cancelled = false;
    void readDesktopConnections()
      .then((nextConnections) => {
        if (cancelled) {
          return;
        }

        setConnections(nextConnections);
        const firstHost = nextConnections.hosts[0];
        if (firstHost) {
          setSelectedHostId(firstHost.id);
          setEditorMode('existing');
          setDraft(createDesktopHostDraft(firstHost));
        } else {
          setEditorMode('new');
          setDraft(createDesktopHostDraft());
        }
      })
      .catch((nextError) => {
        if (!cancelled) {
          setError(nextError instanceof Error ? nextError.message : String(nextError));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  function beginNewRemote() {
    setEditorMode('new');
    setSelectedHostId('');
    setDraft(createDesktopHostDraft());
    setError(null);
    setNotice(null);
  }

  function selectRemote(host: Extract<DesktopHostRecord, { kind: 'ssh' }>) {
    setEditorMode('existing');
    setSelectedHostId(host.id);
    setDraft(createDesktopHostDraft(host));
    setError(null);
    setNotice(null);
  }

  async function handleSave() {
    const bridge = getDesktopBridge();
    if (!bridge) {
      setError('Desktop bridge unavailable. Restart the desktop app and try again.');
      return;
    }

    const id = draft.id.trim();
    const label = draft.label.trim();
    const sshTarget = draft.sshTarget.trim();
    if (!id || !label || !sshTarget) {
      setError('Host id, label, and SSH target are required.');
      return;
    }

    setAction('save');
    setError(null);
    setNotice(null);
    try {
      const nextConnections = await bridge.saveHost({
        id,
        label,
        kind: 'ssh',
        sshTarget,
      });
      setConnections(nextConnections);
      setSelectedHostId(id);
      setEditorMode('existing');
      setDraft({ id, label, sshTarget });
      setNotice(editorMode === 'existing' ? 'SSH remote saved.' : 'SSH remote added.');
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setAction(null);
    }
  }

  async function handleDelete(hostId: string) {
    const bridge = getDesktopBridge();
    if (!bridge) {
      setError('Desktop bridge unavailable. Restart the desktop app and try again.');
      return;
    }

    setAction('delete');
    setError(null);
    setNotice(null);
    try {
      const nextConnections = await bridge.deleteHost(hostId);
      setConnections(nextConnections);
      const nextHost = nextConnections.hosts[0];
      if (nextHost) {
        setSelectedHostId(nextHost.id);
        setEditorMode('existing');
        setDraft(createDesktopHostDraft(nextHost));
      } else {
        beginNewRemote();
      }
      setNotice('SSH remote deleted.');
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setAction(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4 py-6 backdrop-blur-sm">
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-3xl border border-border-subtle bg-base shadow-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-border-subtle px-6 py-4">
          <div>
            <h2 className="text-[20px] font-semibold text-primary">Connections</h2>
            <p className="mt-1 text-[12px] text-secondary">SSH remotes only. Personal Agent copies Pi and a transient helper to the remote when a conversation targets it.</p>
          </div>
          <div className="flex items-center gap-2">
            <ToolbarButton onClick={beginNewRemote} disabled={action !== null}>New remote</ToolbarButton>
            <ToolbarButton onClick={onClose}>Close</ToolbarButton>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {loading ? <p className="ui-card-meta">Loading SSH remotes…</p> : null}
          {error ? <p className="mb-4 text-[12px] text-danger">{error}</p> : null}
          {notice ? <p className="mb-4 text-[12px] text-accent">{notice}</p> : null}

          <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,24rem)]">
            <section className="space-y-4">
              <div className="space-y-1">
                <h3 className="text-[15px] font-medium text-primary">Saved remotes</h3>
                <p className="ui-card-meta">Use SSH host aliases or full <span className="font-mono text-[11px]">user@host</span> targets.</p>
              </div>

              {connections && connections.hosts.length > 0 ? (
                <div className="space-y-px">
                  {connections.hosts.map((host) => {
                    const selected = host.id === selectedHostId;
                    return (
                      <div key={host.id} className={`ui-list-row px-3 py-3 ${selected ? 'ui-list-row-selected' : ''}`}>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-[13px] font-medium text-primary">{host.label}</span>
                            <span className="ui-card-meta">ssh</span>
                          </div>
                          <p className="ui-card-meta mt-1 break-all">{formatDesktopHostDetails(host)}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <button type="button" className={ACTION_BUTTON_CLASS} onClick={() => { selectRemote(host); }} disabled={action !== null}>Edit</button>
                          <button type="button" className={ACTION_BUTTON_CLASS} onClick={() => { void handleDelete(host.id); }} disabled={action !== null}>Delete</button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="ui-card-meta">No SSH remotes saved yet.</p>
              )}
            </section>

            <section className="space-y-4">
              <div className="space-y-1">
                <h3 className="text-[15px] font-medium text-primary">{editorMode === 'existing' ? 'Edit SSH remote' : 'New SSH remote'}</h3>
                <p className="ui-card-meta">The desktop app stays local. Remote execution happens per conversation through SSH.</p>
              </div>

              <div className="space-y-4">
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
                    placeholder="bender"
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
                    placeholder="Bender"
                  />
                </div>
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
              </div>

              <div className="rounded-2xl border border-border-subtle bg-surface px-4 py-4 text-[12px] text-secondary">
                <p>When the first remote conversation starts, the desktop app will:</p>
                <ul className="mt-2 space-y-1 pl-4">
                  <li>copy the matching Pi release binary to the remote cache,</li>
                  <li>copy a transient helper binary,</li>
                  <li>start a detached remote Pi runtime, and</li>
                  <li>reconnect to that runtime over SSH when needed.</li>
                </ul>
                <p className="mt-3 text-[11px] text-secondary">Use the conversation footer to browse the remote filesystem and watch live copy/launch status during the first connection.</p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => { void handleSave(); }} disabled={action !== null} className={ACTION_BUTTON_CLASS}>
                  {action === 'save' ? 'Saving…' : editorMode === 'existing' ? 'Save remote' : 'Add remote'}
                </button>
                {editorMode === 'existing' && selectedHost ? (
                  <button type="button" onClick={beginNewRemote} disabled={action !== null} className={ACTION_BUTTON_CLASS}>New remote</button>
                ) : null}
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}

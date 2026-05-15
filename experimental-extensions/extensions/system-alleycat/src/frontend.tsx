import type { NativeExtensionClient } from '@personal-agent/extensions';
import { useCallback, useEffect, useMemo, useState } from 'react';

interface AlleycatPairPayload {
  v: 1;
  node_id: string;
  token: string;
  relay: string | null;
}

interface AlleycatStatus {
  running: boolean;
  port: number | null;
  pairPayload: AlleycatPairPayload | null;
  agents: Array<{ name: string; display_name: string; wire: string; available: boolean }>;
  implementation: string;
  sidecarRunning: boolean;
  logs: string[];
  note: string;
}

interface AlleycatSettingsPanelProps {
  pa: NativeExtensionClient;
}

const SECTION = 'mb-6';
const LABEL = 'mb-1.5 text-[12px] font-medium text-secondary';
const MONO = 'w-full rounded-lg border border-border-subtle bg-surface/70 px-3 py-2 font-mono text-[12px] leading-5 text-primary';
const BUTTON = 'ui-toolbar-button rounded-lg px-3 py-1.5 text-[12px] font-medium shadow-none transition-colors active:scale-[0.97]';
const NOTE = 'mt-1 text-[11px] leading-relaxed text-tertiary';
const CALLOUT = 'rounded-lg bg-surface/60 px-3 py-2 text-[12px] leading-relaxed text-secondary';

function shortNodeId(nodeId: string): string {
  return nodeId.length <= 18 ? nodeId : `${nodeId.slice(0, 8)}…${nodeId.slice(-8)}`;
}

export function AlleycatSettingsPanel({ pa }: AlleycatSettingsPanelProps) {
  return <AlleycatPanel pa={pa} />;
}

function AlleycatPanel({ pa }: AlleycatSettingsPanelProps) {
  const [status, setStatus] = useState<AlleycatStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setStatus((await pa.extension.invoke('status')) as AlleycatStatus);
    } finally {
      setLoading(false);
    }
  }, [pa]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const pairPayloadJson = useMemo(() => {
    if (!status?.pairPayload) return '';
    return JSON.stringify(status.pairPayload, null, 2);
  }, [status?.pairPayload]);
  const pairPayloadReady = Boolean(status?.pairPayload?.node_id && status.pairPayload.node_id !== 'sidecar-not-running');
  const qrCodeUrl =
    pairPayloadJson && pairPayloadReady
      ? `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(pairPayloadJson)}`
      : null;

  async function invoke(action: 'rotateToken') {
    setBusy(true);
    try {
      const result = (await pa.extension.invoke(action)) as AlleycatStatus | { ok: true };
      if ('running' in result) setStatus(result);
      else await refresh();
    } catch (error) {
      pa.ui.notify({
        type: 'error',
        message: `Alleycat ${action} failed`,
        details: error instanceof Error ? error.message : String(error),
        source: 'system-alleycat',
      });
    } finally {
      setBusy(false);
    }
  }

  async function copyPairPayload() {
    if (!pairPayloadJson) return;
    await navigator.clipboard.writeText(pairPayloadJson).catch(() => undefined);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  if (loading) return <p className="text-[13px] text-tertiary">Loading Alleycat host status…</p>;

  return (
    <div>
      <div className={SECTION}>
        <div className={LABEL}>Setup</div>
        <div className={CALLOUT}>
          <div className="font-medium text-primary">Use the Kitty Litter iOS app — not the Kitty Litter npm host.</div>
          <ol className="mt-2 list-decimal space-y-1 pl-4">
            <li>Enable this extension in Personal Agent; the companion host starts automatically.</li>
            <li>Open Kitty Litter on your phone and scan this QR code.</li>
            <li>Select Personal Agent. It should be the only advertised agent.</li>
          </ol>
          <p className="mt-2 text-tertiary">
            Disable the extension to stop the host. Do not install or run <span className="font-mono">npx kittylitter</span>; that starts
            the upstream host and advertises its built-in agents.
          </p>
        </div>
      </div>

      <div className={SECTION}>
        <div className={LABEL}>Host status</div>
        <div className="flex items-center gap-2 text-[13px] text-primary">
          <span className={`inline-block h-2 w-2 rounded-full ${status?.running ? 'bg-success' : 'bg-danger'}`} />
          <span>{status?.running ? 'Running' : 'Stopped'}</span>
          {status?.port ? <span className="text-tertiary">local compat port {status.port}</span> : null}
          {status?.implementation ? <span className="text-tertiary">· {status.implementation}</span> : null}
        </div>
        <p className={NOTE}>{status?.note}</p>
      </div>

      <div className={SECTION}>
        <div className={LABEL}>Advertised agents</div>
        <div className="space-y-2">
          {(status?.agents ?? []).map((agent) => (
            <div key={agent.name} className="flex items-center justify-between gap-3 rounded-lg bg-surface/60 px-3 py-2">
              <div>
                <div className="text-[13px] font-medium text-primary">{agent.display_name}</div>
                <div className="font-mono text-[11px] text-tertiary">
                  {agent.name} · {agent.wire}
                </div>
              </div>
              <div className={agent.available ? 'text-[12px] text-success' : 'text-[12px] text-tertiary'}>
                {agent.available ? 'Available' : 'Unavailable'}
              </div>
            </div>
          ))}
        </div>
      </div>

      {status?.pairPayload && pairPayloadReady ? (
        <div className={SECTION}>
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
            <div>
              <div className={LABEL}>Pairing QR</div>
              {qrCodeUrl ? (
                <img
                  src={qrCodeUrl}
                  alt="Alleycat pairing QR code"
                  className="h-[180px] w-[180px] rounded-lg border border-border-subtle"
                />
              ) : null}
              <p className={NOTE}>
                Node {shortNodeId(status.pairPayload.node_id)} · relay {status.pairPayload.relay ?? 'default'}
              </p>
            </div>
            <details className="self-start">
              <summary className="cursor-pointer text-[12px] font-medium text-secondary hover:text-primary">Pair payload</summary>
              <textarea
                readOnly
                className={`${MONO} mt-2 min-h-[9rem] resize-none`}
                value={pairPayloadJson}
                onClick={(event) => event.currentTarget.select()}
              />
            </details>
          </div>
        </div>
      ) : null}

      {status?.logs?.length ? (
        <details className={SECTION}>
          <summary className="cursor-pointer text-[12px] font-medium text-secondary hover:text-primary">Host logs</summary>
          <pre className={`${MONO} mt-2 max-h-40 overflow-auto whitespace-pre-wrap`}>{status.logs.slice(-12).join('\n')}</pre>
        </details>
      ) : null}

      <div className={SECTION}>
        <div className="flex flex-wrap gap-2">
          <button className={BUTTON} disabled={busy || !status?.pairPayload} onClick={() => void copyPairPayload()}>
            {copied ? 'Copied' : 'Copy pair payload'}
          </button>
          <button className={BUTTON} disabled={busy} onClick={() => void invoke('rotateToken')}>
            Rotate token
          </button>
          <button className={BUTTON} disabled={busy} onClick={refresh}>
            Refresh
          </button>
        </div>
      </div>
    </div>
  );
}

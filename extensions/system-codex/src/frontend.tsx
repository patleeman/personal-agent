import { type NativeExtensionClient } from '@personal-agent/extensions';
import { useCallback, useEffect, useState } from 'react';

// ── Types ──────────────────────────────────────────────────────────────────

interface CodexStatus {
  running: boolean;
  port: number | null;
  token: string | null;
}

interface CodexSettingsPanelProps {
  pa: NativeExtensionClient;
  settingsContext?: { extensionId?: string };
}

// ── Styles ─────────────────────────────────────────────────────────────────

const SECTION_CLASS = 'mb-6';
const LABEL_CLASS = 'mb-1.5 text-[12px] font-medium text-secondary';
const VALUE_CLASS = 'w-full rounded-lg border border-border-subtle bg-surface/70 px-3 py-2 text-[13px] text-primary font-mono shadow-none';
const BUTTON_CLASS = 'ui-toolbar-button rounded-lg px-3 py-1.5 text-[12px] font-medium shadow-none transition-colors active:scale-[0.97]';
const NOTE_CLASS = 'mt-1 text-[11px] text-tertiary leading-relaxed';

// ── Component ──────────────────────────────────────────────────────────────

export function CodexSettingsPanel({ pa }: CodexSettingsPanelProps) {
  const [status, setStatus] = useState<CodexStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const result = (await pa.extension.invoke('status')) as CodexStatus;
      setStatus(result);
    } catch {
      setStatus({ running: false, port: null, token: null });
    } finally {
      setLoading(false);
    }
  }, [pa]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleRotate = async () => {
    try {
      const result = (await pa.extension.invoke('rotateToken')) as { token: string };
      setStatus((s) => (s ? { ...s, token: result.token } : s));
    } catch (err) {
      console.error('Failed to rotate token:', err);
      pa.ui.notify({
        type: 'error',
        message: 'Failed to rotate token',
        details: err instanceof Error ? err.message : String(err),
        source: 'system-codex',
      });
    }
  };

  const handleCopy = async () => {
    if (status?.token) {
      try {
        await navigator.clipboard.writeText(status.token);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {
        // Fallback for environments without clipboard API
      }
    }
  };

  const qrCodeUrl = status?.token
    ? `https://api.qrserver.com/v1/create-qr-code/?size=256x256&data=${encodeURIComponent(status.token)}`
    : null;

  if (loading) {
    return (
      <div className={SECTION_CLASS}>
        <p className="text-[13px] text-tertiary">Loading server status…</p>
      </div>
    );
  }

  return (
    <div>
      {/* Server status */}
      <div className={SECTION_CLASS}>
        <div className={LABEL_CLASS}>Server status</div>
        <div className="flex items-center gap-2">
          <span className={`inline-block h-2 w-2 rounded-full ${status?.running ? 'bg-green-500' : 'bg-red-500'}`} />
          <span className="text-[13px] text-primary">{status?.running ? 'Running' : 'Stopped'}</span>
          {status?.running && status.port && (
            <span className="text-[13px] text-tertiary">
              on port <span className="font-mono">{status.port}</span>
            </span>
          )}
        </div>
      </div>

      {/* Auth token */}
      <div className={SECTION_CLASS}>
        <div className={LABEL_CLASS}>Auth token</div>
        {status?.token ? (
          <>
            <div className="flex gap-2">
              <input
                type="text"
                readOnly
                className={VALUE_CLASS}
                value={status.token}
                onClick={(e) => (e.target as HTMLInputElement).select()}
              />
              <button className={`${BUTTON_CLASS} ${copied ? 'bg-accent/20 text-accent' : ''}`} onClick={handleCopy}>
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <p className={NOTE_CLASS}>
              Use this token in your Codex client (e.g. Litter) as the Bearer token when connecting to{' '}
              <span className="font-mono">ws://&lt;this-computer&gt;:{status.port}</span>
            </p>
          </>
        ) : (
          <p className="text-[13px] text-tertiary">Server not running</p>
        )}
      </div>

      {/* QR code */}
      {qrCodeUrl && (
        <div className={SECTION_CLASS}>
          <div className={LABEL_CLASS}>Pair from phone</div>
          <p className={NOTE_CLASS}>Scan this QR code with your phone to automatically configure the connection:</p>
          <div className="mt-2 flex justify-center">
            <img
              src={qrCodeUrl}
              alt="Pairing QR code"
              className="rounded-lg border border-border-subtle"
              style={{ width: 180, height: 180 }}
            />
          </div>
        </div>
      )}

      {/* Controls */}
      <div className={SECTION_CLASS}>
        <div className="flex gap-2">
          {status?.running ? (
            <button className={`${BUTTON_CLASS} bg-red-500/10 text-red-500 hover:bg-red-500/20`} onClick={handleRotate}>
              Rotate token
            </button>
          ) : null}
          <button className={`${BUTTON_CLASS} bg-accent/10 text-accent hover:bg-accent/20`} onClick={refresh}>
            Refresh
          </button>
        </div>
      </div>
    </div>
  );
}

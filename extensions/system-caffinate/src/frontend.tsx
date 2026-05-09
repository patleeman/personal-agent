import { type NativeExtensionClient } from '@personal-agent/extensions';
import { useEffect, useRef, useState } from 'react';

interface PowerState {
  keepAwake: boolean;
  supported: boolean;
  active: boolean;
  error?: string;
  daemonConnected: boolean;
}

const POLL_MS = 30_000;

function CaffeineIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2.5 2.5v6a3 3 0 0 0 3 3h3a3 3 0 0 0 3-3v-6Z" />
      <path d="M11.5 4.5h1a1.5 1.5 0 0 1 0 3h-1" />
      <path d="M5 13.5h4" />
      <path d="M7 13.5v-2" />
    </svg>
  );
}

export function CaffeineIndicator({ pa }: { pa: NativeExtensionClient }) {
  const [power, setPower] = useState<PowerState | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;

    async function fetchPower() {
      try {
        const result = (await pa.extension.invoke('readPowerState')) as PowerState;
        if (mountedRef.current) {
          setPower(result);
        }
      } catch {
        if (mountedRef.current) {
          setPower(null);
        }
      }
    }

    void fetchPower();

    function poll() {
      pollTimer = setTimeout(async () => {
        await fetchPower();
        if (mountedRef.current) {
          poll();
        }
      }, POLL_MS);
    }

    poll();

    return () => {
      mountedRef.current = false;
      if (pollTimer !== null) {
        clearTimeout(pollTimer);
      }
    };
  }, []);

  const caffinating = power?.keepAwake === true && power?.active === true;
  const tooltip = caffinating
    ? 'Idle system sleep is blocked. Display sleep is still allowed.'
    : power?.keepAwake === true
      ? `Keep-awake is enabled but inactive${power?.error ? `: ${power.error}` : ''}.`
      : power?.keepAwake === false && power?.daemonConnected
        ? null
        : power?.error
          ? `Keep-awake: ${power.error}`
          : null;

  if (power === null || !power.keepAwake) {
    return null;
  }

  return (
    <div
      className="ui-desktop-top-bar__icon-button ui-desktop-top-bar__caffeine-indicator"
      style={{
        color: caffinating ? 'rgb(var(--color-accent))' : undefined,
      }}
      aria-label={caffinating ? 'Caffinating — system sleep blocked' : 'Keep-awake enabled'}
      title={tooltip ?? ''}
    >
      <CaffeineIcon />
    </div>
  );
}

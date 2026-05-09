import { useEffect, useState } from 'react';

export function CaffeineHeaderIndicator({ pa }: { pa: { extension: { invoke(actionId: string, input?: unknown): Promise<unknown> } } }) {
  const [active, setActive] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timeout: ReturnType<typeof setTimeout>;

    async function check() {
      try {
        const state = (await pa.extension.invoke('readPowerState')) as { keepAwake?: boolean };
        if (!cancelled) setActive(Boolean(state.keepAwake));
      } catch {
        if (!cancelled) setActive(false);
      }
      if (!cancelled) timeout = setTimeout(check, 30000);
    }

    check();
    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [pa]);

  if (!active) return null;

  return (
    <span
      className="inline-flex items-center gap-1 rounded-md bg-amber/10 px-2 py-0.5 text-[10px] font-medium text-amber"
      title="Keep awake is active"
    >
      <svg
        width="10"
        height="10"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
      </svg>
      Keep awake
    </span>
  );
}

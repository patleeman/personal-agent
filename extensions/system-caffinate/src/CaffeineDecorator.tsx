import { useEffect, useState } from 'react';

export function CaffeineDecorator({
  pa,
  session,
}: {
  pa: { extension: { invoke(actionId: string, input?: unknown): Promise<unknown> } };
  session: { id: string };
}) {
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
      className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center text-amber"
      title="Keep awake active"
      aria-label="Keep awake active"
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
      </svg>
    </span>
  );
}

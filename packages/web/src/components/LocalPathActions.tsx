import { useState } from 'react';
import { api } from '../api';
import { looksLikeLocalFilesystemPath } from '../localPaths';
import { cx } from './ui';

const ACTION_BUTTON_CLASS = 'text-[12px] text-accent hover:text-accent/70 transition-colors disabled:opacity-40';
const INLINE_CODE_CLASS = 'font-mono text-[0.82em] bg-elevated px-1 py-0.5 rounded text-accent';

async function copyTextToClipboard(text: string): Promise<boolean> {
  if (typeof navigator === 'undefined' || typeof navigator.clipboard?.writeText !== 'function') {
    return false;
  }

  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function scheduleReset(callback: () => void, delayMs = 1_500): void {
  window.setTimeout(callback, delayMs);
}

export function LocalPathActions({
  path,
  className,
  compact = false,
}: {
  path: string;
  className?: string;
  compact?: boolean;
}) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [openState, setOpenState] = useState<'idle' | 'opening' | 'opened' | 'failed'>('idle');

  async function handleCopy() {
    const didCopy = await copyTextToClipboard(path);
    setCopyState(didCopy ? 'copied' : 'failed');
    scheduleReset(() => setCopyState('idle'));
  }

  async function handleOpen() {
    if (openState === 'opening') {
      return;
    }

    setOpenState('opening');
    try {
      await api.openLocalPath(path);
      setOpenState('opened');
    } catch (error) {
      console.error('Failed to open local path', error);
      setOpenState('failed');
    } finally {
      scheduleReset(() => setOpenState('idle'));
    }
  }

  const copyLabel = copyState === 'copied'
    ? 'Copied'
    : copyState === 'failed'
      ? 'Failed'
      : compact
        ? 'Copy'
        : 'Copy path';
  const openLabel = openState === 'opening'
    ? 'Opening…'
    : openState === 'opened'
      ? 'Opened'
      : openState === 'failed'
        ? 'Failed'
        : 'Open';

  return (
    <span className={cx('flex items-center gap-3', className)}>
      <button
        type="button"
        onClick={() => { void handleOpen(); }}
        className={ACTION_BUTTON_CLASS}
        disabled={openState === 'opening'}
        title={path}
      >
        {openLabel}
      </button>
      <button
        type="button"
        onClick={() => { void handleCopy(); }}
        className={ACTION_BUTTON_CLASS}
        title={path}
      >
        {copyLabel}
      </button>
    </span>
  );
}

export function InlineLocalPath({
  path,
  className,
}: {
  path: string;
  className?: string;
}) {
  if (!looksLikeLocalFilesystemPath(path)) {
    return <code className={INLINE_CODE_CLASS}>{path}</code>;
  }

  return (
    <span className={cx('inline-flex items-center gap-2 align-baseline', className)}>
      <code className={INLINE_CODE_CLASS}>{path}</code>
      <LocalPathActions path={path} compact className="gap-2" />
    </span>
  );
}

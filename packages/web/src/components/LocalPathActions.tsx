import React, { useState } from 'react';
import { api } from '../api';
import { looksLikeLocalFilesystemPath } from '../localPaths';
import { cx } from './ui';

const ACTION_BUTTON_CLASS = 'text-[12px] text-accent hover:text-accent/70 transition-colors disabled:opacity-40';
const COMPACT_ACTION_BUTTON_CLASS = 'inline-flex items-center rounded-md border border-border-subtle bg-surface px-2 py-1 text-[11px] font-medium text-secondary transition-colors hover:border-border-default hover:bg-elevated hover:text-primary disabled:opacity-40';
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

  const buttonClassName = compact ? COMPACT_ACTION_BUTTON_CLASS : ACTION_BUTTON_CLASS;

  return (
    <span className={cx('flex items-center', compact ? 'gap-1.5' : 'gap-3', className)}>
      <button
        type="button"
        onClick={() => { void handleOpen(); }}
        className={buttonClassName}
        disabled={openState === 'opening'}
        title={path}
      >
        {openLabel}
      </button>
      <button
        type="button"
        onClick={() => { void handleCopy(); }}
        className={buttonClassName}
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
    <span className={cx('group relative inline-flex align-baseline', className)}>
      <code
        className={cx(
          INLINE_CODE_CLASS,
          'cursor-default transition-colors group-hover:bg-surface group-focus-within:bg-surface',
        )}
        title={path}
      >
        {path}
      </code>
      <span
        role="tooltip"
        className={cx(
          'pointer-events-none invisible absolute left-0 top-full z-30 mt-3 whitespace-nowrap opacity-0 translate-y-1 transition-all duration-150',
          'group-hover:pointer-events-auto group-hover:visible group-hover:opacity-100 group-hover:translate-y-0',
          'group-focus-within:pointer-events-auto group-focus-within:visible group-focus-within:opacity-100 group-focus-within:translate-y-0',
        )}
      >
        <span className="relative flex min-w-[10rem] flex-col gap-1.5 rounded-xl border border-border-default bg-elevated/95 px-2.5 py-2 shadow-[0_14px_30px_rgba(0,0,0,0.32)] ring-1 ring-black/10 backdrop-blur">
          <span aria-hidden="true" className="absolute left-3 top-0 h-2.5 w-2.5 -translate-y-1/2 rotate-45 border-l border-t border-border-default bg-elevated/95" />
          <span className="relative text-[10px] uppercase tracking-[0.14em] text-dim/70">Path actions</span>
          <LocalPathActions path={path} compact />
        </span>
      </span>
    </span>
  );
}

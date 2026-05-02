import { useEffect, useRef, useState } from 'react';

import { cx } from '../ui';

export function MessageActions({
  isUser,
  copyText,
  onFork,
  onRewind,
}: {
  isUser?: boolean;
  copyText?: string;
  onFork?: () => Promise<void> | void;
  onRewind?: () => Promise<void> | void;
}) {
  const [isForking, setIsForking] = useState(false);
  const [isRewinding, setIsRewinding] = useState(false);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const copyResetTimeoutRef = useRef<number | null>(null);
  const canCopy = !isUser && typeof copyText === 'string' && copyText.length > 0;

  useEffect(
    () => () => {
      if (copyResetTimeoutRef.current !== null) {
        window.clearTimeout(copyResetTimeoutRef.current);
      }
    },
    [],
  );

  function setTransientCopyState(nextState: 'copied' | 'failed') {
    if (copyResetTimeoutRef.current !== null) {
      window.clearTimeout(copyResetTimeoutRef.current);
    }

    setCopyState(nextState);
    copyResetTimeoutRef.current = window.setTimeout(() => {
      setCopyState('idle');
      copyResetTimeoutRef.current = null;
    }, 1200);
  }

  async function handleFork() {
    if (!onFork || isForking) {
      return;
    }

    try {
      setIsForking(true);
      await onFork();
    } finally {
      setIsForking(false);
    }
  }

  async function handleRewind() {
    if (!onRewind || isRewinding) {
      return;
    }

    try {
      setIsRewinding(true);
      await onRewind();
    } finally {
      setIsRewinding(false);
    }
  }

  async function handleCopy() {
    if (!canCopy) {
      return;
    }

    if (typeof navigator === 'undefined' || typeof navigator.clipboard?.writeText !== 'function') {
      setTransientCopyState('failed');
      return;
    }

    try {
      await navigator.clipboard.writeText(copyText);
      setTransientCopyState('copied');
    } catch {
      setTransientCopyState('failed');
    }
  }

  return (
    <div
      className={`flex items-center gap-0 opacity-0 transition-opacity motion-reduce:transition-none group-hover:opacity-100 group-focus-within:opacity-100 ${
        isUser ? 'justify-start' : 'justify-end'
      }`}
    >
      {canCopy && (
        <button
          type="button"
          onClick={() => {
            void handleCopy();
          }}
          className={cx('ui-message-action-button', copyState === 'copied' && 'text-accent', copyState === 'failed' && 'text-danger')}
          title={copyState === 'failed' ? 'Copy to clipboard failed' : 'Copy this assistant message to the clipboard'}
        >
          {copyState === 'copied' ? '⎘ copied' : copyState === 'failed' ? '⎘ copy failed' : '⎘ copy'}
        </button>
      )}
      {onRewind && (
        <button
          type="button"
          onClick={() => {
            void handleRewind();
          }}
          className={cx('ui-message-action-button', isRewinding && 'text-accent')}
          title={
            isUser ? 'Rewind into a new conversation from this prompt' : 'Rewind into a new conversation from the prompt that led here'
          }
          disabled={isRewinding}
        >
          {isRewinding ? '↩ rewinding…' : '↩ rewind'}
        </button>
      )}
      {!isUser && onFork && (
        <button
          type="button"
          onClick={() => {
            void handleFork();
          }}
          className={cx('ui-message-action-button', isForking && 'text-accent')}
          title="Fork into a new conversation from here"
          disabled={isForking}
        >
          {isForking ? '⑂ forking…' : '⑂ fork'}
        </button>
      )}
    </div>
  );
}

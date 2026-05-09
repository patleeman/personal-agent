import { useEffect, useRef, useState } from 'react';

import { createNativeExtensionClient } from '../../extensions/nativePaClient';
import type { ExtensionMessageActionRegistration } from '../../extensions/useExtensionRegistry';
import { useExtensionRegistry } from '../../extensions/useExtensionRegistry';
import { cx } from '../ui';

/**
 * Simple `when` expression evaluator for message actions.
 * Supports predicates like "role:assistant && hasText".
 * If `when` is undefined or empty, the action always matches.
 */
function matchMessageActionWhen(
  action: ExtensionMessageActionRegistration,
  isUser: boolean | undefined,
  blockText: string | undefined,
): boolean {
  const expr = action.when;
  if (!expr) return true;

  const role = isUser ? 'user' : 'assistant';
  const hasText = typeof blockText === 'string' && blockText.length > 0;

  // Tokenize on && and evaluate each clause
  const clauses = expr.split(/\s*&&\s*/).filter(Boolean);
  for (const clause of clauses) {
    const trimmed = clause.trim();
    if (trimmed === 'hasText') {
      if (!hasText) return false;
    } else if (trimmed.startsWith('role:')) {
      const expectedRole = trimmed.slice(5);
      if (role !== expectedRole) return false;
    } else {
      // Unknown predicate — skip (fail open for forward compat)
    }
  }

  return true;
}

export function MessageActions({
  isUser,
  blockText,
  blockId,
  conversationId,
  copyText,
  onFork,
  onRewind,
}: {
  isUser?: boolean;
  blockText?: string;
  blockId?: string;
  conversationId?: string;
  copyText?: string;
  onFork?: () => Promise<void> | void;
  onRewind?: () => Promise<void> | void;
}) {
  const [isForking, setIsForking] = useState(false);
  const [isRewinding, setIsRewinding] = useState(false);
  const [busyActionIds, setBusyActionIds] = useState<Set<string>>(new Set());
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const copyResetTimeoutRef = useRef<number | null>(null);
  const canCopy = !isUser && typeof copyText === 'string' && copyText.length > 0;
  const { messageActions } = useExtensionRegistry();

  const extensionActionInvocations = useRef<Map<string, ReturnType<typeof createNativeExtensionClient>>>(new Map());
  function getPaClient(extensionId: string) {
    let client = extensionActionInvocations.current.get(extensionId);
    if (!client) {
      client = createNativeExtensionClient(extensionId);
      extensionActionInvocations.current.set(extensionId, client);
    }
    return client;
  }

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
      {messageActions.map((action) => {
        if (!matchMessageActionWhen(action, isUser, blockText)) return null;
        const busy = busyActionIds.has(action.id);
        return (
          <button
            key={action.id}
            type="button"
            onClick={() => {
              void (async () => {
                setBusyActionIds((prev) => new Set(prev).add(action.id));
                try {
                  await getPaClient(action.extensionId).extension.invoke(action.action, {
                    messageText: blockText ?? '',
                    messageRole: isUser ? 'user' : 'assistant',
                    blockId: blockId ?? '',
                    conversationId: conversationId ?? '',
                  });
                } finally {
                  setBusyActionIds((prev) => {
                    const next = new Set(prev);
                    next.delete(action.id);
                    return next;
                  });
                }
              })();
            }}
            className={cx('ui-message-action-button', busy && 'text-accent')}
            title={action.title}
            disabled={busy}
          >
            {action.title}
          </button>
        );
      })}
    </div>
  );
}

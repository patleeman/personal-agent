import { useEffect } from 'react';

export function hasBlockingConversationOverlay(): boolean {
  return Boolean(
    document.querySelector('.ui-overlay-backdrop') ||
    document.querySelector('[role="dialog"]') ||
    document.querySelector('[data-modal="true"]'),
  );
}

export function useEscapeAbortStream(input: {
  isStreaming: boolean;
  abort: () => Promise<void> | void;
  hasBlockingOverlay?: () => boolean;
}): void {
  const { isStreaming, abort } = input;
  const hasBlockingOverlay = input.hasBlockingOverlay ?? hasBlockingConversationOverlay;

  useEffect(() => {
    function handler(event: KeyboardEvent) {
      if (event.key !== 'Escape' || event.defaultPrevented) {
        return;
      }

      if (hasBlockingOverlay()) {
        return;
      }

      if (isStreaming) {
        event.preventDefault();
        void abort();
      }
    }

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [abort, hasBlockingOverlay, isStreaming]);
}

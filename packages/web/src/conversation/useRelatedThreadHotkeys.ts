import { useEffect } from 'react';
import type { RelatedConversationSearchResult } from './relatedConversationSearch';

export const MAX_RELATED_THREAD_HOTKEYS = 9;

type RelatedThreadHotkeyEvent = Pick<KeyboardEvent, 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey' | 'key' | 'code' | 'isComposing'>;

export function resolveRelatedThreadHotkeyIndex(event: RelatedThreadHotkeyEvent): number {
  if (event.isComposing || !event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) {
    return -1;
  }

  const codeMatch = event.code.match(/^Digit([1-9])$/);
  if (codeMatch) {
    return Number(codeMatch[1]) - 1;
  }

  return /^[1-9]$/.test(event.key) ? Number(event.key) - 1 : -1;
}

export function useRelatedThreadHotkeys(input: {
  enabled: boolean;
  results: RelatedConversationSearchResult[];
  onToggle: (sessionId: string) => void;
  hotkeyLimit?: number;
}): void {
  const { enabled, results, onToggle } = input;
  const hotkeyLimit = input.hotkeyLimit ?? MAX_RELATED_THREAD_HOTKEYS;

  useEffect(() => {
    if (!enabled || results.length === 0) {
      return;
    }

    function handleRelatedThreadHotkey(event: KeyboardEvent) {
      if (event.defaultPrevented) {
        return;
      }

      const hotkeyIndex = resolveRelatedThreadHotkeyIndex(event);
      if (hotkeyIndex < 0 || hotkeyIndex >= Math.min(results.length, hotkeyLimit)) {
        return;
      }

      const result = results[hotkeyIndex];
      if (!result) {
        return;
      }

      event.preventDefault();
      onToggle(result.sessionId);
    }

    window.addEventListener('keydown', handleRelatedThreadHotkey);
    return () => {
      window.removeEventListener('keydown', handleRelatedThreadHotkey);
    };
  }, [enabled, hotkeyLimit, onToggle, results]);
}

// Simple module-level event bus for knowledge base tree↔editor sync.
// Uses window custom events so it works across arbitrary component tree boundaries.

export type KBEventType =
  | 'kb:file-created'
  | 'kb:file-deleted'
  | 'kb:file-renamed'
  | 'kb:entries-changed' // catch-all for tree refresh
  | 'kb:content-saved'
  | 'kb:file-changed-externally' // file changed on disk via external editor
  | 'kb:close-active-file'
  | 'kb:reopen-closed-file';

export interface KBFileRenamedDetail {
  oldId: string;
  newId: string;
}
export interface KBFileCreatedDetail {
  id: string;
}
export interface KBFileDeletedDetail {
  id: string;
}

export function emitKBEvent(type: 'kb:file-renamed', detail: KBFileRenamedDetail): void;
export function emitKBEvent(type: 'kb:file-created', detail: KBFileCreatedDetail): void;
export function emitKBEvent(type: 'kb:file-deleted', detail: KBFileDeletedDetail): void;
export function emitKBEvent(type: 'kb:entries-changed'): void;
export function emitKBEvent(type: 'kb:content-saved'): void;
export function emitKBEvent(type: 'kb:close-active-file'): void;
export interface KBFileChangedExternallyDetail {
  path: string;
}

export function emitKBEvent(type: 'kb:file-changed-externally', detail: KBFileChangedExternallyDetail): void;
export function emitKBEvent(type: 'kb:reopen-closed-file'): void;
export function emitKBEvent(type: KBEventType, detail?: unknown): void {
  window.dispatchEvent(new CustomEvent(type, detail !== undefined ? { detail } : undefined));
}

export function onKBEvent<T = unknown>(type: KBEventType, handler: (detail: T) => void): () => void {
  const listener = (e: Event) => handler((e as CustomEvent<T>).detail);
  window.addEventListener(type, listener);
  return () => window.removeEventListener(type, listener);
}

// ── Vault file system watcher ─────────────────────────────────────────────

import { buildApiPath } from '@personal-agent/extensions/ui';
import { useEffect, useRef } from 'react';

const VAULT_WATCH_DEBOUNCE_MS = 180;

/**
 * Subscribe to file system changes in the vault root via SSE.
 * Calls onEvent (with debounce) whenever a 'vault' event is received.
 * Also calls onReady with the root path on connection.
 */
export function useVaultWatcher(onEvent: () => void, onReady?: (root: string) => void): void {
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  useEffect(() => {
    if (typeof window === 'undefined' || typeof EventSource === 'undefined') return;
    let timer: number | null = null;
    let source: EventSource | null = null;

    source = new EventSource(buildApiPath('/vault/events'));

    const schedule = () => {
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => onEventRef.current(), VAULT_WATCH_DEBOUNCE_MS);
    };

    source.addEventListener('message', (event: MessageEvent<string>) => {
      try {
        const payload = JSON.parse(event.data) as Record<string, unknown>;
        if (payload.type === 'ready' && typeof payload.root === 'string') {
          onReadyRef.current?.(payload.root);
          return;
        }
      } catch {
        // ignore parse errors
      }
      schedule();
    });

    source.onerror = () => {
      source?.close();
      schedule();
    };

    return () => {
      if (timer !== null) window.clearTimeout(timer);
      source?.close();
    };
  }, []);
}

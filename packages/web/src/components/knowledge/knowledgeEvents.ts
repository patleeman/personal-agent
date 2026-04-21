// Simple module-level event bus for knowledge base tree↔editor sync.
// Uses window custom events so it works across arbitrary component tree boundaries.

export type KBEventType =
  | 'kb:file-created'
  | 'kb:file-deleted'
  | 'kb:file-renamed'
  | 'kb:entries-changed'; // catch-all for tree refresh

export interface KBFileRenamedDetail { oldId: string; newId: string }
export interface KBFileCreatedDetail { id: string }
export interface KBFileDeletedDetail { id: string }

export function emitKBEvent(type: 'kb:file-renamed', detail: KBFileRenamedDetail): void;
export function emitKBEvent(type: 'kb:file-created', detail: KBFileCreatedDetail): void;
export function emitKBEvent(type: 'kb:file-deleted', detail: KBFileDeletedDetail): void;
export function emitKBEvent(type: 'kb:entries-changed'): void;
export function emitKBEvent(type: KBEventType, detail?: unknown): void {
  window.dispatchEvent(new CustomEvent(type, detail !== undefined ? { detail } : undefined));
}

export function onKBEvent<T = unknown>(
  type: KBEventType,
  handler: (detail: T) => void,
): () => void {
  const listener = (e: Event) => handler((e as CustomEvent<T>).detail);
  window.addEventListener(type, listener);
  return () => window.removeEventListener(type, listener);
}

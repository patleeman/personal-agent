export const MEMORIES_CHANGED_EVENT = 'pa:memories-changed';

export function emitMemoriesChanged(): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(new Event(MEMORIES_CHANGED_EVENT));
}

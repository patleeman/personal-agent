export const MEMORIES_CHANGED_EVENT = 'pa:memories-changed';

export interface MemoriesChangedEventDetail {
  memoryId?: string;
  suppressOpenDetailRefresh?: boolean;
}

export function emitMemoriesChanged(detail?: MemoriesChangedEventDetail): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(new CustomEvent<MemoriesChangedEventDetail>(MEMORIES_CHANGED_EVENT, { detail }));
}

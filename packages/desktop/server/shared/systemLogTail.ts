const REMOVED_SYNC_LOG_PATTERNS = ['[module:sync]', 'sync-error-resolver', 'path=/api/sync', 'path=/app/api/sync'] as const;

export function isRemovedSyncLogLine(line: string): boolean {
  return REMOVED_SYNC_LOG_PATTERNS.some((pattern) => line.includes(pattern));
}

export function filterSystemLogTailLines(lines: string[]): string[] {
  return lines.filter((line) => !isRemovedSyncLogLine(line));
}

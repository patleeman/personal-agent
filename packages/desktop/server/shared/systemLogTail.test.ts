import { describe, expect, it } from 'vitest';

import { filterSystemLogTailLines, isRemovedSyncLogLine } from './systemLogTail.js';

describe('systemLogTail', () => {
  it('filters log lines from the removed sync feature', () => {
    expect(isRemovedSyncLogLine('[info] [module:sync] git index lock detected')).toBe(true);
    expect(isRemovedSyncLogLine('[warn] background run started id=run-sync-error-resolver-123')).toBe(true);
    expect(isRemovedSyncLogLine('[info] request completed method=GET path=/api/sync status=200')).toBe(true);
  });

  it('keeps unrelated lines, including durable-state paths that still contain /sync/', () => {
    const kept = '[info] wrote ~/.local/state/personal-agent/sync/tasks/example.task.md';

    expect(isRemovedSyncLogLine(kept)).toBe(false);
    expect(
      filterSystemLogTailLines([
        '[info] [module:sync] old log line',
        kept,
        '[warn] run-sync-error-resolver failed',
        '[info] daemon started',
      ]),
    ).toEqual([kept, '[info] daemon started']);
  });
});

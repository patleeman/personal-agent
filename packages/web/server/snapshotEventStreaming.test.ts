import { describe, expect, it } from 'vitest';
import { streamSnapshotEvents } from './snapshotEventStreaming.js';

describe('streamSnapshotEvents', () => {
  it('deduplicates topics while preserving first-seen order', async () => {
    const writes: string[] = [];

    await streamSnapshotEvents(['sessions', 'activity', 'sessions', 'runs'], {
      buildEvents: (topic) => ({ topic }),
      writeEvent: (event) => {
        writes.push(event.topic);
      },
    });

    expect(writes).toEqual(['sessions', 'activity', 'runs']);
  });

  it('writes earlier snapshot events before later slow topics finish', async () => {
    const writes: string[] = [];
    let resolveSessions: (() => void) | null = null;
    let resolveRuns: (() => void) | null = null;

    const streamPromise = streamSnapshotEvents(['sessions', 'runs'], {
      buildEvents: async (topic) => {
        if (topic === 'sessions') {
          await new Promise<void>((resolve) => {
            resolveSessions = resolve;
          });
          return { topic };
        }

        await new Promise<void>((resolve) => {
          resolveRuns = resolve;
        });
        return { topic };
      },
      writeEvent: (event) => {
        writes.push(event.topic);
      },
    });

    resolveSessions?.();
    await Promise.resolve();
    await Promise.resolve();

    expect(writes).toEqual(['sessions']);

    resolveRuns?.();
    await streamPromise;

    expect(writes).toEqual(['sessions', 'runs']);
  });
});

import { describe, expect, it } from 'vitest';
import { streamSnapshotEvents } from './snapshotEventStreaming.js';

describe('streamSnapshotEvents', () => {
  it('deduplicates topics while preserving first-seen order', async () => {
    const writes: string[] = [];

    await streamSnapshotEvents(['sessions', 'tasks', 'sessions', 'runs'], {
      buildEvents: (topic) => ({ topic }),
      writeEvent: (event) => {
        writes.push(event.topic);
      },
    });

    expect(writes).toEqual(['sessions', 'tasks', 'runs']);
  });

  it('writes each event from array snapshots and skips empty builders', async () => {
    const writes: string[] = [];

    await streamSnapshotEvents(['sessions', 'tasks', 'runs'], {
      buildEvents: (topic) => {
        if (topic === 'sessions') {
          return [{ topic: 'sessions-1' }, { topic: 'sessions-2' }];
        }

        if (topic === 'tasks') {
          return null;
        }

        return undefined;
      },
      writeEvent: (event) => {
        writes.push(event.topic);
      },
    });

    expect(writes).toEqual(['sessions-1', 'sessions-2']);
  });

  it('writes earlier snapshot events before later slow topics finish', async () => {
    const writes: string[] = [];
    let releaseSessions!: () => void;
    let releaseRuns!: () => void;

    const streamPromise = streamSnapshotEvents(['sessions', 'runs'], {
      buildEvents: async (topic) => {
        if (topic === 'sessions') {
          await new Promise<void>((resolve) => {
            releaseSessions = () => resolve();
          });
          return { topic };
        }

        await new Promise<void>((resolve) => {
          releaseRuns = () => resolve();
        });
        return { topic };
      },
      writeEvent: (event) => {
        writes.push(event.topic);
      },
    });

    releaseSessions();
    await Promise.resolve();
    await Promise.resolve();

    expect(writes).toEqual(['sessions']);

    releaseRuns();
    await streamPromise;

    expect(writes).toEqual(['sessions', 'runs']);
  });
});

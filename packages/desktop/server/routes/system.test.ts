import { describe, expect, it, vi } from 'vitest';

vi.mock('../automation/daemon.js', () => ({
  readDaemonState: vi.fn(),
}));

vi.mock('../middleware/index.js', () => ({
  logError: vi.fn(),
}));

vi.mock('../conversations/conversationService.js', () => ({
  listConversationSessionsSnapshot: vi.fn(),
}));

vi.mock('../automation/durableRuns.js', () => ({
  listDurableRuns: vi.fn(),
}));

import { buildSnapshotEventsForTopic } from './system.js';
import * as daemon from '../automation/daemon.js';
import * as convoService from '../conversations/conversationService.js';
import * as durableRuns from '../automation/durableRuns.js';

describe('buildSnapshotEventsForTopic', () => {
  it('builds sessions snapshot', async () => {
    vi.mocked(convoService.listConversationSessionsSnapshot).mockReturnValue([{ id: 'c1' }] as never);
    const events = await buildSnapshotEventsForTopic('sessions');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'sessions_snapshot', sessions: [{ id: 'c1' }] });
  });

  it('builds tasks snapshot using listTasksForCurrentProfileFn from initialized context', async () => {
    // Need to call registerSystemRoutes first to set the context
    const { registerSystemRoutes } = await import('./system.js');
    const router = { get: vi.fn(), post: vi.fn() };
    registerSystemRoutes(router as never, {
      getCurrentProfile: () => 'test',
      getRepoRoot: () => '/repo',
      listTasksForCurrentProfile: () => [{ id: 'task1' }],
    });

    const events = await buildSnapshotEventsForTopic('tasks');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'tasks_snapshot', tasks: [{ id: 'task1' }] });
  });

  it('builds runs snapshot', async () => {
    vi.mocked(durableRuns.listDurableRuns).mockResolvedValue([{ runId: 'run1' }] as never);
    const events = await buildSnapshotEventsForTopic('runs');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'runs_snapshot', result: [{ runId: 'run1' }] });
  });

  it('builds daemon snapshot', async () => {
    vi.mocked(daemon.readDaemonState).mockResolvedValue({ running: true } as never);
    const events = await buildSnapshotEventsForTopic('daemon');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'daemon_snapshot', state: { running: true } });
  });

  it('returns empty array for unknown topics', async () => {
    const events = await buildSnapshotEventsForTopic('unknown' as never);
    expect(events).toEqual([]);
  });
});

import type { Express, Request, Response } from 'express';

import { readDaemonState } from '../automation/daemon.js';
import { listDurableRuns } from '../automation/durableRuns.js';
import { listConversationSessionsSnapshot } from '../conversations/conversationService.js';
import { logError } from '../middleware/index.js';
import { type AppEventTopic } from '../shared/appEvents.js';
import type { ServerRouteContext } from './context.js';

let getCurrentProfileFn: () => string = () => {
  throw new Error('getCurrentProfile not initialized for system routes');
};

let getRepoRootFn: () => string = () => {
  throw new Error('getRepoRoot not initialized for system routes');
};

let listTasksForCurrentProfileFn: () => unknown[] = () => {
  throw new Error('listTasksForCurrentProfile not initialized for system routes');
};

function initializeSystemRoutesContext(
  context: Pick<ServerRouteContext, 'getCurrentProfile' | 'getRepoRoot' | 'listTasksForCurrentProfile'>,
): void {
  getCurrentProfileFn = context.getCurrentProfile;
  getRepoRootFn = context.getRepoRoot;
  listTasksForCurrentProfileFn = context.listTasksForCurrentProfile;
}

export async function buildSnapshotEventsForTopic(topic: AppEventTopic): Promise<unknown[]> {
  switch (topic) {
    case 'sessions':
      return [{ type: 'sessions_snapshot' as const, sessions: listConversationSessionsSnapshot() }];
    case 'tasks':
      return [{ type: 'tasks_snapshot' as const, tasks: listTasksForCurrentProfileFn() }];
    case 'runs':
      return [{ type: 'runs_snapshot' as const, result: await listDurableRuns() }];
    case 'daemon':
      return [{ type: 'daemon_snapshot' as const, state: await readDaemonState() }];
    default:
      return [];
  }
}

export const INITIAL_APP_EVENT_TOPICS: AppEventTopic[] = ['sessions', 'tasks', 'runs', 'daemon'];

function handleStatus(_req: Request, res: Response): void {
  try {
    const profile = getCurrentProfileFn();
    res.json({
      profile,
      repoRoot: getRepoRootFn(),
      appRevision: process.env.PERSONAL_AGENT_APP_REVISION,
    });
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
}

export function registerSystemRoutes(
  router: Pick<Express, 'get' | 'post'>,
  context: Pick<ServerRouteContext, 'getCurrentProfile' | 'getRepoRoot' | 'listTasksForCurrentProfile'>,
): void {
  initializeSystemRoutesContext(context);
  router.get('/api/status', handleStatus);
}

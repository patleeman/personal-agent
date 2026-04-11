import type { Express, Request, Response } from 'express';
import type { ServerRouteContext } from './context.js';
import { readWebUiState } from '../ui/webUi.js';
import { readDaemonState } from '../automation/daemon.js';
import { subscribeAppEvents, type AppEventTopic } from '../shared/appEvents.js';
import { streamSnapshotEvents } from '../shared/snapshotEventStreaming.js';
import {
  logError,
  logWarn,
} from '../middleware/index.js';
import { listConversationSessionsSnapshot } from '../conversations/conversationService.js';
import { listDurableRuns } from '../automation/durableRuns.js';

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
    case 'webUi':
      return [{ type: 'web_ui_snapshot' as const, state: readWebUiState() }];
    default:
      return [];
  }
}

async function emitSnapshotEvents(topics: AppEventTopic[], writeEvent: (event: unknown) => void) {
  await streamSnapshotEvents(topics, {
    buildEvents: buildSnapshotEventsForTopic,
    writeEvent,
  });
}

export const INITIAL_APP_EVENT_TOPICS: AppEventTopic[] = [
  'sessions',
  'tasks',
  'runs',
  'daemon',
  'webUi',
];
function writeSseHeaders(res: Response): void {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
}

function handleStatus(_req: Request, res: Response): void {
  try {
    const profile = getCurrentProfileFn();
    res.json({
      profile,
      repoRoot: getRepoRootFn(),
      webUiRevision: process.env.PERSONAL_AGENT_WEB_REVISION,
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
  router.get('/api/events', (req, res) => {
    writeSseHeaders(res);

    let closed = false;
    let writeQueue = Promise.resolve();

    const writeEvent = (event: unknown) => {
      if (closed) {
        return;
      }

      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    const enqueueWrite = (task: () => Promise<void> | void) => {
      writeQueue = writeQueue
        .then(async () => {
          if (closed) {
            return;
          }

          await task();
        })
        .catch((error) => {
          logWarn('app event stream write failed', {
            message: error instanceof Error ? error.message : String(error),
          });
        });
    };

    const writeSnapshotEvents = async (topics: AppEventTopic[]) => {
      await emitSnapshotEvents(topics, writeEvent);
    };

    writeEvent({ type: 'connected' });
    enqueueWrite(async () => {
      await writeSnapshotEvents(INITIAL_APP_EVENT_TOPICS);
    });

    const heartbeat = setInterval(() => {
      if (!closed) {
        res.write(': heartbeat\n\n');
      }
    }, 15_000);

    const unsubscribe = subscribeAppEvents((event) => {
      if (event.type === 'invalidate') {
        const snapshotTopics = event.topics.filter((topic) => topic !== 'runs');
        enqueueWrite(async () => {
          if (snapshotTopics.length > 0) {
            await writeSnapshotEvents(snapshotTopics);
          }
          writeEvent(event);
        });
        return;
      }

      writeEvent(event);
    });

    req.on('close', () => {
      closed = true;
      clearInterval(heartbeat);
      unsubscribe();
    });
  });

  router.get('/api/status', handleStatus);
}

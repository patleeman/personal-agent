import type { Express, Request, Response } from 'express';
import type { ServerRouteContext } from './context.js';
import { requestApplicationRestart, requestApplicationUpdate } from '../ui/applicationRestart.js';
import { listProjectIndex } from '../projects/projects.js';
import { readWebUiState } from '../ui/webUi.js';
import { readCompanionSession } from '../ui/companionAuth.js';
import { readDaemonState } from '../automation/daemon.js';
import {
  parseSyncSetupInput,
  readSyncState,
  requestSyncRunAndReadState,
  setupSyncAndReadState,
} from '../conversations/sync.js';
import { getAlertSnapshotForProfile } from '../automation/alerts.js';
import { invalidateAppTopics, subscribeAppEvents, type AppEventTopic } from '../shared/appEvents.js';
import { streamSnapshotEvents } from '../shared/snapshotEventStreaming.js';
import { suppressMonitoredServiceAttention } from '../shared/internalAttention.js';
import {
  logError,
  logWarn,
} from '../middleware/index.js';
import { listConversationSessionsSnapshot } from '../conversations/conversationService.js';
import { listDurableRuns } from '../automation/durableRuns.js';

type ActivityListEntryLike = {
  read?: boolean;
};

let getCurrentProfileFn: () => string = () => {
  throw new Error('getCurrentProfile not initialized for system routes');
};

let getRepoRootFn: () => string = () => {
  throw new Error('getRepoRoot not initialized for system routes');
};

let listActivityForCurrentProfileFn: () => ActivityListEntryLike[] = () => {
  throw new Error('listActivityForCurrentProfile not initialized for system routes');
};

let listProjectsForCurrentProfileFn: () => unknown[] = () => {
  throw new Error('listProjectsForCurrentProfile not initialized for system routes');
};

let listTasksForCurrentProfileFn: () => unknown[] = () => {
  throw new Error('listTasksForCurrentProfile not initialized for system routes');
};

function initializeSystemRoutesContext(
  context: Pick<ServerRouteContext, 'getCurrentProfile' | 'getRepoRoot' | 'listActivityForCurrentProfile' | 'listProjectsForCurrentProfile' | 'listTasksForCurrentProfile'>,
): void {
  getCurrentProfileFn = context.getCurrentProfile;
  getRepoRootFn = context.getRepoRoot;
  listActivityForCurrentProfileFn = context.listActivityForCurrentProfile;
  listProjectsForCurrentProfileFn = context.listProjectsForCurrentProfile;
  listTasksForCurrentProfileFn = context.listTasksForCurrentProfile;
}

function getActivitySnapshotForCurrentProfile(): { entries: ActivityListEntryLike[]; unreadCount: number } {
  const entries = listActivityForCurrentProfileFn();
  return {
    entries,
    unreadCount: entries.filter((entry) => !entry.read).length,
  };
}

async function buildSnapshotEventsForTopic(topic: AppEventTopic): Promise<unknown[]> {
  switch (topic) {
    case 'activity': {
      const snapshot = getActivitySnapshotForCurrentProfile();
      return [{ type: 'activity_snapshot' as const, entries: snapshot.entries, unreadCount: snapshot.unreadCount }];
    }
    case 'alerts': {
      const snapshot = getAlertSnapshotForProfile(getCurrentProfileFn());
      return [{ type: 'alerts_snapshot' as const, entries: snapshot.entries, activeCount: snapshot.activeCount }];
    }
    case 'projects':
      return [{ type: 'projects_snapshot' as const, projects: listProjectsForCurrentProfileFn() }];
    case 'sessions':
      return [{ type: 'sessions_snapshot' as const, sessions: listConversationSessionsSnapshot() }];
    case 'tasks':
      return [{ type: 'tasks_snapshot' as const, tasks: listTasksForCurrentProfileFn() }];
    case 'runs':
      return [{ type: 'runs_snapshot' as const, result: await listDurableRuns() }];
    case 'daemon':
      return [{ type: 'daemon_snapshot' as const, state: await readDaemonState() }];
    case 'sync':
      return [{ type: 'sync_snapshot' as const, state: await readSyncState() }];
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

const COMPANION_SESSION_COOKIE = 'pa_companion';
const COMPANION_EVENT_TOPICS = new Set<AppEventTopic>([
  'activity',
  'alerts',
  'projects',
  'sessions',
  'tasks',
  'runs',
  'daemon',
  'sync',
  'webUi',
]);

function writeSseHeaders(res: Response): void {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
}

function readCookieValue(req: Request, cookieName: string): string {
  const cookieHeader = req.headers.cookie;
  if (typeof cookieHeader !== 'string' || cookieHeader.trim().length === 0) {
    return '';
  }

  const pairs = cookieHeader.split(';');
  for (const pair of pairs) {
    const [rawName, ...valueParts] = pair.split('=');
    if (rawName?.trim() !== cookieName) {
      continue;
    }

    return decodeURIComponent(valueParts.join('=').trim());
  }

  return '';
}

function handleStatus(_req: Request, res: Response): void {
  try {
    const profile = getCurrentProfileFn();
    const activities = listActivityForCurrentProfileFn();
    const projectIds = listProjectIndex({ repoRoot: getRepoRootFn(), profile }).projects.map((project) => project.id);
    res.json({
      profile,
      repoRoot: getRepoRootFn(),
      activityCount: activities.length,
      projectCount: projectIds.length,
      webUiSlot: process.env.PERSONAL_AGENT_WEB_SLOT,
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

function handleApplicationRestart(_req: Request, res: Response): void {
  try {
    suppressMonitoredServiceAttention('daemon', 10 * 60_000);
    res.status(202).json(requestApplicationRestart({ repoRoot: getRepoRootFn(), profile: getCurrentProfileFn() }));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.startsWith('Application restart already in progress') || message.startsWith('Application update already in progress')
      ? 409
      : message.startsWith('Managed web UI service is not installed')
        ? 400
        : 500;
    res.status(status).json({ error: message });
  }
}

function handleApplicationUpdate(_req: Request, res: Response): void {
  try {
    suppressMonitoredServiceAttention('daemon', 15 * 60_000);
    res.status(202).json(requestApplicationUpdate({ repoRoot: getRepoRootFn(), profile: getCurrentProfileFn() }));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.startsWith('Application restart already in progress') || message.startsWith('Application update already in progress')
      ? 409
      : message.startsWith('Managed web UI service is not installed')
        ? 400
        : 500;
    res.status(status).json({ error: message });
  }
}

async function handleSyncState(_req: Request, res: Response): Promise<void> {
  try {
    res.json(await readSyncState());
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
}

async function handleSyncRun(_req: Request, res: Response): Promise<void> {
  try {
    const state = await requestSyncRunAndReadState();
    invalidateAppTopics('sync');
    res.json(state);
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
}

async function handleSyncSetup(req: Request, res: Response): Promise<void> {
  let input: ReturnType<typeof parseSyncSetupInput>;

  try {
    input = parseSyncSetupInput(req.body);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    return;
  }

  try {
    const state = await setupSyncAndReadState(input);
    invalidateAppTopics('sync');
    res.json(state);
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
  context: Pick<ServerRouteContext, 'getCurrentProfile' | 'getRepoRoot' | 'listActivityForCurrentProfile' | 'listProjectsForCurrentProfile' | 'listTasksForCurrentProfile'>,
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
      await writeSnapshotEvents(['sessions', 'activity', 'projects', 'tasks', 'daemon', 'sync', 'webUi', 'runs']);
    });

    const heartbeat = setInterval(() => {
      if (!closed) {
        res.write(': heartbeat\n\n');
      }
    }, 15_000);

    const unsubscribe = subscribeAppEvents((event) => {
      if (event.type === 'invalidate') {
        enqueueWrite(async () => {
          await writeSnapshotEvents(event.topics);
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
  router.post('/api/application/restart', handleApplicationRestart);
  router.post('/api/application/update', handleApplicationUpdate);
  router.get('/api/sync', handleSyncState);
  router.post('/api/sync/run', handleSyncRun);
  router.post('/api/sync/setup', handleSyncSetup);
}

export function registerCompanionSystemRoutes(
  router: Pick<Express, 'get' | 'post'>,
  context: Pick<ServerRouteContext, 'getCurrentProfile' | 'getRepoRoot' | 'listActivityForCurrentProfile' | 'listProjectsForCurrentProfile' | 'listTasksForCurrentProfile'>,
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
          logWarn('companion event stream write failed', {
            message: error instanceof Error ? error.message : String(error),
          });
        });
    };

    const writeSnapshotEvents = async (topics: AppEventTopic[]) => {
      await emitSnapshotEvents(topics, writeEvent);
    };

    writeEvent({ type: 'connected' });
    enqueueWrite(async () => {
      await writeSnapshotEvents(['sessions', 'activity', 'alerts', 'projects', 'tasks', 'daemon', 'sync', 'webUi', 'runs']);
    });

    const sessionToken = readCookieValue(req, COMPANION_SESSION_COOKIE);
    const heartbeat = setInterval(() => {
      if (closed) {
        return;
      }

      if (!readCompanionSession(sessionToken, { surface: 'companion', touch: false })) {
        closed = true;
        clearInterval(heartbeat);
        unsubscribe();
        res.end();
        return;
      }

      res.write(': heartbeat\n\n');
    }, 15_000);

    const unsubscribe = subscribeAppEvents((event) => {
      if (event.type === 'invalidate') {
        const topics = event.topics.filter((topic) => COMPANION_EVENT_TOPICS.has(topic));
        if (topics.length === 0) {
          return;
        }

        enqueueWrite(async () => {
          await writeSnapshotEvents(topics);
          writeEvent({ type: 'invalidate', topics });
        });
        return;
      }

      if (event.type === 'live_title' || event.type === 'session_meta_changed') {
        writeEvent(event);
      }
    });

    req.on('close', () => {
      closed = true;
      clearInterval(heartbeat);
      unsubscribe();
    });
  });

  router.get('/api/sync', handleSyncState);
  router.post('/api/sync/run', handleSyncRun);
  router.post('/api/application/restart', handleApplicationRestart);
  router.post('/api/application/update', handleApplicationUpdate);
}

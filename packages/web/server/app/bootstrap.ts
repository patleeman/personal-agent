import { existsSync } from 'node:fs';
import type { IncomingMessage } from 'node:http';
import type { Socket } from 'node:net';
import { join } from 'node:path';
import express, { type Express } from 'express';
import type { RecoverDurableLiveConversationsDependencies } from '../conversations/conversationRecovery.js';
import { recoverDurableLiveConversations } from '../conversations/conversationRecovery.js';
import {
  applyWebSecurityHeaders,
  enforceSameOriginUnsafeRequests,
  logInfo,
  logWarn,
  reloadAllLiveSessionAuth,
  webRequestLoggingMiddleware,
} from '../middleware/index.js';
import { subscribeProviderOAuthLogins } from '../models/providerAuth.js';
import { createServiceAttentionMonitor, type ServiceAttentionMonitorOptions } from '../shared/internalAttention.js';
import { startAppEventMonitor } from '../shared/appEvents.js';

export function createServerApps(): { app: Express } {
  const app = express();

  app.set('etag', false);
  app.set('trust proxy', true);
  app.use(applyWebSecurityHeaders);
  app.use(express.json({ limit: '25mb' }));
  app.use(webRequestLoggingMiddleware);
  app.use(enforceSameOriginUnsafeRequests);

  return { app };
}

export function startBootstrapMonitors(options: {
  repoRoot: string;
  sessionsDir: string;
  taskStateFile: string;
  profileConfigFile: string;
  getCurrentProfile: () => string;
  daemonRoot?: string;
  readDaemonState: ServiceAttentionMonitorOptions['readDaemonState'];
}): void {
  startAppEventMonitor({
    repoRoot: options.repoRoot,
    sessionsDir: options.sessionsDir,
    taskStateFile: options.taskStateFile,
    profileConfigFile: options.profileConfigFile,
    getCurrentProfile: options.getCurrentProfile,
  });

  subscribeProviderOAuthLogins((login) => {
    if (login.status === 'completed') {
      reloadAllLiveSessionAuth();
    }
  });

  createServiceAttentionMonitor({
    repoRoot: options.repoRoot,
    stateRoot: options.daemonRoot,
    getCurrentProfile: options.getCurrentProfile,
    readDaemonState: options.readDaemonState,
    logger: {
      warn: (message, fields) => logWarn(message, fields),
    },
  }).start();
}

export function startDeferredResumeLoop(options: {
  flushLiveDeferredResumes: () => Promise<void>;
  pollMs: number;
}): void {
  void options.flushLiveDeferredResumes().catch((error) => {
    logWarn(`Deferred resume loop failed: ${(error as Error).message}`);
  });

  setInterval(() => {
    void options.flushLiveDeferredResumes().catch((error) => {
      logWarn(`Deferred resume loop failed: ${(error as Error).message}`);
    });
  }, options.pollMs);
}

export function startConversationRecovery(options: {
  flushLiveDeferredResumes: () => Promise<void>;
  buildLiveSessionResourceOptions: () => RecoverDurableLiveConversationsDependencies['loaderOptions'];
  buildLiveSessionExtensionFactories: () => NonNullable<RecoverDurableLiveConversationsDependencies['loaderOptions']>['extensionFactories'];
  isLive: RecoverDurableLiveConversationsDependencies['isLive'];
  resumeSession: RecoverDurableLiveConversationsDependencies['resumeSession'];
  queuePromptContext: RecoverDurableLiveConversationsDependencies['queuePromptContext'];
  promptSession: RecoverDurableLiveConversationsDependencies['promptSession'];
}): void {
  void recoverDurableLiveConversations({
    isLive: options.isLive,
    resumeSession: options.resumeSession,
    queuePromptContext: options.queuePromptContext,
    promptSession: options.promptSession,
    loaderOptions: {
      ...options.buildLiveSessionResourceOptions(),
      extensionFactories: options.buildLiveSessionExtensionFactories(),
    },
    logger: {
      info: (message) => logInfo(message),
      warn: (message) => logWarn(message),
    },
  }).then(async (result) => {
    if (result.recovered.length > 0) {
      logInfo(`Recovered ${String(result.recovered.length)} live conversation runs from durable state.`);
      await options.flushLiveDeferredResumes();
    }
  }).catch((error) => {
    logWarn(`Conversation recovery failed: ${(error as Error).message}`);
  });
}

export function mountStaticServerApps(options: {
  app: Express;
  distDir: string;
}): void {
  const {
    app,
    distDir,
  } = options;

  if (existsSync(distDir)) {
    app.use(express.static(distDir));
    app.get('*', (req, res) => {
      if (req.path.startsWith('/api/')) {
        res.status(404).json({ error: 'Not found' });
        return;
      }

      res.sendFile(join(distDir, 'index.html'));
    });
  } else {
    app.get('/', (_req, res) => {
      res.send(
        '<pre style="font-family:monospace;padding:2rem;background:#07090e;color:#bfcfee">'
          + 'personal-agent web UI\n\n'
          + 'SPA not built yet.\n'
          + 'Run: npm run build in packages/web\n'
          + '</pre>',
      );
    });
  }
}

export function startServerListeners(options: {
  app: Express;
  port: number;
  loopbackHost: string;
  getCurrentProfile: () => string;
  getDefaultWebCwd: () => string;
  repoRoot: string;
  distDir: string;
  handleUpgrade?: (request: IncomingMessage, socket: Socket, head: Buffer) => void;
}): void {
  const server = options.app.listen(options.port, options.loopbackHost, () => {
    logInfo('web ui started', {
      url: `http://${options.loopbackHost}:${options.port}`,
      profile: options.getCurrentProfile(),
      repoRoot: options.repoRoot,
      cwd: options.getDefaultWebCwd(),
      dist: options.distDir,
    });
  });

  if (options.handleUpgrade) {
    server.on('upgrade', options.handleUpgrade);
  }
}

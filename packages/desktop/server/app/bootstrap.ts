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
import { startAppEventMonitor } from '../shared/appEvents.js';
import { createServiceAttentionMonitor, type ServiceAttentionMonitorOptions } from '../shared/internalAttention.js';
import { persistAppTelemetryEvent } from '../traces/appTelemetry.js';

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
  persistAppTelemetryEvent({
    source: 'system',
    category: 'system_health',
    name: 'bootstrap_monitors_start',
    metadata: {
      repoRoot: options.repoRoot,
      sessionsDir: options.sessionsDir,
      taskStateFile: options.taskStateFile,
      profileConfigFile: options.profileConfigFile,
    },
  });

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

export function startDeferredResumeLoop(options: { flushLiveDeferredResumes: () => Promise<void>; pollMs: number }): void {
  const pollMs = normalizeDeferredResumePollMs(options.pollMs);
  persistAppTelemetryEvent({ source: 'system', category: 'system_health', name: 'deferred_resume_loop_start', value: pollMs });
  void options.flushLiveDeferredResumes().catch((error) => {
    persistAppTelemetryEvent({
      source: 'system',
      category: 'system_health',
      name: 'deferred_resume_flush_failed',
      metadata: { message: (error as Error).message },
    });
    logWarn(`Deferred resume loop failed: ${(error as Error).message}`);
  });

  setInterval(() => {
    void options.flushLiveDeferredResumes().catch((error) => {
      persistAppTelemetryEvent({
        source: 'system',
        category: 'system_health',
        name: 'deferred_resume_flush_failed',
        metadata: { message: (error as Error).message },
      });
      logWarn(`Deferred resume loop failed: ${(error as Error).message}`);
    });
  }, pollMs);
}

export function normalizeDeferredResumePollMs(value: number): number {
  return Number.isSafeInteger(value) && value > 0 ? Math.min(60_000, value) : 5_000;
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
  const startedAt = process.hrtime.bigint();
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
  })
    .then(async (result) => {
      persistAppTelemetryEvent({
        source: 'system',
        category: 'system_health',
        name: 'conversation_recovery_completed',
        durationMs: Number(process.hrtime.bigint() - startedAt) / 1_000_000,
        count: result.recovered.length,
      });
      if (result.recovered.length > 0) {
        logInfo(`Recovered ${String(result.recovered.length)} live conversation runs from durable state.`);
        await options.flushLiveDeferredResumes();
      }
    })
    .catch((error) => {
      persistAppTelemetryEvent({
        source: 'system',
        category: 'system_health',
        name: 'conversation_recovery_failed',
        durationMs: Number(process.hrtime.bigint() - startedAt) / 1_000_000,
        metadata: { message: (error as Error).message },
      });
      logWarn(`Conversation recovery failed: ${(error as Error).message}`);
    });
}

export function mountStaticServerApps(options: { app: Express; distDir: string }): void {
  const { app, distDir } = options;

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
        '<pre style="font-family:monospace;padding:2rem;background:#07090e;color:#bfcfee">' +
          'personal-agent desktop renderer\n\n' +
          'SPA not built yet.\n' +
          'Run: pnpm run build in packages/desktop\n' +
          '</pre>',
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
    persistAppTelemetryEvent({
      source: 'system',
      category: 'system_health',
      name: 'server_started',
      metadata: {
        port: options.port,
        loopbackHost: options.loopbackHost,
        profile: options.getCurrentProfile(),
        repoRoot: options.repoRoot,
        cwd: options.getDefaultWebCwd(),
        dist: options.distDir,
      },
    });
    logInfo('desktop renderer server started', {
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

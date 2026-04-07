import { existsSync } from 'node:fs';
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
import { shouldServeCompanionIndex } from '../ui/companionSpaIndex.js';

export function createServerApps(): { app: Express; companionApp: Express } {
  const app = express();
  const companionApp = express();

  for (const serverApp of [app, companionApp]) {
    serverApp.set('etag', false);
    serverApp.set('trust proxy', true);
    serverApp.use(applyWebSecurityHeaders);
    serverApp.use(express.json({ limit: '25mb' }));
    serverApp.use(webRequestLoggingMiddleware);
    serverApp.use(enforceSameOriginUnsafeRequests);
  }

  companionApp.use((req, _res, next) => {
    if (req.url === '/app/api' || req.url.startsWith('/app/api/')) {
      req.url = req.url.slice('/app'.length);
    }
    next();
  });

  return { app, companionApp };
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
  companionApp: Express;
  distDir: string;
  companionDistDir: string;
  distAssetsDir: string;
  companionDisabled: boolean;
  loopbackHost: string;
  companionPort: number;
}): void {
  const {
    app,
    companionApp,
    distDir,
    companionDistDir,
    distAssetsDir,
    companionDisabled,
    loopbackHost,
    companionPort,
  } = options;

  if (existsSync(distDir)) {
    companionApp.use('/assets', express.static(distAssetsDir));
    companionApp.use('/app', express.static(companionDistDir));
    companionApp.get('/', (_req, res) => {
      res.redirect('/app/inbox');
    });
    companionApp.use(express.static(companionDistDir, { index: false }));
    companionApp.get('*', (req, res, next) => {
      if (!shouldServeCompanionIndex(req.path)) {
        next();
        return;
      }

      res.sendFile(join(companionDistDir, 'index.html'));
    });
  } else {
    companionApp.get('*', (_req, res) => {
      res.send(
        '<pre style="font-family:monospace;padding:2rem;background:#07090e;color:#bfcfee">'
          + 'personal-agent companion\n\n'
          + 'SPA not built yet.\n'
          + 'Run: npm run build in packages/web\n'
          + '</pre>',
      );
    });
  }

  if (existsSync(distDir)) {
    if (companionDisabled) {
      app.get('/app*', (_req, res) => {
        res.sendFile(join(companionDistDir, 'index.html'));
      });
    } else {
      app.get('/app*', (req, res) => {
        const search = typeof req.url === 'string' && req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
        res.redirect(`http://${loopbackHost}:${companionPort}${req.path}${search}`);
      });
    }
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
  companionApp: Express;
  port: number;
  companionPort: number;
  loopbackHost: string;
  companionDisabled: boolean;
  getCurrentProfile: () => string;
  getDefaultWebCwd: () => string;
  repoRoot: string;
  distDir: string;
  companionDistDir: string;
}): void {
  options.app.listen(options.port, options.loopbackHost, () => {
    logInfo('web ui started', {
      url: `http://${options.loopbackHost}:${options.port}`,
      profile: options.getCurrentProfile(),
      repoRoot: options.repoRoot,
      cwd: options.getDefaultWebCwd(),
      dist: options.distDir,
    });
  });

  if (!options.companionDisabled) {
    options.companionApp.listen(options.companionPort, options.loopbackHost, () => {
      logInfo('companion service started', {
        url: `http://${options.loopbackHost}:${options.companionPort}`,
        profile: options.getCurrentProfile(),
        repoRoot: options.repoRoot,
        dist: options.companionDistDir,
      });
    });
  }
}

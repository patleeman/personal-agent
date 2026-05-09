import type { ExtensionFactory } from '@earendil-works/pi-coding-agent';
import { inspectCliBinary, readPackageSourceTargetState } from '@personal-agent/core';
import type { Express, Response } from 'express';

import { inspectAvailableTools } from '../conversations/liveSessions.js';
import { logError } from '../middleware/index.js';
import type { LiveSessionResourceOptions, ServerRouteContext } from './context.js';

let getCurrentProfileFn: () => string = () => {
  throw new Error('getCurrentProfile not initialized for tools routes');
};

let getRepoRootFn: () => string = () => {
  throw new Error('getRepoRoot not initialized for tools routes');
};

let buildLiveSessionResourceOptionsFn: (profile: string) => LiveSessionResourceOptions = () => {
  throw new Error('buildLiveSessionResourceOptions not initialized for tools routes');
};

let buildLiveSessionExtensionFactoriesFn: () => ExtensionFactory[] = () => {
  throw new Error('buildLiveSessionExtensionFactories not initialized for tools routes');
};

let withTemporaryProfileAgentDirFn: <T>(profile: string, run: (agentDir: string) => Promise<T>) => Promise<T> = async () => {
  throw new Error('withTemporaryProfileAgentDir not initialized for tools routes');
};

function initializeToolsRoutesContext(
  context: Pick<
    ServerRouteContext,
    | 'getCurrentProfile'
    | 'getRepoRoot'
    | 'buildLiveSessionResourceOptions'
    | 'buildLiveSessionExtensionFactories'
    | 'withTemporaryProfileAgentDir'
  >,
): void {
  getCurrentProfileFn = context.getCurrentProfile;
  getRepoRootFn = context.getRepoRoot;
  buildLiveSessionResourceOptionsFn = context.buildLiveSessionResourceOptions;
  buildLiveSessionExtensionFactoriesFn = context.buildLiveSessionExtensionFactories;
  withTemporaryProfileAgentDirFn = context.withTemporaryProfileAgentDir;
}

function buildPackageInstallState() {
  return {
    localTarget: readPackageSourceTargetState('local', { repoRoot: getRepoRootFn() }),
  };
}

async function handleToolsRequest(_req: unknown, res: Response): Promise<void> {
  try {
    const runtimeName = getCurrentProfileFn();
    const resourceOptions = buildLiveSessionResourceOptionsFn(runtimeName);
    const details = await withTemporaryProfileAgentDirFn(runtimeName, (agentDir) =>
      inspectAvailableTools(getRepoRootFn(), {
        ...resourceOptions,
        agentDir,
        extensionFactories: buildLiveSessionExtensionFactoriesFn(),
      }),
    );
    const onePasswordCommand = process.env.PERSONAL_AGENT_OP_BIN?.trim() || 'op';
    const dependentCliTools = [
      {
        id: '1password-cli',
        name: '1Password CLI',
        description: 'Resolves op:// secret references used by personal-agent features and extensions.',
        configuredBy: 'PERSONAL_AGENT_OP_BIN',
        usedBy: ['op:// secret references', 'web-tools extension'],
        binary: inspectCliBinary({ command: onePasswordCommand, cwd: getRepoRootFn() }),
      },
    ];

    res.json({
      ...details,
      dependentCliTools,
      packageInstall: buildPackageInstallState(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logError('request handler error', {
      message,
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: message });
  }
}

export function registerToolsRoutes(
  app: Pick<Express, 'get'>,
  context: Pick<
    ServerRouteContext,
    | 'getCurrentProfile'
    | 'getRepoRoot'
    | 'buildLiveSessionResourceOptions'
    | 'buildLiveSessionExtensionFactories'
    | 'withTemporaryProfileAgentDir'
  >,
): void {
  initializeToolsRoutesContext(context);
  app.get('/api/tools', handleToolsRequest);
}

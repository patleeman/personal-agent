import type { Express, Request, Response } from 'express';
import { installPackageSource, listProfiles, readPackageSourceTargetState } from '@personal-agent/resources';
import { inspectCliBinary, inspectMcpServer, inspectMcpTool, readMcpConfig } from '@personal-agent/core';
import type { ExtensionFactory } from '@mariozechner/pi-coding-agent';
import type { LiveSessionResourceOptions } from './context.js';
import { inspectAvailableTools } from '../conversations/liveSessions.js';
import { logError } from '../middleware/index.js';

let getCurrentProfileFn: () => string = () => {
  throw new Error('getCurrentProfile not initialized for tools routes');
};

let getRepoRootFn: () => string = () => {
  throw new Error('getRepoRoot not initialized for tools routes');
};

let getProfilesRootFn: () => string = () => {
  throw new Error('getProfilesRoot not initialized for tools routes');
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

const VIEW_PROFILE_QUERY_PARAM = 'viewProfile';

export function setToolsRoutesGetters(params: {
  getCurrentProfile: () => string;
  getRepoRoot: () => string;
  getProfilesRoot: () => string;
  buildLiveSessionResourceOptions: (profile: string) => LiveSessionResourceOptions;
  buildLiveSessionExtensionFactories: () => ExtensionFactory[];
  withTemporaryProfileAgentDir: <T>(profile: string, run: (agentDir: string) => Promise<T>) => Promise<T>;
}): void {
  getCurrentProfileFn = params.getCurrentProfile;
  getRepoRootFn = params.getRepoRoot;
  getProfilesRootFn = params.getProfilesRoot;
  buildLiveSessionResourceOptionsFn = params.buildLiveSessionResourceOptions;
  buildLiveSessionExtensionFactoriesFn = params.buildLiveSessionExtensionFactories;
  withTemporaryProfileAgentDirFn = params.withTemporaryProfileAgentDir;
}

function resolveRequestedProfileFromQuery(req: Request): string {
  const requestedProfile = typeof req.query[VIEW_PROFILE_QUERY_PARAM] === 'string'
    ? req.query[VIEW_PROFILE_QUERY_PARAM].trim()
    : '';

  if (!requestedProfile) {
    return getCurrentProfileFn();
  }

  const availableProfiles = listProfiles({
    repoRoot: getRepoRootFn(),
    profilesRoot: getProfilesRootFn(),
  });

  if (!availableProfiles.includes(requestedProfile)) {
    throw new Error(`Unknown profile: ${requestedProfile}`);
  }

  return requestedProfile;
}

function buildPackageInstallState(profile = getCurrentProfileFn()) {
  const profileTargets = listProfiles({
    repoRoot: getRepoRootFn(),
    profilesRoot: getProfilesRootFn(),
  }).map((profileName) => ({
    ...readPackageSourceTargetState('profile', profileName, {
      repoRoot: getRepoRootFn(),
      profilesRoot: getProfilesRootFn(),
    }),
    profileName,
    current: profileName === profile,
  }));

  return {
    currentProfile: profile,
    profileTargets,
    localTarget: readPackageSourceTargetState('local', { repoRoot: getRepoRootFn() }),
  };
}

async function handleToolsRequest(req: Request, res: Response): Promise<void> {
  try {
    const profile = resolveRequestedProfileFromQuery(req);
    const details = await withTemporaryProfileAgentDirFn(profile, (agentDir) => inspectAvailableTools(getRepoRootFn(), {
      ...buildLiveSessionResourceOptionsFn(profile),
      agentDir,
      extensionFactories: buildLiveSessionExtensionFactoriesFn(),
    }));
    const mcpConfig = readMcpConfig({ cwd: getRepoRootFn() });
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
      profile,
      ...details,
      dependentCliTools,
      mcp: {
        configPath: mcpConfig.path,
        configExists: mcpConfig.exists,
        searchedPaths: mcpConfig.searchedPaths,
        servers: mcpConfig.servers.map((server) => ({
          name: server.name,
          transport: server.transport,
          command: server.command,
          args: [...server.args],
          cwd: server.cwd,
          url: server.url,
          raw: {},
        })),
      },
      packageInstall: buildPackageInstallState(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logError('request handler error', {
      message,
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(message.startsWith('Unknown profile:') ? 400 : 500).json({ error: message });
  }
}

function handleToolsInstallRequest(req: Request, res: Response): void {
  try {
    const { source, target, profileName } = req.body as {
      source?: string;
      target?: 'profile' | 'local';
      profileName?: string;
    };

    if (typeof source !== 'string' || source.trim().length === 0) {
      res.status(400).json({ error: 'source required' });
      return;
    }

    if (target !== 'profile' && target !== 'local') {
      res.status(400).json({ error: 'target must be profile or local' });
      return;
    }

    if (target === 'profile' && typeof profileName !== 'string') {
      res.status(400).json({ error: 'profileName required for profile installs' });
      return;
    }

    const currentProfile = getCurrentProfileFn();
    const result = installPackageSource({
      repoRoot: getRepoRootFn(),
      profilesRoot: getProfilesRootFn(),
      profileName: target === 'profile' ? profileName : undefined,
      source,
      target,
      sourceBaseDir: getRepoRootFn(),
    });

    res.json({
      ...result,
      packageInstall: buildPackageInstallState(currentProfile),
    });
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
}

async function handleToolsMcpServerRequest(req: Request, res: Response): Promise<void> {
  try {
    const server = req.params.server;
    if (!server) {
      res.status(400).json({ error: 'server required' });
      return;
    }

    const config = readMcpConfig({ cwd: getRepoRootFn() });
    const result = await inspectMcpServer(server, {
      cwd: getRepoRootFn(),
      configPath: config.path,
    });

    if (result.exitCode !== 0 || !result.data) {
      res.status(500).json({
        error: (result.error ?? result.stderr) || `Failed to inspect MCP server ${server}`,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
      });
      return;
    }

    res.json({
      server,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      ...result.data,
    });
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
}

async function handleToolsMcpToolRequest(req: Request, res: Response): Promise<void> {
  try {
    const { server, tool } = req.params as { server?: string; tool?: string };
    if (!server || !tool) {
      res.status(400).json({ error: 'server and tool required' });
      return;
    }

    const config = readMcpConfig({ cwd: getRepoRootFn() });
    const result = await inspectMcpTool(server, tool, {
      cwd: getRepoRootFn(),
      configPath: config.path,
    });

    if (result.exitCode !== 0 || !result.data) {
      res.status(500).json({
        error: (result.error ?? result.stderr) || `Failed to inspect MCP tool ${server}/${tool}`,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
      });
      return;
    }

    res.json({
      server,
      tool,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      ...result.data,
    });
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
}

export function registerToolsRoutes(app: Express): void {
  app.get('/api/tools', handleToolsRequest);
  app.post('/api/tools/packages/install', handleToolsInstallRequest);
  app.get('/api/tools/mcp/servers/:server', handleToolsMcpServerRequest);
  app.get('/api/tools/mcp/servers/:server/tools/:tool', handleToolsMcpToolRequest);
}

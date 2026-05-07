import type { ExtensionFactory } from '@earendil-works/pi-coding-agent';
import { readPackageSourceTargetState } from '@personal-agent/core';
import { buildMergedMcpConfigDocument, inspectCliBinary, readBundledSkillMcpManifests, readMcpConfigDocument } from '@personal-agent/core';
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

function buildMcpCallbackUrl(input: { callbackHost?: string; callbackPort?: number; callbackPath?: string }): string | undefined {
  if (!input.callbackHost && !input.callbackPort && !input.callbackPath) {
    return undefined;
  }

  const host = input.callbackHost ?? 'localhost';
  const port = input.callbackPort ?? 3334;
  const path = input.callbackPath ?? '/oauth/callback';
  return `http://${host}:${port}${path}`;
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
    const bundledSkillManifests = readBundledSkillMcpManifests(resourceOptions.additionalSkillPaths ?? []);
    const configDiscoveryEnv = { ...process.env };
    delete configDiscoveryEnv.MCP_CONFIG_PATH;
    const mergedMcpConfig = buildMergedMcpConfigDocument({
      cwd: getRepoRootFn(),
      env: configDiscoveryEnv,
      skillDirs: resourceOptions.additionalSkillPaths ?? [],
    });
    const parsedMcpConfig = readMcpConfigDocument({
      path: mergedMcpConfig.baseConfigPath,
      exists: mergedMcpConfig.baseConfigExists || Object.keys(mergedMcpConfig.document.mcpServers).length > 0,
      searchedPaths: mergedMcpConfig.searchedPaths,
      document: mergedMcpConfig.document,
    });
    const explicitServerNames = new Set(mergedMcpConfig.baseServerNames);
    const bundledManifestByServerName = new Map<string, ReturnType<typeof readBundledSkillMcpManifests>[number]>();
    for (const manifest of bundledSkillManifests) {
      for (const serverName of manifest.serverNames) {
        bundledManifestByServerName.set(serverName, manifest);
      }
    }
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
      mcp: {
        configPath: parsedMcpConfig.path,
        configExists: mergedMcpConfig.baseConfigExists,
        searchedPaths: parsedMcpConfig.searchedPaths,
        servers: parsedMcpConfig.servers.map((server) => {
          const bundledManifest = bundledManifestByServerName.get(server.name);
          const source = explicitServerNames.has(server.name) ? 'config' : 'skill';
          const callbackUrl = buildMcpCallbackUrl({
            callbackHost: server.callbackHost,
            callbackPort: server.callbackPort,
            callbackPath: server.callbackPath,
          });
          return {
            name: server.name,
            transport: server.transport,
            command: server.command,
            args: [...server.args],
            cwd: server.cwd,
            url: server.url,
            source,
            sourcePath: source === 'skill' ? bundledManifest?.manifestPath : parsedMcpConfig.path,
            skillName: source === 'skill' ? bundledManifest?.skillName : undefined,
            skillPath: source === 'skill' ? bundledManifest?.skillDir : undefined,
            manifestPath: source === 'skill' ? bundledManifest?.manifestPath : undefined,
            hasOAuth: Boolean(server.oauthClientInfo || server.oauthClientMetadata || callbackUrl),
            callbackUrl,
            authorizeResource: server.authorizeResource,
            raw: {},
          };
        }),
        bundledSkills: bundledSkillManifests.map((manifest) => ({
          skillName: manifest.skillName,
          skillPath: manifest.skillDir,
          manifestPath: manifest.manifestPath,
          serverNames: [...manifest.serverNames],
          overriddenServerNames: manifest.serverNames.filter((serverName) => explicitServerNames.has(serverName)),
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

import type { Express, Request, Response } from 'express';
import { listProfiles, readPackageSourceTargetState } from '@personal-agent/resources';
import {
  buildMergedMcpConfigDocument,
  inspectCliBinary,
  readBundledSkillMcpManifests,
  readMcpConfigDocument,
} from '@personal-agent/core';
import type { ExtensionFactory } from '@mariozechner/pi-coding-agent';
import type { LiveSessionResourceOptions, ServerRouteContext } from './context.js';
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

function initializeToolsRoutesContext(
  context: Pick<ServerRouteContext, 'getCurrentProfile' | 'getRepoRoot' | 'getProfilesRoot' | 'buildLiveSessionResourceOptions' | 'buildLiveSessionExtensionFactories' | 'withTemporaryProfileAgentDir'>,
): void {
  getCurrentProfileFn = context.getCurrentProfile;
  getRepoRootFn = context.getRepoRoot;
  getProfilesRootFn = context.getProfilesRoot;
  buildLiveSessionResourceOptionsFn = context.buildLiveSessionResourceOptions;
  buildLiveSessionExtensionFactoriesFn = context.buildLiveSessionExtensionFactories;
  withTemporaryProfileAgentDirFn = context.withTemporaryProfileAgentDir;
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
    const resourceOptions = buildLiveSessionResourceOptionsFn(profile);
    const details = await withTemporaryProfileAgentDirFn(profile, (agentDir) => inspectAvailableTools(getRepoRootFn(), {
      ...resourceOptions,
      agentDir,
      extensionFactories: buildLiveSessionExtensionFactoriesFn(),
    }));
    const bundledSkillManifests = readBundledSkillMcpManifests(resourceOptions.additionalSkillPaths ?? []);
    const mergedMcpConfig = buildMergedMcpConfigDocument({
      cwd: getRepoRootFn(),
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
      profile,
      ...details,
      dependentCliTools,
      mcp: {
        configPath: parsedMcpConfig.path,
        configExists: mergedMcpConfig.baseConfigExists,
        searchedPaths: parsedMcpConfig.searchedPaths,
        servers: parsedMcpConfig.servers.map((server) => {
          const bundledManifest = bundledManifestByServerName.get(server.name);
          const source = explicitServerNames.has(server.name) ? 'config' : 'skill';
          return {
            name: server.name,
            transport: server.transport,
            command: server.command,
            args: [...server.args],
            cwd: server.cwd,
            url: server.url,
            source,
            skillName: source === 'skill' ? bundledManifest?.skillName : undefined,
            skillPath: source === 'skill' ? bundledManifest?.skillDir : undefined,
            manifestPath: source === 'skill' ? bundledManifest?.manifestPath : undefined,
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
    res.status(message.startsWith('Unknown profile:') ? 400 : 500).json({ error: message });
  }
}

export function registerToolsRoutes(
  app: Pick<Express, 'get'>,
  context: Pick<ServerRouteContext, 'getCurrentProfile' | 'getRepoRoot' | 'getProfilesRoot' | 'buildLiveSessionResourceOptions' | 'buildLiveSessionExtensionFactories' | 'withTemporaryProfileAgentDir'>,
): void {
  initializeToolsRoutesContext(context);
  app.get('/api/tools', handleToolsRequest);
}

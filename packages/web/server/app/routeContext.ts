import { inspectCliBinary } from '@personal-agent/core';
import { getProfilesRoot } from '@personal-agent/core';
import type { ScannedDurableRun } from '@personal-agent/daemon';
import { buildExecutionTargetsState } from '../workspace/remoteExecution.js';
import type {
  CurrentProfileTaskSummary,
  MemoryDocSummary,
  ProfileAgentItemSummary,
  ServerRouteContext,
  SkillSummary,
} from '../routes/context.js';

interface CreateServerRouteContextOptions {
  repoRoot: string;
  settingsFile: string;
  authFile: string;
  getCurrentProfile: () => string;
  setCurrentProfile: (profile: string) => Promise<string>;
  listAvailableProfiles: () => string[];
  getCurrentProfileSettingsFile: () => string;
  materializeWebProfile: (profile: string) => void;
  getStateRoot: () => string;
  serverPort: number;
  getDefaultWebCwd: () => string;
  resolveRequestedCwd: (cwd: string | null | undefined, defaultCwd?: string) => string | undefined;
  buildLiveSessionResourceOptions: ServerRouteContext['buildLiveSessionResourceOptions'];
  buildLiveSessionExtensionFactories: ServerRouteContext['buildLiveSessionExtensionFactories'];
  flushLiveDeferredResumes: () => Promise<void>;
  getSavedWebUiPreferences: ServerRouteContext['getSavedWebUiPreferences'];
  listActivityForCurrentProfile: () => Array<{ read?: boolean }>;
  listTasksForCurrentProfile: () => CurrentProfileTaskSummary[];
  listMemoryDocs: () => MemoryDocSummary[];
  listSkillsForCurrentProfile: () => SkillSummary[];
  listProfileAgentItems: () => ProfileAgentItemSummary[];
  withTemporaryProfileAgentDir: ServerRouteContext['withTemporaryProfileAgentDir'];
  browseRemoteTargetDirectory: ServerRouteContext['browseRemoteTargetDirectory'];
  getDurableRunSnapshot: ServerRouteContext['getDurableRunSnapshot'];
  draftWorkspaceCommitMessage: ServerRouteContext['draftWorkspaceCommitMessage'];
  listDurableRuns: () => Promise<{ runs: ScannedDurableRun[] }>;
}

export function createServerRouteContext(options: CreateServerRouteContextOptions): ServerRouteContext {
  async function readExecutionTargetsState() {
    return buildExecutionTargetsState({
      runs: (await options.listDurableRuns()).runs,
      inspectSshBinary: () => inspectCliBinary({ command: 'ssh', cwd: options.repoRoot, versionArgs: ['-V'] }),
    });
  }

  return {
    getCurrentProfile: options.getCurrentProfile,
    setCurrentProfile: options.setCurrentProfile,
    listAvailableProfiles: options.listAvailableProfiles,
    getRepoRoot: () => options.repoRoot,
    getProfilesRoot,
    getCurrentProfileSettingsFile: options.getCurrentProfileSettingsFile,
    materializeWebProfile: options.materializeWebProfile,
    getSettingsFile: () => options.settingsFile,
    getAuthFile: () => options.authFile,
    getStateRoot: options.getStateRoot,
    getServerPort: () => options.serverPort,
    getDefaultWebCwd: options.getDefaultWebCwd,
    resolveRequestedCwd: options.resolveRequestedCwd,
    buildLiveSessionResourceOptions: options.buildLiveSessionResourceOptions,
    buildLiveSessionExtensionFactories: options.buildLiveSessionExtensionFactories,
    flushLiveDeferredResumes: options.flushLiveDeferredResumes,
    getSavedWebUiPreferences: options.getSavedWebUiPreferences,
    listActivityForCurrentProfile: options.listActivityForCurrentProfile,
    listTasksForCurrentProfile: options.listTasksForCurrentProfile,
    listMemoryDocs: options.listMemoryDocs,
    listSkillsForCurrentProfile: options.listSkillsForCurrentProfile,
    listProfileAgentItems: options.listProfileAgentItems,
    withTemporaryProfileAgentDir: options.withTemporaryProfileAgentDir,
    readExecutionTargetsState,
    browseRemoteTargetDirectory: options.browseRemoteTargetDirectory,
    getDurableRunSnapshot: options.getDurableRunSnapshot,
    draftWorkspaceCommitMessage: options.draftWorkspaceCommitMessage,
  };
}

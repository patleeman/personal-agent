import { getProfilesRoot } from '@personal-agent/core';
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
  getSavedUiPreferences: ServerRouteContext['getSavedUiPreferences'];
  listTasksForCurrentProfile: () => CurrentProfileTaskSummary[];
  listMemoryDocs: () => MemoryDocSummary[];
  listSkillsForCurrentProfile: () => SkillSummary[];
  listProfileAgentItems: () => ProfileAgentItemSummary[];
  withTemporaryProfileAgentDir: ServerRouteContext['withTemporaryProfileAgentDir'];
  getDurableRunSnapshot: ServerRouteContext['getDurableRunSnapshot'];
}

export function createServerRouteContext(options: CreateServerRouteContextOptions): ServerRouteContext {

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
    getSavedUiPreferences: options.getSavedUiPreferences,
    listTasksForCurrentProfile: options.listTasksForCurrentProfile,
    listMemoryDocs: options.listMemoryDocs,
    listSkillsForCurrentProfile: options.listSkillsForCurrentProfile,
    listProfileAgentItems: options.listProfileAgentItems,
    withTemporaryProfileAgentDir: options.withTemporaryProfileAgentDir,
    getDurableRunSnapshot: options.getDurableRunSnapshot,
  };
}

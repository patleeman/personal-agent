import type { Express } from 'express';
import type { ExtensionFactory } from '@mariozechner/pi-coding-agent';
import type { SavedWebUiPreferences } from '../ui/webUiPreferences.js';

export interface LiveSessionResourceOptions extends Record<string, unknown> {
  additionalExtensionPaths: string[];
  additionalSkillPaths: string[];
  additionalPromptTemplatePaths: string[];
  additionalThemePaths: string[];
}

export interface CurrentProfileTaskSummary {
  id: string;
  filePath: string;
  prompt: string;
  enabled: boolean;
  running: boolean;
  cron?: string;
  model?: string;
  lastStatus?: string;
}

export interface MemoryDocSummary {
  id: string;
  title: string;
  summary?: string;
  description?: string;
  path: string;
  updated?: string;
}

export interface SkillSummary {
  name: string;
  source: string;
  description: string;
  path: string;
}

export interface ProfileAgentItemSummary {
  source: string;
  path: string;
}

export interface ServerRouteContext {
  getCurrentProfile: () => string;
  setCurrentProfile: (profile: string) => Promise<string>;
  listAvailableProfiles: () => string[];
  getRepoRoot: () => string;
  getProfilesRoot: () => string;
  getCurrentProfileSettingsFile: () => string;
  materializeWebProfile: (profile: string) => void;
  getSettingsFile: () => string;
  getAuthFile: () => string;
  getStateRoot: () => string;
  getDefaultWebCwd: () => string;
  resolveRequestedCwd: (cwd: string | null | undefined, defaultCwd?: string) => string | undefined;
  buildLiveSessionResourceOptions: (profile?: string) => LiveSessionResourceOptions;
  buildLiveSessionExtensionFactories: () => ExtensionFactory[];
  flushLiveDeferredResumes: () => Promise<void>;
  getSavedWebUiPreferences: () => SavedWebUiPreferences;
  listActivityForCurrentProfile: () => Array<{ read?: boolean }>;
  listProjectsForCurrentProfile: () => unknown[];
  listTasksForCurrentProfile: () => CurrentProfileTaskSummary[];
  listMemoryDocs: () => MemoryDocSummary[];
  listSkillsForCurrentProfile: () => SkillSummary[];
  listProfileAgentItems: () => ProfileAgentItemSummary[];
  withTemporaryProfileAgentDir: <T>(profile: string, run: (agentDir: string) => Promise<T>) => Promise<T>;
  readExecutionTargetsState: () => Promise<unknown>;
  browseRemoteTargetDirectory: (input: { targetId: string; cwd?: string; baseCwd?: string }) => Promise<unknown>;
  getDurableRunSnapshot: (runId: string, tail: number) => Promise<unknown | null>;
  draftWorkspaceCommitMessage: (input: {
    draftSource: ReturnType<typeof import('../workspace/workspaceBrowser.js').readWorkspaceGitDraftSource>;
    authFile: string;
    settingsFile: string;
  }) => Promise<unknown>;
}

export interface RegisterServerRoutesInput {
  app: Express;
  companionApp: Express;
  context: ServerRouteContext;
}

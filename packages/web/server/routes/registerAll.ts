import { setMemoryDocsProfileGetter } from '../knowledge/memoryDocs.js';
import type { RegisterServerRoutesInput } from './context.js';
import { registerActivityRoutes, setActivityRoutesProfileGetter } from './activity.js';
import { registerAlertRoutes, setAlertRoutesProfileGetter } from './alerts.js';
import { registerAuthRoutes, registerCompanionAuthRoutes } from './auth.js';
import {
  registerCompanionMemoryRoutes,
  registerCompanionModelPreferenceRoutes,
  registerCompanionNoteRoutes,
} from './companionMemory.js';
import { registerConversationStateRoutes, setConversationStateRoutesGetters } from './conversationState.js';
import { registerConversationTitlesRoutes, setConversationTitlesRoutesGetters } from './conversationTitles.js';
import {
  registerCompanionConversationRoutes,
  registerConversationRoutes,
  setConversationRoutesGetters,
} from './conversations.js';
import { registerCompanionDaemonRoutes, registerDaemonRoutes, setDaemonRoutesProfileGetter } from './daemon.js';
import { registerExecutionTargetRoutes, setExecutionTargetRoutesGetters } from './executionTargets.js';
import { registerFolderPickerRoutes, setFolderPickerCwdGetters } from './folderPicker.js';
import {
  handleLiveSessionPrompt,
  registerCompanionLiveSessionRoutes,
  registerLiveSessionRoutes,
  registerLiveSessionStatsRoutes,
  setLiveSessionPromptHandler,
  setLiveSessionRoutesGetters,
} from './liveSessions.js';
import { registerMemoryNotesRoutes, setMemoryNotesProfileGetters } from './memoryNotes.js';
import { registerCompanionModelRoutes, registerModelRoutes, setModelRoutesGetters } from './models.js';
import { registerNodeRoutes, setNodeRoutesGetters } from './nodes.js';
import { registerProfileRoutes, setProfileRoutesGetters } from './profiles.js';
import {
  registerCompanionProjectRoutes,
  registerProjectRoutes,
  setProjectRoutesGetters,
} from './projects.js';
import { registerCompanionRunRoutes, setRunsRoutesGetters } from './runs.js';
import { registerRunAppRoutes, setRunsAppRoutesGetters } from './runsApp.js';
import { registerRunsOpsRoutes } from './runsOps.js';
import { registerShellRoutes, setShellCwdGetters } from './shell.js';
import {
  registerCompanionSystemRoutes,
  registerSystemRoutes,
  setSystemRoutesGetters,
} from './system.js';
import { registerCompanionTaskRunRoutes, registerTaskRoutes, setTaskRoutesProfileGetter } from './tasks.js';
import { registerToolsRoutes, setToolsRoutesGetters } from './tools.js';
import {
  registerCompanionWebUiRoutes,
  registerWebUiRoutes,
  setWebUiRoutesGetters,
} from './webUi.js';
import { registerWorkspaceRoutes, setWorkspaceRoutesGetters } from './workspace.js';

export function registerServerRoutes({ app, companionApp, context }: RegisterServerRoutesInput): void {
  setMemoryDocsProfileGetter(context.getCurrentProfile);

  setProfileRoutesGetters(context.getCurrentProfile, context.setCurrentProfile, context.listAvailableProfiles);
  registerProfileRoutes(app);

  setDaemonRoutesProfileGetter(context.getCurrentProfile);
  registerDaemonRoutes(app);

  setTaskRoutesProfileGetter(context.getCurrentProfile);
  registerTaskRoutes(app);

  setModelRoutesGetters(
    context.getCurrentProfile,
    context.getCurrentProfileSettingsFile,
    context.materializeWebProfile,
    context.getAuthFile(),
    context.getSettingsFile(),
  );
  registerModelRoutes(app);

  setToolsRoutesGetters({
    getCurrentProfile: context.getCurrentProfile,
    getRepoRoot: context.getRepoRoot,
    getProfilesRoot: context.getProfilesRoot,
    buildLiveSessionResourceOptions: context.buildLiveSessionResourceOptions,
    buildLiveSessionExtensionFactories: context.buildLiveSessionExtensionFactories,
    withTemporaryProfileAgentDir: context.withTemporaryProfileAgentDir,
  });
  registerToolsRoutes(app);

  registerAuthRoutes(app);
  registerCompanionAuthRoutes(companionApp);

  setSystemRoutesGetters(
    context.getCurrentProfile,
    context.getRepoRoot,
    context.listActivityForCurrentProfile,
    context.listProjectsForCurrentProfile,
    context.listTasksForCurrentProfile,
  );
  registerSystemRoutes(app);

  setWebUiRoutesGetters(
    context.getCurrentProfile,
    context.getRepoRoot,
    context.getSettingsFile,
    context.getStateRoot,
    context.getDefaultWebCwd,
    context.buildLiveSessionResourceOptions,
    context.buildLiveSessionExtensionFactories,
  );
  registerWebUiRoutes(app);

  registerCompanionWebUiRoutes(companionApp);
  registerCompanionSystemRoutes(companionApp);

  setProjectRoutesGetters(
    context.getCurrentProfile,
    context.listAvailableProfiles,
    context.getRepoRoot(),
    context.getSettingsFile(),
    context.getAuthFile(),
  );
  registerProjectRoutes(app);

  setNodeRoutesGetters(context.getCurrentProfile, context.getRepoRoot);
  registerNodeRoutes(app);
  registerCompanionProjectRoutes(companionApp);

  setConversationRoutesGetters(
    context.getCurrentProfile,
    context.getRepoRoot,
    context.getSavedWebUiPreferences,
    context.flushLiveDeferredResumes,
  );
  registerConversationRoutes(app);
  registerCompanionConversationRoutes(companionApp);

  setConversationStateRoutesGetters(
    context.getCurrentProfile,
    context.getRepoRoot,
    context.buildLiveSessionResourceOptions,
    context.buildLiveSessionExtensionFactories,
    context.flushLiveDeferredResumes,
  );
  registerConversationStateRoutes(app);

  setLiveSessionRoutesGetters(
    context.getCurrentProfile,
    context.getRepoRoot,
    context.getDefaultWebCwd,
    context.buildLiveSessionResourceOptions,
    context.buildLiveSessionExtensionFactories,
    context.flushLiveDeferredResumes,
    {
      listTasksForCurrentProfile: context.listTasksForCurrentProfile,
      listMemoryDocs: context.listMemoryDocs,
      listSkillsForCurrentProfile: context.listSkillsForCurrentProfile,
      listProfileAgentItems: context.listProfileAgentItems,
    },
  );
  setLiveSessionPromptHandler(handleLiveSessionPrompt);
  registerLiveSessionRoutes(app);
  registerLiveSessionStatsRoutes(app);
  registerCompanionLiveSessionRoutes(companionApp);

  setActivityRoutesProfileGetter(context.getCurrentProfile);
  registerActivityRoutes(app);
  registerActivityRoutes(companionApp);

  setAlertRoutesProfileGetter(context.getCurrentProfile);
  registerAlertRoutes(app);

  setConversationTitlesRoutesGetters(context.getSettingsFile());
  registerConversationTitlesRoutes(app);

  setExecutionTargetRoutesGetters(context.readExecutionTargetsState, context.browseRemoteTargetDirectory);
  registerExecutionTargetRoutes(app);

  setRunsAppRoutesGetters(context.getDurableRunSnapshot);
  registerRunAppRoutes(app);

  setWorkspaceRoutesGetters(
    context.getDefaultWebCwd,
    context.resolveRequestedCwd,
    context.draftWorkspaceCommitMessage,
    context.getAuthFile(),
  );
  registerWorkspaceRoutes(app);

  setMemoryNotesProfileGetters(
    context.getCurrentProfile,
    context.getRepoRoot(),
    context.getDefaultWebCwd,
    context.resolveRequestedCwd,
    context.buildLiveSessionResourceOptions,
    context.buildLiveSessionExtensionFactories,
  );
  registerMemoryNotesRoutes(app);

  setFolderPickerCwdGetters(context.getDefaultWebCwd, context.resolveRequestedCwd);
  registerFolderPickerRoutes(app);

  setShellCwdGetters(context.getDefaultWebCwd, context.resolveRequestedCwd);
  registerShellRoutes(app);

  registerRunsOpsRoutes(app);

  registerCompanionModelRoutes(companionApp);
  registerAlertRoutes(companionApp);
  registerTaskRoutes(companionApp);
  registerCompanionTaskRunRoutes(companionApp);
  registerCompanionDaemonRoutes(companionApp);

  setRunsRoutesGetters(
    context.getCurrentProfile,
    context.getRepoRoot(),
    context.getDefaultWebCwd,
    context.buildLiveSessionResourceOptions,
    context.buildLiveSessionExtensionFactories,
  );
  registerCompanionRunRoutes(companionApp);

  registerCompanionMemoryRoutes(companionApp);
  registerCompanionNoteRoutes(companionApp);
  registerCompanionModelPreferenceRoutes(companionApp);
}

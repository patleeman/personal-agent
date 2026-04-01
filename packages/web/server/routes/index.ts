/**
 * Route modules index
 * 
 * Exports all route registration functions for the web server.
 * Routes are organized by domain (alerts, sessions, tasks, etc.).
 */

// Activity routes
export { registerActivityRoutes, setActivityRoutesProfileGetter } from './activity.js';

// Alert routes
export { registerAlertRoutes, setAlertRoutesProfileGetter } from './alerts.js';

// Tools routes
export { registerToolsRoutes, setToolsRoutesGetters } from './tools.js';

// Auth routes
export { registerAuthRoutes, registerCompanionAuthRoutes } from './auth.js';

// Profile routes
export { registerProfileRoutes, setProfileRoutesGetters } from './profiles.js';

// Daemon routes
export { registerDaemonRoutes, registerCompanionDaemonRoutes, setDaemonRoutesProfileGetter } from './daemon.js';

// Task routes
export { registerTaskRoutes, registerCompanionTaskRunRoutes, setTaskRoutesProfileGetter } from './tasks.js';

// Model and provider routes
export { registerModelRoutes, registerCompanionModelRoutes, setModelRoutesGetters } from './models.js';

// Project routes
export { registerProjectRoutes, registerCompanionProjectRoutes, setProjectRoutesGetters } from './projects.js';

// Conversation and live session routes
export { registerConversationRoutes, registerCompanionConversationRoutes, setConversationRoutesGetters } from './conversations.js';
export {
  registerLiveSessionRoutes,
  registerLiveSessionStatsRoutes,
  setLiveSessionRoutesGetters,
  setLiveSessionPromptHandler,
  registerCompanionLiveSessionRoutes,
  handleLiveSessionPrompt,
} from './liveSessions.js';

export {
  registerSystemRoutes,
  registerCompanionSystemRoutes,
  setSystemRoutesGetters,
} from './system.js';

export {
  registerWebUiRoutes,
  registerCompanionWebUiRoutes,
  setWebUiRoutesGetters,
} from './webUi.js';

export { registerConversationTitlesRoutes, setConversationTitlesRoutesGetters } from './conversationTitles.js';
export { registerExecutionTargetRoutes, setExecutionTargetRoutesGetters } from './executionTargets.js';

// Add future route modules here:
// export { registerSessionRoutes } from './sessions.js';
export { registerRunRoutes, registerCompanionRunRoutes, setRunsRoutesGetters } from './runs.js';
export { registerRunAppRoutes, setRunsAppRoutesGetters } from './runsApp.js';
export { registerWorkspaceRoutes, setWorkspaceRoutesGetters } from './workspace.js';
export { registerMemoryNotesRoutes, setMemoryNotesProfileGetters } from './memoryNotes.js';
export { registerFolderPickerRoutes, setFolderPickerCwdGetters } from './folderPicker.js';
export { registerShellRoutes, setShellCwdGetters } from './shell.js';
export { registerRunsOpsRoutes } from './runsOps.js';

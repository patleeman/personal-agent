import type { RegisterServerRoutesInput } from './context.js';
import { registerActivityRoutes } from './activity.js';
import { registerAlertRoutes } from './alerts.js';
import { registerAuthRoutes, registerCompanionAuthRoutes } from './auth.js';
import {
  registerCompanionMemoryRoutes,
  registerCompanionModelPreferenceRoutes,
  registerCompanionNoteRoutes,
} from './companionMemory.js';
import { registerConversationStateRoutes } from './conversationState.js';
import { registerConversationTitlesRoutes } from './conversationTitles.js';
import {
  registerCompanionConversationRoutes,
  registerConversationRoutes,
} from './conversations.js';
import { registerCompanionDaemonRoutes, registerDaemonRoutes } from './daemon.js';
import { registerExecutionTargetRoutes } from './executionTargets.js';
import { registerFolderPickerRoutes } from './folderPicker.js';
import {
  registerCompanionLiveSessionRoutes,
  registerLiveSessionRoutes,
  registerLiveSessionStatsRoutes,
} from './liveSessions.js';
import { registerMemoryNotesRoutes } from './memoryNotes.js';
import { registerCompanionModelRoutes, registerModelRoutes } from './models.js';
import { registerNodeRoutes } from './nodes.js';
import { registerProfileRoutes } from './profiles.js';
import {
  registerCompanionProjectRoutes,
  registerProjectRoutes,
} from './projects.js';
import { registerCompanionRunRoutes } from './runs.js';
import { registerRunAppRoutes } from './runsApp.js';
import { registerRunsOpsRoutes } from './runsOps.js';
import { registerShellRoutes } from './shell.js';
import {
  registerCompanionSystemRoutes,
  registerSystemRoutes,
} from './system.js';
import { registerCompanionTaskRunRoutes, registerTaskRoutes } from './tasks.js';
import { registerToolsRoutes } from './tools.js';
import {
  registerCompanionWebUiRoutes,
  registerWebUiRoutes,
} from './webUi.js';
import { registerWorkspaceRoutes } from './workspace.js';

export function registerServerRoutes({ app, companionApp, context }: RegisterServerRoutesInput): void {
  registerProfileRoutes(app, context);

  registerDaemonRoutes(app);

  registerTaskRoutes(app, context);

  registerModelRoutes(app, context);

  registerToolsRoutes(app, context);

  registerAuthRoutes(app);
  registerCompanionAuthRoutes(companionApp);

  registerSystemRoutes(app, context);

  registerWebUiRoutes(app, context);

  registerCompanionWebUiRoutes(companionApp, context);
  registerCompanionSystemRoutes(companionApp, context);

  registerProjectRoutes(app, context);

  registerNodeRoutes(app, context);
  registerCompanionProjectRoutes(companionApp, context);

  registerConversationRoutes(app, context);
  registerCompanionConversationRoutes(companionApp, context);

  registerConversationStateRoutes(app, context);

  registerLiveSessionRoutes(app, context);
  registerLiveSessionStatsRoutes(app, context);
  registerCompanionLiveSessionRoutes(companionApp, context);

  registerActivityRoutes(app, context);
  registerActivityRoutes(companionApp, context);

  registerAlertRoutes(app, context);

  registerConversationTitlesRoutes(app, context);

  registerExecutionTargetRoutes(app, context);

  registerRunAppRoutes(app, context);

  registerWorkspaceRoutes(app, context);

  registerMemoryNotesRoutes(app, context);

  registerFolderPickerRoutes(app, context);

  registerShellRoutes(app, context);

  registerRunsOpsRoutes(app, context);

  registerCompanionModelRoutes(companionApp, context);
  registerAlertRoutes(companionApp, context);
  registerTaskRoutes(companionApp, context);
  registerCompanionTaskRunRoutes(companionApp, context);
  registerCompanionDaemonRoutes(companionApp);

  registerCompanionRunRoutes(companionApp);

  registerCompanionMemoryRoutes(companionApp, context);
  registerCompanionNoteRoutes(companionApp, context);
  registerCompanionModelPreferenceRoutes(companionApp);
}

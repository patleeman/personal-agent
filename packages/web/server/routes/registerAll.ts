import type { RegisterServerRoutesInput } from './context.js';
import { registerAuthRoutes } from './auth.js';
import { registerConversationStateRoutes } from './conversationState.js';
import { registerConversationTitlesRoutes } from './conversationTitles.js';
import { registerConversationRoutes } from './conversations.js';
import { registerDaemonRoutes } from './daemon.js';
import { registerFolderPickerRoutes } from './folderPicker.js';
import { registerLiveSessionRoutes } from './liveSessions.js';
import { registerMemoryNotesRoutes } from './memoryNotes.js';
import { registerModelRoutes } from './models.js';
import { registerProfileRoutes } from './profiles.js';
import { registerRunAppRoutes } from './runsApp.js';
import { registerRunsOpsRoutes } from './runsOps.js';
import { registerSystemRoutes } from './system.js';
import { registerTaskRoutes } from './tasks.js';
import { registerToolsRoutes } from './tools.js';
import { registerWebUiRoutes } from './webUi.js';

export function registerServerRoutes({ app, context }: RegisterServerRoutesInput): void {
  registerProfileRoutes(app, context);

  registerDaemonRoutes(app);

  registerTaskRoutes(app, context);

  registerModelRoutes(app, context);

  registerToolsRoutes(app, context);

  registerAuthRoutes(app);

  registerSystemRoutes(app, context);

  registerWebUiRoutes(app, context);

  registerConversationRoutes(app, context);

  registerConversationStateRoutes(app, context);

  registerLiveSessionRoutes(app, context);


  registerConversationTitlesRoutes(app, context);

  registerRunAppRoutes(app, context);

  registerMemoryNotesRoutes(app, context);

  registerFolderPickerRoutes(app, context);

  registerRunsOpsRoutes(app);
}

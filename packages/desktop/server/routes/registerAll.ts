import type { RegisterServerRoutesInput } from './context.js';
import { registerConversationStateRoutes } from './conversationState.js';
import { registerConversationTitlesRoutes } from './conversationTitles.js';
import { registerConversationRoutes } from './conversations.js';
import { registerDaemonRoutes } from './daemon.js';
import { registerFilePickerRoutes } from './filePicker.js';
import { registerFolderPickerRoutes } from './folderPicker.js';
import { registerLiveSessionRoutes } from './liveSessions.js';
import { registerMemoryNotesRoutes } from './memoryNotes.js';
import { registerModelRoutes } from './models.js';
import { registerRunAppRoutes } from './runsApp.js';
import { registerRunsOpsRoutes } from './runsOps.js';
import { registerVaultEditorRoutes } from './vaultEditor.js';
import { registerSystemRoutes } from './system.js';
import { registerTaskRoutes } from './tasks.js';
import { registerToolsRoutes } from './tools.js';
import { registerTranscriptionRoutes } from './transcription.js';
import { registerUiPreferenceRoutes } from './uiPreferences.js';
import { registerWorkspaceExplorerRoutes } from './workspaceExplorer.js';

export function registerServerRoutes({ app, context }: RegisterServerRoutesInput): void {
  registerDaemonRoutes(app);

  registerTaskRoutes(app, context);

  registerModelRoutes(app, context);

  registerTranscriptionRoutes(app, context);

  registerToolsRoutes(app, context);

  registerSystemRoutes(app, context);

  registerUiPreferenceRoutes(app, context);

  registerConversationRoutes(app, context);

  registerConversationStateRoutes(app, context);

  registerLiveSessionRoutes(app, context);


  registerConversationTitlesRoutes(app, context);

  registerRunAppRoutes(app, context);

  registerMemoryNotesRoutes(app, context);

  registerFilePickerRoutes(app, context);
  registerFolderPickerRoutes(app, context);
  registerWorkspaceExplorerRoutes(app, context);

  registerVaultEditorRoutes(app);

  registerRunsOpsRoutes(app);
}

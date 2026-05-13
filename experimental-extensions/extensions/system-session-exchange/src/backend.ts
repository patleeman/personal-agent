import type { ExtensionBackendContext } from '@personal-agent/extensions/backend';
import { exportConversationSession, importConversationSession } from '@personal-agent/extensions/backend/conversations';

interface ExportSessionInput {
  conversationId?: string;
  sessionTitle?: string;
}

interface ImportSessionInput {
  filePath?: string;
}

export function exportSession(input: ExportSessionInput, ctx: ExtensionBackendContext) {
  const result = exportConversationSession(input);
  ctx.notify.toast(`Exported session to ${result.exportPath}`, 'info');
  return result;
}

export function importSession(input: ImportSessionInput, ctx: ExtensionBackendContext) {
  const result = importConversationSession(input);
  ctx.notify.toast(
    result.importedAsNewId ? `Imported session as ${result.conversationId}` : `Imported session ${result.conversationId}`,
    'info',
  );
  return result;
}

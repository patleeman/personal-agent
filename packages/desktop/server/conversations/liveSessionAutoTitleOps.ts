import type { AgentSession, ModelRegistry } from '@mariozechner/pi-coding-agent';
import {
  generateConversationTitle,
  hasAssistantTitleSourceMessage,
} from './conversationAutoTitle.js';
import { getSessionMessages } from './liveSessionTitle.js';

export interface LiveSessionAutoTitleHost {
  sessionId: string;
  session: AgentSession & { modelRegistry: ModelRegistry };
  autoTitleRequested: boolean;
}

export function requestLiveSessionAutoTitle(input: {
  entry: LiveSessionAutoTitleHost;
  settingsFile: string;
  isCurrent: () => boolean;
  applyTitle: (title: string) => void;
}): void {
  const { entry } = input;
  if (entry.autoTitleRequested) {
    return;
  }

  if (entry.session.sessionName?.trim()) {
    entry.autoTitleRequested = true;
    return;
  }

  const messages = getSessionMessages(entry.session);
  if (!hasAssistantTitleSourceMessage(messages)) {
    return;
  }

  entry.autoTitleRequested = true;
  void generateConversationTitle({
    messages,
    modelRegistry: entry.session.modelRegistry,
    settingsFile: input.settingsFile,
  })
    .then((title) => {
      if (!input.isCurrent()) {
        return;
      }

      if (entry.session.sessionName?.trim()) {
        entry.autoTitleRequested = true;
        return;
      }

      if (!title) {
        entry.autoTitleRequested = false;
        return;
      }

      input.applyTitle(title);
    })
    .catch((error) => {
      if (input.isCurrent() && !entry.session.sessionName?.trim()) {
        entry.autoTitleRequested = false;
      }

      const message = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : undefined;
      console.error(`[${new Date().toISOString()}] [web] [error] conversation auto-title failed sessionId=${entry.sessionId} message=${message}`);
      if (stack) {
        console.error(stack);
      }
    });
}

import type { AgentMessage } from '@mariozechner/pi-agent-core';
import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import {
  buildConversationAutomationPromptContext,
  buildConversationAutomationSystemPromptPolicy,
  loadConversationAutomationState,
} from './conversationAutomation.js';

interface SessionEntryLike {
  type?: string;
  message?: {
    role?: string;
    customType?: string;
  };
}

interface SessionManagerLike {
  getSessionId: () => string;
  getEntries?: () => SessionEntryLike[];
}

interface ConversationAutomationPromptRuntime {
  rescuePending: boolean;
  rescueInjected: boolean;
}

function hasRelevantAutomationState(document: ReturnType<typeof loadConversationAutomationState>['document']): boolean {
  const hasOpenItems = document.items.some((item) => item.status === 'pending' || item.status === 'running' || item.status === 'waiting');
  const reviewActive = document.review?.status === 'pending' || document.review?.status === 'running';
  return hasOpenItems || reviewActive || Boolean(document.waitingForUser);
}

function readLastNonAssistantTurn(sessionManager: SessionManagerLike): SessionEntryLike['message'] | null {
  const entries = sessionManager.getEntries?.() ?? [];

  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const message = entries[index]?.type === 'message'
      ? entries[index]?.message
      : undefined;

    if (!message) {
      continue;
    }

    if (message.role === 'user' || message.role === 'custom') {
      return message;
    }
  }

  return null;
}

function isAutomationAuthoredTurn(sessionManager: SessionManagerLike): boolean {
  const lastTurn = readLastNonAssistantTurn(sessionManager);
  return lastTurn?.role === 'custom' && typeof lastTurn.customType === 'string' && lastTurn.customType.startsWith('conversation_automation_');
}

function appendPromptSection(base: string, section: string): string {
  const trimmedSection = section.trim();
  if (!trimmedSection) {
    return base;
  }

  return `${base}\n\n${trimmedSection}`;
}

function buildRescueMessage(promptContext: string): AgentMessage {
  return {
    role: 'custom',
    customType: 'conversation_automation_rescue',
    content: promptContext,
    display: false,
    timestamp: Date.now(),
  };
}

export function createConversationAutomationPromptExtension(options: {
  stateRoot?: string;
  settingsFile?: string;
  getCurrentProfile: () => string;
}): (pi: ExtensionAPI) => void {
  return (pi: ExtensionAPI) => {
    const promptRuntimeByConversationId = new Map<string, ConversationAutomationPromptRuntime>();

    function readConversationState(conversationId: string) {
      const profile = options.getCurrentProfile();
      return loadConversationAutomationState({
        stateRoot: options.stateRoot,
        settingsFile: options.settingsFile,
        profile,
        conversationId,
      }).document;
    }

    function readSessionManager(ctx: { sessionManager: unknown }): SessionManagerLike {
      return ctx.sessionManager as SessionManagerLike;
    }

    pi.on('before_agent_start', (event, ctx) => {
      const sessionManager = readSessionManager(ctx);
      const conversationId = sessionManager.getSessionId();
      const document = readConversationState(conversationId);

      if (!hasRelevantAutomationState(document)) {
        return undefined;
      }

      const systemPrompt = event.systemPrompt?.trim();
      if (!systemPrompt) {
        return undefined;
      }

      let nextSystemPrompt = appendPromptSection(event.systemPrompt, buildConversationAutomationSystemPromptPolicy());
      if (!isAutomationAuthoredTurn(sessionManager)) {
        nextSystemPrompt = appendPromptSection(nextSystemPrompt, buildConversationAutomationPromptContext(document));
      }

      return {
        systemPrompt: nextSystemPrompt,
      };
    });

    pi.on('agent_start', (_event, ctx) => {
      const conversationId = readSessionManager(ctx).getSessionId();
      promptRuntimeByConversationId.set(conversationId, {
        rescuePending: false,
        rescueInjected: false,
      });
    });

    pi.on('tool_execution_end', (_event, ctx) => {
      const conversationId = readSessionManager(ctx).getSessionId();
      const runtime = promptRuntimeByConversationId.get(conversationId) ?? {
        rescuePending: false,
        rescueInjected: false,
      };

      if (!runtime.rescueInjected) {
        runtime.rescuePending = true;
      }

      promptRuntimeByConversationId.set(conversationId, runtime);
    });

    pi.on('context', (event, ctx) => {
      const sessionManager = readSessionManager(ctx);
      const conversationId = sessionManager.getSessionId();
      const runtime = promptRuntimeByConversationId.get(conversationId);

      if (!runtime?.rescuePending || runtime.rescueInjected) {
        return undefined;
      }

      runtime.rescuePending = false;
      if (isAutomationAuthoredTurn(sessionManager)) {
        return undefined;
      }

      const document = readConversationState(conversationId);
      const promptContext = buildConversationAutomationPromptContext(document);
      if (!promptContext) {
        return undefined;
      }

      runtime.rescueInjected = true;
      return {
        messages: [...event.messages, buildRescueMessage(promptContext)],
      };
    });

    pi.on('agent_end', (_event, ctx) => {
      const conversationId = readSessionManager(ctx).getSessionId();
      promptRuntimeByConversationId.delete(conversationId);
    });
  };
}

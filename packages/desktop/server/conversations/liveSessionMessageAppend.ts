import type { AgentSession } from '@earendil-works/pi-coding-agent';

import { buildFallbackTitleFromContent, isPlaceholderConversationTitle } from './liveSessionTitle.js';

export interface LiveSessionMessageAppendHost {
  sessionId: string;
  session: AgentSession;
  title: string;
}

const RELATED_CONVERSATION_POINTERS_CUSTOM_TYPE = 'related_conversation_pointers';

function assertVisibleCustomMessage(message: { customType?: string; display?: boolean }): void {
  if (message.display === false) {
    throw new Error(`Custom transcript message "${message.customType ?? 'unknown'}" must be visible.`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function hasQueuedPromptContext(entry: LiveSessionMessageAppendHost, customType: string): boolean {
  if (customType !== RELATED_CONVERSATION_POINTERS_CUSTOM_TYPE) {
    return false;
  }

  const messages = Array.isArray(entry.session.state?.messages) ? entry.session.state.messages : [];
  return messages.some((message) => isRecord(message) && message.role === 'custom' && message.customType === customType);
}

export async function queueLiveSessionPromptContext(
  entry: LiveSessionMessageAppendHost,
  customType: string,
  content: string,
): Promise<void> {
  const message = content.trim();
  if (!message || hasQueuedPromptContext(entry, customType)) {
    return;
  }

  const customMessage = {
    customType,
    content: message,
    display: true,
    details: undefined,
  };
  assertVisibleCustomMessage(customMessage);

  if (entry.session.isStreaming) {
    await entry.session.sendCustomMessage(customMessage, {
      deliverAs: 'nextTurn',
    });
    return;
  }

  await entry.session.sendCustomMessage(customMessage);
}

export async function appendDetachedLiveSessionUserMessage<TEntry extends LiveSessionMessageAppendHost>(
  entry: TEntry,
  text: string,
  callbacks: {
    broadcastTitle: (entry: TEntry) => void;
    publishSessionMetaChanged: (sessionId: string) => void;
  },
): Promise<void> {
  if (entry.session.isStreaming) {
    throw new Error(`Session ${entry.sessionId} is currently streaming`);
  }

  const normalizedText = text.trim();
  if (!normalizedText) {
    return;
  }

  const message = {
    role: 'user' as const,
    content: [{ type: 'text' as const, text: normalizedText }],
    timestamp: Date.now(),
  };

  entry.session.state.messages = [...entry.session.state.messages, message];
  entry.session.sessionManager.appendMessage(message);

  if (!entry.session.sessionName?.trim() && isPlaceholderConversationTitle(entry.title)) {
    const fallbackTitle = buildFallbackTitleFromContent(message.content);
    if (fallbackTitle) {
      entry.title = fallbackTitle;
      callbacks.broadcastTitle(entry);
    }
  }

  callbacks.publishSessionMetaChanged(entry.sessionId);
}

export async function appendVisibleLiveSessionCustomMessage<TEntry extends LiveSessionMessageAppendHost>(
  entry: TEntry,
  customType: string,
  content: string,
  details: unknown,
  callbacks: {
    broadcastSnapshot: (entry: TEntry) => void;
    publishSessionMetaChanged: (sessionId: string) => void;
  },
): Promise<void> {
  if (entry.session.isStreaming) {
    throw new Error(`Session ${entry.sessionId} is currently streaming`);
  }

  const message = content.trim();
  if (!message) {
    return;
  }

  const customMessage = {
    customType,
    content: message,
    display: true,
    details,
  };
  assertVisibleCustomMessage(customMessage);
  await entry.session.sendCustomMessage(customMessage);
  callbacks.broadcastSnapshot(entry);
  callbacks.publishSessionMetaChanged(entry.sessionId);
}

export async function appendParallelImportedLiveSessionMessage<TEntry extends LiveSessionMessageAppendHost>(
  entry: TEntry,
  content: string,
  details: { childConversationId: string; status: 'complete' | 'failed' },
  callbacks: {
    appendDetachedUserMessage: (entry: TEntry, text: string) => Promise<void>;
    broadcastSnapshot: (entry: TEntry) => void;
    publishSessionMetaChanged: (sessionId: string) => void;
  },
): Promise<void> {
  await callbacks.appendDetachedUserMessage(entry, content);

  const customMessage = {
    customType: 'parallel_result',
    content: `Imported parallel response from ${details.childConversationId}.`,
    display: true,
    details,
  };
  assertVisibleCustomMessage(customMessage);
  await entry.session.sendCustomMessage(customMessage);
  callbacks.broadcastSnapshot(entry);
  callbacks.publishSessionMetaChanged(entry.sessionId);
}

import { type AgentSession } from '@mariozechner/pi-coding-agent';
import { readSessionMetaByFile } from './sessions.js';
import { resolveLiveSessionFile } from './liveSessionPersistence.js';

function summarizeUserMessageContent(content: unknown): { text: string; imageCount: number } {
  const blocks = Array.isArray(content)
    ? content as Array<{ type?: string; text?: string }>
    : typeof content === 'string'
      ? [{ type: 'text', text: content }]
      : [];

  const text = blocks
    .filter((block) => block.type === 'text')
    .map((block) => block.text ?? '')
    .join('\n')
    .trim();
  const imageCount = blocks.filter((block) => block.type === 'image').length;

  return { text, imageCount };
}

function formatConversationTitle(text: string, imageCount: number): string {
  return text.trim().replace(/\n/g, ' ').slice(0, 80)
    || (imageCount === 1 ? '(image attachment)' : imageCount > 1 ? `(${imageCount} image attachments)` : '');
}

export function getSessionMessages(session: AgentSession): Array<{ role?: string; content?: unknown }> {
  const stateMessages = (session as AgentSession & {
    state?: { messages?: Array<{ role?: string; content?: unknown }> };
    agent?: { state?: { messages?: Array<{ role?: string; content?: unknown }> } };
  }).state?.messages;

  if (Array.isArray(stateMessages)) {
    return stateMessages;
  }

  const agentMessages = (session as AgentSession & {
    agent?: { state?: { messages?: Array<{ role?: string; content?: unknown }> } };
  }).agent?.state?.messages;

  return Array.isArray(agentMessages) ? agentMessages : [];
}

export function buildFallbackTitleFromContent(content: unknown): string {
  const { text, imageCount } = summarizeUserMessageContent(content);
  return formatConversationTitle(text, imageCount);
}

export function isPlaceholderConversationTitle(title: string | null | undefined): boolean {
  const normalized = title?.trim().toLowerCase();
  return !normalized || normalized === 'new conversation' || normalized === '(new conversation)';
}

export function resolveStableSessionTitle(session: AgentSession): string {
  const sessionName = session.sessionName?.trim();
  if (sessionName) {
    return sessionName;
  }

  const sessionFile = resolveLiveSessionFile(session);
  if (sessionFile) {
    const persistedTitle = readSessionMetaByFile(sessionFile)?.title?.trim();
    if (persistedTitle && !isPlaceholderConversationTitle(persistedTitle)) {
      return persistedTitle;
    }
  }

  const firstUser = getSessionMessages(session).find((message) => message.role === 'user');
  if (!firstUser) {
    return '';
  }

  return buildFallbackTitleFromContent(firstUser.content);
}

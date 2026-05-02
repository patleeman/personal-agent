import {
  cancelDeferredResumeForSessionFile,
  fireDeferredResumeNowForSessionFile,
  listDeferredResumesForSessionFile,
  scheduleDeferredResumeForSessionFile,
} from '../automation/deferredResumes.js';
import {
  publishConversationSessionMetaChanged,
  resolveConversationSessionFile,
} from './conversationService.js';

export class ConversationDeferredResumeCapabilityNotFoundError extends Error {
  constructor(message = 'Conversation not found') {
    super(message);
    this.name = 'ConversationDeferredResumeCapabilityNotFoundError';
  }
}

function resolveRequiredConversationSessionFile(conversationIdInput: string): { conversationId: string; sessionFile: string } {
  const conversationId = conversationIdInput.trim();
  const sessionFile = resolveConversationSessionFile(conversationId);
  if (!conversationId || !sessionFile) {
    throw new ConversationDeferredResumeCapabilityNotFoundError();
  }

  return { conversationId, sessionFile };
}

export function readConversationDeferredResumesCapability(conversationIdInput: string) {
  const { conversationId, sessionFile } = resolveRequiredConversationSessionFile(conversationIdInput);
  return {
    conversationId,
    resumes: listDeferredResumesForSessionFile(sessionFile),
  };
}

export async function scheduleConversationDeferredResumeCapability(input: {
  conversationId: string;
  delay?: string;
  prompt?: string;
  behavior?: 'steer' | 'followUp';
}) {
  const { conversationId, sessionFile } = resolveRequiredConversationSessionFile(input.conversationId);
  const delay = input.delay?.trim();
  if (!delay) {
    throw new Error('delay is required');
  }

  if (input.behavior !== undefined && input.behavior !== 'steer' && input.behavior !== 'followUp') {
    throw new Error('behavior must be "steer" or "followUp"');
  }

  const resume = await scheduleDeferredResumeForSessionFile({
    sessionFile,
    delay,
    prompt: input.prompt,
    behavior: input.behavior,
  });

  publishConversationSessionMetaChanged(conversationId);
  return {
    conversationId,
    resume,
    resumes: listDeferredResumesForSessionFile(sessionFile),
  };
}

export async function cancelConversationDeferredResumeCapability(input: {
  conversationId: string;
  resumeId: string;
}) {
  const { conversationId, sessionFile } = resolveRequiredConversationSessionFile(input.conversationId);

  await cancelDeferredResumeForSessionFile({
    sessionFile,
    id: input.resumeId,
  });

  publishConversationSessionMetaChanged(conversationId);
  return {
    conversationId,
    cancelledId: input.resumeId,
    resumes: listDeferredResumesForSessionFile(sessionFile),
  };
}

export async function fireConversationDeferredResumeCapability(input: {
  conversationId: string;
  resumeId: string;
  flushLiveDeferredResumes?: () => Promise<void>;
}) {
  const { conversationId, sessionFile } = resolveRequiredConversationSessionFile(input.conversationId);

  const resume = await fireDeferredResumeNowForSessionFile({
    sessionFile,
    id: input.resumeId,
  });

  await input.flushLiveDeferredResumes?.();
  publishConversationSessionMetaChanged(conversationId);
  return {
    conversationId,
    resume,
    resumes: listDeferredResumesForSessionFile(sessionFile),
  };
}

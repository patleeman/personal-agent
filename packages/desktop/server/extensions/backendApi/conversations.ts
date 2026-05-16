import { callServerModuleExport } from './serverModuleResolver.js';

export const CONVERSATION_INSPECT_SCOPE_VALUES = ['all', 'live', 'running', 'archived'] as const;
export const CONVERSATION_INSPECT_ACTION_VALUES = ['list', 'search', 'query', 'diff', 'outline', 'read_window'] as const;
export const CONVERSATION_INSPECT_ORDER_VALUES = ['asc', 'desc'] as const;
export const CONVERSATION_INSPECT_BLOCK_TYPE_VALUES = ['user', 'text', 'context', 'summary', 'tool_use', 'image', 'error'] as const;
export const CONVERSATION_INSPECT_ROLE_VALUES = ['user', 'assistant', 'tool', 'context', 'summary', 'image', 'error'] as const;
export const CONVERSATION_INSPECT_SEARCH_MODE_VALUES = ['phrase', 'allTerms', 'anyTerm'] as const;

export async function normalizeGeneratedConversationTitle(...args: unknown[]) {
  return callModuleExport('../../conversations/conversationAutoTitle.js', 'normalizeGeneratedConversationTitle', ...args);
}

export async function resolveRequestedCwd(...args: unknown[]) {
  return callModuleExport('../../conversations/conversationCwd.js', 'resolveRequestedCwd', ...args);
}

export async function querySessionSuggestedPointerIds(...args: unknown[]) {
  return callModuleExport('@personal-agent/core', 'querySessionSuggestedPointerIds', ...args);
}

async function callModuleExport<T>(specifier: string, name: string, ...args: unknown[]): Promise<T> {
  try {
    return await callServerModuleExport<T>(specifier, name, ...args);
  } catch (error) {
    if (error instanceof Error && error.message === `Backend API export ${name} is unavailable.`) {
      throw new Error(`Conversation backend API export ${name} is unavailable.`);
    }
    throw error;
  }
}

export async function executeConversationInspect(...args: unknown[]) {
  return callModuleExport('../../conversations/conversationInspectWorkerClient.js', 'executeConversationInspect', ...args);
}

export async function scheduleConversationSearchIndexing(...args: unknown[]) {
  return callModuleExport<void>('../../conversations/conversationSearchIndex.js', 'scheduleConversationSearchIndexing', ...args);
}

export async function searchIndexedConversationDocuments(...args: unknown[]) {
  return callModuleExport<Array<Record<string, unknown>>>(
    '../../conversations/conversationSearchIndex.js',
    'searchIndexedConversationDocuments',
    ...args,
  );
}

export async function readSessionDetailForRoute(...args: unknown[]) {
  return callModuleExport('../../conversations/conversationService.js', 'readSessionDetailForRoute', ...args);
}

export async function readConversationSessionMetaCapability(...args: unknown[]) {
  return callModuleExport('../../conversations/conversationSessionCapability.js', 'readConversationSessionMetaCapability', ...args);
}

export async function readConversationSessionsCapability(...args: unknown[]) {
  return callModuleExport('../../conversations/conversationSessionCapability.js', 'readConversationSessionsCapability', ...args);
}

export async function readConversationSessionSearchIndexCapability(...args: unknown[]) {
  return callModuleExport('../../conversations/conversationSessionCapability.js', 'readConversationSessionSearchIndexCapability', ...args);
}

export async function readConversationSummary(...args: unknown[]) {
  return callModuleExport<Record<string, unknown> | undefined>(
    '../../conversations/conversationSummaries.js',
    'readConversationSummary',
    ...args,
  );
}

export async function createSession(...args: unknown[]) {
  return callModuleExport('../../conversations/liveSessions.js', 'createSession', ...args);
}

export async function createConversation(...args: unknown[]) {
  const capability = await callModuleExport<Record<string, (...methodArgs: unknown[]) => Promise<unknown>>>(
    '../extensionConversations.js',
    'createExtensionConversationsCapability',
  );
  return capability.create?.(...args);
}

export async function forkConversation(...args: unknown[]) {
  const capability = await callModuleExport<Record<string, (...methodArgs: unknown[]) => Promise<unknown>>>(
    '../extensionConversations.js',
    'createExtensionConversationsCapability',
  );
  return capability.fork?.(...args);
}

export async function appendTranscriptBlock(...args: unknown[]) {
  const capability = await callModuleExport<Record<string, (...methodArgs: unknown[]) => Promise<unknown>>>(
    '../extensionConversations.js',
    'createExtensionConversationsCapability',
  );
  return capability.appendTranscriptBlock?.(...args);
}

export async function updateTranscriptBlock(...args: unknown[]) {
  const capability = await callModuleExport<Record<string, (...methodArgs: unknown[]) => Promise<unknown>>>(
    '../extensionConversations.js',
    'createExtensionConversationsCapability',
  );
  return capability.updateTranscriptBlock?.(...args);
}

export async function renameSession(...args: unknown[]) {
  return callModuleExport('../../conversations/liveSessions.js', 'renameSession', ...args);
}

export async function requestConversationWorkingDirectoryChange(...args: unknown[]) {
  return callModuleExport('../../conversations/liveSessions.js', 'requestConversationWorkingDirectoryChange', ...args);
}

export async function resumeSession(...args: unknown[]) {
  return callModuleExport('../../conversations/liveSessions.js', 'resumeSession', ...args);
}

export async function subscribeLiveSession(...args: unknown[]) {
  return callModuleExport('../../conversations/liveSessions.js', 'subscribe', ...args);
}

export async function exportConversationSession(...args: unknown[]) {
  return callModuleExport('../../conversations/sessionExchange.js', 'exportConversationSession', ...args);
}

export async function importConversationSession(...args: unknown[]) {
  return callModuleExport('../../conversations/sessionExchange.js', 'importConversationSession', ...args);
}

export async function readSessionBlocks(...args: unknown[]) {
  return callModuleExport<Record<string, unknown> | undefined>('../../conversations/sessions.js', 'readSessionBlocks', ...args);
}

export async function readSessionMeta(...args: unknown[]) {
  return callModuleExport<Record<string, unknown> | undefined>('../../conversations/sessions.js', 'readSessionMeta', ...args);
}

export async function persistTraceContextPointerInspect(...args: unknown[]) {
  return callModuleExport<void>('../../traces/tracePersistence.js', 'persistTraceContextPointerInspect', ...args);
}

export async function persistTraceSuggestedContext(...args: unknown[]) {
  return callModuleExport<void>('../../traces/tracePersistence.js', 'persistTraceSuggestedContext', ...args);
}

export async function buildLiveSessionExtensionFactoriesForRuntime(...args: unknown[]) {
  return callModuleExport('../runtimeAgentHooks.js', 'buildLiveSessionExtensionFactoriesForRuntime', ...args);
}

export async function buildLiveSessionResourceOptionsForRuntime(...args: unknown[]) {
  return callModuleExport('../runtimeAgentHooks.js', 'buildLiveSessionResourceOptionsForRuntime', ...args);
}

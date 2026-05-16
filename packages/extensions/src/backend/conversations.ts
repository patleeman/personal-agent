import type { ExtensionBackendContext } from '../index';

export type { ExtensionBackendContext };

function hostResolved(): never {
  throw new Error('@personal-agent/extensions/backend/conversations must be resolved by the Personal Agent host runtime.');
}

export const CONVERSATION_INSPECT_ACTION_VALUES: readonly string[] = [];
export const CONVERSATION_INSPECT_BLOCK_TYPE_VALUES: readonly string[] = [];
export const CONVERSATION_INSPECT_ORDER_VALUES: readonly string[] = [];
export const CONVERSATION_INSPECT_ROLE_VALUES: readonly string[] = [];
export const CONVERSATION_INSPECT_SCOPE_VALUES: readonly string[] = [];
export const CONVERSATION_INSPECT_SEARCH_MODE_VALUES: readonly string[] = [];

export const normalizeGeneratedConversationTitle = (..._args: unknown[]): unknown => hostResolved();
export const resolveRequestedCwd = (..._args: unknown[]): unknown => hostResolved();
export const executeConversationInspect = (..._args: unknown[]): unknown => hostResolved();
export const readSessionDetailForRoute = (..._args: unknown[]): unknown => hostResolved();
export const readConversationSessionMetaCapability = (..._args: unknown[]): unknown => hostResolved();
export const readConversationSessionsCapability = (..._args: unknown[]): unknown => hostResolved();
export const readConversationSessionSearchIndexCapability = (..._args: unknown[]): unknown => hostResolved();
export const createSession = (..._args: unknown[]): unknown => hostResolved();
export const createConversation = (..._args: unknown[]): unknown => hostResolved();
export const forkConversation = (..._args: unknown[]): unknown => hostResolved();
export const appendTranscriptBlock = (..._args: unknown[]): unknown => hostResolved();
export const updateTranscriptBlock = (..._args: unknown[]): unknown => hostResolved();
export const renameSession = (..._args: unknown[]): unknown => hostResolved();
export const requestConversationWorkingDirectoryChange = (..._args: unknown[]): unknown => hostResolved();
export const resumeSession = (..._args: unknown[]): unknown => hostResolved();
export const subscribeLiveSession = (..._args: unknown[]): unknown => hostResolved();
export const exportConversationSession = (..._args: unknown[]): unknown => hostResolved();
export const importConversationSession = (..._args: unknown[]): unknown => hostResolved();
export const persistTraceContextPointerInspect = (_params: {
  sessionId: string;
  inspectedConversationId: string;
  wasSuggested: boolean;
}): Promise<void> => hostResolved();
export const buildLiveSessionExtensionFactoriesForRuntime = (..._args: unknown[]): unknown => hostResolved();
export const buildLiveSessionResourceOptionsForRuntime = (..._args: unknown[]): unknown => hostResolved();
export const querySessionSuggestedPointerIds = (_sessionId: string): Promise<Set<string>> => hostResolved();
export const readSessionMeta = (..._args: unknown[]): unknown => hostResolved();
export const readSessionBlocks = (..._args: unknown[]): unknown => hostResolved();
export const readConversationSummary = (..._args: unknown[]): unknown => hostResolved();
export const searchIndexedConversationDocuments = (..._args: unknown[]): unknown => hostResolved();
export const scheduleConversationSearchIndexing = (..._args: unknown[]): unknown => hostResolved();
export const persistTraceSuggestedContext = (..._args: unknown[]): unknown => hostResolved();

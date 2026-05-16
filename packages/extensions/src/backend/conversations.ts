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

export const normalizeGeneratedConversationTitle = (..._args: any[]): any => hostResolved();
export const resolveRequestedCwd = (..._args: any[]): any => hostResolved();
export const executeConversationInspect = (..._args: any[]): any => hostResolved();
export const readSessionDetailForRoute = (..._args: any[]): any => hostResolved();
export const readConversationSessionMetaCapability = (..._args: any[]): any => hostResolved();
export const readConversationSessionsCapability = (..._args: any[]): any => hostResolved();
export const readConversationSessionSearchIndexCapability = (..._args: any[]): any => hostResolved();
export const createSession = (..._args: any[]): any => hostResolved();
export const createConversation = (..._args: any[]): any => hostResolved();
export const forkConversation = (..._args: any[]): any => hostResolved();
export const appendTranscriptBlock = (..._args: any[]): any => hostResolved();
export const updateTranscriptBlock = (..._args: any[]): any => hostResolved();
export const renameSession = (..._args: any[]): any => hostResolved();
export const requestConversationWorkingDirectoryChange = (..._args: any[]): any => hostResolved();
export const resumeSession = (..._args: any[]): any => hostResolved();
export const subscribeLiveSession = (..._args: any[]): any => hostResolved();
export const exportConversationSession = (..._args: any[]): any => hostResolved();
export const importConversationSession = (..._args: any[]): any => hostResolved();
export const persistTraceContextPointerInspect = (_params: {
  sessionId: string;
  inspectedConversationId: string;
  wasSuggested: boolean;
}): Promise<void> => hostResolved();
export const buildLiveSessionExtensionFactoriesForRuntime = (..._args: any[]): any => hostResolved();
export const buildLiveSessionResourceOptionsForRuntime = (..._args: any[]): any => hostResolved();
export const querySessionSuggestedPointerIds = (_sessionId: string): Promise<Set<string>> => hostResolved();
export const readSessionMeta = (..._args: any[]): any => hostResolved();
export const readSessionBlocks = (..._args: any[]): any => hostResolved();
export const readConversationSummary = (..._args: any[]): any => hostResolved();
export const searchIndexedConversationDocuments = (..._args: any[]): any => hostResolved();
export const scheduleConversationSearchIndexing = (..._args: any[]): any => hostResolved();
export const persistTraceSuggestedContext = (..._args: any[]): any => hostResolved();

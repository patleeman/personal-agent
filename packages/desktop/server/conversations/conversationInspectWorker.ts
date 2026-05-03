import { parentPort } from 'node:worker_threads';

import type { SavedUiPreferences } from '../ui/uiPreferences.js';
import {
  type ConversationInspectAction,
  diffConversationInspectBlocks,
  formatConversationInspectDiffResult,
  formatConversationInspectOutlineResult,
  formatConversationInspectQueryResult,
  formatConversationInspectSearchResult,
  formatConversationInspectSessionList,
  listConversationInspectSessions,
  outlineConversationInspectSession,
  queryConversationInspectBlocks,
  readWindowConversationInspectBlocks,
  searchConversationInspectSessions,
} from './conversationInspectCapability.js';
import { setConversationServiceContext } from './conversationService.js';

// Initialize the conversation service context from environment variables
// inherited from the parent Electron process.
setConversationServiceContext({
  getCurrentProfile: () => process.env.PERSONAL_AGENT_PROFILE ?? 'shared',
  getRepoRoot: () => process.env.PERSONAL_AGENT_REPO_ROOT ?? process.cwd(),
  getSavedUiPreferences: () =>
    ({
      openConversationIds: [],
      pinnedConversationIds: [],
      archivedConversationIds: [],
      workspacePaths: [],
      nodeBrowserViews: [],
    }) satisfies SavedUiPreferences as SavedUiPreferences,
});

interface WorkerRequest {
  id: number;
  action: string;
  params: Record<string, unknown>;
}

interface WorkerSuccess {
  id: number;
  ok: true;
  action: string;
  result: unknown;
  text: string;
}

interface WorkerError {
  id: number;
  ok: false;
  error: string;
}

if (!parentPort) {
  throw new Error('conversationInspectWorker must run as a worker thread.');
}

parentPort.on('message', (request: WorkerRequest) => {
  try {
    const { id, action, params } = request;
    let result: unknown;
    let text: string;

    switch (action as ConversationInspectAction) {
      case 'list': {
        const data = listConversationInspectSessions(params);
        result = data;
        text = formatConversationInspectSessionList(data);
        break;
      }

      case 'search': {
        const data = searchConversationInspectSessions(params);
        result = data;
        text = formatConversationInspectSearchResult(data);
        break;
      }

      case 'query': {
        const data = queryConversationInspectBlocks(params);
        result = data;
        text = formatConversationInspectQueryResult(data);
        break;
      }

      case 'outline': {
        const data = outlineConversationInspectSession(params);
        result = data;
        text = formatConversationInspectOutlineResult(data);
        break;
      }

      case 'read_window': {
        const data = readWindowConversationInspectBlocks(params);
        result = data;
        text = formatConversationInspectQueryResult(data);
        break;
      }

      case 'diff': {
        const data = diffConversationInspectBlocks(params);
        result = data;
        text = formatConversationInspectDiffResult(data);
        break;
      }

      default:
        throw new Error(
          `Unsupported conversation_inspect action ${JSON.stringify(action)}. Valid values: list, search, query, outline, read_window, diff.`,
        );
    }

    parentPort!.postMessage({ id, ok: true, action, result, text } satisfies WorkerSuccess);
  } catch (error) {
    parentPort!.postMessage({
      id: request.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    } satisfies WorkerError);
  }
});

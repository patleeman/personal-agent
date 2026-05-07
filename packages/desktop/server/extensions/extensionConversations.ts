import { readSessionDetailForRoute } from '../conversations/conversationService.js';
import {
  readConversationSessionMetaCapability,
  readConversationSessionsCapability,
  readConversationSessionSearchIndexCapability,
} from '../conversations/conversationSessionCapability.js';
import type { ServerRouteContext } from '../routes/context.js';

export interface ExtensionConversationDetailOptions {
  tailBlocks?: number;
}

function normalizeTailBlocks(value: number | undefined): number | undefined {
  return Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

export function createExtensionConversationsCapability(serverContext?: Pick<ServerRouteContext, 'getCurrentProfile'>) {
  return {
    async list(): Promise<unknown> {
      return readConversationSessionsCapability();
    },
    async getMeta(conversationId: string): Promise<unknown> {
      const meta = readConversationSessionMetaCapability(conversationId);
      if (!meta) {
        throw new Error('Conversation not found.');
      }
      return meta;
    },
    async get(conversationId: string, options: ExtensionConversationDetailOptions = {}): Promise<unknown> {
      if (!serverContext) {
        throw new Error('Conversation reads require server route context.');
      }

      const { sessionRead } = await readSessionDetailForRoute({
        conversationId,
        profile: serverContext.getCurrentProfile(),
        tailBlocks: normalizeTailBlocks(options.tailBlocks),
      });
      if (!sessionRead.detail) {
        throw new Error('Conversation not found.');
      }
      return sessionRead.detail;
    },
    async searchIndex(sessionIds: string[]): Promise<unknown> {
      return readConversationSessionSearchIndexCapability({ sessionIds });
    },
  };
}

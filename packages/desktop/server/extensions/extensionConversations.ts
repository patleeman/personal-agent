import { readConversationSessionsCapability } from '../conversations/conversationSessionCapability.js';
import { broadcastTitle } from '../conversations/liveSessionBroadcasts.js';
import { registry as liveSessionRegistry } from '../conversations/liveSessions.js';
import { resolveStableSessionTitle } from '../conversations/liveSessionTitle.js';
import type { ServerRouteContext } from '../routes/context.js';
import { invalidateAppTopics } from '../shared/appEvents.js';

export interface ExtensionConversationDetailOptions {
  tailBlocks?: number;
}

export interface ExtensionConversationSendOptions {
  /** Send as "steer" (interrupt current turn) — default false, uses "followUp". */
  steer?: boolean;
}

/**
 * Conversation capability factory.
 *
 * Write operations require the session to be live (in the in-memory registry).
 * Read-only meta operations work against persisted session data.
 */
export function createExtensionConversationsCapability(serverContext?: Pick<ServerRouteContext, 'getCurrentProfile'>) {
  const findLiveEntry = (conversationId: string) => {
    const entry = liveSessionRegistry.get(conversationId);
    if (!entry) throw new Error(`Conversation "${conversationId}" is not live.`);
    return entry;
  };

  return {
    // ── Read operations ──────────────────────────────────────────────────

    async list(): Promise<unknown> {
      return readConversationSessionsCapability();
    },

    async getMeta(conversationId: string): Promise<unknown> {
      const entry = liveSessionRegistry.get(conversationId);
      if (!entry) {
        // Fall back to persisted meta
        const { readConversationSessionMetaCapability } = await import('../conversations/conversationSessionCapability.js');
        const meta = readConversationSessionMetaCapability(conversationId);
        if (!meta) throw new Error('Conversation not found.');
        return meta;
      }
      return {
        id: conversationId,
        title: resolveStableSessionTitle(entry.session),
        cwd: entry.cwd,
        running: entry.session.isStreaming,
        currentModel: entry.session.model?.id ?? null,
      };
    },

    async get(conversationId: string, _options?: ExtensionConversationDetailOptions): Promise<unknown> {
      const entry = findLiveEntry(conversationId);
      // Return a snapshot of the current session state
      return {
        id: conversationId,
        title: resolveStableSessionTitle(entry.session),
        cwd: entry.cwd,
        running: entry.session.isStreaming,
        currentModel: entry.session.model?.id ?? null,
        stats: entry.session.getSessionStats(),
        toolNames: entry.session.getActiveToolNames(),
      };
    },

    async searchIndex(sessionIds: string[]): Promise<unknown> {
      const { readConversationSessionSearchIndexCapability } = await import('../conversations/conversationSessionCapability.js');
      return readConversationSessionSearchIndexCapability({ sessionIds });
    },

    // ── Write operations ─────────────────────────────────────────────────

    /**
     * Send a message into a live conversation.
     * Requires the `conversations:readwrite` permission.
     */
    async sendMessage(conversationId: string, text: string, options?: ExtensionConversationSendOptions): Promise<{ accepted: boolean }> {
      const entry = findLiveEntry(conversationId);
      const session = entry.session;

      try {
        if (options?.steer) {
          await session.steer(text);
        } else {
          await session.followUp(text);
        }
        invalidateAppTopics('sessions');
        return { accepted: true };
      } catch (error) {
        throw new Error(`Failed to send message: ${(error as Error).message}`);
      }
    },

    /**
     * Update the title of a live conversation.
     * Requires the `conversations:readwrite` permission.
     */
    async setTitle(conversationId: string, title: string): Promise<{ ok: true }> {
      const entry = findLiveEntry(conversationId);
      try {
        entry.session.setSessionName(title);
      } catch {
        // Fallback: set on the entry directly
        entry.title = title;
      }
      broadcastTitle(entry);
      invalidateAppTopics('sessions');
      return { ok: true };
    },

    /**
     * Trigger compaction on a live conversation.
     * Requires the `conversations:readwrite` permission.
     */
    async compact(conversationId: string, customInstructions?: string): Promise<{ ok: true }> {
      const entry = findLiveEntry(conversationId);
      await entry.session.compact(customInstructions);
      invalidateAppTopics('sessions');
      return { ok: true };
    },
  };
}

import type { SessionEntry } from '@earendil-works/pi-coding-agent';

import { readConversationSessionsCapability } from '../conversations/conversationSessionCapability.js';
import { broadcastTitle } from '../conversations/liveSessionBroadcasts.js';
import {
  appendVisibleCustomMessage as appendVisibleLiveSessionCustomMessage,
  createSession,
  createSessionFromExisting,
  registry as liveSessionRegistry,
  resumeSession,
  subscribe as subscribeLiveSession,
} from '../conversations/liveSessions.js';
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

export interface ExtensionConversationCreateOptions {
  /** Working directory for the conversation. */
  cwd?: string;
  /** Optional initial prompt text. */
  prompt?: string;
  /** Model override. */
  model?: string | null;
  /** Thinking level override. */
  thinkingLevel?: string | null;
  /** Service tier override. */
  serviceTier?: string | null;
}

export interface ExtensionConversationBlocksOptions {
  /** Number of most-recent blocks to return. */
  tailBlocks?: number;
}

export interface ExtensionConversationSubscriptionHandler {
  (event: unknown): void;
}

export interface ExtensionConversationSubscriptionOptions {
  tailBlocks?: number;
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

    /**
     * Read conversation blocks (session detail).
     * Works for both live and persisted sessions.
     */
    async getBlocks(conversationId: string, options?: ExtensionConversationBlocksOptions): Promise<unknown> {
      const profile = serverContext?.getCurrentProfile?.() ?? 'shared';
      const { readSessionDetailForRoute } = await import('../conversations/conversationService.js');
      const { sessionRead } = await readSessionDetailForRoute({
        conversationId,
        profile,
        ...(options?.tailBlocks ? { tailBlocks: options.tailBlocks } : {}),
      });
      return sessionRead;
    },

    async searchIndex(sessionIds: string[]): Promise<unknown> {
      const { readConversationSessionSearchIndexCapability } = await import('../conversations/conversationSessionCapability.js');
      return readConversationSessionSearchIndexCapability({ sessionIds });
    },

    // ── Write operations ─────────────────────────────────────────────────

    /**
     * Create a new conversation (live session).
     * Returns the bootstrap response when a prompt is provided, or session metadata otherwise.
     */
    async create(input?: ExtensionConversationCreateOptions): Promise<{ id: string }> {
      const cwd = input?.cwd?.trim() || process.cwd();
      const options: Record<string, unknown> = {};
      if (input?.model) options.initialModel = input.model;
      if (input?.thinkingLevel) options.initialThinkingLevel = input.thinkingLevel;
      if (input?.serviceTier) options.initialServiceTier = input.serviceTier;

      const created = await createSession(cwd, options);

      if (input?.prompt?.trim()) {
        // Send the initial prompt
        const entry = liveSessionRegistry.get(created.id);
        if (entry) {
          await entry.session.followUp(input.prompt.trim());
        }
      }

      invalidateAppTopics('sessions');
      return { id: created.id };
    },

    /**
     * Resume an existing session from its session file.
     */
    async resume(sessionFile: string, cwd?: string): Promise<{ id: string }> {
      const result = await resumeSession(sessionFile, cwd ? { cwdOverride: cwd } : undefined);
      invalidateAppTopics('sessions');
      return result;
    },

    /**
     * Send a message into a live conversation.
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
     * Append a visible system/custom message without starting an agent turn.
     */
    async appendVisibleCustomMessage(
      conversationId: string,
      customType: string,
      content: string,
      details?: unknown,
    ): Promise<{ ok: true }> {
      await appendVisibleLiveSessionCustomMessage(conversationId, customType, content, details);
      invalidateAppTopics('sessions');
      return { ok: true };
    },

    /**
     * Update the title of a live conversation.
     */
    async setTitle(conversationId: string, title: string): Promise<{ ok: true }> {
      const entry = findLiveEntry(conversationId);
      try {
        entry.session.setSessionName(title);
      } catch {
        entry.title = title;
      }
      broadcastTitle(entry, {
        resolveEntryTitle: (e) => resolveStableSessionTitle(e.session),
        publishSessionMetaChanged: () => {
          invalidateAppTopics('sessions');
        },
      });
      return { ok: true };
    },

    /**
     * Trigger compaction on a live conversation.
     */
    async compact(conversationId: string, customInstructions?: string): Promise<{ ok: true }> {
      const entry = findLiveEntry(conversationId);
      await entry.session.compact(customInstructions);
      invalidateAppTopics('sessions');
      return { ok: true };
    },

    /**
     * Fork a conversation into a new live session.
     * Creates a new session in the specified cwd (or same cwd) with the full history.
     * Returns the new conversation id.
     */
    async fork(conversationId: string, targetCwd?: string): Promise<{ id: string }> {
      const entry = findLiveEntry(conversationId);
      const sessionManager = (entry.session as unknown as { sessionManager: { getSessionFile(): string | undefined } }).sessionManager;
      const sessionFile = sessionManager.getSessionFile();
      if (!sessionFile) throw new Error('Source session has no persisted file');

      const cwd = targetCwd?.trim() || entry.cwd;
      const result = await createSessionFromExisting(sessionFile, cwd);
      invalidateAppTopics('sessions');
      return { id: result.id };
    },

    /**
     * Roll back a conversation by N turns.
     * Moves the leaf pointer backwards in the session tree to the entry
     * before the Nth user message counted from the end.
     */
    async rollback(conversationId: string, count: number): Promise<{ rolledBackTo: string | null }> {
      if (count < 1) throw new Error('count must be >= 1');

      const entry = findLiveEntry(conversationId);
      const liveEntry = entry;
      const sessionManager = (
        liveEntry.session as unknown as {
          sessionManager: {
            getLeafId(): string | null;
            getBranch(fromId?: string): SessionEntry[];
            branch(fromId: string): void;
          };
        }
      ).sessionManager;

      const leafId = sessionManager.getLeafId();
      if (!leafId) return { rolledBackTo: null };

      const branch = sessionManager.getBranch(leafId);
      if (branch.length === 0) return { rolledBackTo: null };

      // Walk backwards from the end, counting user messages as turns
      let turnsFound = 0;
      let targetEntryId: string | null = null;

      for (let i = branch.length - 1; i >= 0; i--) {
        const currentEntry = branch[i];
        if (currentEntry.type === 'message' && (currentEntry.message as { role?: string }).role === 'user') {
          turnsFound++;
          if (turnsFound === count) {
            // Target is parent of this user message (before this turn)
            targetEntryId = currentEntry.parentId;
            break;
          }
        }
      }

      if (!targetEntryId) return { rolledBackTo: null };

      sessionManager.branch(targetEntryId);
      invalidateAppTopics('sessions');
      return { rolledBackTo: targetEntryId };
    },

    // ── Real-time subscriptions ──────────────────────────────────────────

    /**
     * Subscribe to real-time conversation events.
     * Returns an unsubscribe function.
     */
    subscribe(
      conversationId: string,
      handler: ExtensionConversationSubscriptionHandler,
      options?: ExtensionConversationSubscriptionOptions,
    ): (() => void) | null {
      const unsubscribe = subscribeLiveSession(conversationId, handler, {
        ...(options?.tailBlocks ? { tailBlocks: options.tailBlocks } : {}),
      });
      return unsubscribe;
    },
  };
}

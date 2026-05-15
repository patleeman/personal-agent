import type { MethodHandler } from '../codexJsonRpcServer.js';

// Track per-turn subscriptions keyed by threadId so they can be cleaned up
// on connection drop. Map<threadId, Set<unsubscribeFn>>
const turnSubscriptions = new Map<string, Set<() => void>>();

function uid(prefix = ''): string {
  return `${prefix}${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function codexTurn(id: string, status: 'inProgress' | 'completed' | 'failed', error: string | null = null) {
  return {
    id,
    items: [],
    itemsView: 'full',
    status,
    error,
    startedAt: null,
    completedAt: status === 'inProgress' ? null : Math.floor(Date.now() / 1000),
    durationMs: null,
  };
}

function nowMs(): number {
  return Date.now();
}

/** Clean up all turn subscriptions for a given thread. */
export function cleanupTurnSubscriptions(threadId: string): void {
  const subs = turnSubscriptions.get(threadId);
  if (!subs) return;
  for (const unsub of subs) unsub();
  turnSubscriptions.delete(threadId);
}

export const turn = {
  /**
   * `turn/start` — send user input to a thread and stream the response.
   *
   * Subscribes to the PA live session events and forwards them as Codex
   * notifications. The subscription stays alive until the turn completes
   * (turn_end / error event), at which point it auto-cleans.
   *
   * params: {
   *   threadId: string,
   *   input: Array<{ type: 'text', text: string } | { type: 'image', url: string }>,
   *   cwd?: string,
   *   model?: string,
   *   effect?: string
   * }
   */
  start: (async (params, ctx, conn, notify) => {
    const p = params as Record<string, unknown> | undefined;
    const threadId = p?.threadId as string | undefined;
    if (!threadId) throw new Error('threadId is required');

    // Track for cleanup on connection drop
    conn.activeTurnThreads.add(threadId);

    const input = p?.input as Array<Record<string, unknown>> | undefined;
    if (!input || input.length === 0) throw new Error('input is required');

    const textParts: string[] = [];
    for (const item of input) {
      if (item.type === 'text' && typeof item.text === 'string') {
        textParts.push(item.text);
      }
    }
    const text = textParts.join('\n');
    if (!text) throw new Error('input must contain at least one text item');

    const turnId = uid('turn-');

    // Notify turn started
    notify('turn/started', {
      threadId,
      turn: codexTurn(turnId, 'inProgress'),
    });

    // User message item
    const userItemId = uid('item-');
    const userItem = { id: userItemId, type: 'userMessage', content: [{ type: 'text', text, textElements: [] }] };
    notify('item/started', {
      threadId,
      turnId,
      item: userItem,
      startedAtMs: nowMs(),
    });
    notify('item/completed', {
      threadId,
      turnId,
      item: userItem,
      completedAtMs: nowMs(),
    });

    // Subscribe to PA session events and forward them as Codex notifications.
    // The subscription stays alive until the turn ends — do NOT unsubscribe
    // in a finally block because sendMessage may resolve before streaming finishes.
    let turnDone = false;
    let agentItemId: string | null = null;
    let agentText = '';

    const unsubscribe = ctx.conversations.subscribe(threadId, (event: unknown) => {
      if (turnDone) return;
      const ev = event as Record<string, unknown>;
      if (!ev || typeof ev.type !== 'string') return;

      switch (ev.type) {
        case 'agent_start': {
          agentItemId = uid('item-');
          agentText = '';
          notify('item/started', {
            threadId,
            turnId,
            item: { id: agentItemId, type: 'agentMessage', text: '' },
            startedAtMs: nowMs(),
          });
          break;
        }
        case 'text_delta': {
          const delta = ev.delta as string | undefined;
          if (delta && agentItemId) {
            agentText += delta;
            notify('item/agentMessage/delta', {
              threadId,
              turnId,
              itemId: agentItemId,
              delta,
            });
          }
          break;
        }
        case 'thinking_delta': {
          const delta = ev.delta as string | undefined;
          if (delta && agentItemId) {
            notify('item/reasoning/delta', {
              threadId,
              turnId,
              itemId: agentItemId,
              delta,
              summaryIndex: 0,
            });
          }
          break;
        }
        case 'tool_start': {
          const toolId = (ev.toolCallId as string) ?? uid('tool-');
          notify('item/started', {
            threadId,
            turnId,
            item: {
              id: toolId,
              type: 'toolUse',
              toolName: ev.toolName as string,
              status: 'started',
            },
          });
          break;
        }
        case 'tool_end': {
          const toolId = (ev.toolCallId as string) ?? uid('tool-');
          notify('item/completed', {
            threadId,
            turnId,
            item: {
              id: toolId,
              type: 'toolUse',
              toolName: ev.toolName as string,
              status: 'completed',
              isError: ev.isError as boolean,
              output: ev.output as string,
            },
          });
          break;
        }
        case 'agent_end': {
          if (agentItemId) {
            notify('item/completed', {
              threadId,
              turnId,
              item: {
                id: agentItemId,
                type: 'agentMessage',
                text: agentText,
              },
              completedAtMs: nowMs(),
            });
          }
          break;
        }
        case 'turn_end': {
          turnDone = true;
          conn.activeTurnThreads.delete(threadId);
          if (unsubscribe) {
            unsubscribe();
            cleanupTurnSubscriptions(threadId);
          }
          notify('turn/completed', {
            threadId,
            turn: codexTurn(turnId, 'completed'),
          });
          break;
        }
        case 'error': {
          const errorMsg = ev.message as string | undefined;
          turnDone = true;
          conn.activeTurnThreads.delete(threadId);
          if (unsubscribe) {
            unsubscribe();
            cleanupTurnSubscriptions(threadId);
          }
          notify('turn/completed', {
            threadId,
            turn: codexTurn(turnId, 'failed', errorMsg ?? 'Unknown error'),
          });
          break;
        }
      }
    });

    // Track this subscription so it can be cleaned up on connection drop
    let subs = turnSubscriptions.get(threadId);
    if (!subs) {
      subs = new Set();
      turnSubscriptions.set(threadId, subs);
    }
    subs.add(unsubscribe);

    void ctx.conversations.sendMessage(threadId, text).catch((error) => {
      conn.activeTurnThreads.delete(threadId);
      if (!turnDone) {
        turnDone = true;
        notify('turn/completed', {
          threadId,
          turn: codexTurn(turnId, 'failed', error instanceof Error ? error.message : String(error)),
        });
        if (unsubscribe) {
          unsubscribe();
          cleanupTurnSubscriptions(threadId);
        }
      }
    });

    return {
      turn: codexTurn(turnId, 'inProgress'),
    };
  }) as MethodHandler,

  /**
   * `turn/steer` — send input to an already in-flight turn.
   */
  steer: (async (params, ctx) => {
    const p = params as Record<string, unknown> | undefined;
    const threadId = p?.threadId as string | undefined;
    const input = p?.input as Array<Record<string, unknown>> | undefined;
    if (!threadId) throw new Error('threadId is required');

    const text = (input ?? [])
      .map((i) => (i.type === 'text' ? (i.text as string) : ''))
      .filter(Boolean)
      .join('\n');
    if (!text) throw new Error('input must contain at least one text item');

    await ctx.conversations.sendMessage(threadId, text, { steer: true });
    return { turnId: threadId };
  }) as MethodHandler,

  /**
   * `turn/interrupt` — interrupt a running turn.
   */
  interrupt: (async (params, ctx, _conn, notify) => {
    const p = params as Record<string, unknown> | undefined;
    const threadId = p?.threadId as string | undefined;
    if (!threadId) throw new Error('threadId is required');

    // Notify the client that the turn was interrupted, so it doesn't hang
    // waiting for turn/completed that will never arrive.
    notify('turn/interrupted', {
      threadId,
      turn: codexTurn((p?.turnId as string) ?? `interrupted-${Date.now()}`, 'failed', 'Turn interrupted by user'),
    });

    // Send abort command before cleaning up subscriptions, so any turn_end
    // events from the PA backend can still flow through to the handler.
    try {
      await ctx.conversations.sendMessage(threadId, '/abort');
    } catch {
      // Best effort
    }

    // Clean up after the fact — the subscription is done regardless.
    cleanupTurnSubscriptions(threadId);

    return {};
  }) as MethodHandler,
};

export { turnSubscriptions };

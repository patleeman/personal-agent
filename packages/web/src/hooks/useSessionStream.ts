/**
 * useSessionStream — subscribes to a live Pi session SSE endpoint and builds
 * a growing MessageBlock list in real time.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { MessageBlock, PromptAttachmentRefInput, PromptImageInput, SessionContextUsage, SseEvent } from '../types';
import { api } from '../api';
import { normalizeConversationComposerBehavior } from '../conversationComposerSubmit';
import { displayBlockToMessageBlock } from '../messageBlocks';

export interface StreamState {
  blocks: MessageBlock[];
  blockOffset: number;
  totalBlocks: number;
  hasSnapshot: boolean;
  isStreaming: boolean;
  error: string | null;
  title: string | null;
  tokens: { input: number; output: number; total: number } | null;
  cost: number | null;
  contextUsage: SessionContextUsage | null;
  pendingQueue: { steering: string[]; followUp: string[] };
}

export const INITIAL_STREAM_STATE: StreamState = {
  blocks: [],
  blockOffset: 0,
  totalBlocks: 0,
  hasSnapshot: false,
  isStreaming: false,
  error: null,
  title: null,
  tokens: null,
  cost: null,
  contextUsage: null,
  pendingQueue: { steering: [], followUp: [] },
};

export function selectVisibleStreamState(
  state: StreamState,
  stateSessionId: string | null,
  requestedSessionId: string | null,
): StreamState {
  return stateSessionId === requestedSessionId ? state : INITIAL_STREAM_STATE;
}

export function useSessionStream(sessionId: string | null, options?: { tailBlocks?: number }) {
  const [state, setState] = useState<StreamState>(INITIAL_STREAM_STATE);
  const [connectVersion, setConnectVersion] = useState(0);
  // Mutable refs to avoid stale closures in the SSE handler
  const blocksRef = useRef<MessageBlock[]>([]);
  const streamingRef = useRef(false);
  const stateSessionIdRef = useRef<string | null>(sessionId);

  const send = useCallback(async (
    text: string,
    behavior?: 'steer' | 'followUp',
    images?: PromptImageInput[],
    attachmentRefs?: PromptAttachmentRefInput[],
  ) => {
    if (!sessionId) return;

    const normalizedBehavior = normalizeConversationComposerBehavior(behavior, streamingRef.current);

    if (!normalizedBehavior) {
      const ts = new Date().toISOString();
      const userBlock: MessageBlock = {
        type: 'user',
        id: `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        text,
        ts,
        ...(images && images.length > 0
          ? {
              images: images.map((image) => ({
                alt: image.name ?? 'Attached image',
                src: image.previewUrl,
                mimeType: image.mimeType,
                caption: image.name,
              })),
            }
          : {}),
      };
      blocksRef.current = [...blocksRef.current, userBlock];
      setState((s) => ({ ...s, blocks: blocksRef.current }));
    }

    await api.promptSession(sessionId, text, normalizedBehavior, images, attachmentRefs);
  }, [sessionId]);

  const abort = useCallback(async () => {
    if (!sessionId) return;
    await api.abortSession(sessionId);
  }, [sessionId]);

  const reconnect = useCallback(() => {
    if (!sessionId) {
      return;
    }

    setConnectVersion((current) => current + 1);
  }, [sessionId]);

  useEffect(() => {
    stateSessionIdRef.current = sessionId;
    blocksRef.current = [];
    streamingRef.current = false;
    setState(INITIAL_STREAM_STATE);
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId) return;

    let es: EventSource;
    let closed = false;

    function connect() {
      const params = new URLSearchParams();
      if (typeof options?.tailBlocks === 'number' && Number.isInteger(options.tailBlocks) && options.tailBlocks > 0) {
        params.set('tailBlocks', String(options.tailBlocks));
      }
      const query = params.toString();
      es = new EventSource(`/api/live-sessions/${sessionId}/events${query ? `?${query}` : ''}`);

      es.onmessage = (e: MessageEvent<string>) => {
        if (closed) return;
        let event: SseEvent;
        try { event = JSON.parse(e.data) as SseEvent; }
        catch { return; }

        setState(prev => applyEvent(prev, blocksRef, streamingRef, event));
      };

      es.onerror = () => {
        if (closed) return;
        es.close();
        // Check if 404 (session not live) — don't retry in that case
        fetch(`/api/live-sessions/${sessionId}`)
          .then(r => {
            if (!closed && r.ok) setTimeout(connect, 2_000); // retry if still live
          })
          .catch(() => { /* not live, stop */ });
      };
    }

    connect();

    return () => {
      closed = true;
      es?.close();
    };
  }, [connectVersion, options?.tailBlocks, sessionId]);

  const visibleState = selectVisibleStreamState(state, stateSessionIdRef.current, sessionId);

  return { ...visibleState, send, abort, reconnect };
}

// ── Event → block reducer ─────────────────────────────────────────────────────

function applyEvent(
  prev: StreamState,
  blocksRef: React.MutableRefObject<MessageBlock[]>,
  streamingRef: React.MutableRefObject<boolean>,
  event: SseEvent,
): StreamState {
  const blocks = [...blocksRef.current];

  switch (event.type) {
    case 'snapshot': {
      const snapshotBlocks = event.blocks.map(displayBlockToMessageBlock);
      blocksRef.current = snapshotBlocks;
      return {
        ...prev,
        blocks: snapshotBlocks,
        blockOffset: event.blockOffset,
        totalBlocks: event.totalBlocks,
        hasSnapshot: true,
        error: null,
      };
    }

    case 'agent_start': {
      streamingRef.current = true;
      blocksRef.current = blocks;
      return { ...prev, blocks, isStreaming: true, error: null };
    }

    case 'agent_end': {
      streamingRef.current = false;
      blocksRef.current = blocks;
      return { ...prev, blocks, isStreaming: false };
    }

    case 'user_message': {
      const nextBlock = displayBlockToMessageBlock(event.block);
      const last = blocks[blocks.length - 1];
      const lastImageCount = last?.type === 'user' ? last.images?.length ?? 0 : -1;
      const nextImageCount = nextBlock.type === 'user' ? nextBlock.images?.length ?? 0 : -1;
      const sameUserBlock = last?.type === 'user' && nextBlock.type === 'user'
        && last.text === nextBlock.text
        && lastImageCount === nextImageCount;

      if (sameUserBlock) {
        blocks[blocks.length - 1] = nextBlock;
      } else {
        blocks.push(nextBlock);
      }

      blocksRef.current = blocks;
      return { ...prev, blocks, totalBlocks: Math.max(prev.totalBlocks, prev.blockOffset + blocks.length) };
    }

    case 'queue_state':
      return { ...prev, pendingQueue: { steering: [...event.steering], followUp: [...event.followUp] } };

    case 'text_delta': {
      const last = blocks[blocks.length - 1];
      if (last?.type === 'text') {
        blocks[blocks.length - 1] = { ...last, text: last.text + event.delta };
      } else {
        blocks.push({ type: 'text', text: event.delta, ts: new Date().toISOString() });
      }
      blocksRef.current = blocks;
      return { ...prev, blocks, totalBlocks: Math.max(prev.totalBlocks, prev.blockOffset + blocks.length) };
    }

    case 'thinking_delta': {
      const last = blocks[blocks.length - 1];
      if (last?.type === 'thinking') {
        blocks[blocks.length - 1] = { ...last, text: last.text + event.delta };
      } else {
        blocks.push({ type: 'thinking', text: event.delta, ts: new Date().toISOString() });
      }
      blocksRef.current = blocks;
      return { ...prev, blocks, totalBlocks: Math.max(prev.totalBlocks, prev.blockOffset + blocks.length) };
    }

    case 'tool_start': {
      const args = (event.args ?? {}) as Record<string, unknown>;
      blocks.push({
        type: 'tool_use',
        tool: event.toolName,
        input: args,
        output: '',
        status: 'running',
        ts: new Date().toISOString(),
        _toolCallId: event.toolCallId,
      } as MessageBlock & { _toolCallId: string });
      blocksRef.current = blocks;
      return { ...prev, blocks, totalBlocks: Math.max(prev.totalBlocks, prev.blockOffset + blocks.length) };
    }

    case 'tool_update': {
      const idx = blocks.findLastIndex(
        b => b.type === 'tool_use' && (b as MessageBlock & { _toolCallId?: string })._toolCallId === event.toolCallId,
      );
      if (idx >= 0) {
        const b = blocks[idx] as Extract<MessageBlock, { type: 'tool_use' }>;
        // partialResult from Pi is an AgentToolResult; content[0].text holds the text
        const pr = event.partialResult as { content?: { text?: string }[] } | string | undefined;
        const partial = typeof pr === 'string' ? pr
          : pr?.content?.[0]?.text ?? '';
        blocks[idx] = { ...b, output: (b.output ?? '') + partial };
      }
      blocksRef.current = blocks;
      return { ...prev, blocks, totalBlocks: Math.max(prev.totalBlocks, prev.blockOffset + blocks.length) };
    }

    case 'tool_end': {
      const idx = blocks.findLastIndex(
        b => b.type === 'tool_use' && (b as MessageBlock & { _toolCallId?: string })._toolCallId === event.toolCallId,
      );
      if (idx >= 0) {
        const b = blocks[idx] as Extract<MessageBlock, { type: 'tool_use' }>;
        blocks[idx] = {
          ...b,
          output:     event.output,   // replace partial with final
          status:     event.isError ? 'error' : 'ok',
          durationMs: event.durationMs,
          details:    event.details,
        };
      }
      blocksRef.current = blocks;
      return { ...prev, blocks, totalBlocks: Math.max(prev.totalBlocks, prev.blockOffset + blocks.length) };
    }

    case 'title_update':
      return { ...prev, title: event.title };

    case 'context_usage':
      return { ...prev, contextUsage: event.usage };

    case 'stats_update':
      return { ...prev, tokens: event.tokens, cost: event.cost };

    case 'error': {
      blocks.push({ type: 'error', message: event.message, ts: new Date().toISOString() });
      blocksRef.current = blocks;
      return {
        ...prev,
        blocks,
        totalBlocks: Math.max(prev.totalBlocks, prev.blockOffset + blocks.length),
        isStreaming: false,
        error: event.message,
      };
    }

    default:
      return prev;
  }
}

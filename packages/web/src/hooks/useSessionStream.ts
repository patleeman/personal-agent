/**
 * useSessionStream — subscribes to a live Pi session SSE endpoint and builds
 * a growing MessageBlock list in real time.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { MessageBlock } from '../data/mockConversations';
import type { SseEvent } from '../types';
import { api } from '../api';

export interface StreamState {
  blocks:      MessageBlock[];
  isStreaming: boolean;
  error:       string | null;
}

const INIT: StreamState = { blocks: [], isStreaming: false, error: null };

// Tool color map (matches ConversationTree)
const TOOL_COLORS: Record<string, string> = {
  bash: '#6b8fa3', read: '#4db6ac', write: '#f0a832', edit: '#f0a832',
  web_fetch: '#4caf82', web_search: '#4caf82',
};

export function useSessionStream(sessionId: string | null) {
  const [state, setState] = useState<StreamState>(INIT);
  // Mutable refs to avoid stale closures in the SSE handler
  const blocksRef    = useRef<MessageBlock[]>([]);
  const streamingRef = useRef(false);

  const send = useCallback(async (text: string, behavior?: 'steer' | 'followUp') => {
    if (!sessionId) return;
    // Optimistically append user message
    const userBlock: MessageBlock = { type: 'user', text, ts: new Date().toISOString() };
    blocksRef.current = [...blocksRef.current, userBlock];
    setState(s => ({ ...s, blocks: blocksRef.current }));
    await api.promptSession(sessionId, text, behavior);
  }, [sessionId]);

  const abort = useCallback(async () => {
    if (!sessionId) return;
    await api.abortSession(sessionId);
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId) return;

    let es: EventSource;
    let closed = false;

    function connect() {
      es = new EventSource(`/api/live-sessions/${sessionId}/events`);

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
        // Retry after 2s if still mounted
        if (!closed) setTimeout(connect, 2_000);
      };
    }

    connect();

    return () => {
      closed = true;
      es?.close();
    };
  }, [sessionId]);

  return { ...state, send, abort };
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

    case 'text_delta': {
      const last = blocks[blocks.length - 1];
      if (last?.type === 'text') {
        blocks[blocks.length - 1] = { ...last, text: last.text + event.delta };
      } else {
        blocks.push({ type: 'text', text: event.delta, ts: new Date().toISOString() });
      }
      blocksRef.current = blocks;
      return { ...prev, blocks };
    }

    case 'thinking_delta': {
      const last = blocks[blocks.length - 1];
      if (last?.type === 'thinking') {
        blocks[blocks.length - 1] = { ...last, text: last.text + event.delta };
      } else {
        blocks.push({ type: 'thinking', text: event.delta, ts: new Date().toISOString(), collapsed: false });
      }
      blocksRef.current = blocks;
      return { ...prev, blocks };
    }

    case 'tool_start': {
      const args = (event.args ?? {}) as Record<string, string>;
      const input = args.command ?? args.path ?? args.url ?? JSON.stringify(args).slice(0, 200);
      blocks.push({
        type: 'tool_use',
        tool: event.toolName,
        input: args,
        inputPreview: input,
        result: '',
        resultPreview: '',
        status: 'running',
        ts: new Date().toISOString(),
        _toolCallId: event.toolCallId,
      } as MessageBlock & { _toolCallId: string });
      blocksRef.current = blocks;
      return { ...prev, blocks };
    }

    case 'tool_update': {
      // Find the running tool block for this callId and append partial output
      const idx = blocks.findLastIndex(
        b => b.type === 'tool_use' && (b as MessageBlock & { _toolCallId?: string })._toolCallId === event.toolCallId,
      );
      if (idx >= 0) {
        const b = blocks[idx] as Extract<MessageBlock, { type: 'tool_use' }>;
        const partial = String(event.partialResult ?? '');
        blocks[idx] = { ...b, result: (b.result ?? '') + partial };
      }
      blocksRef.current = blocks;
      return { ...prev, blocks };
    }

    case 'tool_end': {
      const idx = blocks.findLastIndex(
        b => b.type === 'tool_use' && (b as MessageBlock & { _toolCallId?: string })._toolCallId === event.toolCallId,
      );
      if (idx >= 0) {
        const b = blocks[idx] as Extract<MessageBlock, { type: 'tool_use' }>;
        blocks[idx] = {
          ...b,
          status:   event.isError ? 'error' : 'ok',
          durationMs: event.durationMs,
        };
      }
      blocksRef.current = blocks;
      return { ...prev, blocks };
    }

    case 'error': {
      blocks.push({ type: 'error', message: event.message, ts: new Date().toISOString() });
      blocksRef.current = blocks;
      return { ...prev, blocks, isStreaming: false, error: event.message };
    }

    default:
      return prev;
  }
}

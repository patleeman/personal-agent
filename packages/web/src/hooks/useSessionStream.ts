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
  title:       string | null;
  tokens:      { input: number; output: number; total: number } | null;
  cost:        number | null;
}

const INIT: StreamState = { blocks: [], isStreaming: false, error: null, title: null, tokens: null, cost: null };

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
      return { ...prev, blocks };
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
          output:     event.output,   // replace partial with final
          status:     event.isError ? 'error' : 'ok',
          durationMs: event.durationMs,
        };
      }
      blocksRef.current = blocks;
      return { ...prev, blocks };
    }

    case 'title_update':
      return { ...prev, title: event.title };

    case 'stats_update':
      return { ...prev, tokens: event.tokens, cost: event.cost };

    case 'error': {
      blocks.push({ type: 'error', message: event.message, ts: new Date().toISOString() });
      blocksRef.current = blocks;
      return { ...prev, blocks, isStreaming: false, error: event.message };
    }

    default:
      return prev;
  }
}

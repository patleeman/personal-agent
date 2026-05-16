import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent';

import type { ParallelPromptPreview } from './liveSessionParallelJobs.js';
import type { LiveSessionPresenceState } from './liveSessionPresence.js';
import type { QueuedPromptPreview } from './liveSessionQueue.js';
import { buildDisplayBlocksFromEntries, type DisplayBlock, getAssistantErrorDisplayMessage, type ThreadGoal } from './sessions.js';
import { normalizeTranscriptToolName } from './toolNames.js';

export interface LiveContextUsageSegment {
  key: 'system' | 'user' | 'assistant' | 'tool' | 'summary' | 'other';
  label: string;
  tokens: number;
}

export interface LiveContextUsage {
  tokens: number | null;
  modelId?: string;
  contextWindow?: number;
  percent?: number | null;
  segments?: LiveContextUsageSegment[];
}

export interface LiveSessionToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export type SseEvent =
  | {
      type: 'snapshot';
      blocks: DisplayBlock[];
      blockOffset: number;
      totalBlocks: number;
      isStreaming: boolean;
      goalState?: ThreadGoal | null;
      systemPrompt?: string | null;
      toolDefinitions?: LiveSessionToolDefinition[];
    }
  | { type: 'agent_start' }
  | { type: 'agent_end' }
  | { type: 'turn_end' }
  | { type: 'cwd_changed'; newConversationId: string; cwd: string; autoContinued: boolean }
  | { type: 'user_message'; block: Extract<DisplayBlock, { type: 'user' }> }
  | { type: 'queue_state'; steering: QueuedPromptPreview[]; followUp: QueuedPromptPreview[] }
  | { type: 'parallel_state'; jobs: ParallelPromptPreview[] }
  | { type: 'presence_state'; state: LiveSessionPresenceState }
  | { type: 'text_delta'; delta: string }
  | { type: 'thinking_delta'; delta: string }
  | { type: 'tool_start'; toolCallId: string; toolName: string; args: unknown }
  | { type: 'tool_update'; toolCallId: string; partialResult: unknown }
  | { type: 'tool_end'; toolCallId: string; toolName: string; isError: boolean; durationMs: number; output: string; details?: unknown }
  | { type: 'title_update'; title: string }
  | { type: 'context_usage'; usage: LiveContextUsage | null }
  | { type: 'stats_update'; tokens: { input: number; output: number; total: number; cacheRead: number; cacheWrite: number }; cost: number }
  | { type: 'compaction_start'; mode: 'manual' | 'auto'; reason?: 'manual' | 'threshold' | 'overflow' }
  | {
      type: 'compaction_end';
      mode: 'manual' | 'auto';
      reason: 'manual' | 'threshold' | 'overflow';
      aborted: boolean;
      willRetry: boolean;
      errorMessage?: string;
      tokensBefore?: number;
    }
  | { type: 'error'; message: string };

const toolTimings = new Map<string, number>();

function buildUserMessageBlock(message: {
  content?: unknown;
  timestamp?: string | number;
}): Extract<DisplayBlock, { type: 'user' }> | null {
  const [block] = buildDisplayBlocksFromEntries([
    {
      id: 'live-user',
      timestamp: message.timestamp ?? Date.now(),
      message: {
        role: 'user',
        content: message.content,
      },
    },
  ]);

  return block?.type === 'user' ? block : null;
}

export function toSse(event: AgentSessionEvent): SseEvent | null {
  switch (event.type) {
    case 'agent_start':
      return { type: 'agent_start' };
    case 'agent_end':
      return { type: 'agent_end' };
    case 'turn_end':
      return { type: 'turn_end' };

    case 'message_start': {
      if (event.message.role !== 'user') {
        return null;
      }

      const block = buildUserMessageBlock(event.message);
      return block ? { type: 'user_message', block } : null;
    }

    case 'message_end': {
      if (event.message.role !== 'assistant') {
        return null;
      }

      const errorMessage = getAssistantErrorDisplayMessage(event.message);
      return errorMessage ? { type: 'error', message: errorMessage } : null;
    }

    case 'message_update': {
      const assistantEvent = event.assistantMessageEvent;
      if (assistantEvent.type === 'text_delta') {
        return { type: 'text_delta', delta: assistantEvent.delta };
      }
      if (assistantEvent.type === 'thinking_delta') {
        return { type: 'thinking_delta', delta: assistantEvent.delta };
      }
      return null;
    }

    case 'tool_execution_start': {
      toolTimings.set(event.toolCallId, Date.now());
      return {
        type: 'tool_start',
        toolCallId: event.toolCallId,
        toolName: normalizeTranscriptToolName(event.toolName),
        args: event.args,
      };
    }

    case 'tool_execution_update':
      return {
        type: 'tool_update',
        toolCallId: event.toolCallId,
        partialResult: event.partialResult,
      };

    case 'tool_execution_end': {
      const start = toolTimings.get(event.toolCallId) ?? Date.now();
      toolTimings.delete(event.toolCallId);
      const result = event.result as { content?: Array<{ type: string; text?: string }>; details?: unknown } | undefined;
      const outputText =
        result?.content
          ?.filter((content) => content.type === 'text')
          .map((content) => content.text ?? '')
          .join('\n')
          .slice(0, 8000) ?? '';
      return {
        type: 'tool_end',
        toolCallId: event.toolCallId,
        toolName: normalizeTranscriptToolName(event.toolName),
        isError: event.isError,
        durationMs: Math.max(0, Date.now() - start),
        output: outputText,
        ...(result?.details !== undefined ? { details: result.details } : {}),
      };
    }

    case 'compaction_start':
      return {
        type: 'compaction_start',
        mode: event.reason === 'manual' ? 'manual' : 'auto',
        reason: event.reason,
      };

    case 'compaction_end':
      return {
        type: 'compaction_end',
        mode: event.reason === 'manual' ? 'manual' : 'auto',
        reason: event.reason,
        aborted: event.aborted,
        willRetry: event.willRetry,
        ...(event.errorMessage ? { errorMessage: event.errorMessage } : {}),
        ...(event.result?.tokensBefore !== undefined ? { tokensBefore: event.result.tokensBefore } : {}),
      };

    default:
      return null;
  }
}

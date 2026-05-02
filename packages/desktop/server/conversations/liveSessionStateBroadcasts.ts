import type { AgentSession } from '@mariozechner/pi-coding-agent';
import { estimateContextUsageSegments } from './sessionContextUsage.js';
import { normalizeModelContextWindow } from '../models/modelContextWindows.js';
import { readQueueState } from './liveSessionQueue.js';
import { readParallelState, type ParallelPromptJob } from './liveSessionParallelJobs.js';
import { readLiveSessionAutoModeHostState } from './liveSessionAutoModeOps.js';
import type { ConversationAutoModeState } from './conversationAutoMode.js';
import type { LiveContextUsage, SseEvent } from './liveSessionEvents.js';

export interface LiveSessionContextUsageHost {
  session: AgentSession;
  lastContextUsageJson: string | null;
  contextUsageTimer?: ReturnType<typeof setTimeout>;
}

export interface LiveSessionQueueStateHost {
  session: AgentSession;
  lastQueueStateJson: string | null;
}

export interface LiveSessionParallelStateHost {
  parallelJobs?: ParallelPromptJob[];
  lastParallelStateJson?: string | null;
}

export interface LiveSessionAutoModeStateHost {
  session: AgentSession;
  lastAutoModeStateJson?: string | null;
}

export function readLiveSessionContextUsage(session: AgentSession): LiveContextUsage | null {
  try {
    const usage = session.getContextUsage();
    if (!usage) {
      return null;
    }

    const modelId = session.model?.id;
    const contextWindow = normalizeModelContextWindow(
      modelId,
      usage.contextWindow,
      session.model?.contextWindow ?? 128_000,
    );

    return {
      ...usage,
      modelId,
      contextWindow,
      percent: usage.tokens !== null && contextWindow > 0 ? (usage.tokens / contextWindow) * 100 : null,
      ...(usage.tokens !== null
        ? { segments: estimateContextUsageSegments(session.messages, usage.tokens) }
        : {}),
    };
  } catch {
    return null;
  }
}

export function readConversationAutoModeState(entry: LiveSessionAutoModeStateHost): ConversationAutoModeState {
  return readLiveSessionAutoModeHostState(entry);
}

export function broadcastLiveSessionContextUsage(
  entry: LiveSessionContextUsageHost,
  send: (event: SseEvent) => void,
  force = false,
): void {
  const usage = readLiveSessionContextUsage(entry.session);
  const nextJson = JSON.stringify(usage);
  if (!force && entry.lastContextUsageJson === nextJson) {
    return;
  }

  entry.lastContextUsageJson = nextJson;
  send({ type: 'context_usage', usage });
}

export function broadcastLiveSessionQueueState(
  entry: LiveSessionQueueStateHost,
  send: (event: SseEvent) => void,
  force = false,
): void {
  const queueState = readQueueState(entry.session);
  const nextJson = JSON.stringify(queueState);
  if (!force && entry.lastQueueStateJson === nextJson) {
    return;
  }

  entry.lastQueueStateJson = nextJson;
  send({ type: 'queue_state', ...queueState });
}

export function broadcastLiveSessionParallelState(
  entry: LiveSessionParallelStateHost,
  send: (event: SseEvent) => void,
  force = false,
): void {
  const jobs = readParallelState(entry.parallelJobs);
  const nextJson = JSON.stringify(jobs);
  if (!force && entry.lastParallelStateJson === nextJson) {
    return;
  }

  entry.lastParallelStateJson = nextJson;
  send({ type: 'parallel_state', jobs });
}

export function broadcastLiveSessionAutoModeState(
  entry: LiveSessionAutoModeStateHost,
  send: (event: SseEvent) => void,
  force = false,
): void {
  const state = readConversationAutoModeState(entry);
  const nextJson = JSON.stringify(state);
  if (!force && entry.lastAutoModeStateJson === nextJson) {
    return;
  }

  entry.lastAutoModeStateJson = nextJson;
  send({ type: 'auto_mode_state', state });
}

export function scheduleLiveSessionContextUsage(
  entry: LiveSessionContextUsageHost,
  send: (event: SseEvent) => void,
  delayMs = 400,
): void {
  if (entry.contextUsageTimer) {
    return;
  }

  entry.contextUsageTimer = setTimeout(() => {
    entry.contextUsageTimer = undefined;
    broadcastLiveSessionContextUsage(entry, send);
  }, delayMs);
}

export function clearLiveSessionContextUsageTimer(entry: LiveSessionContextUsageHost): void {
  if (!entry.contextUsageTimer) {
    return;
  }

  clearTimeout(entry.contextUsageTimer);
  entry.contextUsageTimer = undefined;
}

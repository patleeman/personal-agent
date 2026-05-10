import type { AgentSession } from '@earendil-works/pi-coding-agent';

import { normalizeModelContextWindow } from '../models/modelContextWindows.js';
import type { LiveContextUsage, SseEvent } from './liveSessionEvents.js';
import { type ParallelPromptJob, readParallelState } from './liveSessionParallelJobs.js';
import { readQueueState } from './liveSessionQueue.js';
import { estimateContextUsageSegments, estimateSessionContextTokens } from './sessionContextUsage.js';

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

export function readLiveSessionContextUsage(session: AgentSession): LiveContextUsage | null {
  try {
    const usage = session.getContextUsage();
    const modelId = session.model?.id;
    const contextWindow = normalizeModelContextWindow(modelId, usage?.contextWindow, session.model?.contextWindow ?? 128_000);

    if (!usage) {
      const tokens = estimateSessionContextTokens(session.messages);
      if (!Number.isSafeInteger(tokens) || tokens < 0) {
        return null;
      }

      return {
        tokens,
        modelId,
        contextWindow,
        percent: contextWindow > 0 ? (tokens / contextWindow) * 100 : null,
        segments: estimateContextUsageSegments(session.messages, tokens),
      };
    }

    if (usage.tokens === null) {
      return {
        ...usage,
        modelId,
        contextWindow,
        percent: null,
      };
    }

    if (!Number.isSafeInteger(usage.tokens) || usage.tokens < 0) {
      return null;
    }

    return {
      ...usage,
      modelId,
      contextWindow,
      percent: contextWindow > 0 ? (usage.tokens / contextWindow) * 100 : null,
      segments: estimateContextUsageSegments(session.messages, usage.tokens),
    };
  } catch {
    return null;
  }
}

export function broadcastLiveSessionContextUsage(entry: LiveSessionContextUsageHost, send: (event: SseEvent) => void, force = false): void {
  const usage = readLiveSessionContextUsage(entry.session);
  const nextJson = JSON.stringify(usage);
  if (!force && entry.lastContextUsageJson === nextJson) {
    return;
  }

  entry.lastContextUsageJson = nextJson;
  send({ type: 'context_usage', usage });
}

export function broadcastLiveSessionQueueState(entry: LiveSessionQueueStateHost, send: (event: SseEvent) => void, force = false): void {
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

export function scheduleLiveSessionContextUsage(entry: LiveSessionContextUsageHost, send: (event: SseEvent) => void, delayMs = 400): void {
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

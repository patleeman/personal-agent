import { existsSync } from 'node:fs';
import type { AgentSession } from '@mariozechner/pi-coding-agent';
import {
  readSessionBlocksByFile,
  type DisplayBlock,
} from './sessions.js';
import {
  applyLatestCompactionSummaryTitle,
  buildLiveStateBlocks,
  mergeConversationHistoryBlocks,
} from './liveSessionTranscript.js';
import { readQueueState, type QueuedPromptPreview } from './liveSessionQueue.js';
import { readParallelState, type ParallelPromptJob, type ParallelPromptPreview } from './liveSessionParallelJobs.js';
import { buildLiveSessionPresenceState, type LiveSessionPresenceHost, type LiveSessionPresenceState } from './liveSessionPresence.js';
import { hasQueuedOrActiveHiddenTurn } from './liveSessionHiddenTurns.js';
import { readConversationAutoModeState, readLiveSessionContextUsage } from './liveSessionStateBroadcasts.js';
import type { ConversationAutoModeState } from './conversationAutoMode.js';
import type { LiveContextUsage } from './liveSessionEvents.js';

const DEFAULT_LIVE_SNAPSHOT_TAIL_BLOCKS = 400;

function normalizeLiveSnapshotTailBlocks(value: number | undefined): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
    ? value
    : DEFAULT_LIVE_SNAPSHOT_TAIL_BLOCKS;
}

export interface LiveSessionSnapshotHost {
  session: AgentSession;
  activeHiddenTurnCustomType?: string | null;
  lastCompactionSummaryTitle?: string | null;
}

export interface LiveSessionStateSnapshot {
  blocks: DisplayBlock[];
  blockOffset: number;
  totalBlocks: number;
  hasSnapshot: boolean;
  isStreaming: boolean;
  isCompacting: boolean;
  hasPendingHiddenTurn: boolean;
  error: string | null;
  title: string | null;
  tokens: { input: number; output: number; total: number } | null;
  cost: number | null;
  contextUsage: LiveContextUsage | null;
  pendingQueue: { steering: QueuedPromptPreview[]; followUp: QueuedPromptPreview[] };
  parallelJobs: ParallelPromptPreview[];
  presence: LiveSessionPresenceState;
  autoModeState: ConversationAutoModeState | null;
  cwdChange: { newConversationId: string; cwd: string; autoContinued: boolean } | null;
}

export interface LiveSessionStateSnapshotHost extends LiveSessionSnapshotHost, LiveSessionPresenceHost {
  currentTurnError?: string | null;
  isCompacting?: boolean;
  parallelJobs?: ParallelPromptJob[];
}

export interface LiveSessionSnapshot {
  blocks: DisplayBlock[];
  blockOffset: number;
  totalBlocks: number;
  isStreaming: boolean;
}

export function buildLiveSessionSnapshot(entry: LiveSessionSnapshotHost, tailBlocks?: number): LiveSessionSnapshot {
  const liveBlocks = buildLiveStateBlocks(entry.session, {
    omitStreamMessage: Boolean(entry.activeHiddenTurnCustomType),
  });
  const sessionFile = entry.session.sessionFile?.trim();
  if (!sessionFile || !existsSync(sessionFile)) {
    return {
      blocks: applyLatestCompactionSummaryTitle(liveBlocks, entry.lastCompactionSummaryTitle),
      blockOffset: 0,
      totalBlocks: liveBlocks.length,
      isStreaming: entry.session.isStreaming,
    };
  }

  const persisted = readSessionBlocksByFile(sessionFile, { tailBlocks: normalizeLiveSnapshotTailBlocks(tailBlocks) });
  if (!persisted || persisted.blocks.length === 0) {
    return {
      blocks: applyLatestCompactionSummaryTitle(liveBlocks, entry.lastCompactionSummaryTitle),
      blockOffset: 0,
      totalBlocks: liveBlocks.length,
      isStreaming: entry.session.isStreaming,
    };
  }

  // session.state.messages is the *current context window*, not a chronological display transcript.
  // After compaction it can reorder blocks as: summary → pre-compaction tail → post-compaction tail.
  // For idle live sessions we should render the durable transcript from disk exactly as persisted.
  if (!entry.session.isStreaming) {
    return {
      blocks: applyLatestCompactionSummaryTitle(persisted.blocks, entry.lastCompactionSummaryTitle),
      blockOffset: persisted.blockOffset,
      totalBlocks: persisted.totalBlocks,
      isStreaming: entry.session.isStreaming,
    };
  }

  const blocks = mergeConversationHistoryBlocks(persisted.blocks, liveBlocks);
  return {
    blocks: applyLatestCompactionSummaryTitle(blocks, entry.lastCompactionSummaryTitle),
    blockOffset: persisted.blockOffset,
    totalBlocks: persisted.blockOffset + blocks.length,
    isStreaming: entry.session.isStreaming,
  };
}

export function readLiveSessionStateSnapshotFromEntry(
  entry: LiveSessionStateSnapshotHost,
  title: string,
  tailBlocks?: number,
): LiveSessionStateSnapshot {
  let tokens: LiveSessionStateSnapshot['tokens'] = null;
  let cost: number | null = null;
  try {
    const stats = entry.session.getSessionStats();
    tokens = stats.tokens;
    cost = stats.cost;
  } catch {
    tokens = null;
    cost = null;
  }

  return {
    ...buildLiveSessionSnapshot(entry, tailBlocks),
    hasSnapshot: true,
    isStreaming: entry.session.isStreaming && !entry.activeHiddenTurnCustomType,
    isCompacting: entry.isCompacting === true,
    hasPendingHiddenTurn: hasQueuedOrActiveHiddenTurn(entry),
    error: entry.currentTurnError ?? null,
    title,
    tokens,
    cost,
    contextUsage: readLiveSessionContextUsage(entry.session),
    pendingQueue: readQueueState(entry.session),
    parallelJobs: readParallelState(entry.parallelJobs),
    presence: buildLiveSessionPresenceState(entry),
    autoModeState: readConversationAutoModeState(entry),
    cwdChange: null,
  };
}

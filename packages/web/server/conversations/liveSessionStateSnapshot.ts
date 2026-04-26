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

const DEFAULT_LIVE_SNAPSHOT_TAIL_BLOCKS = 400;

export interface LiveSessionSnapshotHost {
  session: AgentSession;
  activeHiddenTurnCustomType?: string | null;
  lastCompactionSummaryTitle?: string | null;
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

  const persisted = readSessionBlocksByFile(sessionFile, { tailBlocks: tailBlocks ?? DEFAULT_LIVE_SNAPSHOT_TAIL_BLOCKS });
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

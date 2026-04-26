import { describe, expect, it } from 'vitest';
import type { DisplayBlock } from './sessions.js';
import {
  applyLatestCompactionSummaryTitle,
  mergeConversationHistoryBlocks,
  resolveCompactionSummaryTitle,
} from './liveSessionTranscript.js';

function textBlock(id: string, text: string, ts = `2026-04-26T12:00:0${id}.000Z`): DisplayBlock {
  return { id, type: 'text', role: 'assistant', text, ts } as DisplayBlock;
}

function toolBlock(input: {
  id: string;
  toolCallId: string;
  output: string;
  durationMs?: number;
  details?: unknown;
  ts?: string;
}): DisplayBlock {
  return {
    id: input.id,
    type: 'tool_use',
    tool: 'bash',
    toolCallId: input.toolCallId,
    input: {},
    output: input.output,
    ts: input.ts ?? '2026-04-26T12:00:00.000Z',
    ...(input.durationMs !== undefined ? { durationMs: input.durationMs } : {}),
    ...(input.details !== undefined ? { details: input.details } : {}),
  } as DisplayBlock;
}

function summaryBlock(id: string, title: string): DisplayBlock {
  return {
    id,
    type: 'summary',
    kind: 'compaction',
    title,
    text: 'summary text',
    ts: '2026-04-26T12:00:00.000Z',
  } as DisplayBlock;
}

describe('liveSessionTranscript', () => {
  it('appends live blocks after an overlapping persisted tail', () => {
    const persisted = [textBlock('1', 'one'), textBlock('2', 'two')];
    const live = [textBlock('2', 'two'), textBlock('3', 'three')];

    expect(mergeConversationHistoryBlocks(persisted, live)).toEqual([
      textBlock('1', 'one'),
      textBlock('2', 'two'),
      textBlock('3', 'three'),
    ]);
  });

  it('preserves persisted tool output when the live block only has a placeholder', () => {
    const persistedTool = toolBlock({ id: 'tool-old', toolCallId: 'call-1', output: 'done', durationMs: 123 });
    const liveTool = toolBlock({ id: 'tool-live', toolCallId: 'call-1', output: '' });

    expect(mergeConversationHistoryBlocks([persistedTool], [liveTool])).toEqual([persistedTool]);
  });

  it('updates the latest compaction summary title without mutating the input array', () => {
    const first = summaryBlock('s1', 'Old title');
    const second = summaryBlock('s2', 'Later old title');
    const blocks = [first, textBlock('1', 'body'), second];

    const updated = applyLatestCompactionSummaryTitle(blocks, 'Overflow recovery compaction');

    expect(updated).not.toBe(blocks);
    expect(updated[0]).toBe(first);
    expect((updated[2] as Extract<DisplayBlock, { type: 'summary' }>).title).toBe('Overflow recovery compaction');
    expect((blocks[2] as Extract<DisplayBlock, { type: 'summary' }>).title).toBe('Later old title');
  });

  it('names compaction summaries by mode and retry reason', () => {
    expect(resolveCompactionSummaryTitle({ mode: 'manual' })).toBe('Manual compaction');
    expect(resolveCompactionSummaryTitle({ mode: 'auto', reason: 'overflow' })).toBe('Overflow recovery compaction');
    expect(resolveCompactionSummaryTitle({ mode: 'auto', willRetry: true })).toBe('Overflow recovery compaction');
    expect(resolveCompactionSummaryTitle({ mode: 'auto', reason: 'threshold' })).toBe('Proactive compaction');
  });
});

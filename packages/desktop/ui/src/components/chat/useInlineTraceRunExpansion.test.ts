import { describe, expect, it } from 'vitest';
import type { ChatRenderItem } from './transcriptItems.js';
import { collectVisibleInlineRunKeys, filterInlineRunKeys, toggleInlineRunKey } from './useInlineTraceRunExpansion.js';

function runTool(runId: string) {
  return {
    type: 'tool_use' as const,
    ts: '2026-04-26T00:00:00.000Z',
    tool: 'run',
    input: {},
    output: '',
    details: { action: 'logs', runId },
  };
}

describe('useInlineTraceRunExpansion helpers', () => {
  it('collects visible inline run expansion keys from trace clusters', () => {
    const renderItems: ChatRenderItem[] = [
      { type: 'message', index: 0, block: { type: 'text', ts: '2026-04-26T00:00:00.000Z', text: 'hi' } },
      {
        type: 'trace_cluster',
        startIndex: 1,
        endIndex: 2,
        blocks: [runTool('run-cleanup-abc123'), runTool('run-review-def456')],
        summary: { stepCount: 2, categories: [], hasRunning: false, hasError: false, durationMs: 0 },
      },
    ];

    expect(Array.from(collectVisibleInlineRunKeys(renderItems))).toEqual(['1:run-review-def456', '1:run-cleanup-abc123']);
  });

  it('filters stale expanded keys while preserving identity when unchanged', () => {
    const current = new Set(['1:run-a', '1:run-b']);
    const visible = new Set(['1:run-a', '1:run-b']);

    expect(filterInlineRunKeys(current, visible)).toBe(current);
    expect(Array.from(filterInlineRunKeys(current, new Set(['1:run-a'])))).toEqual(['1:run-a']);
  });

  it('toggles a single expanded key', () => {
    expect(Array.from(toggleInlineRunKey(new Set(), '1:run-a'))).toEqual(['1:run-a']);
    expect(Array.from(toggleInlineRunKey(new Set(['1:run-a']), '1:run-a'))).toEqual([]);
  });
});

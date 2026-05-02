import { describe, expect, it } from 'vitest';
import type { DisplayBlock, MessageBlock } from '../shared/types';
import {
  addHydratingHistoricalBlockId,
  buildHydratingHistoricalBlockIdSet,
  mergeHydratedHistoricalBlocks,
  mergeHydratedStreamBlocks,
  normalizeHistoricalBlockId,
  removeHydratingHistoricalBlockId,
} from './messageBlocks';

describe('message block hydration helpers', () => {
  it('normalizes and updates hydrating historical block ids', () => {
    expect(normalizeHistoricalBlockId(' block-1 ')).toBe('block-1');
    expect(normalizeHistoricalBlockId('   ')).toBeNull();
    expect(addHydratingHistoricalBlockId(['block-1'], ' block-1 ')).toEqual(['block-1']);
    expect(addHydratingHistoricalBlockId(['block-1'], ' block-2 ')).toEqual(['block-1', 'block-2']);
    expect(removeHydratingHistoricalBlockId(['block-1', 'block-2'], ' block-1 ')).toEqual(['block-2']);
    expect(removeHydratingHistoricalBlockId(['block-1'], '   ')).toEqual(['block-1']);
    expect(buildHydratingHistoricalBlockIdSet(['block-1']).has('block-1')).toBe(true);
  });

  it('merges hydrated historical display blocks before presentation', () => {
    const hydrated: Extract<MessageBlock, { type: 'text' }> = {
      type: 'text',
      id: 'block-1',
      ts: '2026-04-01T00:00:00.000Z',
      text: 'hydrated output',
    };
    const displayBlocks: DisplayBlock[] = [
      { type: 'text', id: 'block-1', ts: '2026-04-01T00:00:00.000Z', text: 'deferred output' },
      { type: 'user', id: 'block-2', ts: '2026-04-01T00:00:01.000Z', text: 'hello' },
    ];

    expect(mergeHydratedHistoricalBlocks(displayBlocks, { 'block-1': hydrated })).toEqual([
      hydrated,
      { type: 'user', id: 'block-2', ts: '2026-04-01T00:00:01.000Z', text: 'hello', images: undefined },
    ]);
  });

  it('merges hydrated stream blocks by normalized id', () => {
    const streamBlock: Extract<MessageBlock, { type: 'text' }> = {
      type: 'text',
      id: ' block-1 ',
      ts: '2026-04-01T00:00:00.000Z',
      text: 'placeholder',
    };
    const hydrated: Extract<MessageBlock, { type: 'text' }> = {
      type: 'text',
      id: 'block-1',
      ts: '2026-04-01T00:00:00.000Z',
      text: 'hydrated',
    };

    expect(mergeHydratedStreamBlocks([streamBlock], { 'block-1': hydrated })).toEqual([hydrated]);
  });
});

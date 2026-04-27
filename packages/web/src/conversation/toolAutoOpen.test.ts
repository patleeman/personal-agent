import { describe, expect, it } from 'vitest';
import type { MessageBlock } from '../shared/types';
import {
  collectCompletedToolAutoOpenBlockKeys,
  findRequestedToolPresentationToOpen,
} from './toolAutoOpen';

interface Presentation {
  id: string;
  openRequested: boolean;
}

function toolBlock(overrides: Partial<Extract<MessageBlock, { type: 'tool_use' }>>): Extract<MessageBlock, { type: 'tool_use' }> {
  return {
    type: 'tool_use',
    id: 'block-id',
    ts: '2026-01-01T00:00:00.000Z',
    tool: 'artifact',
    input: {},
    output: '',
    status: 'ok',
    details: { id: 'target-id', openRequested: false },
    ...overrides,
  };
}

function readPresentation(block: Extract<MessageBlock, { type: 'tool_use' }>): Presentation | null {
  if (block.tool !== 'artifact' || !block.details || typeof block.details !== 'object') {
    return null;
  }

  const details = block.details as { id?: unknown; openRequested?: unknown };
  return typeof details.id === 'string'
    ? { id: details.id, openRequested: details.openRequested === true }
    : null;
}

describe('toolAutoOpen', () => {
  it('seeds completed presentation block keys without opening historical tools', () => {
    const keys = collectCompletedToolAutoOpenBlockKeys([
      toolBlock({ id: 'completed', details: { id: 'a', openRequested: true } }),
      toolBlock({ id: 'running', status: 'running', running: true, details: { id: 'b', openRequested: true } }),
      { type: 'text', ts: '2026-01-01T00:00:00.000Z', text: 'ignored' },
    ], readPresentation, 'artifact');

    expect([...keys]).toEqual(['completed']);
  });

  it('selects the newest unprocessed requested presentation created after auto-open started', () => {
    const result = findRequestedToolPresentationToOpen({
      messages: [
        toolBlock({ id: 'older', ts: '2026-01-01T00:00:01.000Z', details: { id: 'older-target', openRequested: true } }),
        toolBlock({ id: 'newer', ts: '2026-01-01T00:00:02.000Z', details: { id: 'newer-target', openRequested: true } }),
      ],
      processedBlockKeys: new Set(),
      autoOpenStartedAt: '2026-01-01T00:00:00.000Z',
      readPresentation,
      getTargetId: (presentation) => presentation.id,
      keyPrefix: 'artifact',
    });

    expect(result).toEqual({ targetId: 'newer-target', processedBlockKeys: ['newer'] });
  });

  it('marks stale requested presentations processed without opening them', () => {
    const result = findRequestedToolPresentationToOpen({
      messages: [
        toolBlock({ id: 'stale', ts: '2025-12-31T23:59:59.000Z', details: { id: 'stale-target', openRequested: true } }),
      ],
      processedBlockKeys: new Set(),
      autoOpenStartedAt: '2026-01-01T00:00:00.000Z',
      readPresentation,
      getTargetId: (presentation) => presentation.id,
      keyPrefix: 'artifact',
    });

    expect(result).toEqual({ targetId: null, processedBlockKeys: ['stale'] });
  });

  it('skips already processed, running, and non-requested presentations', () => {
    const result = findRequestedToolPresentationToOpen({
      messages: [
        toolBlock({ id: 'processed', ts: '2026-01-01T00:00:03.000Z', details: { id: 'processed-target', openRequested: true } }),
        toolBlock({ id: 'running', ts: '2026-01-01T00:00:04.000Z', status: 'running', running: true, details: { id: 'running-target', openRequested: true } }),
        toolBlock({ id: 'not-requested', ts: '2026-01-01T00:00:05.000Z', details: { id: 'quiet-target', openRequested: false } }),
      ],
      processedBlockKeys: new Set(['processed']),
      autoOpenStartedAt: '2026-01-01T00:00:00.000Z',
      readPresentation,
      getTargetId: (presentation) => presentation.id,
      keyPrefix: 'artifact',
    });

    expect(result).toEqual({ targetId: null, processedBlockKeys: [] });
  });
});

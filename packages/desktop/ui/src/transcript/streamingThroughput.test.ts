import { afterEach, describe, expect, it, vi } from 'vitest';

import type { MessageBlock } from '../shared/types';
import { getStreamingThroughputLabel } from './streamingThroughput';

afterEach(() => {
  vi.useRealTimers();
});

describe('streamingThroughput', () => {
  it('returns null when the session is not streaming', () => {
    const blocks: MessageBlock[] = [{ type: 'text', ts: '2026-03-29T12:00:00.000Z', text: 'hello world' }];

    expect(getStreamingThroughputLabel(blocks, false, Date.parse('2026-03-29T12:00:02.000Z'))).toBeNull();
  });

  it('estimates tok/s from the live tail text block', () => {
    const blocks: MessageBlock[] = [{ type: 'text', ts: '2026-03-29T12:00:00.000Z', text: 'a'.repeat(48) }];

    expect(getStreamingThroughputLabel(blocks, true, Date.parse('2026-03-29T12:00:03.000Z'))).toBe('~4.0 tok/s');
  });

  it('uses the current thinking block when that is still streaming', () => {
    const blocks: MessageBlock[] = [{ type: 'thinking', ts: '2026-03-29T12:00:00.000Z', text: 'a'.repeat(120) }];

    expect(getStreamingThroughputLabel(blocks, true, Date.parse('2026-03-29T12:00:04.000Z'))).toBe('~7.5 tok/s');
  });

  it('suppresses throughput before enough time has elapsed', () => {
    const blocks: MessageBlock[] = [{ type: 'text', ts: '2026-03-29T12:00:00.000Z', text: 'a'.repeat(80) }];

    expect(getStreamingThroughputLabel(blocks, true, Date.parse('2026-03-29T12:00:00.300Z'))).toBeNull();
  });

  it('rejects unsafe clock values', () => {
    const blocks: MessageBlock[] = [{ type: 'text', ts: '2026-03-29T12:00:00.000Z', text: 'a'.repeat(80) }];

    expect(getStreamingThroughputLabel(blocks, true, Number.MAX_SAFE_INTEGER + 1)).toBeNull();
  });

  it('ignores malformed tail timestamps', () => {
    const blocks: MessageBlock[] = [{ type: 'text', ts: '1', text: 'a'.repeat(80) }];

    expect(getStreamingThroughputLabel(blocks, true, Date.parse('2026-03-29T12:00:04.000Z'))).toBeNull();
  });

  it('returns null once the tail is a tool step instead of streamed text', () => {
    const blocks: MessageBlock[] = [
      { type: 'thinking', ts: '2026-03-29T12:00:00.000Z', text: 'a'.repeat(80) },
      { type: 'tool_use', ts: '2026-03-29T12:00:02.000Z', tool: 'bash', input: { command: 'sleep 1' }, output: '', status: 'running' },
    ];

    expect(getStreamingThroughputLabel(blocks, true, Date.parse('2026-03-29T12:00:04.000Z'))).toBeNull();
  });

  it('renders directly inside ChatView trace headers with a stable label', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-29T12:00:03.000Z'));

    const blocks: MessageBlock[] = [{ type: 'thinking', ts: '2026-03-29T12:00:00.000Z', text: 'a'.repeat(48) }];

    expect(getStreamingThroughputLabel(blocks, true)).toBe('~4.0 tok/s');
  });
});

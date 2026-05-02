import { describe, expect, it } from 'vitest';

import type { MessageBlock } from '../../shared/types';
import {
  getStreamingStatusLabel,
  resolveDisclosureOpen,
  shouldAutoOpenConversationBlock,
  shouldAutoOpenTraceCluster,
  toggleDisclosurePreference,
  toolMeta,
} from './toolPresentation.js';

describe('toolPresentation', () => {
  it('resolves known and unknown tool metadata', () => {
    expect(toolMeta('bash')).toMatchObject({ icon: '$', label: 'bash', tone: 'steel' });
    expect(toolMeta('custom_tool')).toMatchObject({ icon: '⚙', label: 'custom_tool', tone: 'muted' });
  });

  it('resolves disclosure preferences over auto state', () => {
    expect(resolveDisclosureOpen(true, 'auto')).toBe(true);
    expect(resolveDisclosureOpen(false, 'auto')).toBe(false);
    expect(resolveDisclosureOpen(false, 'open')).toBe(true);
    expect(resolveDisclosureOpen(true, 'closed')).toBe(false);
    expect(toggleDisclosurePreference(true, 'auto')).toBe('closed');
    expect(toggleDisclosurePreference(false, 'auto')).toBe('open');
  });

  it('auto-opens trace clusters while live or running', () => {
    expect(shouldAutoOpenTraceCluster(true, false)).toBe(true);
    expect(shouldAutoOpenTraceCluster(false, true)).toBe(true);
    expect(shouldAutoOpenTraceCluster(false, false)).toBe(false);
  });

  it('auto-opens running tool blocks and latest streaming thinking blocks', () => {
    const runningTool: MessageBlock = {
      type: 'tool_use',
      ts: '2026-04-26T00:00:00.000Z',
      tool: 'bash',
      input: {},
      output: '',
      status: 'running',
    };
    const thinking: MessageBlock = { type: 'thinking', ts: '2026-04-26T00:00:00.000Z', text: 'thinking' };

    expect(shouldAutoOpenConversationBlock(runningTool, 0, 2, false)).toBe(true);
    expect(shouldAutoOpenConversationBlock(thinking, 1, 2, true)).toBe(true);
    expect(shouldAutoOpenConversationBlock(thinking, 0, 2, true)).toBe(false);
  });

  it('describes streaming state from the latest block', () => {
    expect(getStreamingStatusLabel([], false)).toBeNull();
    expect(getStreamingStatusLabel([], true)).toBe('Working…');
    expect(getStreamingStatusLabel([{ type: 'text', ts: '2026-04-26T00:00:00.000Z', text: 'hi' }], true)).toBe('Responding…');
    expect(
      getStreamingStatusLabel(
        [
          {
            type: 'tool_use',
            ts: '2026-04-26T00:00:00.000Z',
            tool: 'bash',
            input: {},
            output: '',
            status: 'running',
          },
        ],
        true,
      ),
    ).toBe('Running bash…');
    expect(
      getStreamingStatusLabel(
        [{ type: 'subagent', ts: '2026-04-26T00:00:00.000Z', name: 'reviewer', prompt: '', status: 'running' }],
        true,
      ),
    ).toBe('Running reviewer…');
  });
});

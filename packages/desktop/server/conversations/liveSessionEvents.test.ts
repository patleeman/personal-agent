import { describe, expect, it } from 'vitest';

import { toSse } from './liveSessionEvents.js';

describe('toSse tool execution events', () => {
  it('keeps ordinary bash tool calls in the generic tool pipeline', () => {
    const start = toSse({
      type: 'tool_execution_start',
      toolCallId: 'bash-1',
      toolName: 'bash',
      args: { command: 'pwd' },
    } as never);
    const end = toSse({
      type: 'tool_execution_end',
      toolCallId: 'bash-1',
      toolName: 'bash',
      isError: false,
      result: {
        content: [{ type: 'text', text: '/repo' }],
      },
    } as never);

    expect(start).toEqual({
      type: 'tool_start',
      toolCallId: 'bash-1',
      toolName: 'bash',
      args: { command: 'pwd' },
    });
    expect(end).toMatchObject({
      type: 'tool_end',
      toolCallId: 'bash-1',
      toolName: 'bash',
      isError: false,
      output: '/repo',
    });
    expect(end && 'details' in end ? end.details : undefined).toBeUndefined();
  });

  it('preserves explicit bash tool details without forcing terminal mode', () => {
    const end = toSse({
      type: 'tool_execution_end',
      toolCallId: 'bash-2',
      toolName: 'bash',
      isError: false,
      result: {
        content: [{ type: 'text', text: 'done' }],
        details: { exitCode: 0 },
      },
    } as never);

    expect(end).toMatchObject({
      type: 'tool_end',
      toolCallId: 'bash-2',
      toolName: 'bash',
      details: { exitCode: 0 },
    });
    expect(end && 'details' in end && typeof end.details === 'object' && end.details !== null ? 'displayMode' in end.details : false).toBe(
      false,
    );
  });
});

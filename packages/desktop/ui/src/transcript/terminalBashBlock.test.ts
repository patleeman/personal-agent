import { describe, expect, it } from 'vitest';

import { readTerminalBashToolPresentation } from './terminalBashBlock.js';

describe('terminalBashBlock', () => {
  it('reads execution wrapper metadata', () => {
    expect(
      readTerminalBashToolPresentation({
        type: 'tool_use',
        id: 'tool-1',
        tool: 'bash',
        input: { command: 'npm test', displayMode: 'terminal' },
        details: { displayMode: 'terminal', executionWrappers: [{ id: 'example-wrapper', label: 'Example Wrapper' }, { bad: true }] },
        status: 'done',
      } as never)?.executionWrappers,
    ).toEqual([{ id: 'example-wrapper', label: 'Example Wrapper' }]);
  });

  it('ignores fractional bash exit codes', () => {
    expect(
      readTerminalBashToolPresentation({
        type: 'tool_use',
        id: 'tool-1',
        tool: 'bash',
        input: { command: 'npm test', displayMode: 'terminal' },
        details: { displayMode: 'terminal', exitCode: 1.5 },
        status: 'done',
      } as never)?.exitCode,
    ).toBeUndefined();

    expect(
      readTerminalBashToolPresentation({
        type: 'tool_use',
        id: 'tool-1',
        tool: 'bash',
        input: { command: 'npm test', displayMode: 'terminal' },
        details: { displayMode: 'terminal', exitCode: Number.MAX_SAFE_INTEGER + 1 },
        status: 'done',
      } as never)?.exitCode,
    ).toBeUndefined();
  });
});

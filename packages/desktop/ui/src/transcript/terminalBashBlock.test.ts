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

  it('does not read background command starts as terminal bash presentations', () => {
    expect(
      readTerminalBashToolPresentation({
        type: 'tool_use',
        id: 'tool-1',
        tool: 'background_command',
        input: { action: 'start', command: 'npm run desktop:dev' },
        details: { action: 'start', runId: 'run-123' },
        status: 'done',
      } as never),
    ).toBeNull();
  });

  it('does not read background bash starts as terminal bash presentations', () => {
    expect(
      readTerminalBashToolPresentation({
        type: 'tool_use',
        id: 'tool-1',
        tool: 'bash',
        input: { command: 'npm run desktop:dev', background: true },
        details: { action: 'start', displayMode: 'terminal', runId: 'run-123' },
        status: 'done',
      } as never),
    ).toBeNull();
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

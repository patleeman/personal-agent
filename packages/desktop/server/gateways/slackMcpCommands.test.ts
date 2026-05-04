import { describe, expect, it } from 'vitest';

import { parseSlackMcpGatewayCommand } from './slackMcpCommands.js';

describe('parseSlackMcpGatewayCommand', () => {
  it('parses supported !agent commands', () => {
    expect(parseSlackMcpGatewayCommand('!agent')).toEqual({ kind: 'help' });
    expect(parseSlackMcpGatewayCommand('!agent help')).toEqual({ kind: 'help' });
    expect(parseSlackMcpGatewayCommand('!agent stop')).toEqual({ kind: 'stop' });
    expect(parseSlackMcpGatewayCommand('!agent model gpt-5.5')).toEqual({ kind: 'model', model: 'gpt-5.5' });
    expect(parseSlackMcpGatewayCommand('!agent compact')).toEqual({ kind: 'compact' });
    expect(parseSlackMcpGatewayCommand('!agent detach')).toEqual({ kind: 'detach' });
  });

  it('ignores normal messages and unknown commands', () => {
    expect(parseSlackMcpGatewayCommand('hello')).toBeNull();
    expect(parseSlackMcpGatewayCommand('/stop')).toBeNull();
    expect(parseSlackMcpGatewayCommand('!agent wat')).toBeNull();
  });
});

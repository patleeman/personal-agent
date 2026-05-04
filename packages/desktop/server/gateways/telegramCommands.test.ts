import { describe, expect, it } from 'vitest';

import { parseTelegramGatewayCommand } from './telegramCommands.js';

describe('parseTelegramGatewayCommand', () => {
  it('parses supported commands and bot mentions', () => {
    expect(parseTelegramGatewayCommand('/start')).toEqual({ kind: 'start' });
    expect(parseTelegramGatewayCommand('/pause@my_bot')).toEqual({ kind: 'stop' });
    expect(parseTelegramGatewayCommand('/model gpt-5.5')).toEqual({ kind: 'model', model: 'gpt-5.5' });
    expect(parseTelegramGatewayCommand('/rename Daily agent')).toEqual({ kind: 'rename', title: 'Daily agent' });
  });

  it('rejects unknown or incomplete commands', () => {
    expect(parseTelegramGatewayCommand('hello')).toBeNull();
    expect(parseTelegramGatewayCommand('/wat')).toBeNull();
    expect(parseTelegramGatewayCommand('/rename')).toBeNull();
  });
});

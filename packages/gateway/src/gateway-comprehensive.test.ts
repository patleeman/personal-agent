/**
 * P3: Gateway package behavior breadth tests
 */

import { describe, it, expect, vi } from 'vitest';
import {
  createQueuedTelegramMessageHandler,
  parseAllowlist,
  parseGatewayCliArgs,
  registerGatewayCliCommands,
  splitTelegramMessage,
} from './index.js';

describe('parseAllowlist breadth', () => {
  it('parses comma-separated ids with whitespace', () => {
    const allowlist = parseAllowlist('123, 456 , 789 ');
    expect([...allowlist]).toEqual(['123', '456', '789']);
  });

  it('filters empty entries', () => {
    const allowlist = parseAllowlist('123,,456,,,789');
    expect([...allowlist]).toEqual(['123', '456', '789']);
  });

  it('returns empty set for missing input', () => {
    expect(parseAllowlist(undefined)).toEqual(new Set());
    expect(parseAllowlist('')).toEqual(new Set());
  });
});

describe('splitTelegramMessage breadth', () => {
  it('returns one chunk for short message', () => {
    expect(splitTelegramMessage('hello', 10)).toEqual(['hello']);
  });

  it('splits long messages into fixed-size chunks', () => {
    const chunks = splitTelegramMessage('abcdefghij', 4);
    expect(chunks).toEqual(['abcd', 'efgh', 'ij']);
  });

  it('handles unicode strings', () => {
    const chunks = splitTelegramMessage('🎉🎉🎉🎉', 4);
    expect(chunks.length).toBeGreaterThan(0);
  });
});

describe('gateway command registration breadth', () => {
  it('registers gateway command metadata', () => {
    const commands: Array<{ name: string; usage: string; description: string }> = [];

    registerGatewayCliCommands((command) => {
      commands.push({
        name: command.name,
        usage: command.usage,
        description: command.description,
      });
    });

    expect(commands).toEqual([
      {
        name: 'gateway',
        usage: 'pa gateway [telegram|discord] [start|help]',
        description: 'Run messaging gateway commands',
      },
    ]);
  });

  it('supports parsing provider-specific CLI args', () => {
    expect(parseGatewayCliArgs(['telegram', 'start'])).toEqual({ action: 'start', provider: 'telegram' });
    expect(parseGatewayCliArgs(['discord', 'help'])).toEqual({ action: 'help', provider: 'discord' });
    expect(parseGatewayCliArgs(['start', 'discord'])).toEqual({ action: 'start', provider: 'discord' });
  });
});

describe('queued telegram handler breadth', () => {
  it('sends typing action before processing', async () => {
    const sendMessage = vi.fn(async () => undefined);
    const sendChatAction = vi.fn(async () => undefined);
    const runPrompt = vi.fn(async () => 'response');

    const handler = createQueuedTelegramMessageHandler({
      allowlist: new Set(['1']),
      profileName: 'shared',
      agentDir: '/tmp/agent',
      telegramSessionDir: '/tmp/sessions',
      workingDirectory: '/tmp/work',
      sendMessage,
      sendChatAction,
      runPrompt,
    });

    handler.handleMessage({ chat: { id: 1 }, text: 'hello' });
    await handler.waitForIdle();

    expect(sendChatAction).toHaveBeenCalledWith(1, 'typing');
  });

  it('rejects empty message text', async () => {
    const sendMessage = vi.fn(async () => undefined);
    const sendChatAction = vi.fn(async () => undefined);
    const runPrompt = vi.fn(async () => 'response');

    const handler = createQueuedTelegramMessageHandler({
      allowlist: new Set(['1']),
      profileName: 'shared',
      agentDir: '/tmp/agent',
      telegramSessionDir: '/tmp/sessions',
      workingDirectory: '/tmp/work',
      sendMessage,
      sendChatAction,
      runPrompt,
    });

    handler.handleMessage({ chat: { id: 1 }, text: '' });
    await handler.waitForIdle();

    expect(runPrompt).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledWith(1, 'Please send text messages only.');
  });

  it('splits long responses into multiple messages', async () => {
    const sendMessage = vi.fn(async () => undefined);
    const sendChatAction = vi.fn(async () => undefined);
    const longResponse = 'a'.repeat(5000);
    const runPrompt = vi.fn(async () => longResponse);

    const handler = createQueuedTelegramMessageHandler({
      allowlist: new Set(['1']),
      profileName: 'shared',
      agentDir: '/tmp/agent',
      telegramSessionDir: '/tmp/sessions',
      workingDirectory: '/tmp/work',
      sendMessage,
      sendChatAction,
      runPrompt,
    });

    handler.handleMessage({ chat: { id: 1 }, text: 'hello' });
    await handler.waitForIdle();

    expect(sendMessage).toHaveBeenCalledTimes(2);
  });

  it('returns formatted error when runPrompt fails', async () => {
    const sendMessage = vi.fn(async () => undefined);
    const sendChatAction = vi.fn(async () => undefined);
    const runPrompt = vi.fn(async () => {
      throw new Error('Processing failed');
    });

    const handler = createQueuedTelegramMessageHandler({
      allowlist: new Set(['1']),
      profileName: 'shared',
      agentDir: '/tmp/agent',
      telegramSessionDir: '/tmp/sessions',
      workingDirectory: '/tmp/work',
      sendMessage,
      sendChatAction,
      runPrompt,
    });

    handler.handleMessage({ chat: { id: 1 }, text: 'hello' });
    await handler.waitForIdle();

    expect(sendMessage).toHaveBeenCalledWith(1, 'Error: Processing failed');
  });
});

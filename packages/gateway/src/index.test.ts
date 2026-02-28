import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createQueuedTelegramMessageHandler,
  parseAllowlist,
  splitTelegramMessage,
} from './index.js';

const originalEnv = process.env;

beforeEach(() => {
  process.env = {
    ...originalEnv,
    PERSONAL_AGENT_DISABLE_DAEMON_EVENTS: '1',
  };
});

afterEach(() => {
  process.env = originalEnv;
});

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = () => {};
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe('parseAllowlist', () => {
  it('parses comma-separated ids', () => {
    const allowlist = parseAllowlist('123,456, 789 ');
    expect([...allowlist]).toEqual(['123', '456', '789']);
  });

  it('returns empty set for empty input', () => {
    expect(parseAllowlist(undefined).size).toBe(0);
    expect(parseAllowlist('').size).toBe(0);
  });
});

describe('splitTelegramMessage', () => {
  it('returns one chunk when below limit', () => {
    expect(splitTelegramMessage('hello', 10)).toEqual(['hello']);
  });

  it('splits into multiple chunks when above limit', () => {
    const chunks = splitTelegramMessage('abcdefghij', 4);
    expect(chunks).toEqual(['abcd', 'efgh', 'ij']);
  });
});

describe('queued message handler', () => {
  it('rejects non-allowlisted chats without running prompts', async () => {
    const sendMessage = vi.fn(async () => undefined);
    const sendChatAction = vi.fn(async () => undefined);
    const runPrompt = vi.fn(async () => 'ignored');

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

    handler.handleMessage({ chat: { id: 2 }, text: 'hello' });
    await handler.waitForIdle('2');

    expect(runPrompt).not.toHaveBeenCalled();
    expect(sendChatAction).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledWith(2, 'This chat is not allowed.');
  });

  it('isolates session files per chat and queues messages per chat', async () => {
    const sendMessage = vi.fn(async () => undefined);
    const sendChatAction = vi.fn(async () => undefined);

    const firstGate = deferred();

    const runPrompt = vi.fn(async ({ prompt }: { prompt: string; sessionFile: string }) => {
      if (prompt === 'first') {
        await firstGate.promise;
      }
      return `reply:${prompt}`;
    });

    const handler = createQueuedTelegramMessageHandler({
      allowlist: new Set(['1', '2']),
      profileName: 'shared',
      agentDir: '/tmp/agent',
      telegramSessionDir: '/tmp/sessions',
      workingDirectory: '/tmp/work',
      sendMessage,
      sendChatAction,
      runPrompt,
    });

    handler.handleMessage({ chat: { id: 1 }, text: 'first' });
    handler.handleMessage({ chat: { id: 1 }, text: 'second' });
    handler.handleMessage({ chat: { id: 2 }, text: 'third' });

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(runPrompt).toHaveBeenCalledTimes(2);

    const firstCall = runPrompt.mock.calls[0]?.[0] as { sessionFile: string };
    const thirdCall = runPrompt.mock.calls[1]?.[0] as { sessionFile: string };

    expect(firstCall.sessionFile).toBe('/tmp/sessions/1.jsonl');
    expect(thirdCall.sessionFile).toBe('/tmp/sessions/2.jsonl');

    firstGate.resolve();
    await handler.waitForIdle();

    expect(runPrompt).toHaveBeenCalledTimes(3);

    const secondCall = runPrompt.mock.calls[2]?.[0] as { sessionFile: string };
    expect(secondCall.sessionFile).toBe('/tmp/sessions/1.jsonl');
  });

  it('rejects messages when per-chat queue limit is exceeded', async () => {
    const sendMessage = vi.fn(async () => undefined);
    const sendChatAction = vi.fn(async () => undefined);
    const gate = deferred();

    const runPrompt = vi.fn(async () => {
      await gate.promise;
      return 'reply';
    });

    const handler = createQueuedTelegramMessageHandler({
      allowlist: new Set(['1']),
      profileName: 'shared',
      agentDir: '/tmp/agent',
      telegramSessionDir: '/tmp/sessions',
      workingDirectory: '/tmp/work',
      maxPendingPerChat: 1,
      sendMessage,
      sendChatAction,
      runPrompt,
    });

    handler.handleMessage({ chat: { id: 1 }, text: 'first' });
    handler.handleMessage({ chat: { id: 1 }, text: 'second' });

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(runPrompt).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith(
      1,
      'Too many pending messages for this chat (limit: 1). Please wait and try again.',
    );

    gate.resolve();
    await handler.waitForIdle();
  });
});

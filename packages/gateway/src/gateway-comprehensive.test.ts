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

interface TestRunPromptInput {
  prompt: string;
  sessionFile: string;
  cwd: string;
  model?: string;
  images?: Array<{
    type: 'image';
    data: string;
    mimeType: string;
  }>;
  abortSignal?: AbortSignal;
  onTextDelta?: (delta: string) => void;
  onToolActivity?: (event: {
    phase: 'call' | 'result';
    toolName: string;
    args?: Record<string, unknown>;
    resultText?: string;
    isError?: boolean;
  }) => void;
  logContext?: {
    source: string;
    userId: string;
    userName?: string;
  };
}

type TestRunPrompt = (input: TestRunPromptInput) => Promise<string>;

function createTestConversationControllerFactory(runPrompt: TestRunPrompt) {
  return async ({ sessionFile }: { sessionFile: string }) => {
    let runChain: Promise<void> = Promise.resolve();
    let activeAbortController: AbortController | undefined;

    const enqueueRun = (input: TestRunPromptInput): Promise<string> => {
      const abortController = new AbortController();
      const run = runChain
        .then(async () => {
          activeAbortController = abortController;
          return runPrompt({
            ...input,
            sessionFile,
            abortSignal: abortController.signal,
          });
        })
        .finally(() => {
          if (activeAbortController === abortController) {
            activeAbortController = undefined;
          }
        });

      runChain = run.then(() => undefined).catch(() => undefined);
      return run;
    };

    let activeSessionFile = sessionFile;

    return {
      submitPrompt: async (input: TestRunPromptInput) => ({ mode: 'started' as const, run: enqueueRun(input) }),
      submitFollowUp: async (input: TestRunPromptInput) => ({ mode: 'started' as const, run: enqueueRun(input) }),
      compact: async (customInstructions?: string) => {
        if (customInstructions && customInstructions.length > 0) {
          return `Context compacted.\n${customInstructions}`;
        }

        return 'Context compacted.';
      },
      getUserMessagesForForking: async () => [],
      fork: async () => {
        activeSessionFile = `${activeSessionFile}.fork`;
        return {
          sessionFile: activeSessionFile,
          entryId: 'entry-1',
          prompt: 'Fork point',
          selectedText: '',
          cancelled: false,
        };
      },
      getSessionFile: async () => activeSessionFile,
      abortCurrent: async () => {
        if (!activeAbortController) {
          return false;
        }

        activeAbortController.abort();
        return true;
      },
      waitForIdle: async () => {
        await runChain;
      },
      dispose: async () => {
        if (activeAbortController) {
          activeAbortController.abort();
        }

        await runChain;
      },
    };
  };
}

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
        usage: 'pa gateway [telegram|service|send] [subcommand]',
        description: 'Run messaging gateway commands',
      },
    ]);
  });

  it('supports parsing provider-specific CLI args', () => {
    expect(parseGatewayCliArgs(['telegram', 'start'])).toEqual({ action: 'start', provider: 'telegram' });
    expect(parseGatewayCliArgs(['telegram', 'help'])).toEqual({ action: 'help', provider: 'telegram' });
    expect(parseGatewayCliArgs(['setup', 'telegram'])).toEqual({ action: 'setup', provider: 'telegram' });
    expect(parseGatewayCliArgs(['send', 'hello'])).toEqual({
      action: 'send',
      provider: 'telegram',
      sendArgs: ['hello'],
    });
    expect(parseGatewayCliArgs(['telegram', 'send', 'hello'])).toEqual({
      action: 'send',
      provider: 'telegram',
      sendArgs: ['hello'],
    });
    expect(parseGatewayCliArgs(['service', 'install', 'telegram'])).toEqual({
      action: 'service',
      serviceAction: 'install',
      provider: 'telegram',
    });
    expect(parseGatewayCliArgs(['service', 'status'])).toEqual({
      action: 'service',
      serviceAction: 'status',
      provider: 'telegram',
    });
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
      createConversationController: createTestConversationControllerFactory(runPrompt),
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
      createConversationController: createTestConversationControllerFactory(runPrompt),
    });

    handler.handleMessage({ chat: { id: 1 }, text: '' });
    await handler.waitForIdle();

    expect(runPrompt).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledWith(1, 'Please send text, documents, images, or voice notes.');
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
      createConversationController: createTestConversationControllerFactory(runPrompt),
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
      createConversationController: createTestConversationControllerFactory(runPrompt),
    });

    handler.handleMessage({ chat: { id: 1 }, text: 'hello' });
    await handler.waitForIdle();

    expect(sendMessage).toHaveBeenCalledWith(1, 'Error: Processing failed');
  });
});

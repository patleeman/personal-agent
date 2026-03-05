import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createQueuedDiscordMessageHandler,
  createQueuedTelegramMessageHandler,
  flushGatewayNotifications,
  parseAllowlist,
  parseGatewayCliArgs,
  registerGatewayCliCommands,
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

function createTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

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

    return {
      submitPrompt: async (input: TestRunPromptInput) => ({ mode: 'started' as const, run: enqueueRun(input) }),
      submitFollowUp: async (input: TestRunPromptInput) => ({ mode: 'started' as const, run: enqueueRun(input) }),
      compact: async (customInstructions?: string) => {
        if (customInstructions && customInstructions.length > 0) {
          return `Context compacted.\n${customInstructions}`;
        }

        return 'Context compacted.';
      },
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

  it('preserves fenced code blocks across chunk boundaries', () => {
    const text = [
      '```ts',
      'const value = 1;',
      'console.log(value);',
      '```',
      'done',
    ].join('\n');

    const chunks = splitTelegramMessage(text, 20);

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      const fenceCount = (chunk.match(/```/g) ?? []).length;
      expect(fenceCount % 2).toBe(0);
    }
  });
});

describe('flushGatewayNotifications', () => {
  it('delivers pulled daemon notifications', async () => {
    const pullNotifications = vi.fn(async () => [
      {
        id: 'notification-1',
        createdAt: new Date().toISOString(),
        source: 'module:tasks',
        gateway: 'telegram' as const,
        destinationId: '123',
        message: 'Take a quick stretch break.',
        taskId: 'stretch-break',
        status: 'success' as const,
      },
    ]);

    const deliverNotification = vi.fn(async () => undefined);

    const deliveredCount = await flushGatewayNotifications({
      gateway: 'telegram',
      pullNotifications,
      deliverNotification,
    });

    expect(deliveredCount).toBe(1);
    expect(pullNotifications).toHaveBeenCalledTimes(1);
    expect(deliverNotification).toHaveBeenCalledTimes(1);
    expect(deliverNotification).toHaveBeenCalledWith(expect.objectContaining({ id: 'notification-1' }));
  });

  it('requeues failed deliveries', async () => {
    const notification = {
      id: 'notification-1',
      createdAt: new Date().toISOString(),
      source: 'module:tasks',
      gateway: 'telegram' as const,
      destinationId: '123',
      message: 'Take a quick stretch break.',
      taskId: 'stretch-break',
      status: 'success' as const,
    };

    const pullNotifications = vi.fn(async () => [notification]);
    const deliverNotification = vi.fn(async () => {
      throw new Error('network down');
    });
    const requeueNotification = vi.fn(async () => undefined);

    const deliveredCount = await flushGatewayNotifications({
      gateway: 'telegram',
      pullNotifications,
      deliverNotification,
      requeueNotification,
    });

    expect(deliveredCount).toBe(0);
    expect(deliverNotification).toHaveBeenCalledTimes(1);
    expect(requeueNotification).toHaveBeenCalledTimes(1);
    expect(requeueNotification).toHaveBeenCalledWith(notification);
  });
});

describe('parseGatewayCliArgs', () => {
  it('shows help by default and supports explicit start', () => {
    expect(parseGatewayCliArgs([])).toEqual({ action: 'help' });
    expect(parseGatewayCliArgs(['start'])).toEqual({ action: 'start', provider: 'telegram' });
  });

  it('supports provider-first syntax', () => {
    expect(parseGatewayCliArgs(['telegram'])).toEqual({ action: 'help', provider: 'telegram' });
    expect(parseGatewayCliArgs(['discord'])).toEqual({ action: 'help', provider: 'discord' });
    expect(parseGatewayCliArgs(['telegram', 'help'])).toEqual({ action: 'help', provider: 'telegram' });
    expect(parseGatewayCliArgs(['discord', 'start'])).toEqual({ action: 'start', provider: 'discord' });
    expect(parseGatewayCliArgs(['telegram', 'setup'])).toEqual({ action: 'setup', provider: 'telegram' });
  });

  it('supports start/setup <provider> syntax', () => {
    expect(parseGatewayCliArgs(['start', 'telegram'])).toEqual({ action: 'start', provider: 'telegram' });
    expect(parseGatewayCliArgs(['start', 'discord'])).toEqual({ action: 'start', provider: 'discord' });
    expect(parseGatewayCliArgs(['setup', 'telegram'])).toEqual({ action: 'setup', provider: 'telegram' });
    expect(parseGatewayCliArgs(['setup'])).toEqual({ action: 'setup' });
  });

  it('supports service subcommands', () => {
    expect(parseGatewayCliArgs(['service'])).toEqual({ action: 'service', serviceAction: 'help' });
    expect(parseGatewayCliArgs(['service', 'help'])).toEqual({ action: 'service', serviceAction: 'help' });
    expect(parseGatewayCliArgs(['service', 'help', 'discord'])).toEqual({
      action: 'service',
      serviceAction: 'help',
      provider: 'discord',
    });
    expect(parseGatewayCliArgs(['service', 'install'])).toEqual({
      action: 'service',
      serviceAction: 'install',
      provider: 'telegram',
    });
    expect(parseGatewayCliArgs(['service', 'status', 'discord'])).toEqual({
      action: 'service',
      serviceAction: 'status',
      provider: 'discord',
    });
    expect(parseGatewayCliArgs(['service', 'uninstall', 'telegram'])).toEqual({
      action: 'service',
      serviceAction: 'uninstall',
      provider: 'telegram',
    });
  });

  it('supports global help', () => {
    expect(parseGatewayCliArgs(['help'])).toEqual({ action: 'help' });
    expect(parseGatewayCliArgs(['--help'])).toEqual({ action: 'help' });
    expect(parseGatewayCliArgs(['-h'])).toEqual({ action: 'help' });
  });

  it('fails for invalid syntax', () => {
    expect(() => parseGatewayCliArgs(['start', 'slack'])).toThrow('Unknown gateway provider: slack');
    expect(() => parseGatewayCliArgs(['setup', 'slack'])).toThrow('Unknown gateway provider: slack');
    expect(() => parseGatewayCliArgs(['service', 'restart'])).toThrow('Unknown gateway service subcommand: restart');
    expect(() => parseGatewayCliArgs(['service', 'install', 'slack'])).toThrow('Unknown gateway provider: slack');
    expect(() => parseGatewayCliArgs(['discord', 'stop'])).toThrow('Unknown discord subcommand: stop');
    expect(() => parseGatewayCliArgs(['unknown'])).toThrow('Unknown gateway subcommand: unknown');
    expect(() => parseGatewayCliArgs(['help', 'discord'])).toThrow('Too many arguments for `pa gateway help`');
  });
});

describe('gateway CLI command registration', () => {
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
        usage: 'pa gateway [telegram|discord|service] [subcommand]',
        description: 'Run messaging gateway commands',
      },
    ]);
  });
});

describe('queued telegram message handler', () => {
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
      createConversationController: createTestConversationControllerFactory(runPrompt),
    });

    handler.handleMessage({ chat: { id: 2 }, text: 'hello' });
    await handler.waitForIdle('2');

    expect(runPrompt).not.toHaveBeenCalled();
    expect(sendChatAction).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledWith(2, 'This chat is not allowed.');
  });

  it('silently ignores non-authorized users when allowed user IDs are configured', async () => {
    const sendMessage = vi.fn(async () => undefined);
    const sendChatAction = vi.fn(async () => undefined);
    const runPrompt = vi.fn(async () => 'ignored');

    const handler = createQueuedTelegramMessageHandler({
      allowlist: new Set(['1']),
      allowedUserIds: new Set(['42']),
      profileName: 'shared',
      agentDir: '/tmp/agent',
      telegramSessionDir: '/tmp/sessions',
      workingDirectory: '/tmp/work',
      sendMessage,
      sendChatAction,
      createConversationController: createTestConversationControllerFactory(runPrompt),
    });

    handler.handleMessage({
      chat: { id: 1 },
      text: 'hello',
      from: { id: 7 },
    });
    await handler.waitForIdle('1');

    expect(runPrompt).not.toHaveBeenCalled();
    expect(sendChatAction).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('routes topic messages to thread-specific sessions and replies in the same thread', async () => {
    const sendMessage = vi.fn(async () => undefined);
    const sendChatAction = vi.fn(async () => undefined);
    const runPrompt = vi.fn(async () => 'thread response');

    const handler = createQueuedTelegramMessageHandler({
      allowlist: new Set(['1']),
      allowedUserIds: new Set(['42']),
      profileName: 'shared',
      agentDir: '/tmp/agent',
      telegramSessionDir: '/tmp/sessions',
      workingDirectory: '/tmp/work',
      sendMessage,
      sendChatAction,
      createConversationController: createTestConversationControllerFactory(runPrompt),
    });

    handler.handleMessage({
      chat: { id: 1 },
      message_thread_id: 99,
      text: 'hello thread',
      from: { id: 42 },
    });
    await handler.waitForIdle('1');

    expect(runPrompt).toHaveBeenCalledWith(expect.objectContaining({
      sessionFile: '/tmp/sessions/1__thread_99.jsonl',
    }));
    expect(sendChatAction).toHaveBeenCalledWith(1, 'typing', { message_thread_id: 99 });

    const sentCalls = sendMessage.mock.calls as unknown as Array<[
      number,
      string,
      ({ message_thread_id?: number } | undefined)?,
    ]>;
    expect(sentCalls.some((call) =>
      call[0] === 1
      && call[1] === 'thread response'
      && call[2]?.message_thread_id === 99,
    )).toBe(true);
  });

  it('returns configured command list for /commands without invoking pi', async () => {
    const sendMessage = vi.fn(async () => undefined);
    const sendChatAction = vi.fn(async () => undefined);
    const runPrompt = vi.fn(async () => 'ignored');

    const handler = createQueuedTelegramMessageHandler({
      allowlist: new Set(['1']),
      profileName: 'shared',
      agentDir: '/tmp/agent',
      telegramSessionDir: '/tmp/sessions',
      workingDirectory: '/tmp/work',
      commandHelpText: 'Available commands:\n/new\n/status',
      sendMessage,
      sendChatAction,
      createConversationController: createTestConversationControllerFactory(runPrompt),
    });

    handler.handleMessage({ chat: { id: 1 }, text: '/commands' });
    await handler.waitForIdle('1');

    expect(runPrompt).not.toHaveBeenCalled();
    expect(sendChatAction).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledWith(1, 'Available commands:\n/new\n/status');
  });

  it('returns scheduled task list for /tasks without invoking pi', async () => {
    const sendMessage = vi.fn(async () => undefined);
    const sendChatAction = vi.fn(async () => undefined);
    const runPrompt = vi.fn(async () => 'ignored');
    const listScheduledTasks = vi.fn(async ({ statusFilter }: { statusFilter: string }) =>
      `Scheduled tasks\nFilter: ${statusFilter}`
    );

    const handler = createQueuedTelegramMessageHandler({
      allowlist: new Set(['1']),
      profileName: 'shared',
      agentDir: '/tmp/agent',
      telegramSessionDir: '/tmp/sessions',
      workingDirectory: '/tmp/work',
      sendMessage,
      sendChatAction,
      listScheduledTasks,
      createConversationController: createTestConversationControllerFactory(runPrompt),
    });

    handler.handleMessage({ chat: { id: 1 }, text: '/tasks completed' });
    await handler.waitForIdle('1');

    expect(listScheduledTasks).toHaveBeenCalledWith({ statusFilter: 'completed' });
    expect(runPrompt).not.toHaveBeenCalled();
    expect(sendChatAction).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledWith(1, 'Scheduled tasks\nFilter: completed');
  });

  it('shows /tasks usage when the status filter is invalid', async () => {
    const sendMessage = vi.fn(async () => undefined);
    const sendChatAction = vi.fn(async () => undefined);
    const runPrompt = vi.fn(async () => 'ignored');
    const listScheduledTasks = vi.fn(async () => 'should-not-be-called');

    const handler = createQueuedTelegramMessageHandler({
      allowlist: new Set(['1']),
      profileName: 'shared',
      agentDir: '/tmp/agent',
      telegramSessionDir: '/tmp/sessions',
      workingDirectory: '/tmp/work',
      sendMessage,
      sendChatAction,
      listScheduledTasks,
      createConversationController: createTestConversationControllerFactory(runPrompt),
    });

    handler.handleMessage({ chat: { id: 1 }, text: '/tasks nope invalid' });
    await handler.waitForIdle('1');

    expect(listScheduledTasks).not.toHaveBeenCalled();
    expect(runPrompt).not.toHaveBeenCalled();
    expect(sendChatAction).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledWith(
      1,
      'Usage: /tasks [all|running|active|completed|disabled|pending|error]\nExample: /tasks completed',
    );
  });

  it('routes /room commands to the room admin handler', async () => {
    const sendMessage = vi.fn(async () => undefined);
    const sendChatAction = vi.fn(async () => undefined);
    const runPrompt = vi.fn(async () => 'ignored');
    const handleRoomAdminCommand = vi.fn(async () => 'Pending room authorization requests:\n- room-a');

    const handler = createQueuedTelegramMessageHandler({
      allowlist: new Set(['1']),
      profileName: 'shared',
      agentDir: '/tmp/agent',
      telegramSessionDir: '/tmp/sessions',
      workingDirectory: '/tmp/work',
      sendMessage,
      sendChatAction,
      handleRoomAdminCommand,
      createConversationController: createTestConversationControllerFactory(runPrompt),
    });

    handler.handleMessage({
      chat: { id: 1 },
      text: '/room pending',
      from: { id: 42, username: 'patrick' },
    });
    await handler.waitForIdle('1');

    expect(handleRoomAdminCommand).toHaveBeenCalledWith({
      actorUserId: '42',
      actorLabel: 'patrick (42)',
      args: 'pending',
    });
    expect(runPrompt).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledWith(1, 'Pending room authorization requests:\n- room-a');
  });

  it('includes /tasks, /room, /model, /models, /stop, /cancel, /compact, and /resume in default /commands output', async () => {
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
      createConversationController: createTestConversationControllerFactory(runPrompt),
    });

    handler.handleMessage({ chat: { id: 1 }, text: '/commands' });
    await handler.waitForIdle('1');

    expect(runPrompt).not.toHaveBeenCalled();
    expect(sendChatAction).not.toHaveBeenCalled();

    const output = sendMessage.mock.calls
      .map((call) => String(call.at(1) ?? ''))
      .join('\n');
    expect(output).toContain('/tasks -');
    expect(output).toContain('/room -');
    expect(output).toContain('/model -');
    expect(output).toContain('/models -');
    expect(output).toContain('/stop -');
    expect(output).toContain('/cancel -');
    expect(output).toContain('/compact -');
    expect(output).toContain('/resume -');
  });

  it('returns configured skills list for /skills without invoking pi', async () => {
    const sendMessage = vi.fn(async () => undefined);
    const sendChatAction = vi.fn(async () => undefined);
    const runPrompt = vi.fn(async () => 'ignored');

    const handler = createQueuedTelegramMessageHandler({
      allowlist: new Set(['1']),
      profileName: 'shared',
      agentDir: '/tmp/agent',
      telegramSessionDir: '/tmp/sessions',
      workingDirectory: '/tmp/work',
      skillsHelpText: 'Available skills:\n- tdd-feature',
      sendMessage,
      sendChatAction,
      createConversationController: createTestConversationControllerFactory(runPrompt),
    });

    handler.handleMessage({ chat: { id: 1 }, text: '/skills' });
    await handler.waitForIdle('1');

    expect(runPrompt).not.toHaveBeenCalled();
    expect(sendChatAction).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledWith(1, 'Available skills:\n- tdd-feature');
  });

  it('handles /resume and /compact without forwarding to pi', async () => {
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
      createConversationController: createTestConversationControllerFactory(runPrompt),
    });

    handler.handleMessage({ chat: { id: 1 }, text: '/resume' });
    handler.handleMessage({ chat: { id: 1 }, text: '/compact' });
    await handler.waitForIdle('1');

    expect(runPrompt).not.toHaveBeenCalled();
    expect(sendChatAction).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledWith(
      1,
      'Gateway sessions already resume automatically per chat/topic. Use /new to start a fresh session.',
    );
    expect(sendMessage).toHaveBeenCalledWith(
      1,
      'Context compacted.',
    );
  });

  it('enters follow-up capture mode when /followup is sent without arguments', async () => {
    const sendMessage = vi.fn(async () => undefined);
    const sendChatAction = vi.fn(async () => undefined);
    const runPrompt = vi.fn(async ({ prompt }: { prompt: string }) => `reply:${prompt}`);

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

    handler.handleMessage({ chat: { id: 1 }, text: '/followup' });
    await handler.waitForIdle('1');

    expect(sendMessage).toHaveBeenCalledWith(
      1,
      'Send your follow-up message now. Your next message in this chat will be queued as a follow-up.',
      {
        reply_markup: {
          force_reply: true,
        },
      },
    );

    handler.handleMessage({ chat: { id: 1 }, text: 'also check edge cases' });
    await handler.waitForIdle('1');

    const promptCall = runPrompt.mock.calls[0]?.[0] as { prompt: string };
    expect(promptCall.prompt).toBe('also check edge cases');
  });

  it('reuses the last prompt with /regenerate', async () => {
    const sendMessage = vi.fn(async () => undefined);
    const sendChatAction = vi.fn(async () => undefined);
    const runPrompt = vi.fn(async ({ prompt }: { prompt: string }) => `reply:${prompt}`);

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

    handler.handleMessage({ chat: { id: 1 }, text: 'hello there' });
    await handler.waitForIdle('1');

    handler.handleMessage({ chat: { id: 1 }, text: '/regenerate' });
    await handler.waitForIdle('1');

    expect(runPrompt).toHaveBeenCalledTimes(2);
    const firstPrompt = runPrompt.mock.calls[0]?.[0] as { prompt: string };
    const secondPrompt = runPrompt.mock.calls[1]?.[0] as { prompt: string };
    expect(firstPrompt.prompt).toBe('hello there');
    expect(secondPrompt.prompt).toBe('hello there');
  });

  it('passes prepared inbound media into prompt text and image attachments', async () => {
    const sendMessage = vi.fn(async () => undefined);
    const sendChatAction = vi.fn(async () => undefined);
    const runPrompt = vi.fn(async ({ prompt }: { prompt: string }) => `reply:${prompt}`);
    const prepareInboundMedia = vi.fn(async () => [
      {
        kind: 'photo' as const,
        localPath: '/tmp/media/image.png',
        fileName: 'image.png',
        mimeType: 'image/png',
        imageContent: {
          type: 'image' as const,
          data: 'aGVsbG8=',
          mimeType: 'image/png',
        },
      },
    ]);

    const handler = createQueuedTelegramMessageHandler({
      allowlist: new Set(['1']),
      profileName: 'shared',
      agentDir: '/tmp/agent',
      telegramSessionDir: '/tmp/sessions',
      workingDirectory: '/tmp/work',
      sendMessage,
      sendChatAction,
      prepareInboundMedia,
      createConversationController: createTestConversationControllerFactory(runPrompt),
    });

    handler.handleMessage({
      chat: { id: 1 },
      caption: 'analyze this image',
      photo: [{ file_id: 'photo-1', width: 10, height: 10 }],
    });

    await handler.waitForIdle('1');

    expect(prepareInboundMedia).toHaveBeenCalledTimes(1);

    const promptCall = runPrompt.mock.calls[0]?.[0] as { prompt: string; images?: unknown[] };
    expect(promptCall.prompt).toContain('analyze this image');
    expect(promptCall.prompt).toContain('/tmp/media/image.png');
    expect(promptCall.images).toEqual([
      {
        type: 'image',
        data: 'aGVsbG8=',
        mimeType: 'image/png',
      },
    ]);
  });

  it('accepts sticker messages as media input', async () => {
    const sendMessage = vi.fn(async () => undefined);
    const sendChatAction = vi.fn(async () => undefined);
    const runPrompt = vi.fn(async ({ prompt }: { prompt: string }) => `reply:${prompt}`);
    const prepareInboundMedia = vi.fn(async (_input: {
      media: Array<{ kind: string; fileId: string }>;
    }) => [
      {
        kind: 'sticker' as const,
        localPath: '/tmp/media/sticker.webp',
        fileName: 'sticker.webp',
        mimeType: 'image/webp',
      },
    ]);

    const handler = createQueuedTelegramMessageHandler({
      allowlist: new Set(['1']),
      profileName: 'shared',
      agentDir: '/tmp/agent',
      telegramSessionDir: '/tmp/sessions',
      workingDirectory: '/tmp/work',
      sendMessage,
      sendChatAction,
      prepareInboundMedia,
      createConversationController: createTestConversationControllerFactory(runPrompt),
    });

    handler.handleMessage({
      chat: { id: 1 },
      sticker: { file_id: 'sticker-1', width: 512, height: 512 },
    });

    await handler.waitForIdle('1');

    expect(prepareInboundMedia).toHaveBeenCalledTimes(1);
    const prepareCall = prepareInboundMedia.mock.calls[0]?.[0];
    expect(prepareCall).toBeDefined();

    const media = (prepareCall as { media: Array<{ kind: string; fileId: string }> }).media;
    expect(media[0]).toMatchObject({ kind: 'sticker', fileId: 'sticker-1' });

    const promptCall = runPrompt.mock.calls[0]?.[0] as { prompt: string };
    expect(promptCall.prompt).toContain('/tmp/media/sticker.webp');
  });

  it('uses message edits for streaming and sends long responses as text files', async () => {
    const sendMessage = vi.fn(async () => ({ message_id: 321 }));
    const editMessageText = vi.fn(async () => undefined);
    const sendDocument = vi.fn(async () => undefined);
    const sendChatAction = vi.fn(async () => undefined);
    const exportDir = createTempDir('gateway-telegram-exports-');

    const runPrompt = vi.fn(async ({ onTextDelta }: { onTextDelta?: (delta: string) => void }) => {
      onTextDelta?.('preview');
      return 'x'.repeat(13_000);
    });

    const handler = createQueuedTelegramMessageHandler({
      allowlist: new Set(['1']),
      profileName: 'shared',
      agentDir: '/tmp/agent',
      telegramSessionDir: '/tmp/sessions',
      workingDirectory: '/tmp/work',
      telegramExportDir: exportDir,
      sendMessage,
      editMessageText,
      sendDocument,
      sendChatAction,
      createConversationController: createTestConversationControllerFactory(runPrompt),
    });

    handler.handleMessage({ chat: { id: 1 }, text: 'stream please' });
    await handler.waitForIdle('1');

    expect(editMessageText).toHaveBeenCalled();
    expect(sendDocument).toHaveBeenCalledTimes(1);
  });

  it('streams tool activity in a temporary telegram status message when enabled', async () => {
    let nextMessageId = 500;
    const sendMessage = vi.fn(async () => ({ message_id: nextMessageId++ }));
    const editMessageText = vi.fn(async () => undefined);
    const deleteMessage = vi.fn(async () => undefined);
    const sendChatAction = vi.fn(async () => undefined);

    const runPrompt = vi.fn(async ({ onToolActivity }: TestRunPromptInput) => {
      onToolActivity?.({
        phase: 'call',
        toolName: 'read',
        args: { path: '/tmp/notes.md' },
      });
      onToolActivity?.({
        phase: 'result',
        toolName: 'read',
        resultText: 'loaded 120 lines',
      });

      return 'done';
    });

    const handler = createQueuedTelegramMessageHandler({
      allowlist: new Set(['1']),
      profileName: 'shared',
      agentDir: '/tmp/agent',
      telegramSessionDir: '/tmp/sessions',
      workingDirectory: '/tmp/work',
      streamToolActivity: true,
      sendMessage,
      editMessageText,
      deleteMessage,
      sendChatAction,
      createConversationController: createTestConversationControllerFactory(runPrompt),
    });

    handler.handleMessage({ chat: { id: 1 }, text: 'run with tool status' });
    await handler.waitForIdle('1');

    const editedCalls = editMessageText.mock.calls.map((call) => {
      const args = call as unknown[];
      return {
        messageId: Number(args[1]),
        text: String(args[2] ?? ''),
      };
    });

    const toolStatusEdit = editedCalls.find((call) => call.text.includes('⚙️ Running tools…'));
    expect(toolStatusEdit).toBeDefined();
    expect(editedCalls.some((call) => call.text.includes('#   phase   tool'))).toBe(true);
    expect(editedCalls.some((call) => /\b1\s+call\s+read\s+path=\/tmp\/notes\.md/.test(call.text))).toBe(true);
    expect(editedCalls.some((call) => /\b2\s+result\s+read\s+loaded 120 lines/.test(call.text))).toBe(true);
    expect(editedCalls.some((call) => call.text.includes('✅ Tool calls'))).toBe(true);

    expect(deleteMessage).not.toHaveBeenCalled();
  });

  it('ignores telegram "message is not modified" edit errors', async () => {
    const sendMessage = vi.fn(async () => ({ message_id: 333 }));
    const editMessageText = vi.fn(async () => {
      const error = new Error(
        'ETELEGRAM: 400 Bad Request: message is not modified: specified new message content and reply markup are exactly the same as a current content and reply markup of the message',
      ) as Error & { response?: { statusCode?: number } };
      error.response = { statusCode: 400 };
      throw error;
    });
    const sendChatAction = vi.fn(async () => undefined);

    const runPrompt = vi.fn(async ({ onTextDelta }: { onTextDelta?: (delta: string) => void }) => {
      onTextDelta?.('preview');
      return 'preview';
    });

    const handler = createQueuedTelegramMessageHandler({
      allowlist: new Set(['1']),
      profileName: 'shared',
      agentDir: '/tmp/agent',
      telegramSessionDir: '/tmp/sessions',
      workingDirectory: '/tmp/work',
      sendMessage,
      editMessageText,
      sendChatAction,
      createConversationController: createTestConversationControllerFactory(runPrompt),
    });

    handler.handleMessage({ chat: { id: 1 }, text: 'stream unchanged' });
    await handler.waitForIdle('1');

    const sentTexts = sendMessage.mock.calls.map((call) => {
      const args = call as unknown[];
      return String(args[1] ?? '');
    });
    expect(sentTexts.some((value) => value.includes('message is not modified'))).toBe(false);
  });

  it('maps /skill <name> to /skill:<name> before invoking pi', async () => {
    const sendMessage = vi.fn(async () => undefined);
    const sendChatAction = vi.fn(async () => undefined);
    const runPrompt = vi.fn(async ({ prompt }: { prompt: string; sessionFile: string }) => `reply:${prompt}`);

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

    handler.handleMessage({ chat: { id: 1 }, text: '/skill tdd-feature' });
    await handler.waitForIdle('1');

    const firstCall = runPrompt.mock.calls[0]?.[0] as { prompt: string };
    expect(firstCall.prompt).toBe('/skill:tdd-feature');
    expect(sendChatAction).toHaveBeenCalledWith(1, 'typing');
  });

  it('injects scheduled task context when replying to tracked notification messages', async () => {
    const sendMessage = vi.fn(async () => undefined);
    const sendChatAction = vi.fn(async () => undefined);
    const runPrompt = vi.fn(async ({ prompt }: { prompt: string }) => `reply:${prompt}`);

    const handler = createQueuedTelegramMessageHandler({
      allowlist: new Set(['1']),
      profileName: 'shared',
      agentDir: '/tmp/agent',
      telegramSessionDir: '/tmp/sessions',
      workingDirectory: '/tmp/work',
      sendMessage,
      sendChatAction,
      resolveScheduledReplyContext: ({ chatId, replyMessageId }) => {
        if (chatId !== '1' || replyMessageId !== 77) {
          return undefined;
        }

        return {
          source: 'scheduled-task',
          taskId: 'daily-status',
          status: 'success',
          message: 'Yesterday summary from scheduled task.',
          logPath: '/tmp/task.log',
          createdAt: '2026-03-03T01:00:00.000Z',
        };
      },
      createConversationController: createTestConversationControllerFactory(runPrompt),
    });

    handler.handleMessage({
      chat: { id: 1 },
      text: 'what should I focus on now?',
      reply_to_message: { message_id: 77 },
    });
    await handler.waitForIdle('1');

    const promptCall = runPrompt.mock.calls[0]?.[0] as { prompt: string };
    expect(promptCall.prompt).toContain('You are responding to a user reply to a scheduled task notification.');
    expect(promptCall.prompt).toContain('Task ID: daily-status');
    expect(promptCall.prompt).toContain('Yesterday summary from scheduled task.');
    expect(promptCall.prompt).toContain('User reply:\nwhat should I focus on now?');
  });

  it('keeps telegram messages in durable inbox until run completion', async () => {
    const durableInboxDir = createTempDir('gateway-telegram-inbox-');

    try {
      const sendMessage = vi.fn(async () => undefined);
      const sendChatAction = vi.fn(async () => undefined);

      let resolveRun: ((value: string) => void) | undefined;
      const runPromise = new Promise<string>((resolve) => {
        resolveRun = resolve;
      });

      const runPrompt = vi.fn(async () => runPromise);

      const handler = createQueuedTelegramMessageHandler({
        allowlist: new Set(['1']),
        profileName: 'shared',
        agentDir: '/tmp/agent',
        telegramSessionDir: '/tmp/sessions',
        workingDirectory: '/tmp/work',
        sendMessage,
        sendChatAction,
        durableInboxDir,
        createConversationController: createTestConversationControllerFactory(runPrompt),
      });

      handler.handleMessage({ chat: { id: 1 }, message_id: 101, text: 'hello' });
      expect(readdirSync(durableInboxDir).length).toBe(1);

      resolveRun?.('done');
      await handler.waitForIdle('1');

      expect(readdirSync(durableInboxDir).length).toBe(0);
    } finally {
      rmSync(durableInboxDir, { recursive: true, force: true });
    }
  });

  it('replays pending durable telegram messages on startup', async () => {
    const durableInboxDir = createTempDir('gateway-telegram-replay-');

    try {
      const storedMessage = {
        version: 1,
        storedAt: new Date().toISOString(),
        message: {
          chat: { id: 1 },
          message_id: 202,
          text: 'replayed message',
        },
      };

      writeFileSync(join(durableInboxDir, 'pending.json'), `${JSON.stringify(storedMessage)}\n`, 'utf-8');

      const sendMessage = vi.fn(async () => undefined);
      const sendChatAction = vi.fn(async () => undefined);
      const runPrompt = vi.fn(async ({ prompt }: { prompt: string }) => `reply:${prompt}`);

      const handler = createQueuedTelegramMessageHandler({
        allowlist: new Set(['1']),
        profileName: 'shared',
        agentDir: '/tmp/agent',
        telegramSessionDir: '/tmp/sessions',
        workingDirectory: '/tmp/work',
        sendMessage,
        sendChatAction,
        durableInboxDir,
        createConversationController: createTestConversationControllerFactory(runPrompt),
      });

      const recovered = handler.replayPendingMessages();
      expect(recovered).toBe(1);

      await handler.waitForIdle('1');

      const firstCall = runPrompt.mock.calls[0]?.[0] as { prompt: string };
      expect(firstCall.prompt).toBe('replayed message');
      expect(readdirSync(durableInboxDir).length).toBe(0);
    } finally {
      rmSync(durableInboxDir, { recursive: true, force: true });
    }
  });

  it('continues sending typing actions while a telegram run is active', async () => {
    vi.useFakeTimers();

    try {
      const sendMessage = vi.fn(async () => undefined);
      const sendChatAction = vi.fn(async () => undefined);

      let resolveRun: ((value: string) => void) | undefined;
      const runPromise = new Promise<string>((resolve) => {
        resolveRun = resolve;
      });

      const runPrompt = vi.fn(async () => runPromise);

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

      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(12_500);

      expect(sendChatAction.mock.calls.length).toBeGreaterThanOrEqual(3);
      expect(sendChatAction).toHaveBeenCalledWith(1, 'typing');

      resolveRun?.('done');
      await handler.waitForIdle('1');

      const callsAfterCompletion = sendChatAction.mock.calls.length;
      await vi.advanceTimersByTimeAsync(8_000);
      expect(sendChatAction.mock.calls.length).toBe(callsAfterCompletion);
    } finally {
      vi.useRealTimers();
    }
  });

  it('streams telegram responses in chunks before completion', async () => {
    const sendMessage = vi.fn(async () => undefined);
    const sendChatAction = vi.fn(async () => undefined);

    let resolveRun: ((value: string) => void) | undefined;
    const runPromise = new Promise<string>((resolve) => {
      resolveRun = resolve;
    });

    const streamedChunk = 'chunk '.repeat(150);
    const finalTail = 'tail';

    const runPrompt = vi.fn(async ({ onTextDelta }: TestRunPromptInput) => {
      onTextDelta?.(streamedChunk);
      return runPromise;
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

    handler.handleMessage({ chat: { id: 1 }, text: 'stream this' });
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(sendMessage).toHaveBeenCalledWith(1, streamedChunk);

    resolveRun?.(`${streamedChunk}${finalTail}`);
    await handler.waitForIdle('1');

    expect(sendMessage).toHaveBeenCalledWith(1, finalTail);
  });

  it('formats markdown in regular telegram responses using parse mode', async () => {
    const sendMessage = vi.fn(async () => undefined);
    const sendChatAction = vi.fn(async () => undefined);
    const runPrompt = vi.fn(async () => '# Heading\n\n**Bold** and `code`');

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

    handler.handleMessage({ chat: { id: 1 }, text: 'format this' });
    await handler.waitForIdle('1');

    expect(sendMessage).toHaveBeenCalledWith(
      1,
      '<b>Heading</b>\n\n<b>Bold</b> and <code>code</code>',
      { parse_mode: 'HTML' },
    );
  });

  it('steers active telegram runs instead of starting a second run with controller mode', async () => {
    const sendMessage = vi.fn(async () => undefined);
    const sendChatAction = vi.fn(async () => undefined);

    let resolveRun: ((value: string) => void) | undefined;
    const firstRun = new Promise<string>((resolve) => {
      resolveRun = resolve;
    });

    const submitPrompt = vi.fn()
      .mockResolvedValueOnce({ mode: 'started', run: firstRun })
      .mockResolvedValueOnce({ mode: 'steered' });

    const controller = {
      submitPrompt,
      submitFollowUp: vi.fn(async () => ({ mode: 'followup' as const })),
      compact: vi.fn(async () => 'Context compacted.'),
      abortCurrent: vi.fn(async () => false),
      waitForIdle: vi.fn(async () => {
        await firstRun;
      }),
      dispose: vi.fn(async () => undefined),
    };

    const createConversationController = vi.fn(async () => controller);

    const handler = createQueuedTelegramMessageHandler({
      allowlist: new Set(['1']),
      profileName: 'shared',
      agentDir: '/tmp/agent',
      telegramSessionDir: '/tmp/sessions',
      workingDirectory: '/tmp/work',
      sendMessage,
      sendChatAction,
      createConversationController,
    });

    handler.handleMessage({ chat: { id: 1 }, text: 'first' });
    await new Promise((resolve) => setTimeout(resolve, 10));

    handler.handleMessage({ chat: { id: 1 }, text: 'second' });
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(sendMessage).toHaveBeenCalledWith(1, 'Steering current response...');
    expect(submitPrompt).toHaveBeenCalledTimes(2);

    resolveRun?.('reply:first');
    await handler.waitForIdle('1');

    expect(sendMessage).toHaveBeenCalledWith(1, 'reply:first');
    expect(createConversationController).toHaveBeenCalledTimes(1);
    expect(createConversationController).toHaveBeenCalledWith({
      conversationId: '1',
      sessionFile: '/tmp/sessions/1.jsonl',
    });
  });

  it('lists models for /model and applies selected model to future prompts', async () => {
    const sendMessage = vi.fn(async () => undefined);
    const sendChatAction = vi.fn(async () => undefined);
    const runPrompt = vi.fn(async ({ prompt, model }: { prompt: string; model?: string }) => `reply:${prompt}:${model}`);

    const listModels = vi.fn(async () => ['provider/model-a', 'provider/model-b']);

    const handler = createQueuedTelegramMessageHandler({
      allowlist: new Set(['1']),
      profileName: 'shared',
      agentDir: '/tmp/agent',
      telegramSessionDir: '/tmp/sessions',
      workingDirectory: '/tmp/work',
      sendMessage,
      sendChatAction,
      createConversationController: createTestConversationControllerFactory(runPrompt),
      modelCommands: {
        listModels,
        activeModelsByConversation: new Map(),
        pendingSelectionsByConversation: new Map(),
      },
    });

    handler.handleMessage({ chat: { id: 1 }, text: '/model' });
    await handler.waitForIdle('1');

    expect(listModels).toHaveBeenCalledWith(undefined);
    expect(runPrompt).not.toHaveBeenCalled();

    const pickerOutput = sendMessage.mock.calls
      .map((call) => String(call.at(1) ?? ''))
      .join('\n');
    expect(pickerOutput).toContain('1. provider/model-a');
    expect(pickerOutput).toContain('2. provider/model-b');

    const firstSendCall = sendMessage.mock.calls[0] as unknown[] | undefined;
    const pickerOptions = firstSendCall?.[2] as {
      reply_markup?: {
        inline_keyboard?: Array<Array<{ text: string; callback_data: string }>>;
      };
    } | undefined;
    expect(pickerOptions?.reply_markup?.inline_keyboard?.[0]?.[0]?.callback_data).toBe('model_select:1');
    expect(pickerOptions?.reply_markup?.inline_keyboard?.[1]?.[0]?.callback_data).toBe('model_select:2');

    handler.handleMessage({ chat: { id: 1 }, text: '2' });
    await handler.waitForIdle('1');

    expect(sendMessage).toHaveBeenCalledWith(1, 'Model set to provider/model-b for this chat.');
    expect(runPrompt).not.toHaveBeenCalled();

    handler.handleMessage({ chat: { id: 1 }, text: 'hello' });
    await handler.waitForIdle('1');

    const promptCall = runPrompt.mock.calls[0]?.[0] as { prompt: string; model?: string };
    expect(promptCall.prompt).toBe('hello');
    expect(promptCall.model).toBe('provider/model-b');
  });

  it('supports /models as an alias for /model', async () => {
    const sendMessage = vi.fn(async () => undefined);
    const sendChatAction = vi.fn(async () => undefined);
    const runPrompt = vi.fn(async () => 'ignored');
    const listModels = vi.fn(async () => ['provider/model-a']);

    const handler = createQueuedTelegramMessageHandler({
      allowlist: new Set(['1']),
      profileName: 'shared',
      agentDir: '/tmp/agent',
      telegramSessionDir: '/tmp/sessions',
      workingDirectory: '/tmp/work',
      sendMessage,
      sendChatAction,
      createConversationController: createTestConversationControllerFactory(runPrompt),
      modelCommands: {
        listModels,
        activeModelsByConversation: new Map(),
        pendingSelectionsByConversation: new Map(),
      },
    });

    handler.handleMessage({ chat: { id: 1 }, text: '/models' });
    await handler.waitForIdle('1');

    expect(listModels).toHaveBeenCalledWith(undefined);
    expect(runPrompt).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledWith(1, 'Model set to provider/model-a for this chat.');
  });

  it('handles /cancel for active model selection without forwarding to pi', async () => {
    const sendMessage = vi.fn(async () => undefined);
    const sendChatAction = vi.fn(async () => undefined);
    const runPrompt = vi.fn(async () => 'ignored');
    const listModels = vi.fn(async () => ['provider/model-a', 'provider/model-b']);

    const handler = createQueuedTelegramMessageHandler({
      allowlist: new Set(['1']),
      profileName: 'shared',
      agentDir: '/tmp/agent',
      telegramSessionDir: '/tmp/sessions',
      workingDirectory: '/tmp/work',
      sendMessage,
      sendChatAction,
      createConversationController: createTestConversationControllerFactory(runPrompt),
      modelCommands: {
        listModels,
        activeModelsByConversation: new Map(),
        pendingSelectionsByConversation: new Map(),
      },
    });

    handler.handleMessage({ chat: { id: 1 }, text: '/model' });
    await handler.waitForIdle('1');

    handler.handleMessage({ chat: { id: 1 }, text: '/cancel' });
    await handler.waitForIdle('1');

    expect(runPrompt).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledWith(1, 'Cancelled model selection.');
  });

  it('handles /cancel with no active model selection without forwarding to pi', async () => {
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
      createConversationController: createTestConversationControllerFactory(runPrompt),
      modelCommands: {
        listModels: vi.fn(async () => []),
        activeModelsByConversation: new Map(),
        pendingSelectionsByConversation: new Map(),
      },
    });

    handler.handleMessage({ chat: { id: 1 }, text: '/cancel' });
    await handler.waitForIdle('1');

    expect(runPrompt).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledWith(1, 'No active model selection. Use /model to list models.');
  });

  it('stops an active telegram request with /stop without forwarding to pi', async () => {
    const sendMessage = vi.fn(async () => undefined);
    const sendChatAction = vi.fn(async () => undefined);

    const runPrompt = vi.fn(async ({ abortSignal }: { abortSignal?: AbortSignal }) => new Promise<string>((_, reject) => {
      abortSignal?.addEventListener('abort', () => {
        reject(new Error('Request cancelled by /stop.'));
      }, { once: true });
    }));

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

    handler.handleMessage({ chat: { id: 1 }, text: 'long-running prompt' });
    await new Promise((resolve) => setTimeout(resolve, 10));

    handler.handleMessage({ chat: { id: 1 }, text: '/stop' });
    await handler.waitForIdle('1');

    expect(sendMessage).toHaveBeenCalledWith(1, 'Stopped active request.');

    const output = sendMessage.mock.calls
      .map((call) => String(call.at(1) ?? ''))
      .join('\n');
    expect(output).not.toContain('Error: Request cancelled by /stop.');
  });

  it('returns helpful /stop message when no telegram request is active', async () => {
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
      createConversationController: createTestConversationControllerFactory(runPrompt),
    });

    handler.handleMessage({ chat: { id: 1 }, text: '/stop' });
    await handler.waitForIdle('1');

    expect(runPrompt).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledWith(1, 'No active request to stop.');
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
      createConversationController: createTestConversationControllerFactory(runPrompt),
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
      createConversationController: createTestConversationControllerFactory(runPrompt),
    });

    handler.handleMessage({ chat: { id: 1 }, text: 'first' });
    handler.handleMessage({ chat: { id: 1 }, text: 'second' });

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(runPrompt).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith(
      1,
      'Too many pending messages for this conversation (limit: 1). Please wait and try again.',
    );

    gate.resolve();
    await handler.waitForIdle();
  });
});

describe('queued discord message handler', () => {
  it('rejects non-allowlisted channels without running prompts', async () => {
    const runPrompt = vi.fn(async () => 'ignored');
    const sendMessage = vi.fn(async () => undefined);
    const sendTyping = vi.fn(async () => undefined);

    const handler = createQueuedDiscordMessageHandler({
      allowlist: new Set(['allowed-channel']),
      profileName: 'shared',
      agentDir: '/tmp/agent',
      discordSessionDir: '/tmp/discord-sessions',
      workingDirectory: '/tmp/work',
      createConversationController: createTestConversationControllerFactory(runPrompt),
    });

    handler.handleMessage({
      channelId: 'blocked-channel',
      content: 'hello',
      sendMessage,
      sendTyping,
    });

    await handler.waitForIdle('blocked-channel');

    expect(runPrompt).not.toHaveBeenCalled();
    expect(sendTyping).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledWith('This channel is not allowed.');
  });

  it('returns configured command list for /commands without invoking pi', async () => {
    const runPrompt = vi.fn(async () => 'ignored');
    const sendMessage = vi.fn(async () => undefined);
    const sendTyping = vi.fn(async () => undefined);

    const handler = createQueuedDiscordMessageHandler({
      allowlist: new Set(['channel-1']),
      profileName: 'shared',
      agentDir: '/tmp/agent',
      discordSessionDir: '/tmp/discord-sessions',
      workingDirectory: '/tmp/work',
      commandHelpText: 'Available commands:\n/new\n/status',
      createConversationController: createTestConversationControllerFactory(runPrompt),
    });

    handler.handleMessage({
      channelId: 'channel-1',
      content: '/commands',
      sendMessage,
      sendTyping,
    });

    await handler.waitForIdle('channel-1');

    expect(runPrompt).not.toHaveBeenCalled();
    expect(sendTyping).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledWith('Available commands:\n/new\n/status');
  });

  it('returns scheduled task list for /tasks without invoking pi', async () => {
    const runPrompt = vi.fn(async () => 'ignored');
    const sendMessage = vi.fn(async () => undefined);
    const sendTyping = vi.fn(async () => undefined);
    const listScheduledTasks = vi.fn(async ({ statusFilter }: { statusFilter: string }) =>
      `Scheduled tasks\nFilter: ${statusFilter}`
    );

    const handler = createQueuedDiscordMessageHandler({
      allowlist: new Set(['channel-1']),
      profileName: 'shared',
      agentDir: '/tmp/agent',
      discordSessionDir: '/tmp/discord-sessions',
      workingDirectory: '/tmp/work',
      listScheduledTasks,
      createConversationController: createTestConversationControllerFactory(runPrompt),
    });

    handler.handleMessage({
      channelId: 'channel-1',
      content: '/tasks pending',
      sendMessage,
      sendTyping,
    });

    await handler.waitForIdle('channel-1');

    expect(listScheduledTasks).toHaveBeenCalledWith({ statusFilter: 'pending' });
    expect(runPrompt).not.toHaveBeenCalled();
    expect(sendTyping).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledWith('Scheduled tasks\nFilter: pending');
  });

  it('shows /tasks usage when the status filter is invalid', async () => {
    const runPrompt = vi.fn(async () => 'ignored');
    const sendMessage = vi.fn(async () => undefined);
    const sendTyping = vi.fn(async () => undefined);
    const listScheduledTasks = vi.fn(async () => 'should-not-be-called');

    const handler = createQueuedDiscordMessageHandler({
      allowlist: new Set(['channel-1']),
      profileName: 'shared',
      agentDir: '/tmp/agent',
      discordSessionDir: '/tmp/discord-sessions',
      workingDirectory: '/tmp/work',
      listScheduledTasks,
      createConversationController: createTestConversationControllerFactory(runPrompt),
    });

    handler.handleMessage({
      channelId: 'channel-1',
      content: '/tasks invalid invalid',
      sendMessage,
      sendTyping,
    });

    await handler.waitForIdle('channel-1');

    expect(listScheduledTasks).not.toHaveBeenCalled();
    expect(runPrompt).not.toHaveBeenCalled();
    expect(sendTyping).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledWith(
      'Usage: /tasks [all|running|active|completed|disabled|pending|error]\nExample: /tasks completed',
    );
  });

  it('includes /tasks, /model, /models, /stop, /cancel, /compact, and /resume in default /commands output', async () => {
    const runPrompt = vi.fn(async () => 'ignored');
    const sendMessage = vi.fn(async () => undefined);
    const sendTyping = vi.fn(async () => undefined);

    const handler = createQueuedDiscordMessageHandler({
      allowlist: new Set(['channel-1']),
      profileName: 'shared',
      agentDir: '/tmp/agent',
      discordSessionDir: '/tmp/discord-sessions',
      workingDirectory: '/tmp/work',
      createConversationController: createTestConversationControllerFactory(runPrompt),
    });

    handler.handleMessage({
      channelId: 'channel-1',
      content: '/commands',
      sendMessage,
      sendTyping,
    });

    await handler.waitForIdle('channel-1');

    expect(runPrompt).not.toHaveBeenCalled();
    expect(sendTyping).not.toHaveBeenCalled();

    const output = sendMessage.mock.calls
      .map((call) => String(call.at(0) ?? ''))
      .join('\n');
    expect(output).toContain('/tasks -');
    expect(output).toContain('/model -');
    expect(output).toContain('/models -');
    expect(output).toContain('/stop -');
    expect(output).toContain('/cancel -');
    expect(output).toContain('/compact -');
    expect(output).toContain('/resume -');
  });

  it('returns configured skills list for /skills without invoking pi', async () => {
    const runPrompt = vi.fn(async () => 'ignored');
    const sendMessage = vi.fn(async () => undefined);
    const sendTyping = vi.fn(async () => undefined);

    const handler = createQueuedDiscordMessageHandler({
      allowlist: new Set(['channel-1']),
      profileName: 'shared',
      agentDir: '/tmp/agent',
      discordSessionDir: '/tmp/discord-sessions',
      workingDirectory: '/tmp/work',
      skillsHelpText: 'Available skills:\n- tdd-feature',
      createConversationController: createTestConversationControllerFactory(runPrompt),
    });

    handler.handleMessage({
      channelId: 'channel-1',
      content: '/skills',
      sendMessage,
      sendTyping,
    });

    await handler.waitForIdle('channel-1');

    expect(runPrompt).not.toHaveBeenCalled();
    expect(sendTyping).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledWith('Available skills:\n- tdd-feature');
  });

  it('handles /resume and /compact without forwarding to pi', async () => {
    const runPrompt = vi.fn(async () => 'ignored');
    const sendMessage = vi.fn(async () => undefined);
    const sendTyping = vi.fn(async () => undefined);

    const handler = createQueuedDiscordMessageHandler({
      allowlist: new Set(['channel-1']),
      profileName: 'shared',
      agentDir: '/tmp/agent',
      discordSessionDir: '/tmp/discord-sessions',
      workingDirectory: '/tmp/work',
      createConversationController: createTestConversationControllerFactory(runPrompt),
    });

    handler.handleMessage({
      channelId: 'channel-1',
      content: '/resume',
      sendMessage,
      sendTyping,
    });

    handler.handleMessage({
      channelId: 'channel-1',
      content: '/compact',
      sendMessage,
      sendTyping,
    });

    await handler.waitForIdle('channel-1');

    expect(runPrompt).not.toHaveBeenCalled();
    expect(sendTyping).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledWith(
      'Gateway sessions already resume automatically per channel. Use /new to start a fresh session.',
    );
    expect(sendMessage).toHaveBeenCalledWith(
      'Manual /compact is not supported in gateway print mode yet. Open this session in Pi TUI to compact.',
    );
  });

  it('maps /skill <name> to /skill:<name> before invoking pi', async () => {
    const runPrompt = vi.fn(async ({ prompt }: { prompt: string; sessionFile: string }) => `reply:${prompt}`);
    const sendMessage = vi.fn(async () => undefined);
    const sendTyping = vi.fn(async () => undefined);

    const handler = createQueuedDiscordMessageHandler({
      allowlist: new Set(['channel-1']),
      profileName: 'shared',
      agentDir: '/tmp/agent',
      discordSessionDir: '/tmp/discord-sessions',
      workingDirectory: '/tmp/work',
      createConversationController: createTestConversationControllerFactory(runPrompt),
    });

    handler.handleMessage({
      channelId: 'channel-1',
      content: '/skill tdd-feature',
      sendMessage,
      sendTyping,
    });

    await handler.waitForIdle('channel-1');

    const firstCall = runPrompt.mock.calls[0]?.[0] as { prompt: string };
    expect(firstCall.prompt).toBe('/skill:tdd-feature');
    expect(sendTyping).toHaveBeenCalled();
  });

  it('continues sending typing indicators while a discord run is active', async () => {
    vi.useFakeTimers();

    try {
      const sendMessage = vi.fn(async () => undefined);
      const sendTyping = vi.fn(async () => undefined);

      let resolveRun: ((value: string) => void) | undefined;
      const runPromise = new Promise<string>((resolve) => {
        resolveRun = resolve;
      });

      const runPrompt = vi.fn(async () => runPromise);

      const handler = createQueuedDiscordMessageHandler({
        allowlist: new Set(['channel-1']),
        profileName: 'shared',
        agentDir: '/tmp/agent',
        discordSessionDir: '/tmp/discord-sessions',
        workingDirectory: '/tmp/work',
        createConversationController: createTestConversationControllerFactory(runPrompt),
      });

      handler.handleMessage({
        channelId: 'channel-1',
        content: 'hello',
        sendMessage,
        sendTyping,
      });

      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(12_500);

      expect(sendTyping.mock.calls.length).toBeGreaterThanOrEqual(3);

      resolveRun?.('done');
      await handler.waitForIdle('channel-1');

      const callsAfterCompletion = sendTyping.mock.calls.length;
      await vi.advanceTimersByTimeAsync(8_000);
      expect(sendTyping.mock.calls.length).toBe(callsAfterCompletion);
    } finally {
      vi.useRealTimers();
    }
  });

  it('steers active discord runs instead of starting a second run with controller mode', async () => {
    const sendMessage = vi.fn(async () => undefined);
    const sendTyping = vi.fn(async () => undefined);

    let resolveRun: ((value: string) => void) | undefined;
    const firstRun = new Promise<string>((resolve) => {
      resolveRun = resolve;
    });

    const submitPrompt = vi.fn()
      .mockResolvedValueOnce({ mode: 'started', run: firstRun })
      .mockResolvedValueOnce({ mode: 'steered' });

    const controller = {
      submitPrompt,
      submitFollowUp: vi.fn(async () => ({ mode: 'followup' as const })),
      compact: vi.fn(async () => 'Context compacted.'),
      abortCurrent: vi.fn(async () => false),
      waitForIdle: vi.fn(async () => {
        await firstRun;
      }),
      dispose: vi.fn(async () => undefined),
    };

    const createConversationController = vi.fn(async () => controller);

    const handler = createQueuedDiscordMessageHandler({
      allowlist: new Set(['channel-1']),
      profileName: 'shared',
      agentDir: '/tmp/agent',
      discordSessionDir: '/tmp/discord-sessions',
      workingDirectory: '/tmp/work',
      createConversationController,
    });

    handler.handleMessage({
      channelId: 'channel-1',
      content: 'first',
      sendMessage,
      sendTyping,
    });

    await new Promise((resolve) => setTimeout(resolve, 10));

    handler.handleMessage({
      channelId: 'channel-1',
      content: 'second',
      sendMessage,
      sendTyping,
    });

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(sendMessage).toHaveBeenCalledWith('Steering current response...');
    expect(submitPrompt).toHaveBeenCalledTimes(2);

    resolveRun?.('reply:first');
    await handler.waitForIdle('channel-1');

    expect(sendMessage).toHaveBeenCalledWith('reply:first');
    expect(createConversationController).toHaveBeenCalledWith({
      conversationId: 'channel-1',
      sessionFile: '/tmp/discord-sessions/channel-1.jsonl',
    });
  });

  it('applies /model <provider/model> and forwards selection to future prompts', async () => {
    const runPrompt = vi.fn(async ({ prompt, model }: { prompt: string; model?: string }) => `reply:${prompt}:${model}`);
    const sendMessage = vi.fn(async () => undefined);
    const sendTyping = vi.fn(async () => undefined);

    const handler = createQueuedDiscordMessageHandler({
      allowlist: new Set(['channel-1']),
      profileName: 'shared',
      agentDir: '/tmp/agent',
      discordSessionDir: '/tmp/discord-sessions',
      workingDirectory: '/tmp/work',
      createConversationController: createTestConversationControllerFactory(runPrompt),
      modelCommands: {
        listModels: vi.fn(async () => []),
        activeModelsByConversation: new Map(),
        pendingSelectionsByConversation: new Map(),
      },
    });

    handler.handleMessage({
      channelId: 'channel-1',
      content: '/model provider/model-a',
      sendMessage,
      sendTyping,
    });

    await handler.waitForIdle('channel-1');

    expect(runPrompt).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledWith('Model set to provider/model-a for this channel.');

    handler.handleMessage({
      channelId: 'channel-1',
      content: 'hello',
      sendMessage,
      sendTyping,
    });

    await handler.waitForIdle('channel-1');

    const firstCall = runPrompt.mock.calls[0]?.[0] as { prompt: string; model?: string };
    expect(firstCall.prompt).toBe('hello');
    expect(firstCall.model).toBe('provider/model-a');
  });

  it('stops an active discord request with /stop without forwarding to pi', async () => {
    const sendMessage = vi.fn(async () => undefined);
    const sendTyping = vi.fn(async () => undefined);

    const runPrompt = vi.fn(async ({ abortSignal }: { abortSignal?: AbortSignal }) => new Promise<string>((_, reject) => {
      abortSignal?.addEventListener('abort', () => {
        reject(new Error('Request cancelled by /stop.'));
      }, { once: true });
    }));

    const handler = createQueuedDiscordMessageHandler({
      allowlist: new Set(['channel-1']),
      profileName: 'shared',
      agentDir: '/tmp/agent',
      discordSessionDir: '/tmp/discord-sessions',
      workingDirectory: '/tmp/work',
      createConversationController: createTestConversationControllerFactory(runPrompt),
    });

    handler.handleMessage({
      channelId: 'channel-1',
      content: 'long-running prompt',
      sendMessage,
      sendTyping,
    });

    await new Promise((resolve) => setTimeout(resolve, 10));

    handler.handleMessage({
      channelId: 'channel-1',
      content: '/stop',
      sendMessage,
      sendTyping,
    });

    await handler.waitForIdle('channel-1');

    expect(sendMessage).toHaveBeenCalledWith('Stopped active request.');

    const output = sendMessage.mock.calls
      .map((call) => String(call.at(0) ?? ''))
      .join('\n');
    expect(output).not.toContain('Error: Request cancelled by /stop.');
  });

  it('returns helpful /stop message when no discord request is active', async () => {
    const runPrompt = vi.fn(async () => 'ignored');
    const sendMessage = vi.fn(async () => undefined);
    const sendTyping = vi.fn(async () => undefined);

    const handler = createQueuedDiscordMessageHandler({
      allowlist: new Set(['channel-1']),
      profileName: 'shared',
      agentDir: '/tmp/agent',
      discordSessionDir: '/tmp/discord-sessions',
      workingDirectory: '/tmp/work',
      createConversationController: createTestConversationControllerFactory(runPrompt),
    });

    handler.handleMessage({
      channelId: 'channel-1',
      content: '/stop',
      sendMessage,
      sendTyping,
    });

    await handler.waitForIdle('channel-1');

    expect(runPrompt).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledWith('No active request to stop.');
  });

  it('rejects messages when per-channel queue limit is exceeded', async () => {
    const gate = deferred();
    const runPrompt = vi.fn(async () => {
      await gate.promise;
      return 'reply';
    });

    const firstSendMessage = vi.fn(async () => undefined);
    const secondSendMessage = vi.fn(async () => undefined);
    const sendTyping = vi.fn(async () => undefined);

    const handler = createQueuedDiscordMessageHandler({
      allowlist: new Set(['channel-1']),
      profileName: 'shared',
      agentDir: '/tmp/agent',
      discordSessionDir: '/tmp/discord-sessions',
      workingDirectory: '/tmp/work',
      maxPendingPerChannel: 1,
      createConversationController: createTestConversationControllerFactory(runPrompt),
    });

    handler.handleMessage({
      channelId: 'channel-1',
      content: 'first',
      sendMessage: firstSendMessage,
      sendTyping,
    });

    handler.handleMessage({
      channelId: 'channel-1',
      content: 'second',
      sendMessage: secondSendMessage,
      sendTyping,
    });

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(runPrompt).toHaveBeenCalledTimes(1);
    expect(secondSendMessage).toHaveBeenCalledWith(
      'Too many pending messages for this channel (limit: 1). Please wait and try again.',
    );

    gate.resolve();
    await handler.waitForIdle();
  });
});

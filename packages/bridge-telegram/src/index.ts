#!/usr/bin/env node

import { mkdir, rm } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { spawn, spawnSync } from 'child_process';
import TelegramBot from 'node-telegram-bot-api';
import {
  bootstrapStateOrThrow,
  preparePiAgentDir,
  resolveStatePaths,
  validateStatePathsOutsideRepo,
} from '@personal-agent/core';
import {
  buildPiResourceArgs,
  getExtensionDependencyDirs,
  materializeProfileToAgentDir,
  mergeJsonFiles,
  resolveResourceProfile,
} from '@personal-agent/resources';

export interface TelegramBridgeConfig {
  token: string;
  profile: string;
  allowlist: Set<string>;
  workingDirectory: string;
}

export interface TelegramMessageLike {
  chat: { id: number };
  text?: string;
}

type SendMessageFn = (chatId: number, text: string) => Promise<unknown>;

type SendChatActionFn = (chatId: number, action: 'typing') => Promise<unknown>;

interface RunPromptFnInput {
  prompt: string;
  sessionFile: string;
  cwd: string;
}

type RunPromptFn = (options: RunPromptFnInput) => Promise<string>;

export interface CreateTelegramMessageHandlerOptions {
  allowlist: Set<string>;
  profileName: string;
  agentDir: string;
  telegramSessionDir: string;
  workingDirectory: string;
  sendMessage: SendMessageFn;
  sendChatAction: SendChatActionFn;
  runPrompt: RunPromptFn;
  sessionFileExists?: (path: string) => boolean;
  removeSessionFile?: (path: string) => Promise<void>;
  maxPendingPerChat?: number;
}

export interface QueuedTelegramMessageHandler {
  handleMessage: (message: TelegramMessageLike) => void;
  waitForIdle: (chatId?: string) => Promise<void>;
}

const DEFAULT_PI_TIMEOUT_MS = 180_000;
const DEFAULT_PI_MAX_OUTPUT_BYTES = 200_000;
const DEFAULT_MAX_PENDING_PER_CHAT = 20;

export function parseAllowlist(value: string | undefined): Set<string> {
  if (!value) return new Set<string>();

  return new Set(
    value
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0),
  );
}

export function splitTelegramMessage(text: string, chunkSize = 3900): string[] {
  if (text.length <= chunkSize) return [text];

  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    chunks.push(text.slice(start, start + chunkSize));
    start += chunkSize;
  }

  return chunks;
}

function applyModelDefaults(args: string[], settings: Record<string, unknown>): string[] {
  const output = [...args];

  if (!output.includes('--model')) {
    const provider = settings.defaultProvider;
    const model = settings.defaultModel;
    if (typeof provider === 'string' && typeof model === 'string') {
      output.push('--model', `${provider}/${model}`);
    }
  }

  if (!output.includes('--thinking')) {
    const thinking = settings.defaultThinkingLevel;
    if (typeof thinking === 'string') {
      output.push('--thinking', thinking);
    }
  }

  return output;
}

function ensureExtensionDependencies(profile: ReturnType<typeof resolveResourceProfile>): void {
  if (process.env.PERSONAL_AGENT_SKIP_EXTENSION_INSTALL === '1') {
    return;
  }

  const dependencyDirs = getExtensionDependencyDirs(profile);
  const missingDirs = dependencyDirs.filter((dir) => !existsSync(join(dir, 'node_modules')));

  if (missingDirs.length === 0) {
    return;
  }

  const allowAutoInstall = process.env.PERSONAL_AGENT_INSTALL_EXTENSION_DEPS === '1';

  if (!allowAutoInstall) {
    throw new Error(
      `Extension dependencies are missing in: ${missingDirs.join(', ')}. ` +
      `Install them manually (trusted profiles only), or set PERSONAL_AGENT_INSTALL_EXTENSION_DEPS=1 to auto-install.`
    );
  }

  for (const dir of missingDirs) {
    const result = spawnSync('npm', ['install', '--silent', '--no-package-lock'], {
      cwd: dir,
      stdio: 'inherit',
    });

    if (result.error || result.status !== 0) {
      throw new Error(`Failed to install extension dependencies in ${dir}`);
    }
  }
}

async function runPiPrintPrompt(options: {
  prompt: string;
  sessionFile: string;
  profile: ReturnType<typeof resolveResourceProfile>;
  agentDir: string;
  cwd: string;
}): Promise<string> {
  const settings = options.profile.settingsFiles.length > 0
    ? mergeJsonFiles(options.profile.settingsFiles)
    : {};

  const resourceArgs = buildPiResourceArgs(options.profile);
  const args = applyModelDefaults(
    [
      ...resourceArgs,
      '--session',
      options.sessionFile,
      '-p',
      options.prompt,
    ],
    settings,
  );

  const configuredTimeoutMs = Number(process.env.PERSONAL_AGENT_PI_TIMEOUT_MS ?? DEFAULT_PI_TIMEOUT_MS);
  const timeoutMs = Number.isFinite(configuredTimeoutMs) && configuredTimeoutMs > 0
    ? Math.floor(configuredTimeoutMs)
    : DEFAULT_PI_TIMEOUT_MS;

  const configuredMaxOutputBytes = Number(
    process.env.PERSONAL_AGENT_PI_MAX_OUTPUT_BYTES ?? DEFAULT_PI_MAX_OUTPUT_BYTES,
  );
  const maxOutputBytes = Number.isFinite(configuredMaxOutputBytes) && configuredMaxOutputBytes > 0
    ? Math.floor(configuredMaxOutputBytes)
    : DEFAULT_PI_MAX_OUTPUT_BYTES;

  return new Promise((resolve, reject) => {
    const child = spawn('pi', args, {
      cwd: options.cwd,
      env: {
        ...process.env,
        PI_CODING_AGENT_DIR: options.agentDir,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;

    const finalize = (resolver: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutHandle);
      resolver();
    };

    const fail = (message: string) => {
      child.kill('SIGTERM');
      finalize(() => reject(new Error(message)));
    };

    const timeoutHandle = setTimeout(() => {
      fail(`pi timed out after ${timeoutMs}ms`);
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer | string) => {
      const text = chunk.toString();
      stdout += text;
      stdoutBytes += Buffer.byteLength(text);

      if (stdoutBytes > maxOutputBytes) {
        fail(`pi stdout exceeded ${maxOutputBytes} bytes`);
      }
    });

    child.stderr.on('data', (chunk: Buffer | string) => {
      const text = chunk.toString();
      stderr += text;
      stderrBytes += Buffer.byteLength(text);

      if (stderrBytes > maxOutputBytes) {
        fail(`pi stderr exceeded ${maxOutputBytes} bytes`);
      }
    });

    child.on('error', (error) => {
      finalize(() => reject(error));
    });

    child.on('close', (code) => {
      if (code !== 0) {
        finalize(() => reject(new Error(stderr.trim() || `pi exited with code ${code}`)));
        return;
      }

      finalize(() => resolve(stdout.trim()));
    });
  });
}

async function sendLongMessage(sendMessage: SendMessageFn, chatId: number, text: string): Promise<void> {
  const chunks = splitTelegramMessage(text || '(empty response)');
  for (const chunk of chunks) {
    await sendMessage(chatId, chunk);
  }
}

async function processTelegramMessage(
  options: CreateTelegramMessageHandlerOptions,
  message: TelegramMessageLike,
): Promise<void> {
  const chatId = String(message.chat.id);

  if (!options.allowlist.has(chatId)) {
    await options.sendMessage(message.chat.id, 'This chat is not allowed.');
    return;
  }

  const text = message.text?.trim();
  if (!text) {
    await options.sendMessage(message.chat.id, 'Please send text messages only.');
    return;
  }

  const sessionFile = join(options.telegramSessionDir, `${chatId}.jsonl`);
  const sessionFileExists = options.sessionFileExists ?? existsSync;
  const removeSessionFile = options.removeSessionFile ?? ((path: string) => rm(path, { force: true }));

  if (text === '/new') {
    if (sessionFileExists(sessionFile)) {
      await removeSessionFile(sessionFile);
    }
    await options.sendMessage(message.chat.id, 'Started a new session.');
    return;
  }

  if (text === '/status') {
    await options.sendMessage(
      message.chat.id,
      `profile=${options.profileName}\nagentDir=${options.agentDir}\nsession=${sessionFile}`,
    );
    return;
  }

  await options.sendChatAction(message.chat.id, 'typing');

  try {
    const output = await options.runPrompt({
      prompt: text,
      sessionFile,
      cwd: options.workingDirectory,
    });

    await sendLongMessage(options.sendMessage, message.chat.id, output || '(no output)');
  } catch (error) {
    await options.sendMessage(message.chat.id, `Error: ${(error as Error).message}`);
  }
}

export function createQueuedTelegramMessageHandler(
  options: CreateTelegramMessageHandlerOptions,
): QueuedTelegramMessageHandler {
  const chatQueue = new Map<string, Promise<void>>();
  const pendingPerChat = new Map<string, number>();
  const maxPendingPerChat = options.maxPendingPerChat ?? DEFAULT_MAX_PENDING_PER_CHAT;

  const enqueue = (chatId: string, task: () => Promise<void>) => {
    const previous = chatQueue.get(chatId) ?? Promise.resolve();

    const next = previous
      .then(task)
      .catch((error) => {
        console.error(`[telegram:${chatId}]`, error);
      })
      .finally(() => {
        if (chatQueue.get(chatId) === next) {
          chatQueue.delete(chatId);
        }
      });

    chatQueue.set(chatId, next);
  };

  return {
    handleMessage(message: TelegramMessageLike): void {
      const chatId = String(message.chat.id);
      const pending = pendingPerChat.get(chatId) ?? 0;

      if (pending >= maxPendingPerChat) {
        void options.sendMessage(
          message.chat.id,
          `Too many pending messages for this chat (limit: ${maxPendingPerChat}). Please wait and try again.`,
        );
        return;
      }

      pendingPerChat.set(chatId, pending + 1);

      enqueue(chatId, async () => {
        try {
          await processTelegramMessage(options, message);
        } finally {
          const nextPending = (pendingPerChat.get(chatId) ?? 1) - 1;
          if (nextPending <= 0) {
            pendingPerChat.delete(chatId);
          } else {
            pendingPerChat.set(chatId, nextPending);
          }
        }
      });
    },

    async waitForIdle(chatId?: string): Promise<void> {
      if (chatId) {
        await (chatQueue.get(chatId) ?? Promise.resolve());
        return;
      }

      await Promise.all([...chatQueue.values()]);
    },
  };
}

async function createConfigFromEnv(): Promise<TelegramBridgeConfig> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new Error('TELEGRAM_BOT_TOKEN is required');
  }

  const profile = process.env.PERSONAL_AGENT_PROFILE || 'shared';
  const allowlist = parseAllowlist(process.env.PERSONAL_AGENT_TELEGRAM_ALLOWLIST);

  if (allowlist.size === 0) {
    throw new Error('PERSONAL_AGENT_TELEGRAM_ALLOWLIST is required (comma-separated chat IDs)');
  }

  const workingDirectory = process.env.PERSONAL_AGENT_TELEGRAM_CWD || process.cwd();

  return {
    token,
    profile,
    allowlist,
    workingDirectory,
  };
}

export async function startTelegramBridge(config?: TelegramBridgeConfig): Promise<void> {
  const effectiveConfig = config ?? await createConfigFromEnv();
  const resolvedProfile = resolveResourceProfile(effectiveConfig.profile);
  const statePaths = resolveStatePaths();

  validateStatePathsOutsideRepo(statePaths, resolvedProfile.repoRoot);
  await bootstrapStateOrThrow(statePaths);

  const runtime = await preparePiAgentDir({
    statePaths,
    copyLegacyAuth: true,
  });

  materializeProfileToAgentDir(resolvedProfile, runtime.agentDir);
  ensureExtensionDependencies(resolvedProfile);

  const telegramSessionDir = join(statePaths.session, 'telegram');
  await mkdir(telegramSessionDir, { recursive: true });

  const bot = new TelegramBot(effectiveConfig.token, { polling: true });

  const configuredMaxPendingPerChat = Number(
    process.env.PERSONAL_AGENT_TELEGRAM_MAX_PENDING_PER_CHAT ?? DEFAULT_MAX_PENDING_PER_CHAT,
  );

  const maxPendingPerChat = Number.isFinite(configuredMaxPendingPerChat) && configuredMaxPendingPerChat > 0
    ? Math.floor(configuredMaxPendingPerChat)
    : DEFAULT_MAX_PENDING_PER_CHAT;

  const handler = createQueuedTelegramMessageHandler({
    allowlist: effectiveConfig.allowlist,
    profileName: effectiveConfig.profile,
    agentDir: runtime.agentDir,
    telegramSessionDir,
    workingDirectory: effectiveConfig.workingDirectory,
    maxPendingPerChat,
    sendMessage: (chatId, text) => bot.sendMessage(chatId, text),
    sendChatAction: (chatId, action) => bot.sendChatAction(chatId, action),
    runPrompt: ({ prompt, sessionFile, cwd }) => runPiPrintPrompt({
      prompt,
      sessionFile,
      profile: resolvedProfile,
      agentDir: runtime.agentDir,
      cwd,
    }),
  });

  bot.on('message', handler.handleMessage);

  console.log(`Telegram bridge started (profile=${effectiveConfig.profile})`);
  console.log(`Allowed chats: ${[...effectiveConfig.allowlist].join(', ')}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startTelegramBridge().catch((error) => {
    console.error((error as Error).message);
    process.exit(1);
  });
}

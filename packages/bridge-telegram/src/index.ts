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
}

export interface QueuedTelegramMessageHandler {
  handleMessage: (message: TelegramMessageLike) => void;
  waitForIdle: (chatId?: string) => Promise<void>;
}

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

  for (const dir of dependencyDirs) {
    if (existsSync(join(dir, 'node_modules'))) {
      continue;
    }

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

    child.stdout.on('data', (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      reject(error);
    });

    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `pi exited with code ${code}`));
        return;
      }
      resolve(stdout.trim());
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
      enqueue(chatId, () => processTelegramMessage(options, message));
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

  const handler = createQueuedTelegramMessageHandler({
    allowlist: effectiveConfig.allowlist,
    profileName: effectiveConfig.profile,
    agentDir: runtime.agentDir,
    telegramSessionDir,
    workingDirectory: effectiveConfig.workingDirectory,
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

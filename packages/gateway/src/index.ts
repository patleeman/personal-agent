#!/usr/bin/env node

import { mkdir, rm } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { spawn, spawnSync } from 'child_process';
import TelegramBot from 'node-telegram-bot-api';
import {
  Client,
  GatewayIntentBits,
  Partials,
} from 'discord.js';
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
import { emitDaemonEventNonFatal } from '@personal-agent/daemon';

export interface TelegramBridgeConfig {
  token: string;
  profile: string;
  allowlist: Set<string>;
  workingDirectory: string;
}

export interface DiscordBridgeConfig {
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

type SendTextFn = (text: string) => Promise<unknown>;

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

export interface DiscordMessageLike {
  channelId: string;
  content?: string;
  authorIsBot?: boolean;
  sendMessage: SendTextFn;
  sendTyping: () => Promise<unknown>;
}

export interface CreateDiscordMessageHandlerOptions {
  allowlist: Set<string>;
  profileName: string;
  agentDir: string;
  discordSessionDir: string;
  workingDirectory: string;
  runPrompt: RunPromptFn;
  sessionFileExists?: (path: string) => boolean;
  removeSessionFile?: (path: string) => Promise<void>;
  maxPendingPerChannel?: number;
}

export interface QueuedDiscordMessageHandler {
  handleMessage: (message: DiscordMessageLike) => void;
  waitForIdle: (channelId?: string) => Promise<void>;
}

const DEFAULT_PI_TIMEOUT_MS = 180_000;
const DEFAULT_PI_MAX_OUTPUT_BYTES = 200_000;
const DEFAULT_MAX_PENDING_PER_CHAT = 20;
const DEFAULT_MAX_PENDING_PER_CHANNEL = 20;

const GATEWAY_PROVIDERS = ['telegram', 'discord'] as const;

export type GatewayProvider = (typeof GATEWAY_PROVIDERS)[number];

type ResolvedProfile = ReturnType<typeof resolveResourceProfile>;

interface PreparedGatewayRuntime {
  resolvedProfile: ResolvedProfile;
  statePaths: ReturnType<typeof resolveStatePaths>;
  runtime: Awaited<ReturnType<typeof preparePiAgentDir>>;
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

function splitMessage(text: string, chunkSize = 3900): string[] {
  if (text.length <= chunkSize) return [text];

  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    chunks.push(text.slice(start, start + chunkSize));
    start += chunkSize;
  }

  return chunks;
}

export function splitTelegramMessage(text: string, chunkSize = 3900): string[] {
  return splitMessage(text, chunkSize);
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

function ensureExtensionDependencies(profile: ResolvedProfile): void {
  const dependencyDirs = getExtensionDependencyDirs(profile);
  const missingDirs = dependencyDirs.filter((dir) => !existsSync(join(dir, 'node_modules')));

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
  profile: ResolvedProfile;
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

async function prepareGatewayRuntime(profileName: string): Promise<PreparedGatewayRuntime> {
  const resolvedProfile = resolveResourceProfile(profileName);
  const statePaths = resolveStatePaths();

  validateStatePathsOutsideRepo(statePaths, resolvedProfile.repoRoot);
  await bootstrapStateOrThrow(statePaths);

  const runtime = await preparePiAgentDir({
    statePaths,
    copyLegacyAuth: true,
  });

  materializeProfileToAgentDir(resolvedProfile, runtime.agentDir);
  ensureExtensionDependencies(resolvedProfile);

  return {
    resolvedProfile,
    statePaths,
    runtime,
  };
}

async function sendLongText(sendMessage: SendTextFn, text: string): Promise<void> {
  const chunks = splitMessage(text || '(empty response)');
  for (const chunk of chunks) {
    await sendMessage(chunk);
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

    await emitDaemonEventNonFatal({
      type: 'session.closed',
      source: 'gateway',
      payload: {
        sessionFile,
        profile: options.profileName,
        cwd: options.workingDirectory,
        reason: 'telegram-new-command',
      },
    });

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

    await emitDaemonEventNonFatal({
      type: 'session.updated',
      source: 'gateway',
      payload: {
        sessionFile,
        profile: options.profileName,
        cwd: options.workingDirectory,
        chatId,
      },
    });

    await sendLongText((chunk) => options.sendMessage(message.chat.id, chunk), output || '(no output)');
  } catch (error) {
    await emitDaemonEventNonFatal({
      type: 'session.processing.failed',
      source: 'gateway',
      payload: {
        sessionFile,
        profile: options.profileName,
        cwd: options.workingDirectory,
        chatId,
        message: (error as Error).message,
      },
    });

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

async function createTelegramConfigFromEnv(): Promise<TelegramBridgeConfig> {
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
  const effectiveConfig = config ?? await createTelegramConfigFromEnv();
  const { resolvedProfile, statePaths, runtime } = await prepareGatewayRuntime(effectiveConfig.profile);

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

async function processDiscordMessage(
  options: CreateDiscordMessageHandlerOptions,
  message: DiscordMessageLike,
): Promise<void> {
  if (message.authorIsBot) {
    return;
  }

  const channelId = message.channelId;

  if (!options.allowlist.has(channelId)) {
    await message.sendMessage('This channel is not allowed.');
    return;
  }

  const text = message.content?.trim();
  if (!text) {
    await message.sendMessage('Please send text messages only.');
    return;
  }

  const sessionFile = join(options.discordSessionDir, `${channelId}.jsonl`);
  const sessionFileExists = options.sessionFileExists ?? existsSync;
  const removeSessionFile = options.removeSessionFile ?? ((path: string) => rm(path, { force: true }));

  if (text === '/new') {
    if (sessionFileExists(sessionFile)) {
      await removeSessionFile(sessionFile);
    }

    await emitDaemonEventNonFatal({
      type: 'session.closed',
      source: 'gateway',
      payload: {
        sessionFile,
        profile: options.profileName,
        cwd: options.workingDirectory,
        reason: 'discord-new-command',
      },
    });

    await message.sendMessage('Started a new session.');
    return;
  }

  if (text === '/status') {
    await message.sendMessage(
      `profile=${options.profileName}\nagentDir=${options.agentDir}\nsession=${sessionFile}`,
    );
    return;
  }

  await message.sendTyping();

  try {
    const output = await options.runPrompt({
      prompt: text,
      sessionFile,
      cwd: options.workingDirectory,
    });

    await emitDaemonEventNonFatal({
      type: 'session.updated',
      source: 'gateway',
      payload: {
        sessionFile,
        profile: options.profileName,
        cwd: options.workingDirectory,
        channelId,
      },
    });

    await sendLongText(message.sendMessage, output || '(no output)');
  } catch (error) {
    await emitDaemonEventNonFatal({
      type: 'session.processing.failed',
      source: 'gateway',
      payload: {
        sessionFile,
        profile: options.profileName,
        cwd: options.workingDirectory,
        channelId,
        message: (error as Error).message,
      },
    });

    await message.sendMessage(`Error: ${(error as Error).message}`);
  }
}

export function createQueuedDiscordMessageHandler(
  options: CreateDiscordMessageHandlerOptions,
): QueuedDiscordMessageHandler {
  const channelQueue = new Map<string, Promise<void>>();
  const pendingPerChannel = new Map<string, number>();
  const maxPendingPerChannel = options.maxPendingPerChannel ?? DEFAULT_MAX_PENDING_PER_CHANNEL;

  const enqueue = (channelId: string, task: () => Promise<void>) => {
    const previous = channelQueue.get(channelId) ?? Promise.resolve();

    const next = previous
      .then(task)
      .catch((error) => {
        console.error(`[discord:${channelId}]`, error);
      })
      .finally(() => {
        if (channelQueue.get(channelId) === next) {
          channelQueue.delete(channelId);
        }
      });

    channelQueue.set(channelId, next);
  };

  return {
    handleMessage(message: DiscordMessageLike): void {
      if (message.authorIsBot) {
        return;
      }

      const channelId = message.channelId;
      const pending = pendingPerChannel.get(channelId) ?? 0;

      if (pending >= maxPendingPerChannel) {
        void message.sendMessage(
          `Too many pending messages for this channel (limit: ${maxPendingPerChannel}). Please wait and try again.`,
        );
        return;
      }

      pendingPerChannel.set(channelId, pending + 1);

      enqueue(channelId, async () => {
        try {
          await processDiscordMessage(options, message);
        } finally {
          const nextPending = (pendingPerChannel.get(channelId) ?? 1) - 1;
          if (nextPending <= 0) {
            pendingPerChannel.delete(channelId);
          } else {
            pendingPerChannel.set(channelId, nextPending);
          }
        }
      });
    },

    async waitForIdle(channelId?: string): Promise<void> {
      if (channelId) {
        await (channelQueue.get(channelId) ?? Promise.resolve());
        return;
      }

      await Promise.all([...channelQueue.values()]);
    },
  };
}

async function createDiscordConfigFromEnv(): Promise<DiscordBridgeConfig> {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) {
    throw new Error('DISCORD_BOT_TOKEN is required');
  }

  const profile = process.env.PERSONAL_AGENT_PROFILE || 'shared';
  const allowlist = parseAllowlist(process.env.PERSONAL_AGENT_DISCORD_ALLOWLIST);

  if (allowlist.size === 0) {
    throw new Error('PERSONAL_AGENT_DISCORD_ALLOWLIST is required (comma-separated channel IDs)');
  }

  const workingDirectory = process.env.PERSONAL_AGENT_DISCORD_CWD || process.cwd();

  return {
    token,
    profile,
    allowlist,
    workingDirectory,
  };
}

function hasDiscordChannelMessaging(channel: unknown): channel is {
  send: (text: string) => Promise<unknown>;
  sendTyping: () => Promise<unknown>;
} {
  if (!channel || typeof channel !== 'object') {
    return false;
  }

  const candidate = channel as Record<string, unknown>;
  return typeof candidate.send === 'function' && typeof candidate.sendTyping === 'function';
}

export async function startDiscordBridge(config?: DiscordBridgeConfig): Promise<void> {
  const effectiveConfig = config ?? await createDiscordConfigFromEnv();
  const { resolvedProfile, statePaths, runtime } = await prepareGatewayRuntime(effectiveConfig.profile);

  const discordSessionDir = join(statePaths.session, 'discord');
  await mkdir(discordSessionDir, { recursive: true });

  const configuredMaxPendingPerChannel = Number(
    process.env.PERSONAL_AGENT_DISCORD_MAX_PENDING_PER_CHANNEL ?? DEFAULT_MAX_PENDING_PER_CHANNEL,
  );

  const maxPendingPerChannel = Number.isFinite(configuredMaxPendingPerChannel) && configuredMaxPendingPerChannel > 0
    ? Math.floor(configuredMaxPendingPerChannel)
    : DEFAULT_MAX_PENDING_PER_CHANNEL;

  const handler = createQueuedDiscordMessageHandler({
    allowlist: effectiveConfig.allowlist,
    profileName: effectiveConfig.profile,
    agentDir: runtime.agentDir,
    discordSessionDir,
    workingDirectory: effectiveConfig.workingDirectory,
    maxPendingPerChannel,
    runPrompt: ({ prompt, sessionFile, cwd }) => runPiPrintPrompt({
      prompt,
      sessionFile,
      profile: resolvedProfile,
      agentDir: runtime.agentDir,
      cwd,
    }),
  });

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.DirectMessages,
      GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Channel],
  });

  client.on('messageCreate', (message) => {
    if (!hasDiscordChannelMessaging(message.channel)) {
      return;
    }

    handler.handleMessage({
      channelId: message.channelId,
      content: message.content,
      authorIsBot: message.author?.bot ?? false,
      sendMessage: (text) => message.channel.send(text),
      sendTyping: () => message.channel.sendTyping(),
    });
  });

  client.once('ready', () => {
    console.log(`Discord bridge started (profile=${effectiveConfig.profile})`);
    console.log(`Allowed channels: ${[...effectiveConfig.allowlist].join(', ')}`);
  });

  client.on('error', (error) => {
    console.error('Discord bridge error:', error);
  });

  await client.login(effectiveConfig.token);
}

function isGatewayProvider(value: string | undefined): value is GatewayProvider {
  if (!value) {
    return false;
  }

  return (GATEWAY_PROVIDERS as readonly string[]).includes(value);
}

function isHelpToken(value: string | undefined): boolean {
  return value === 'help' || value === '--help' || value === '-h';
}

function isStartToken(value: string | undefined): boolean {
  return value === 'start';
}

function ensureNoExtraGatewayArgs(args: string[], expectedLength: number, command: string): void {
  if (args.length <= expectedLength) {
    return;
  }

  throw new Error(`Too many arguments for \`${command}\``);
}

export interface ParsedGatewayCliArgs {
  action: 'start' | 'help';
  provider?: GatewayProvider;
}

export function parseGatewayCliArgs(args: string[]): ParsedGatewayCliArgs {
  const [first, second] = args;

  if (!first) {
    return {
      action: 'start',
      provider: 'telegram',
    };
  }

  if (isHelpToken(first)) {
    ensureNoExtraGatewayArgs(args, 1, 'pa gateway help');
    return {
      action: 'help',
    };
  }

  if (isStartToken(first)) {
    if (!second) {
      return {
        action: 'start',
        provider: 'telegram',
      };
    }

    if (!isGatewayProvider(second)) {
      throw new Error(`Unknown gateway provider: ${second}`);
    }

    ensureNoExtraGatewayArgs(args, 2, `pa gateway start ${second}`);

    return {
      action: 'start',
      provider: second,
    };
  }

  if (isGatewayProvider(first)) {
    if (!second) {
      return {
        action: 'start',
        provider: first,
      };
    }

    if (isStartToken(second)) {
      ensureNoExtraGatewayArgs(args, 2, `pa gateway ${first} start`);
      return {
        action: 'start',
        provider: first,
      };
    }

    if (isHelpToken(second)) {
      ensureNoExtraGatewayArgs(args, 2, `pa gateway ${first} help`);
      return {
        action: 'help',
        provider: first,
      };
    }

    throw new Error(`Unknown ${first} subcommand: ${second}`);
  }

  throw new Error(`Unknown gateway subcommand: ${first}`);
}

async function startGateway(provider: GatewayProvider): Promise<void> {
  if (provider === 'telegram') {
    await startTelegramBridge();
    return;
  }

  await startDiscordBridge();
}

function printGatewayHelp(provider?: GatewayProvider): void {
  if (provider === 'telegram') {
    console.log(`pa gateway telegram

Commands:
  pa gateway telegram start    Start Telegram bridge in foreground
  pa gateway telegram help     Show Telegram gateway help

Environment:
  TELEGRAM_BOT_TOKEN
  PERSONAL_AGENT_TELEGRAM_ALLOWLIST
  PERSONAL_AGENT_PROFILE (optional, default: shared)
  PERSONAL_AGENT_TELEGRAM_CWD (optional, default: current working directory)
  PERSONAL_AGENT_TELEGRAM_MAX_PENDING_PER_CHAT (optional, default: 20)
`);
    return;
  }

  if (provider === 'discord') {
    console.log(`pa gateway discord

Commands:
  pa gateway discord start     Start Discord bridge in foreground
  pa gateway discord help      Show Discord gateway help

Environment:
  DISCORD_BOT_TOKEN
  PERSONAL_AGENT_DISCORD_ALLOWLIST
  PERSONAL_AGENT_PROFILE (optional, default: shared)
  PERSONAL_AGENT_DISCORD_CWD (optional, default: current working directory)
  PERSONAL_AGENT_DISCORD_MAX_PENDING_PER_CHANNEL (optional, default: 20)
`);
    return;
  }

  console.log(`pa gateway

Commands:
  pa gateway [start]                 Start Telegram bridge in foreground
  pa gateway telegram [start|help]   Telegram gateway commands
  pa gateway discord [start|help]    Discord gateway commands
  pa gateway start <provider>        Start specific provider (telegram|discord)
  pa gateway help                    Show gateway help

Shared Environment:
  PERSONAL_AGENT_PROFILE (optional, default: shared)
  PERSONAL_AGENT_PI_TIMEOUT_MS (optional, default: 180000)
  PERSONAL_AGENT_PI_MAX_OUTPUT_BYTES (optional, default: 200000)
`);
}

async function runGatewayCommand(args: string[]): Promise<number> {
  const parsed = parseGatewayCliArgs(args);

  if (parsed.action === 'help') {
    printGatewayHelp(parsed.provider);
    return 0;
  }

  await startGateway(parsed.provider ?? 'telegram');
  return 0;
}

export interface RegisteredCliCommand {
  name: string;
  usage: string;
  description: string;
  run: (args: string[]) => Promise<number>;
}

export type CliCommandRegistrar = (command: RegisteredCliCommand) => void;

export function registerGatewayCliCommands(register: CliCommandRegistrar): void {
  register({
    name: 'gateway',
    usage: 'pa gateway [telegram|discord] [start|help]',
    description: 'Run messaging gateway commands',
    run: runGatewayCommand,
  });
}

async function startGatewayFromEnv(): Promise<void> {
  const providerValue = process.env.PERSONAL_AGENT_GATEWAY_PROVIDER?.trim().toLowerCase();

  if (!providerValue) {
    await startTelegramBridge();
    return;
  }

  if (!isGatewayProvider(providerValue)) {
    throw new Error(`Unsupported PERSONAL_AGENT_GATEWAY_PROVIDER: ${providerValue}`);
  }

  await startGateway(providerValue);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startGatewayFromEnv().catch((error) => {
    console.error((error as Error).message);
    process.exit(1);
  });
}

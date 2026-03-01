#!/usr/bin/env node

import { createInterface } from 'readline';
import { mkdir, rm } from 'fs/promises';
import { existsSync } from 'fs';
import { join, resolve } from 'path';
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
import {
  getGatewayConfigFilePath,
  readGatewayConfig,
  type DiscordStoredConfig,
  type GatewayStoredConfig,
  type TelegramStoredConfig,
  writeGatewayConfig,
} from './config.js';

// Logging types for chat flow
export interface ChatLogEntry {
  timestamp: string;
  type: 'incoming' | 'tool_call' | 'tool_result' | 'assistant' | 'error' | 'system';
  source: string;
  userId: string;
  userName?: string;
  content: string;
  details?: Record<string, unknown>;
}

export interface PiJsonEvent {
  type: string;
  assistantMessageEvent?: {
    type: string;
    contentIndex?: number;
    delta?: string;
    content?: string;
    toolCall?: {
      id?: string;
      name?: string;
      arguments?: Record<string, unknown>;
    };
  };
  toolCallId?: string;
  toolName?: string;
  args?: Record<string, unknown>;
  result?: {
    content?: Array<{ type: string; text?: string }>;
    isError?: boolean;
  };
  isError?: boolean;
  message?: {
    role?: string;
    content?: Array<{
      type: string;
      text?: string;
      name?: string;
      arguments?: Record<string, unknown>;
    }>;
  };
}

export interface TelegramBridgeConfig {
  token: string;
  profile: string;
  allowlist: Set<string>;
  workingDirectory: string;
  maxPendingPerChat?: number;
}

export interface DiscordBridgeConfig {
  token: string;
  profile: string;
  allowlist: Set<string>;
  workingDirectory: string;
  maxPendingPerChannel?: number;
}

export interface TelegramMessageLike {
  chat: { id: number };
  text?: string;
  from?: {
    id?: number;
    username?: string;
    first_name?: string;
    last_name?: string;
  };
}

type SendMessageFn = (chatId: number, text: string) => Promise<unknown>;

type SendTextFn = (text: string) => Promise<unknown>;

type SendChatActionFn = (chatId: number, action: 'typing') => Promise<unknown>;

interface RunPromptFnInput {
  prompt: string;
  sessionFile: string;
  cwd: string;
  logContext?: {
    source: string;
    userId: string;
    userName?: string;
  };
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
  commandHelpText?: string;
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
  authorUsername?: string;
  authorId?: string;
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

function gatewaySection(title: string): string {
  return title;
}

function gatewaySuccess(message: string): string {
  return `✓ ${message}`;
}

function gatewayWarning(message: string): string {
  return `⚠ ${message}`;
}

function gatewayNext(command: string): string {
  return `Next: ${command}`;
}

function gatewayKeyValue(key: string, value: string | number): string {
  return `  ${key}: ${value}`;
}

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

interface TelegramCommandDefinition {
  command: string;
  description: string;
}

const DEFAULT_TELEGRAM_COMMANDS: TelegramCommandDefinition[] = [
  { command: 'new', description: 'Start a new session' },
  { command: 'status', description: 'Show gateway status' },
  { command: 'commands', description: 'List available commands' },
  { command: 'help', description: 'Show command help' },
  { command: 'skill', description: 'Load a skill (usage: /skill <name>)' },
];

function toTelegramCommandName(rawCommand: string): string | undefined {
  let value = rawCommand.trim().toLowerCase();
  if (value.startsWith('/')) {
    value = value.slice(1);
  }

  value = value.split(/\s+/)[0] ?? value;

  let command = '';
  for (const char of value) {
    if (/[a-z0-9_]/.test(char)) {
      command += char;
      continue;
    }

    break;
  }

  if (command.length === 0) {
    return undefined;
  }

  return command.slice(0, 32);
}

function toTelegramCommandDescription(description: string): string {
  const singleLine = description.replace(/\s+/g, ' ').trim();
  if (singleLine.length === 0) {
    return 'Command';
  }

  return singleLine.slice(0, 256);
}

function parsePiHelpCommands(helpText: string): TelegramCommandDefinition[] {
  const parsed: TelegramCommandDefinition[] = [];
  const lines = helpText.split('\n');

  for (const line of lines) {
    const match = line.match(/^\s*-\s*`\/([^`]+)`\s*-\s*(.+)$/);
    if (!match) {
      continue;
    }

    const rawCommand = match[1]?.trim() ?? '';
    const rawDescription = match[2]?.trim() ?? '';
    const command = toTelegramCommandName(rawCommand);

    if (!command) {
      continue;
    }

    const description = command === 'skill'
      ? 'Load a skill (usage: /skill <name>)'
      : toTelegramCommandDescription(rawDescription);

    parsed.push({ command, description });
  }

  return parsed;
}

function mergeTelegramCommands(
  preferred: TelegramCommandDefinition[],
  discovered: TelegramCommandDefinition[],
): TelegramCommandDefinition[] {
  const merged = new Map<string, TelegramCommandDefinition>();

  for (const command of preferred) {
    merged.set(command.command, command);
  }

  for (const command of discovered) {
    if (!merged.has(command.command)) {
      merged.set(command.command, command);
    }
  }

  return [...merged.values()].slice(0, 100);
}

function formatTelegramCommands(commands: TelegramCommandDefinition[]): string {
  const lines = ['Available commands:'];

  for (const command of commands) {
    lines.push(`/${command.command} - ${command.description}`);
  }

  lines.push('');
  lines.push('Tip: use /skill <name> for skill commands like /skill:tdd-feature.');

  return lines.join('\n');
}

function normalizeTelegramCommandText(text: string): {
  normalizedText: string;
  command?: string;
  args: string;
} {
  const trimmed = text.trim();

  if (!trimmed.startsWith('/')) {
    return {
      normalizedText: trimmed,
      args: '',
    };
  }

  const parts = trimmed.split(/\s+/);
  const first = parts[0] ?? '';
  const normalizedCommand = first
    .replace(/^\/([a-z0-9_]+)@[^\s]+$/i, '/$1')
    .toLowerCase();
  const args = parts.slice(1).join(' ').trim();

  return {
    normalizedText: args.length > 0 ? `${normalizedCommand} ${args}` : normalizedCommand,
    command: normalizedCommand,
    args,
  };
}

async function discoverTelegramCommandsFromPi(options: {
  profile: ResolvedProfile;
  agentDir: string;
  cwd: string;
  sessionFile: string;
}): Promise<TelegramCommandDefinition[]> {
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
      '/help',
    ],
    settings,
  );

  try {
    const result = spawnSync('pi', args, {
      cwd: options.cwd,
      env: {
        ...process.env,
        PI_CODING_AGENT_DIR: options.agentDir,
      },
      encoding: 'utf-8',
    });

    if (result.error || result.status !== 0) {
      return [];
    }

    return parsePiHelpCommands(result.stdout ?? '');
  } finally {
    await rm(options.sessionFile, { force: true });
  }
}

// Chat flow logging functions
function formatLogTimestamp(): string {
  return new Date().toISOString();
}

function logChatEntry(entry: ChatLogEntry): void {
  const timestamp = entry.timestamp;
  const type = entry.type.toUpperCase().padEnd(12);
  const source = entry.source.padEnd(10);
  const user = entry.userName || entry.userId;
  
  // Color codes for terminal
  const colors: Record<string, string> = {
    incoming: '\x1b[36m',   // Cyan
    tool_call: '\x1b[33m',  // Yellow
    tool_result: '\x1b[32m', // Green
    assistant: '\x1b[35m',  // Magenta
    error: '\x1b[31m',      // Red
    system: '\x1b[90m',     // Gray
    reset: '\x1b[0m',
  };
  
  const color = colors[entry.type] || colors.reset;
  const reset = colors.reset;
  
  console.log(`${color}[${timestamp}] [${type}] [${source}] ${user}:${reset} ${entry.content}`);
  
  if (entry.details && Object.keys(entry.details).length > 0) {
    const detailsStr = JSON.stringify(entry.details, null, 2);
    console.log(`${color}  → Details:${reset} ${detailsStr}`);
  }
}

function logIncomingMessage(source: string, userId: string, userName: string | undefined, message: string): void {
  logChatEntry({
    timestamp: formatLogTimestamp(),
    type: 'incoming',
    source,
    userId,
    userName,
    content: message,
  });
}

function logToolCall(
  source: string,
  userId: string,
  toolName: string,
  args: Record<string, unknown>,
  userName?: string,
): void {
  logChatEntry({
    timestamp: formatLogTimestamp(),
    type: 'tool_call',
    source,
    userId,
    userName,
    content: `Tool call: ${toolName}`,
    details: { args },
  });
}

function logToolResult(
  source: string,
  userId: string,
  toolName: string,
  result: string,
  isError: boolean,
  userName?: string,
): void {
  logChatEntry({
    timestamp: formatLogTimestamp(),
    type: 'tool_result',
    source,
    userId,
    userName,
    content: `Tool result: ${toolName}${isError ? ' (ERROR)' : ''}`,
    details: { result: result.slice(0, 500) + (result.length > 500 ? '...' : '') },
  });
}

function logAssistantMessage(source: string, userId: string, message: string, userName?: string): void {
  logChatEntry({
    timestamp: formatLogTimestamp(),
    type: 'assistant',
    source,
    userId,
    userName,
    content: message.slice(0, 200) + (message.length > 200 ? '...' : ''),
  });
}

function logError(source: string, userId: string, error: string, userName?: string): void {
  logChatEntry({
    timestamp: formatLogTimestamp(),
    type: 'error',
    source,
    userId,
    userName,
    content: error,
  });
}

function logSystem(source: string, message: string): void {
  logChatEntry({
    timestamp: formatLogTimestamp(),
    type: 'system',
    source,
    userId: '-',
    content: message,
  });
}

// Parse pi --mode json output and log events
class PiJsonStreamParser {
  private currentToolCalls = new Map<string, { name: string; args: string }>();
  private assistantTextBuffer = '';
  private source: string;
  private userId: string;
  private userName?: string;

  constructor(source: string, userId: string, userName?: string) {
    this.source = source;
    this.userId = userId;
    this.userName = userName;
  }

  parseLine(line: string): void {
    if (!line.trim()) return;
    
    try {
      const event = JSON.parse(line) as PiJsonEvent;
      this.handleEvent(event);
    } catch {
      // Ignore parse errors for non-JSON lines
    }
  }

  private handleEvent(event: PiJsonEvent): void {
    switch (event.type) {
      case 'message_update': {
        const msgEvent = event.assistantMessageEvent;
        if (!msgEvent) return;

        switch (msgEvent.type) {
          case 'text_delta': {
            if (msgEvent.delta) {
              this.assistantTextBuffer += msgEvent.delta;
            }
            break;
          }
          case 'toolcall_start': {
            const toolCall = msgEvent.toolCall;
            if (toolCall?.id) {
              this.currentToolCalls.set(toolCall.id, {
                name: toolCall.name || 'unknown',
                args: '',
              });
            }
            break;
          }
          case 'toolcall_delta': {
            const toolCall = msgEvent.toolCall;
            if (toolCall?.id && msgEvent.delta) {
              const existing = this.currentToolCalls.get(toolCall.id);
              if (existing) {
                existing.args += msgEvent.delta;
              }
            }
            break;
          }
          case 'toolcall_end': {
            const toolCall = msgEvent.toolCall;
            if (toolCall?.id) {
              const existing = this.currentToolCalls.get(toolCall.id);
              if (existing) {
                try {
                  const args = JSON.parse(existing.args) as Record<string, unknown>;
                  logToolCall(this.source, this.userId, existing.name, args, this.userName);
                } catch {
                  logToolCall(this.source, this.userId, existing.name, { raw: existing.args }, this.userName);
                }
                this.currentToolCalls.delete(toolCall.id);
              }
            }
            break;
          }
          case 'text_end': {
            // Text is complete, will be logged at turn_end
            break;
          }
        }
        break;
      }
      case 'tool_execution_start': {
        // Tool execution started - already logged at toolcall_end
        break;
      }
      case 'tool_execution_end': {
        const result = event.result;
        const toolName = event.toolName || 'unknown';
        const isError = event.isError || false;
        
        if (result?.content) {
          const textContent = result.content
            .filter((c) => c.type === 'text')
            .map((c) => c.text)
            .join('');
          logToolResult(this.source, this.userId, toolName, textContent, isError, this.userName);
        }
        break;
      }
      case 'turn_end': {
        // Log the complete assistant message
        if (this.assistantTextBuffer.trim()) {
          logAssistantMessage(this.source, this.userId, this.assistantTextBuffer.trim(), this.userName);
          this.assistantTextBuffer = '';
        }
        break;
      }
      case 'agent_end': {
        // Final message logged at turn_end
        break;
      }
    }
  }
}

function toPositiveInteger(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }

  return Math.floor(parsed);
}

function createPromptInterface() {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const ask = async (question: string): Promise<string> => new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });

  const close = (): void => {
    rl.close();
  };

  return { ask, close };
}

async function promptRequired(ask: (question: string) => Promise<string>, question: string): Promise<string> {
  let value = await ask(question);

  while (value.length === 0) {
    value = await ask(question);
  }

  return value;
}

async function promptWithDefault(
  ask: (question: string) => Promise<string>,
  label: string,
  defaultValue: string,
): Promise<string> {
  const value = await ask(`${label} [${defaultValue}]: `);
  return value.length > 0 ? value : defaultValue;
}

async function promptPositiveInteger(
  ask: (question: string) => Promise<string>,
  label: string,
  defaultValue?: number,
): Promise<number | undefined> {
  const suffix = defaultValue ? ` [${defaultValue}]` : ' (optional)';
  let value = await ask(`${label}${suffix}: `);

  while (value.length > 0) {
    const parsed = toPositiveInteger(value);
    if (parsed !== undefined) {
      return parsed;
    }

    console.log('Please enter a positive integer or leave blank.');
    value = await ask(`${label}${suffix}: `);
  }

  return defaultValue;
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

interface RunPiPrintPromptOptions {
  prompt: string;
  sessionFile: string;
  profile: ResolvedProfile;
  agentDir: string;
  cwd: string;
  logContext?: {
    source: string;
    userId: string;
    userName?: string;
  };
}

async function runPiPrintPrompt(options: RunPiPrintPromptOptions): Promise<string> {
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
      '--mode',
      'json',
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

    // Initialize JSON stream parser for logging
    const parser = options.logContext
      ? new PiJsonStreamParser(options.logContext.source, options.logContext.userId, options.logContext.userName)
      : null;

    const finalize = (resolver: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutHandle);
      resolver();
    };

    const fail = (message: string) => {
      child.kill('SIGTERM');
      if (parser && options.logContext) {
        logError(options.logContext.source, options.logContext.userId, message, options.logContext.userName);
      }
      finalize(() => reject(new Error(message)));
    };

    const timeoutHandle = setTimeout(() => {
      fail(`pi timed out after ${timeoutMs}ms`);
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer | string) => {
      const text = chunk.toString();
      stdout += text;
      stdoutBytes += Buffer.byteLength(text);

      // Parse JSON lines for logging
      if (parser) {
        const lines = text.split('\n');
        for (const line of lines) {
          parser.parseLine(line);
        }
      }

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

  const fullName = [message.from?.first_name, message.from?.last_name].filter(Boolean).join(' ');
  const userName = message.from?.username ?? (fullName || undefined);

  logIncomingMessage('telegram', chatId, userName, text);

  const sessionFile = join(options.telegramSessionDir, `${chatId}.jsonl`);
  const sessionFileExists = options.sessionFileExists ?? existsSync;
  const removeSessionFile = options.removeSessionFile ?? ((path: string) => rm(path, { force: true }));

  const normalized = normalizeTelegramCommandText(text);
  const command = normalized.command;

  if (command === '/new') {
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

  if (command === '/status') {
    await options.sendMessage(
      message.chat.id,
      `profile=${options.profileName}\nagentDir=${options.agentDir}\nsession=${sessionFile}`,
    );
    return;
  }

  if (command === '/commands') {
    const commandHelp = options.commandHelpText
      ?? formatTelegramCommands(DEFAULT_TELEGRAM_COMMANDS);
    await sendLongText((chunk) => options.sendMessage(message.chat.id, chunk), commandHelp);
    return;
  }

  let prompt = normalized.normalizedText;
  if (command === '/skill') {
    if (normalized.args.length === 0) {
      await options.sendMessage(message.chat.id, 'Usage: /skill <name>\nExample: /skill tdd-feature');
      return;
    }

    prompt = `/skill:${normalized.args}`;
  }

  await options.sendChatAction(message.chat.id, 'typing');

  try {
    const output = await options.runPrompt({
      prompt,
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
  const stored = readGatewayConfig();
  const storedTelegram = stored.telegram;

  const token = process.env.TELEGRAM_BOT_TOKEN ?? storedTelegram?.token;
  if (!token) {
    throw new Error('TELEGRAM_BOT_TOKEN is required. Run `pa gateway setup telegram` or set TELEGRAM_BOT_TOKEN.');
  }

  const profile = process.env.PERSONAL_AGENT_PROFILE || stored.profile || 'shared';

  const allowlistFromEnv = parseAllowlist(process.env.PERSONAL_AGENT_TELEGRAM_ALLOWLIST);
  const allowlist = allowlistFromEnv.size > 0
    ? allowlistFromEnv
    : new Set(storedTelegram?.allowlist ?? []);

  if (allowlist.size === 0) {
    throw new Error(
      'PERSONAL_AGENT_TELEGRAM_ALLOWLIST is required (comma-separated chat IDs). ' +
      'Run `pa gateway setup telegram` or set PERSONAL_AGENT_TELEGRAM_ALLOWLIST.',
    );
  }

  const workingDirectory = process.env.PERSONAL_AGENT_TELEGRAM_CWD
    || storedTelegram?.workingDirectory
    || process.cwd();

  const maxPendingPerChat = toPositiveInteger(process.env.PERSONAL_AGENT_TELEGRAM_MAX_PENDING_PER_CHAT)
    ?? storedTelegram?.maxPendingPerChat;

  return {
    token,
    profile,
    allowlist,
    workingDirectory,
    maxPendingPerChat,
  };
}

export async function startTelegramBridge(config?: TelegramBridgeConfig): Promise<void> {
  const effectiveConfig = config ?? await createTelegramConfigFromEnv();
  const { resolvedProfile, statePaths, runtime } = await prepareGatewayRuntime(effectiveConfig.profile);

  const telegramSessionDir = join(statePaths.session, 'telegram');
  await mkdir(telegramSessionDir, { recursive: true });

  const bot = new TelegramBot(effectiveConfig.token, { polling: true });

  const maxPendingPerChat = effectiveConfig.maxPendingPerChat ?? DEFAULT_MAX_PENDING_PER_CHAT;

  const discoveredCommands = await discoverTelegramCommandsFromPi({
    profile: resolvedProfile,
    agentDir: runtime.agentDir,
    cwd: effectiveConfig.workingDirectory,
    sessionFile: join(telegramSessionDir, '__commands__.jsonl'),
  });
  const telegramCommands = mergeTelegramCommands(DEFAULT_TELEGRAM_COMMANDS, discoveredCommands);
  const commandHelpText = formatTelegramCommands(telegramCommands);

  try {
    await bot.setMyCommands(telegramCommands);
  } catch (error) {
    console.warn(gatewayWarning(`Failed to register Telegram commands: ${(error as Error).message}`));
  }

  const handler = createQueuedTelegramMessageHandler({
    allowlist: effectiveConfig.allowlist,
    profileName: effectiveConfig.profile,
    agentDir: runtime.agentDir,
    telegramSessionDir,
    workingDirectory: effectiveConfig.workingDirectory,
    maxPendingPerChat,
    commandHelpText,
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

  console.log(gatewaySuccess(`Telegram bridge started (profile=${effectiveConfig.profile})`));
  console.log(gatewayKeyValue('Allowed chats', [...effectiveConfig.allowlist].join(', ')));
  console.log(gatewayKeyValue('Working directory', effectiveConfig.workingDirectory));
  console.log(gatewayKeyValue('Registered commands', telegramCommands.length));
  logSystem('telegram', `Bridge started for profile=${effectiveConfig.profile}`);
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

  logIncomingMessage('discord', channelId, undefined, text);

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
  const stored = readGatewayConfig();
  const storedDiscord = stored.discord;

  const token = process.env.DISCORD_BOT_TOKEN ?? storedDiscord?.token;
  if (!token) {
    throw new Error('DISCORD_BOT_TOKEN is required. Run `pa gateway setup discord` or set DISCORD_BOT_TOKEN.');
  }

  const profile = process.env.PERSONAL_AGENT_PROFILE || stored.profile || 'shared';

  const allowlistFromEnv = parseAllowlist(process.env.PERSONAL_AGENT_DISCORD_ALLOWLIST);
  const allowlist = allowlistFromEnv.size > 0
    ? allowlistFromEnv
    : new Set(storedDiscord?.allowlist ?? []);

  if (allowlist.size === 0) {
    throw new Error(
      'PERSONAL_AGENT_DISCORD_ALLOWLIST is required (comma-separated channel IDs). ' +
      'Run `pa gateway setup discord` or set PERSONAL_AGENT_DISCORD_ALLOWLIST.',
    );
  }

  const workingDirectory = process.env.PERSONAL_AGENT_DISCORD_CWD
    || storedDiscord?.workingDirectory
    || process.cwd();

  const maxPendingPerChannel = toPositiveInteger(process.env.PERSONAL_AGENT_DISCORD_MAX_PENDING_PER_CHANNEL)
    ?? storedDiscord?.maxPendingPerChannel;

  return {
    token,
    profile,
    allowlist,
    workingDirectory,
    maxPendingPerChannel,
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

  const maxPendingPerChannel = effectiveConfig.maxPendingPerChannel ?? DEFAULT_MAX_PENDING_PER_CHANNEL;

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
    console.log(gatewaySuccess(`Discord bridge started (profile=${effectiveConfig.profile})`));
    console.log(gatewayKeyValue('Allowed channels', [...effectiveConfig.allowlist].join(', ')));
    console.log(gatewayKeyValue('Working directory', effectiveConfig.workingDirectory));
    logSystem('discord', `Bridge started for profile=${effectiveConfig.profile}`);
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

function isSetupToken(value: string | undefined): boolean {
  return value === 'setup';
}

function ensureNoExtraGatewayArgs(args: string[], expectedLength: number, command: string): void {
  if (args.length <= expectedLength) {
    return;
  }

  throw new Error(`Too many arguments for \`${command}\``);
}

export interface ParsedGatewayCliArgs {
  action: 'start' | 'setup' | 'help';
  provider?: GatewayProvider;
}

export function parseGatewayCliArgs(args: string[]): ParsedGatewayCliArgs {
  const [first, second] = args;

  if (!first) {
    return {
      action: 'help',
    };
  }

  if (isHelpToken(first)) {
    ensureNoExtraGatewayArgs(args, 1, 'pa gateway help');
    return {
      action: 'help',
    };
  }

  if (isStartToken(first) || isSetupToken(first)) {
    const action: ParsedGatewayCliArgs['action'] = isStartToken(first) ? 'start' : 'setup';

    if (!second) {
      return action === 'start'
        ? { action, provider: 'telegram' }
        : { action };
    }

    if (!isGatewayProvider(second)) {
      throw new Error(`Unknown gateway provider: ${second}`);
    }

    ensureNoExtraGatewayArgs(args, 2, `pa gateway ${first} ${second}`);

    return {
      action,
      provider: second,
    };
  }

  if (isGatewayProvider(first)) {
    if (!second) {
      return {
        action: 'help',
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

    if (isSetupToken(second)) {
      ensureNoExtraGatewayArgs(args, 2, `pa gateway ${first} setup`);
      return {
        action: 'setup',
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

function waitIndefinitely(): Promise<void> {
  return new Promise(() => {
    // Keep process alive in foreground mode until interrupted (Ctrl+C).
  });
}

async function resolveGatewayProviderForSetup(
  ask: (question: string) => Promise<string>,
  provider?: GatewayProvider,
): Promise<GatewayProvider> {
  if (provider) {
    return provider;
  }

  let input = (await ask('Provider [telegram/discord] [telegram]: ')).trim().toLowerCase();

  while (input.length > 0 && !isGatewayProvider(input)) {
    console.log(gatewayWarning('Please enter telegram or discord.'));
    input = (await ask('Provider [telegram/discord] [telegram]: ')).trim().toLowerCase();
  }

  if (input.length === 0) {
    return 'telegram';
  }

  if (!isGatewayProvider(input)) {
    return 'telegram';
  }

  return input;
}

async function runGatewaySetup(provider?: GatewayProvider): Promise<void> {
  const prompt = createPromptInterface();

  try {
    const selectedProvider = await resolveGatewayProviderForSetup(prompt.ask, provider);
    const current = readGatewayConfig();

    const profileDefault = current.profile ?? 'shared';
    const profile = await promptWithDefault(prompt.ask, 'Profile', profileDefault);

    const existingProviderConfig: TelegramStoredConfig | DiscordStoredConfig | undefined =
      selectedProvider === 'telegram' ? current.telegram : current.discord;

    let resolvedToken = existingProviderConfig?.token;

    if (resolvedToken) {
      const tokenInput = await prompt.ask('Bot token [press Enter to keep existing]: ');
      if (tokenInput.length > 0) {
        resolvedToken = tokenInput;
      }
    } else {
      resolvedToken = await promptRequired(prompt.ask, 'Bot token: ');
    }

    if (!resolvedToken) {
      throw new Error('Bot token is required.');
    }

    const allowlistDefault = existingProviderConfig?.allowlist?.join(',') ?? '';
    const allowlistInput = allowlistDefault.length > 0
      ? await promptWithDefault(prompt.ask, 'Allowlist (comma-separated IDs)', allowlistDefault)
      : await promptRequired(prompt.ask, 'Allowlist (comma-separated IDs): ');

    const allowlist = [...parseAllowlist(allowlistInput)];
    if (allowlist.length === 0) {
      throw new Error('At least one allowlist entry is required.');
    }

    const cwdDefault = existingProviderConfig?.workingDirectory ?? process.cwd();
    const workingDirectory = resolve(await promptWithDefault(prompt.ask, 'Working directory', cwdDefault));

    const maxPending = await promptPositiveInteger(
      prompt.ask,
      selectedProvider === 'telegram' ? 'Max pending messages per chat' : 'Max pending messages per channel',
      selectedProvider === 'telegram'
        ? current.telegram?.maxPendingPerChat
        : current.discord?.maxPendingPerChannel,
    );

    const updated: GatewayStoredConfig = {
      ...current,
      profile,
    };

    if (selectedProvider === 'telegram') {
      updated.telegram = {
        ...current.telegram,
        token: resolvedToken,
        allowlist,
        workingDirectory,
        maxPendingPerChat: maxPending,
      };
    } else {
      updated.discord = {
        ...current.discord,
        token: resolvedToken,
        allowlist,
        workingDirectory,
        maxPendingPerChannel: maxPending,
      };
    }

    writeGatewayConfig(updated);
    console.log(gatewaySuccess(`Saved ${selectedProvider} gateway config`));
    console.log(gatewayKeyValue('Config file', getGatewayConfigFilePath()));
    console.log(gatewayNext(`pa gateway ${selectedProvider} start`));
  } finally {
    prompt.close();
  }
}

function printGatewayHelp(provider?: GatewayProvider): void {
  if (provider === 'telegram') {
    console.log(gatewaySection('Gateway · Telegram'));
    console.log('');
    console.log('Commands:');
    console.log('  pa gateway telegram setup    Interactive setup for Telegram gateway');
    console.log('  pa gateway telegram start    Start Telegram bridge in foreground');
    console.log('  pa gateway telegram help     Show Telegram gateway help');
    console.log('');
    console.log('Config keys (written by setup):');
    console.log('  TELEGRAM_BOT_TOKEN');
    console.log('  PERSONAL_AGENT_TELEGRAM_ALLOWLIST');
    console.log('  PERSONAL_AGENT_PROFILE (optional, default: shared)');
    console.log('  PERSONAL_AGENT_TELEGRAM_CWD (optional, default: current working directory)');
    console.log('  PERSONAL_AGENT_TELEGRAM_MAX_PENDING_PER_CHAT (optional, default: 20)');
    console.log('');
    console.log(gatewayNext('pa gateway telegram setup'));
    return;
  }

  if (provider === 'discord') {
    console.log(gatewaySection('Gateway · Discord'));
    console.log('');
    console.log('Commands:');
    console.log('  pa gateway discord setup     Interactive setup for Discord gateway');
    console.log('  pa gateway discord start     Start Discord bridge in foreground');
    console.log('  pa gateway discord help      Show Discord gateway help');
    console.log('');
    console.log('Config keys (written by setup):');
    console.log('  DISCORD_BOT_TOKEN');
    console.log('  PERSONAL_AGENT_DISCORD_ALLOWLIST');
    console.log('  PERSONAL_AGENT_PROFILE (optional, default: shared)');
    console.log('  PERSONAL_AGENT_DISCORD_CWD (optional, default: current working directory)');
    console.log('  PERSONAL_AGENT_DISCORD_MAX_PENDING_PER_CHANNEL (optional, default: 20)');
    console.log('');
    console.log(gatewayNext('pa gateway discord setup'));
    return;
  }

  console.log(gatewaySection('Gateway commands'));
  console.log('');
  console.log('Commands:');
  console.log('  pa gateway help                            Show gateway help');
  console.log('  pa gateway setup [provider]                Interactive setup walkthrough');
  console.log('  pa gateway start [provider]                Start provider (default: telegram)');
  console.log('  pa gateway telegram [setup|start|help]     Telegram gateway commands');
  console.log('  pa gateway discord [setup|start|help]      Discord gateway commands');
  console.log('');
  console.log(`Config file: ${getGatewayConfigFilePath()}`);
  console.log('');
  console.log('Environment overrides (optional):');
  console.log('  PERSONAL_AGENT_PROFILE');
  console.log('  PERSONAL_AGENT_PI_TIMEOUT_MS');
  console.log('  PERSONAL_AGENT_PI_MAX_OUTPUT_BYTES');
}

async function runGatewayCommand(args: string[]): Promise<number> {
  const parsed = parseGatewayCliArgs(args);

  if (parsed.action === 'help') {
    printGatewayHelp(parsed.provider);
    return 0;
  }

  if (parsed.action === 'setup') {
    await runGatewaySetup(parsed.provider);
    return 0;
  }

  await startGateway(parsed.provider ?? 'telegram');
  await waitIndefinitely();
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
    usage: 'pa gateway [telegram|discord] [setup|start|help]',
    description: 'Run messaging gateway commands',
    run: runGatewayCommand,
  });
}

async function startGatewayFromEnv(): Promise<void> {
  const providerValue = process.env.PERSONAL_AGENT_GATEWAY_PROVIDER?.trim().toLowerCase();

  if (!providerValue) {
    await startTelegramBridge();
    await waitIndefinitely();
    return;
  }

  if (!isGatewayProvider(providerValue)) {
    throw new Error(`Unsupported PERSONAL_AGENT_GATEWAY_PROVIDER: ${providerValue}`);
  }

  await startGateway(providerValue);
  await waitIndefinitely();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startGatewayFromEnv().catch((error) => {
    console.error((error as Error).message);
    process.exit(1);
  });
}

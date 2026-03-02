#!/usr/bin/env node

import { createInterface } from 'readline';
import { mkdir, rm } from 'fs/promises';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from 'fs';
import { basename, join, resolve } from 'path';
import { spawnSync } from 'child_process';
import TelegramBot from 'node-telegram-bot-api';
import * as DiscordJs from 'discord.js';
import {
  SessionManager,
  SettingsManager,
  createAgentSession,
  createEventBus,
  loadExtensions,
  type PromptTemplate,
} from '@mariozechner/pi-coding-agent';
import {
  bootstrapStateOrThrow,
  preparePiAgentDir,
  resolveStatePaths,
  validateStatePathsOutsideRepo,
} from '@personal-agent/core';
import {
  getExtensionDependencyDirs,
  materializeProfileToAgentDir,
  mergeJsonFiles,
  resolveResourceProfile,
} from '@personal-agent/resources';
import { emitDaemonEventNonFatal, startDaemonDetached } from '@personal-agent/daemon';
import {
  getGatewayConfigFilePath,
  readGatewayConfig,
  type DiscordStoredConfig,
  type GatewayStoredConfig,
  type TelegramStoredConfig,
  writeGatewayConfig,
} from './config.js';
import {
  getGatewayServiceStatus,
  installGatewayService,
  uninstallGatewayService,
} from './service.js';

export {
  SUPPORTED_GATEWAY_PROVIDERS,
  getManagedDaemonServiceStatus,
  installManagedDaemonService,
  restartGatewayService,
  restartGatewayServiceIfInstalled,
  restartManagedDaemonServiceIfInstalled,
  uninstallManagedDaemonService,
} from './service.js';

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
  messages?: Array<{
    role?: string;
    content?: Array<{
      type: string;
      text?: string;
      name?: string;
      arguments?: Record<string, unknown>;
    }>;
  }>;
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
  message_id?: number;
  text?: string;
  from?: {
    id?: number;
    username?: string;
    first_name?: string;
    last_name?: string;
  };
}

interface TelegramInlineKeyboardButton {
  text: string;
  callback_data: string;
}

interface TelegramSendMessageOptions {
  reply_markup?: {
    inline_keyboard: TelegramInlineKeyboardButton[][];
  };
}

type SendMessageFn = (chatId: number, text: string, options?: TelegramSendMessageOptions) => Promise<unknown>;

type SendTextFn = (text: string) => Promise<unknown>;

type SendChatActionFn = (chatId: number, action: 'typing') => Promise<unknown>;

interface RunPromptFnInput {
  prompt: string;
  sessionFile: string;
  cwd: string;
  model?: string;
  abortSignal?: AbortSignal;
  logContext?: {
    source: string;
    userId: string;
    userName?: string;
  };
}

interface ConversationSubmitStarted {
  mode: 'started';
  run: Promise<string>;
}

interface ConversationSubmitQueued {
  mode: 'steered' | 'followup';
}

type ConversationSubmitResult = ConversationSubmitStarted | ConversationSubmitQueued;

interface MessageProcessingResult {
  completion: Promise<void>;
}

function completedMessageProcessingResult(): MessageProcessingResult {
  return { completion: Promise.resolve() };
}

export interface GatewayConversationController {
  submitPrompt: (input: RunPromptFnInput) => Promise<ConversationSubmitResult>;
  submitFollowUp: (input: RunPromptFnInput) => Promise<ConversationSubmitResult>;
  abortCurrent: () => Promise<boolean>;
  waitForIdle: () => Promise<void>;
  dispose: () => Promise<void>;
}

type CreateConversationControllerFn = (input: {
  conversationId: string;
  sessionFile: string;
}) => Promise<GatewayConversationController> | GatewayConversationController;

interface PendingModelSelection {
  models: string[];
  search?: string;
}

export interface ModelCommandSupport {
  listModels: (search?: string) => Promise<string[]>;
  activeModelsByConversation: Map<string, string>;
  pendingSelectionsByConversation: Map<string, PendingModelSelection>;
  defaultModel?: string;
  selectionLimit?: number;
}

export interface CreateTelegramMessageHandlerOptions {
  allowlist: Set<string>;
  profileName: string;
  agentDir: string;
  telegramSessionDir: string;
  workingDirectory: string;
  sendMessage: SendMessageFn;
  sendChatAction: SendChatActionFn;
  createConversationController: CreateConversationControllerFn;
  commandHelpText?: string;
  skillsHelpText?: string;
  sessionFileExists?: (path: string) => boolean;
  removeSessionFile?: (path: string) => Promise<void>;
  maxPendingPerChat?: number;
  modelCommands?: ModelCommandSupport;
  durableInboxDir?: string;
}

export interface QueuedTelegramMessageHandler {
  handleMessage: (message: TelegramMessageLike) => void;
  replayPendingMessages: () => number;
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
  createConversationController: CreateConversationControllerFn;
  commandHelpText?: string;
  skillsHelpText?: string;
  sessionFileExists?: (path: string) => boolean;
  removeSessionFile?: (path: string) => Promise<void>;
  maxPendingPerChannel?: number;
  modelCommands?: ModelCommandSupport;
}

export interface QueuedDiscordMessageHandler {
  handleMessage: (message: DiscordMessageLike) => void;
  waitForIdle: (channelId?: string) => Promise<void>;
}

const DEFAULT_PI_TIMEOUT_MS = 180_000;
const DEFAULT_MAX_PENDING_PER_CHAT = 20;
const DEFAULT_MAX_PENDING_PER_CHANNEL = 20;
const DEFAULT_MODEL_SELECTION_LIMIT = 25;
const TYPING_HEARTBEAT_INTERVAL_MS = 4_000;
const DEFAULT_TELEGRAM_RETRY_ATTEMPTS = 3;
const DEFAULT_TELEGRAM_RETRY_BASE_DELAY_MS = 300;
const TELEGRAM_MODEL_SELECTION_CALLBACK_PREFIX = 'model_select:';
const PROMPT_CANCELLED_ERROR_MESSAGE = 'Request cancelled by /stop.';
const STOPPED_ACTIVE_REQUEST_MESSAGE = 'Stopped active request.';
const NO_ACTIVE_REQUEST_MESSAGE = 'No active request to stop.';
const STEERING_ACTIVE_REQUEST_MESSAGE = 'Steering current response...';
const FOLLOWUP_QUEUED_MESSAGE = 'Queued as follow-up.';

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

function resolveDiscordIntentFlags(): number[] {
  const bits = (DiscordJs as any).GatewayIntentBits;
  if (bits && typeof bits === 'object') {
    return [bits.Guilds, bits.GuildMessages, bits.DirectMessages, bits.MessageContent]
      .filter((value): value is number => typeof value === 'number');
  }

  const legacyFlags = (DiscordJs as any).Intents?.FLAGS;
  if (legacyFlags && typeof legacyFlags === 'object') {
    return [
      legacyFlags.GUILDS,
      legacyFlags.GUILD_MESSAGES,
      legacyFlags.DIRECT_MESSAGES,
      legacyFlags.MESSAGE_CONTENT,
    ].filter((value): value is number => typeof value === 'number');
  }

  return [];
}

function resolveDiscordChannelPartial(): unknown {
  const partials = (DiscordJs as any).Partials;
  if (!partials || typeof partials !== 'object') {
    return undefined;
  }

  return partials.Channel ?? partials.CHANNEL;
}

export type GatewayProvider = (typeof GATEWAY_PROVIDERS)[number];

type ResolvedProfile = ReturnType<typeof resolveResourceProfile>;
type PiAgentSession = Awaited<ReturnType<typeof createAgentSession>>['session'];

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

interface TelegramSkillDefinition {
  name: string;
  description: string;
}

interface PiHelpDiscovery {
  commands: TelegramCommandDefinition[];
  skills: TelegramSkillDefinition[];
}

const MODEL_TELEGRAM_COMMANDS: TelegramCommandDefinition[] = [
  { command: 'model', description: 'Select model (usage: /model [search|provider/model])' },
  { command: 'models', description: 'Alias for /model' },
];

const MODEL_TELEGRAM_COMMAND_ALIASES = new Set(
  MODEL_TELEGRAM_COMMANDS.map((command) => `/${command.command}`),
);

function isModelCommand(command: string | undefined): boolean {
  if (!command) {
    return false;
  }

  return MODEL_TELEGRAM_COMMAND_ALIASES.has(command);
}

const DEFAULT_TELEGRAM_COMMANDS: TelegramCommandDefinition[] = [
  { command: 'new', description: 'Start a new session' },
  { command: 'status', description: 'Show gateway status' },
  { command: 'commands', description: 'List available commands' },
  { command: 'skills', description: 'List available skills' },
  { command: 'help', description: 'Show command help' },
  { command: 'skill', description: 'Load a skill (usage: /skill <name>)' },
  ...MODEL_TELEGRAM_COMMANDS,
  { command: 'stop', description: 'Stop active request' },
  { command: 'followup', description: 'Queue follow-up while current response runs' },
  { command: 'cancel', description: 'Cancel active model selection' },
  { command: 'compact', description: 'Compact context (TUI only in gateway mode)' },
  { command: 'resume', description: 'Resume help (gateway auto-resumes per chat)' },
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

function parsePiHelpSkills(helpText: string): TelegramSkillDefinition[] {
  const skills = new Map<string, TelegramSkillDefinition>();
  const lines = helpText.split('\n');

  for (const line of lines) {
    const match = line.match(/^\|\s*`([^`]+)`\s*\|\s*(.+?)\s*\|\s*$/);
    if (!match) {
      continue;
    }

    const name = match[1]?.trim();
    const description = toTelegramCommandDescription(match[2]?.trim() ?? '');
    if (!name) {
      continue;
    }

    if (!skills.has(name)) {
      skills.set(name, { name, description });
    }
  }

  return [...skills.values()];
}

function formatTelegramSkills(skills: TelegramSkillDefinition[]): string {
  if (skills.length === 0) {
    return [
      'No skills found for this profile.',
      '',
      'Tip: use /commands to see gateway and slash commands.',
    ].join('\n');
  }

  const lines = ['Available skills:'];

  for (const skill of skills) {
    lines.push(`- ${skill.name} - ${skill.description}`);
  }

  lines.push('');
  lines.push('Usage: /skill <name>');
  lines.push('Example: /skill tdd-feature');

  return lines.join('\n');
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

async function discoverPiHelpFromPi(options: {
  profile: ResolvedProfile;
  agentDir: string;
  cwd: string;
  sessionFile: string;
}): Promise<PiHelpDiscovery> {
  try {
    const helpText = await runPiPrintPrompt({
      prompt: '/help',
      sessionFile: options.sessionFile,
      profile: options.profile,
      agentDir: options.agentDir,
      cwd: options.cwd,
    });

    return {
      commands: parsePiHelpCommands(helpText),
      skills: parsePiHelpSkills(helpText),
    };
  } catch {
    return { commands: [], skills: [] };
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

// Parse SDK agent events and log chat flow details
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

  parseEvent(event: PiJsonEvent): void {
    this.handleEvent(event);
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

  private flushAssistantMessage(): void {
    if (!this.assistantTextBuffer.trim()) {
      return;
    }

    logAssistantMessage(this.source, this.userId, this.assistantTextBuffer.trim(), this.userName);
    this.assistantTextBuffer = '';
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
        this.flushAssistantMessage();
        break;
      }
      case 'agent_end': {
        // In case turn_end was missed or omitted.
        this.flushAssistantMessage();
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

function getProfileDefaultModel(profile: ResolvedProfile): string | undefined {
  const settings = profile.settingsFiles.length > 0
    ? mergeJsonFiles(profile.settingsFiles)
    : {};

  const provider = settings.defaultProvider;
  const model = settings.defaultModel;

  if (typeof provider === 'string' && typeof model === 'string') {
    return `${provider}/${model}`;
  }

  return undefined;
}

function parsePromptTemplateFrontmatter(content: string): {
  description?: string;
  content: string;
} {
  if (!content.startsWith('---')) {
    return { content: content.trim() };
  }

  const endIndex = content.indexOf('\n---', 3);
  if (endIndex === -1) {
    return { content: content.trim() };
  }

  const frontmatter = content.slice(4, endIndex);
  const remainingContent = content.slice(endIndex + 4).trim();

  let description: string | undefined;
  for (const line of frontmatter.split('\n')) {
    const match = line.match(/^(\w+):\s*(.*)$/);
    if (!match) {
      continue;
    }

    const key = match[1]?.trim().toLowerCase();
    const value = match[2]?.trim();
    if (key === 'description' && value) {
      description = value;
    }
  }

  return {
    description,
    content: remainingContent,
  };
}

function loadProfilePromptTemplates(profile: ResolvedProfile): PromptTemplate[] {
  const templates: PromptTemplate[] = [];

  for (const entry of profile.promptEntries) {
    try {
      const rawContent = readFileSync(entry, 'utf-8');
      const parsed = parsePromptTemplateFrontmatter(rawContent);
      const name = basename(entry, '.md');
      const firstLine = parsed.content.split('\n').find((line) => line.trim().length > 0)?.trim();

      let description = parsed.description;
      if (!description && firstLine) {
        description = firstLine.slice(0, 60) + (firstLine.length > 60 ? '...' : '');
      }

      templates.push({
        name,
        description: description ? `${description} (profile)` : '(profile)',
        content: parsed.content,
        source: '(profile)',
      });
    } catch {
      // Ignore unreadable prompt templates
    }
  }

  return templates;
}

function buildGatewaySettingsManager(profile: ResolvedProfile, cwd: string, agentDir: string): SettingsManager {
  const settingsManager = SettingsManager.create(cwd, agentDir);

  settingsManager.applyOverrides({
    skills: {
      enableCodexUser: false,
      enableClaudeUser: false,
      enableClaudeProject: false,
      enablePiUser: false,
      enablePiProject: false,
      customDirectories: profile.skillDirs,
    },
  });

  return settingsManager;
}

function createPersistentSessionManager(cwd: string, sessionFile: string): SessionManager {
  const sessionDir = resolve(sessionFile, '..');

  if (existsSync(sessionFile)) {
    return SessionManager.open(sessionFile, sessionDir);
  }

  const manager = SessionManager.create(cwd, sessionDir);
  manager.setSessionFile(sessionFile);
  return manager;
}

async function createGatewayAgentSession(options: {
  profile: ResolvedProfile;
  agentDir: string;
  cwd: string;
  sessionFile: string;
}): Promise<PiAgentSession> {
  const settingsManager = buildGatewaySettingsManager(options.profile, options.cwd, options.agentDir);
  const eventBus = createEventBus();
  const preloadedExtensions = await loadExtensions(options.profile.extensionEntries, options.cwd, eventBus);

  for (const { path, error } of preloadedExtensions.errors) {
    console.error(`Failed to load extension "${path}": ${error}`);
  }

  const { session } = await createAgentSession({
    cwd: options.cwd,
    agentDir: options.agentDir,
    sessionManager: createPersistentSessionManager(options.cwd, options.sessionFile),
    settingsManager,
    preloadedExtensions,
    promptTemplates: loadProfilePromptTemplates(options.profile),
  });

  return session;
}

function parseModelReference(model: string): { provider: string; modelId: string } | undefined {
  const trimmed = model.trim();
  const separatorIndex = trimmed.indexOf('/');

  if (separatorIndex <= 0 || separatorIndex >= trimmed.length - 1) {
    return undefined;
  }

  return {
    provider: trimmed.slice(0, separatorIndex),
    modelId: trimmed.slice(separatorIndex + 1),
  };
}

async function applyRequestedModel(session: PiAgentSession, model?: string): Promise<void> {
  if (!model) {
    return;
  }

  const parsed = parseModelReference(model);
  if (!parsed) {
    throw new Error(`Invalid model "${model}". Use format provider/model.`);
  }

  const resolvedModel = session.modelRegistry.find(parsed.provider, parsed.modelId);
  if (!resolvedModel) {
    throw new Error(`Model not found: ${parsed.provider}/${parsed.modelId}`);
  }

  const currentModel = session.model;
  if (currentModel && currentModel.provider === resolvedModel.provider && currentModel.id === resolvedModel.id) {
    return;
  }

  await session.setModel(resolvedModel);
}

function extractLatestAssistantText(messages: unknown): string {
  if (!Array.isArray(messages)) {
    return '';
  }

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index] as Record<string, unknown> | undefined;
    if (!message || message.role !== 'assistant') {
      continue;
    }

    const content = message.content;
    if (!Array.isArray(content)) {
      continue;
    }

    const textParts: string[] = [];
    for (const block of content) {
      const candidate = block as Record<string, unknown>;
      if (candidate?.type !== 'text') {
        continue;
      }

      const text = candidate.text;
      if (typeof text === 'string') {
        textParts.push(text);
      }
    }

    const joined = textParts.join('').trim();
    if (joined.length > 0) {
      return joined;
    }
  }

  return '';
}

async function listPiModels(options: {
  profile: ResolvedProfile;
  agentDir: string;
  cwd: string;
  search?: string;
}): Promise<string[]> {
  const settingsManager = buildGatewaySettingsManager(options.profile, options.cwd, options.agentDir);
  const { session } = await createAgentSession({
    cwd: options.cwd,
    agentDir: options.agentDir,
    sessionManager: SessionManager.inMemory(options.cwd),
    settingsManager,
    extensions: [],
    skills: [],
    promptTemplates: [],
    tools: [],
  });

  try {
    const search = options.search?.trim().toLowerCase();
    const seen = new Set<string>();
    const models: string[] = [];

    const availableModels = await session.getAvailableModels();
    for (const availableModel of availableModels) {
      const modelName = `${availableModel.provider}/${availableModel.id}`;
      if (seen.has(modelName)) {
        continue;
      }

      seen.add(modelName);
      if (!search || modelName.toLowerCase().includes(search)) {
        models.push(modelName);
      }
    }

    return models;
  } finally {
    session.dispose();
  }
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
  model?: string;
  abortSignal?: AbortSignal;
  logContext?: {
    source: string;
    userId: string;
    userName?: string;
  };
}

async function runPiPrintPrompt(options: RunPiPrintPromptOptions): Promise<string> {
  const configuredTimeoutMs = Number(process.env.PERSONAL_AGENT_PI_TIMEOUT_MS ?? DEFAULT_PI_TIMEOUT_MS);
  const timeoutMs = Number.isFinite(configuredTimeoutMs) && configuredTimeoutMs > 0
    ? Math.floor(configuredTimeoutMs)
    : DEFAULT_PI_TIMEOUT_MS;

  if (options.abortSignal?.aborted) {
    throw new Error(PROMPT_CANCELLED_ERROR_MESSAGE);
  }

  const session = await createGatewayAgentSession({
    profile: options.profile,
    agentDir: options.agentDir,
    cwd: options.cwd,
    sessionFile: options.sessionFile,
  });

  const parser = options.logContext
    ? new PiJsonStreamParser(options.logContext.source, options.logContext.userId, options.logContext.userName)
    : null;

  return new Promise((resolve, reject) => {
    let settled = false;
    let timeoutHandle: NodeJS.Timeout | undefined;
    let streamedOutput = '';

    const abortSignal = options.abortSignal;

    const unsubscribe = session.subscribe((event) => {
      const piEvent = event as unknown as PiJsonEvent;

      if (parser) {
        parser.parseEvent(piEvent);
      }

      if (piEvent.type === 'message_update' && piEvent.assistantMessageEvent?.type === 'text_delta') {
        const delta = piEvent.assistantMessageEvent.delta;
        if (typeof delta === 'string') {
          streamedOutput += delta;
        }
      }
    });

    const cleanup = () => {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
        timeoutHandle = undefined;
      }

      if (abortSignal) {
        abortSignal.removeEventListener('abort', onAbort);
      }

      unsubscribe();
      session.dispose();
    };

    const finalize = (resolver: () => void) => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      resolver();
    };

    const fail = (message: string) => {
      void (async () => {
        try {
          await session.abort();
        } catch {
          // Ignore abort failures and surface original failure message
        }

        if (parser && options.logContext) {
          logError(options.logContext.source, options.logContext.userId, message, options.logContext.userName);
        }

        finalize(() => reject(new Error(message)));
      })();
    };

    const onAbort = () => {
      fail(PROMPT_CANCELLED_ERROR_MESSAGE);
    };

    timeoutHandle = setTimeout(() => {
      fail(`pi timed out after ${timeoutMs}ms`);
    }, timeoutMs);

    if (abortSignal?.aborted) {
      fail(PROMPT_CANCELLED_ERROR_MESSAGE);
      return;
    }

    abortSignal?.addEventListener('abort', onAbort, { once: true });

    void (async () => {
      try {
        await applyRequestedModel(session, options.model);
        await session.prompt(options.prompt);

        const streamed = streamedOutput.trim();
        const fallback = extractLatestAssistantText(session.messages as unknown);
        const finalOutput = streamed.length > 0 ? streamed : fallback;

        finalize(() => resolve(finalOutput));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        finalize(() => reject(new Error(message)));
      }
    })();
  });
}

interface PersistentConversationControllerOptions {
  profile: ResolvedProfile;
  agentDir: string;
  cwd: string;
  sessionFile: string;
}

interface ActiveConversationRun {
  streamedOutput: string;
  parser?: PiJsonStreamParser;
  aborted: boolean;
  promise: Promise<string>;
}

function isLikelyStreamingTransitionError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  return normalized.includes('stream')
    || normalized.includes('processing')
    || normalized.includes('already')
    || normalized.includes('idle')
    || normalized.includes('pending');
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class PersistentConversationController implements GatewayConversationController {
  private readonly profile: ResolvedProfile;
  private readonly agentDir: string;
  private readonly cwd: string;
  private readonly sessionFile: string;

  private session?: PiAgentSession;
  private sessionPromise?: Promise<PiAgentSession>;
  private unsubscribe?: () => void;

  private activeRun?: ActiveConversationRun;
  private dispatchChain: Promise<void> = Promise.resolve();
  private disposed = false;

  constructor(options: PersistentConversationControllerOptions) {
    this.profile = options.profile;
    this.agentDir = options.agentDir;
    this.cwd = options.cwd;
    this.sessionFile = options.sessionFile;
  }

  async submitPrompt(input: RunPromptFnInput): Promise<ConversationSubmitResult> {
    this.ensureActive();

    if (!this.activeRun) {
      return {
        mode: 'started',
        run: this.startRun(input),
      };
    }

    const steered = await this.dispatchToActiveRun(input, 'steer');
    if (steered) {
      return { mode: 'steered' };
    }

    return {
      mode: 'started',
      run: this.startRun(input),
    };
  }

  async submitFollowUp(input: RunPromptFnInput): Promise<ConversationSubmitResult> {
    this.ensureActive();

    if (!this.activeRun) {
      return {
        mode: 'started',
        run: this.startRun(input),
      };
    }

    const queued = await this.dispatchToActiveRun(input, 'followup');
    if (queued) {
      return { mode: 'followup' };
    }

    return {
      mode: 'started',
      run: this.startRun(input),
    };
  }

  async abortCurrent(): Promise<boolean> {
    const activeRun = this.activeRun;
    if (!activeRun) {
      return false;
    }

    activeRun.aborted = true;

    try {
      const session = await this.getSession();
      await session.abort();
    } catch {
      // Ignore abort failures and rely on run state cleanup.
    }

    return true;
  }

  async waitForIdle(): Promise<void> {
    await this.dispatchChain;
    const run = this.activeRun?.promise;
    if (!run) {
      return;
    }

    await run.catch(() => {
      // waitForIdle is best-effort and should not throw.
    });
  }

  async dispose(): Promise<void> {
    if (this.disposed) {
      return;
    }

    this.disposed = true;

    await this.abortCurrent();
    await this.waitForIdle();

    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = undefined;
    }

    if (this.session) {
      this.session.dispose();
      this.session = undefined;
    }

    this.sessionPromise = undefined;
  }

  private ensureActive(): void {
    if (this.disposed) {
      throw new Error('Conversation is closed.');
    }
  }

  private startRun(input: RunPromptFnInput): Promise<string> {
    const activeRun: ActiveConversationRun = {
      streamedOutput: '',
      parser: input.logContext
        ? new PiJsonStreamParser(input.logContext.source, input.logContext.userId, input.logContext.userName)
        : undefined,
      aborted: false,
      promise: Promise.resolve(''),
    };

    const runPromise = this.executeRunWithTimeout(input, activeRun)
      .catch((error) => {
        if (activeRun.aborted) {
          throw new Error(PROMPT_CANCELLED_ERROR_MESSAGE);
        }

        throw error;
      })
      .finally(() => {
        if (this.activeRun === activeRun) {
          this.activeRun = undefined;
        }
      });

    activeRun.promise = runPromise;
    this.activeRun = activeRun;

    return runPromise;
  }

  private async executeRun(input: RunPromptFnInput, activeRun: ActiveConversationRun): Promise<string> {
    const session = await this.getSession();
    await applyRequestedModel(session, input.model);
    await session.prompt(input.prompt);

    const streamed = activeRun.streamedOutput.trim();
    const fallback = extractLatestAssistantText(session.messages as unknown);
    return streamed.length > 0 ? streamed : fallback;
  }

  private async executeRunWithTimeout(
    input: RunPromptFnInput,
    activeRun: ActiveConversationRun,
  ): Promise<string> {
    const configuredTimeoutMs = Number(process.env.PERSONAL_AGENT_PI_TIMEOUT_MS ?? DEFAULT_PI_TIMEOUT_MS);
    const timeoutMs = Number.isFinite(configuredTimeoutMs) && configuredTimeoutMs > 0
      ? Math.floor(configuredTimeoutMs)
      : DEFAULT_PI_TIMEOUT_MS;

    let timeoutHandle: NodeJS.Timeout | undefined;

    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          void this.getSession()
            .then(async (session) => session.abort())
            .catch(() => {
              // Ignore abort failures and surface timeout error.
            });

          reject(new Error(`pi timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      });

      return await Promise.race([
        this.executeRun(input, activeRun),
        timeoutPromise,
      ]);
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    }
  }

  private async dispatchToActiveRun(
    input: RunPromptFnInput,
    mode: 'steer' | 'followup',
  ): Promise<boolean> {
    let dispatched = false;

    const dispatchPromise = this.dispatchChain
      .then(async () => {
        dispatched = await this.dispatchToActiveRunInternal(input, mode);
      });

    this.dispatchChain = dispatchPromise.catch(() => {
      // Keep dispatch chain alive after failures.
    });

    await dispatchPromise;
    return dispatched;
  }

  private async dispatchToActiveRunInternal(
    input: RunPromptFnInput,
    mode: 'steer' | 'followup',
  ): Promise<boolean> {
    if (!this.activeRun) {
      return false;
    }

    const session = await this.getSession();
    const deadline = Date.now() + 2_000;

    while (this.activeRun) {
      try {
        if (mode === 'steer') {
          await session.steer(input.prompt);
        } else {
          await session.followUp(input.prompt);
        }

        return true;
      } catch (error) {
        if (!this.activeRun) {
          return false;
        }

        if (!isLikelyStreamingTransitionError(error) || Date.now() >= deadline) {
          throw error;
        }

        await delay(25);
      }
    }

    return false;
  }

  private async getSession(): Promise<PiAgentSession> {
    if (this.session) {
      return this.session;
    }

    if (this.sessionPromise) {
      return this.sessionPromise;
    }

    this.sessionPromise = createGatewayAgentSession({
      profile: this.profile,
      agentDir: this.agentDir,
      cwd: this.cwd,
      sessionFile: this.sessionFile,
    }).then((session) => {
      this.session = session;
      this.unsubscribe = session.subscribe((event) => {
        this.handleSessionEvent(event as unknown as PiJsonEvent);
      });
      return session;
    });

    return this.sessionPromise;
  }

  private handleSessionEvent(event: PiJsonEvent): void {
    const activeRun = this.activeRun;
    if (!activeRun) {
      return;
    }

    if (activeRun.parser) {
      activeRun.parser.parseEvent(event);
    }

    if (event.type === 'message_update' && event.assistantMessageEvent?.type === 'text_delta') {
      const delta = event.assistantMessageEvent.delta;
      if (typeof delta === 'string') {
        activeRun.streamedOutput += delta;
      }
    }
  }
}

function createPersistentConversationController(
  options: PersistentConversationControllerOptions,
): GatewayConversationController {
  return new PersistentConversationController(options);
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

  const runtimeBinDir = join(runtime.agentDir, 'bin');
  const pathEntries = (process.env.PATH ?? '').split(':').filter((entry) => entry.length > 0);
  if (!pathEntries.includes(runtimeBinDir)) {
    process.env.PATH = [runtimeBinDir, ...pathEntries].join(':');
  }

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

interface StoredTelegramPendingMessage {
  version: 1;
  storedAt: string;
  message: TelegramMessageLike;
}

interface LoadedTelegramPendingMessage {
  id: string;
  message: TelegramMessageLike;
}

function sanitizeTelegramPendingToken(token: string): string {
  return token.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function createTelegramPendingMessageId(message: TelegramMessageLike): string {
  const timestampToken = new Date().toISOString().replace(/[:.]/g, '-');
  const chatToken = sanitizeTelegramPendingToken(String(message.chat.id));
  const messageToken = typeof message.message_id === 'number'
    ? String(message.message_id)
    : `nomsg-${Math.floor(Math.random() * 1_000_000_000)}`;
  const nonce = Math.floor(Math.random() * 1_000_000_000).toString(36);

  return `${timestampToken}_${chatToken}_${messageToken}_${nonce}`;
}

function isTelegramMessageLike(value: unknown): value is TelegramMessageLike {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  const chat = candidate.chat as Record<string, unknown> | undefined;
  if (!chat || typeof chat.id !== 'number') {
    return false;
  }

  if (candidate.message_id !== undefined && typeof candidate.message_id !== 'number') {
    return false;
  }

  if (candidate.text !== undefined && typeof candidate.text !== 'string') {
    return false;
  }

  return true;
}

function storeTelegramPendingMessage(inboxDir: string, message: TelegramMessageLike): string {
  mkdirSync(inboxDir, { recursive: true });

  const id = createTelegramPendingMessageId(message);
  const payload: StoredTelegramPendingMessage = {
    version: 1,
    storedAt: new Date().toISOString(),
    message,
  };

  writeFileSync(join(inboxDir, `${id}.json`), `${JSON.stringify(payload)}\n`, 'utf-8');
  return id;
}

function loadTelegramPendingMessages(inboxDir: string): LoadedTelegramPendingMessage[] {
  if (!existsSync(inboxDir)) {
    return [];
  }

  const fileNames = readdirSync(inboxDir)
    .filter((entry) => entry.endsWith('.json'))
    .sort((a, b) => a.localeCompare(b));

  const recovered: LoadedTelegramPendingMessage[] = [];

  for (const fileName of fileNames) {
    const filePath = join(inboxDir, fileName);

    try {
      const raw = readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<StoredTelegramPendingMessage>;
      if (parsed.version !== 1 || !isTelegramMessageLike(parsed.message)) {
        throw new Error('invalid message payload');
      }

      recovered.push({
        id: fileName.slice(0, -'.json'.length),
        message: parsed.message,
      });
    } catch (error) {
      console.warn(gatewayWarning(`Dropping unreadable telegram pending message ${fileName}: ${(error as Error).message}`));
      try {
        unlinkSync(filePath);
      } catch {
        // Best-effort cleanup for bad files.
      }
    }
  }

  return recovered;
}

function acknowledgeTelegramPendingMessage(inboxDir: string, id: string): void {
  const filePath = join(inboxDir, `${id}.json`);
  if (!existsSync(filePath)) {
    return;
  }

  unlinkSync(filePath);
}

interface RetryAsyncOptions {
  operationName: string;
  attempts: number;
  baseDelayMs: number;
  shouldRetry: (error: unknown) => boolean;
}

function getTelegramErrorStatusCode(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') {
    return undefined;
  }

  const candidate = error as {
    response?: {
      statusCode?: number;
    };
  };

  return candidate.response?.statusCode;
}

function getTelegramRetryAfterMs(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') {
    return undefined;
  }

  const candidate = error as {
    response?: {
      body?: {
        parameters?: {
          retry_after?: number;
        };
      };
    };
  };

  const retryAfterSeconds = candidate.response?.body?.parameters?.retry_after;
  if (typeof retryAfterSeconds !== 'number' || !Number.isFinite(retryAfterSeconds) || retryAfterSeconds < 0) {
    return undefined;
  }

  return Math.floor(retryAfterSeconds * 1000);
}

function isRetriableTelegramApiError(error: unknown): boolean {
  const statusCode = getTelegramErrorStatusCode(error);
  if (typeof statusCode === 'number') {
    if (statusCode === 408 || statusCode === 429 || statusCode >= 500) {
      return true;
    }

    if (statusCode >= 400 && statusCode < 500) {
      return false;
    }
  }

  const candidate = error as { code?: unknown; message?: unknown } | undefined;
  const code = typeof candidate?.code === 'string' ? candidate.code.toUpperCase() : '';
  const retriableCodes = new Set(['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ENOTFOUND', 'ECONNREFUSED', 'EPIPE']);
  if (retriableCodes.has(code)) {
    return true;
  }

  const message = typeof candidate?.message === 'string'
    ? candidate.message.toLowerCase()
    : String(error).toLowerCase();

  return message.includes('socket hang up')
    || message.includes('network')
    || message.includes('timeout')
    || message.includes('temporarily unavailable')
    || message.includes('too many requests');
}

async function retryAsync<T>(operation: () => Promise<T>, options: RetryAsyncOptions): Promise<T> {
  const attempts = Math.max(1, options.attempts);

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= attempts || !options.shouldRetry(error)) {
        throw error;
      }

      const retryAfterMs = getTelegramRetryAfterMs(error) ?? 0;
      const exponentialBackoffMs = options.baseDelayMs * (2 ** (attempt - 1));
      const delayMs = Math.max(exponentialBackoffMs, retryAfterMs);
      const errorMessage = error instanceof Error ? error.message : String(error);

      console.warn(
        gatewayWarning(
          `${options.operationName} failed (attempt ${attempt}/${attempts}): ${errorMessage}. Retrying in ${delayMs}ms.`,
        ),
      );

      await delay(delayMs);
    }
  }

  throw new Error(`${options.operationName} failed after ${attempts} attempts`);
}

function startTypingHeartbeat(sendTyping: () => Promise<unknown>): () => void {
  let stopped = false;
  let sending = false;

  const dispatchTyping = async (): Promise<void> => {
    if (stopped || sending) {
      return;
    }

    sending = true;
    try {
      await sendTyping();
    } catch {
      // Ignore typing indicator failures.
    } finally {
      sending = false;
    }
  };

  void dispatchTyping();

  const interval = setInterval(() => {
    void dispatchTyping();
  }, TYPING_HEARTBEAT_INTERVAL_MS);

  return () => {
    stopped = true;
    clearInterval(interval);
  };
}

function resolveModelFromInput(input: string, models: string[]): string | undefined {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  if (/^\d+$/.test(trimmed)) {
    const index = Number(trimmed);
    if (!Number.isFinite(index) || index <= 0) {
      return undefined;
    }

    return models[index - 1];
  }

  const exactMatch = models.find((model) => model.toLowerCase() === trimmed.toLowerCase());
  if (exactMatch) {
    return exactMatch;
  }

  if (trimmed.includes('/')) {
    return trimmed;
  }

  return undefined;
}

function formatModelSelectionPrompt(options: {
  models: string[];
  search?: string;
  total: number;
}): string {
  const heading = options.search
    ? `Available models matching "${options.search}":`
    : 'Available models:';

  const lines = [heading];

  for (const [index, model] of options.models.entries()) {
    lines.push(`${index + 1}. ${model}`);
  }

  if (options.total > options.models.length) {
    lines.push(`...and ${options.total - options.models.length} more.`);
    lines.push('Use /model <search> to narrow the results.');
  }

  lines.push('');
  lines.push('Reply with a number (for example: 2) or /model <provider/model>.');
  lines.push('Send /cancel to cancel model selection.');

  return lines.join('\n');
}

function truncateTelegramButtonLabel(text: string, maxLength = 56): string {
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength - 1)}…`;
}

function buildTelegramModelSelectionOptions(models: string[]): TelegramSendMessageOptions {
  const inlineKeyboard: TelegramInlineKeyboardButton[][] = models.map((model, index) => [
    {
      text: truncateTelegramButtonLabel(`${index + 1}. ${model}`),
      callback_data: `${TELEGRAM_MODEL_SELECTION_CALLBACK_PREFIX}${index + 1}`,
    },
  ]);

  inlineKeyboard.push([
    {
      text: 'Cancel',
      callback_data: `${TELEGRAM_MODEL_SELECTION_CALLBACK_PREFIX}cancel`,
    },
  ]);

  return {
    reply_markup: {
      inline_keyboard: inlineKeyboard,
    },
  };
}

function parseTelegramModelSelectionCallback(data: string): string | undefined {
  if (!data.startsWith(TELEGRAM_MODEL_SELECTION_CALLBACK_PREFIX)) {
    return undefined;
  }

  const value = data.slice(TELEGRAM_MODEL_SELECTION_CALLBACK_PREFIX.length).trim();
  if (value.length === 0) {
    return undefined;
  }

  if (value === 'cancel') {
    return '/cancel';
  }

  if (!/^\d+$/.test(value)) {
    return undefined;
  }

  return value;
}

function clearPendingModelSelection(
  support: ModelCommandSupport | undefined,
  conversationId: string,
): void {
  support?.pendingSelectionsByConversation.delete(conversationId);
}

interface HandleModelCommandOptions {
  conversationId: string;
  conversationLabel: 'chat' | 'channel';
  command?: string;
  args: string;
  normalizedText: string;
  modelCommands?: ModelCommandSupport;
  sendMessage: SendTextFn;
  sendModelSelectionPrompt?: (promptText: string, models: string[]) => Promise<void>;
}

async function handleModelCommand(options: HandleModelCommandOptions): Promise<boolean> {
  const support = options.modelCommands;
  if (!support) {
    return false;
  }

  const pending = support.pendingSelectionsByConversation.get(options.conversationId);

  if (options.command === '/cancel') {
    if (pending) {
      support.pendingSelectionsByConversation.delete(options.conversationId);
      await options.sendMessage('Cancelled model selection.');
      return true;
    }

    await options.sendMessage('No active model selection. Use /model to list models.');
    return true;
  }

  if (pending && !options.command) {
    const selectedModel = resolveModelFromInput(options.normalizedText, pending.models);
    if (!selectedModel) {
      await options.sendMessage(
        'Invalid model selection. Reply with a number from the list, '
        + 'or send /model to refresh, or /cancel to cancel.',
      );
      return true;
    }

    support.pendingSelectionsByConversation.delete(options.conversationId);
    support.activeModelsByConversation.set(options.conversationId, selectedModel);
    await options.sendMessage(`Model set to ${selectedModel} for this ${options.conversationLabel}.`);
    return true;
  }

  if (pending && options.command && !isModelCommand(options.command)) {
    support.pendingSelectionsByConversation.delete(options.conversationId);
  }

  if (!isModelCommand(options.command)) {
    return false;
  }

  const args = options.args.trim();

  if (args.includes('/')) {
    clearPendingModelSelection(support, options.conversationId);
    support.activeModelsByConversation.set(options.conversationId, args);
    await options.sendMessage(`Model set to ${args} for this ${options.conversationLabel}.`);
    return true;
  }

  if (/^\d+$/.test(args)) {
    let selectedModel = pending
      ? resolveModelFromInput(args, pending.models)
      : undefined;

    if (!selectedModel) {
      try {
        const availableModels = await support.listModels();
        selectedModel = resolveModelFromInput(args, availableModels);
      } catch (error) {
        await options.sendMessage(`Error listing models: ${(error as Error).message}`);
        return true;
      }
    }

    if (!selectedModel) {
      await options.sendMessage(
        'Selection number not found. Run /model to list models, '
        + 'or use /model <provider/model> to set one directly.',
      );
      return true;
    }

    clearPendingModelSelection(support, options.conversationId);
    support.activeModelsByConversation.set(options.conversationId, selectedModel);
    await options.sendMessage(`Model set to ${selectedModel} for this ${options.conversationLabel}.`);
    return true;
  }

  const search = args.length > 0 ? args : undefined;

  try {
    const availableModels = await support.listModels(search);
    if (availableModels.length === 0) {
      const suffix = search ? ` matching "${search}"` : '';
      await options.sendMessage(`No models found${suffix}.`);
      return true;
    }

    if (availableModels.length === 1) {
      const selectedModel = availableModels[0] as string;
      clearPendingModelSelection(support, options.conversationId);
      support.activeModelsByConversation.set(options.conversationId, selectedModel);
      await options.sendMessage(`Model set to ${selectedModel} for this ${options.conversationLabel}.`);
      return true;
    }

    const selectionLimit = support.selectionLimit ?? DEFAULT_MODEL_SELECTION_LIMIT;
    const modelsForSelection = availableModels.slice(0, selectionLimit);

    support.pendingSelectionsByConversation.set(options.conversationId, {
      models: modelsForSelection,
      search,
    });

    const pickerText = formatModelSelectionPrompt({
      models: modelsForSelection,
      search,
      total: availableModels.length,
    });

    if (options.sendModelSelectionPrompt) {
      await options.sendModelSelectionPrompt(pickerText, modelsForSelection);
      return true;
    }

    await sendLongText(options.sendMessage, pickerText);
    return true;
  } catch (error) {
    await options.sendMessage(`Error listing models: ${(error as Error).message}`);
    return true;
  }
}

async function getOrCreateConversationController(
  controllers: Map<string, Promise<GatewayConversationController>>,
  conversationId: string,
  sessionFile: string,
  createConversationController: CreateConversationControllerFn,
): Promise<GatewayConversationController> {
  const existing = controllers.get(conversationId);
  if (existing) {
    return existing;
  }

  const controllerPromise = Promise.resolve(createConversationController({
    conversationId,
    sessionFile,
  }));

  controllers.set(conversationId, controllerPromise);

  try {
    return await controllerPromise;
  } catch (error) {
    controllers.delete(conversationId);
    throw error;
  }
}

async function disposeConversationController(
  controllers: Map<string, Promise<GatewayConversationController>>,
  conversationId: string,
): Promise<void> {
  const controllerPromise = controllers.get(conversationId);
  if (!controllerPromise) {
    return;
  }

  controllers.delete(conversationId);

  try {
    const controller = await controllerPromise;
    await controller.dispose();
  } catch {
    // best-effort cleanup
  }
}

async function processTelegramMessage(
  options: CreateTelegramMessageHandlerOptions,
  message: TelegramMessageLike,
  controllers: Map<string, Promise<GatewayConversationController>>,
  registerRunTask: (task: Promise<void>) => void,
): Promise<MessageProcessingResult> {
  const chatId = String(message.chat.id);

  if (!options.allowlist.has(chatId)) {
    await options.sendMessage(message.chat.id, 'This chat is not allowed.');
    return completedMessageProcessingResult();
  }

  const text = message.text?.trim();
  if (!text) {
    await options.sendMessage(message.chat.id, 'Please send text messages only.');
    return completedMessageProcessingResult();
  }

  const fullName = [message.from?.first_name, message.from?.last_name].filter(Boolean).join(' ');
  const userName = message.from?.username ?? (fullName || undefined);

  logIncomingMessage('telegram', chatId, userName, text);

  const sessionFile = join(options.telegramSessionDir, `${chatId}.jsonl`);
  const sessionFileExists = options.sessionFileExists ?? existsSync;
  const removeSessionFile = options.removeSessionFile ?? ((path: string) => rm(path, { force: true }));

  const normalized = normalizeTelegramCommandText(text);
  const command = normalized.command;

  const modelCommandHandled = await handleModelCommand({
    conversationId: chatId,
    conversationLabel: 'chat',
    command,
    args: normalized.args,
    normalizedText: normalized.normalizedText,
    modelCommands: options.modelCommands,
    sendMessage: (messageText) => options.sendMessage(message.chat.id, messageText),
    sendModelSelectionPrompt: async (promptText, models) => {
      await options.sendMessage(
        message.chat.id,
        promptText,
        buildTelegramModelSelectionOptions(models),
      );
    },
  });

  if (modelCommandHandled) {
    return completedMessageProcessingResult();
  }

  if (command === '/new') {
    await disposeConversationController(controllers, chatId);

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
    return completedMessageProcessingResult();
  }

  if (command === '/status') {
    const activeModel = options.modelCommands?.activeModelsByConversation.get(chatId);
    const configuredModel = options.modelCommands?.defaultModel;
    const model = activeModel ?? configuredModel ?? '(pi default)';

    await options.sendMessage(
      message.chat.id,
      `profile=${options.profileName}
agentDir=${options.agentDir}
session=${sessionFile}
model=${model}`,
    );
    return completedMessageProcessingResult();
  }

  if (command === '/resume') {
    await options.sendMessage(
      message.chat.id,
      'Gateway sessions already resume automatically per chat. Use /new to start a fresh session.',
    );
    return completedMessageProcessingResult();
  }

  if (command === '/compact') {
    await options.sendMessage(
      message.chat.id,
      'Manual /compact is not supported in gateway print mode yet. Open this session in Pi TUI to compact.',
    );
    return completedMessageProcessingResult();
  }

  if (command === '/commands') {
    const commandHelp = options.commandHelpText
      ?? formatTelegramCommands(DEFAULT_TELEGRAM_COMMANDS);
    await sendLongText((chunk) => options.sendMessage(message.chat.id, chunk), commandHelp);
    return completedMessageProcessingResult();
  }

  if (command === '/skills') {
    const skillsHelp = options.skillsHelpText ?? formatTelegramSkills([]);
    await sendLongText((chunk) => options.sendMessage(message.chat.id, chunk), skillsHelp);
    return completedMessageProcessingResult();
  }

  if (command === '/stop') {
    const controllerPromise = controllers.get(chatId);
    if (!controllerPromise) {
      await options.sendMessage(message.chat.id, NO_ACTIVE_REQUEST_MESSAGE);
      return completedMessageProcessingResult();
    }

    const controller = await controllerPromise;
    const aborted = await controller.abortCurrent();
    if (aborted) {
      await options.sendMessage(message.chat.id, STOPPED_ACTIVE_REQUEST_MESSAGE);
      return completedMessageProcessingResult();
    }

    await options.sendMessage(message.chat.id, NO_ACTIVE_REQUEST_MESSAGE);
    return completedMessageProcessingResult();
  }

  let prompt = normalized.normalizedText;
  if (command === '/skill') {
    if (normalized.args.length === 0) {
      await options.sendMessage(message.chat.id, 'Usage: /skill <name>\nExample: /skill tdd-feature');
      return completedMessageProcessingResult();
    }

    prompt = `/skill:${normalized.args}`;
  } else if (command === '/followup') {
    if (normalized.args.length === 0) {
      await options.sendMessage(message.chat.id, 'Usage: /followup <message>');
      return completedMessageProcessingResult();
    }

    prompt = normalized.args;
  }

  const controller = await getOrCreateConversationController(
    controllers,
    chatId,
    sessionFile,
    options.createConversationController,
  );

  const submissionInput: RunPromptFnInput = {
    prompt,
    sessionFile,
    cwd: options.workingDirectory,
    model: options.modelCommands?.activeModelsByConversation.get(chatId),
    logContext: {
      source: 'telegram',
      userId: chatId,
      userName,
    },
  };

  const submission = command === '/followup'
    ? await controller.submitFollowUp(submissionInput)
    : await controller.submitPrompt(submissionInput);

  if (submission.mode === 'started') {
    const stopTypingHeartbeat = startTypingHeartbeat(() => options.sendChatAction(message.chat.id, 'typing'));

    const runTask = submission.run
      .then(async (output) => {
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
      })
      .catch(async (error) => {
        const errorMessage = (error as Error).message;

        if (errorMessage === PROMPT_CANCELLED_ERROR_MESSAGE) {
          return;
        }

        await emitDaemonEventNonFatal({
          type: 'session.processing.failed',
          source: 'gateway',
          payload: {
            sessionFile,
            profile: options.profileName,
            cwd: options.workingDirectory,
            chatId,
            message: errorMessage,
          },
        });

        await options.sendMessage(message.chat.id, `Error: ${errorMessage}`);
      })
      .finally(() => {
        stopTypingHeartbeat();
      });

    registerRunTask(runTask);
    return { completion: runTask };
  }

  if (submission.mode === 'steered') {
    await options.sendMessage(message.chat.id, STEERING_ACTIVE_REQUEST_MESSAGE);
    return completedMessageProcessingResult();
  }

  await options.sendMessage(message.chat.id, FOLLOWUP_QUEUED_MESSAGE);
  return completedMessageProcessingResult();
}

export function createQueuedTelegramMessageHandler(
  options: CreateTelegramMessageHandlerOptions,
): QueuedTelegramMessageHandler {
  const chatQueue = new Map<string, Promise<void>>();
  const pendingPerChat = new Map<string, number>();
  const controllers = new Map<string, Promise<GatewayConversationController>>();
  const runTasks = new Map<string, Set<Promise<void>>>();
  const latestMessageIdByChat = new Map<string, number>();
  const maxPendingPerChat = options.maxPendingPerChat ?? DEFAULT_MAX_PENDING_PER_CHAT;
  const durableInboxDir = options.durableInboxDir;

  if (durableInboxDir) {
    mkdirSync(durableInboxDir, { recursive: true });
  }

  const acknowledgePendingMessage = (pendingMessageId: string | undefined): void => {
    if (!pendingMessageId || !durableInboxDir) {
      return;
    }

    try {
      acknowledgeTelegramPendingMessage(durableInboxDir, pendingMessageId);
    } catch (error) {
      console.error(`[telegram] failed to acknowledge durable message ${pendingMessageId}:`, error);
    }
  };

  const trackRunTask = (chatId: string, task: Promise<void>): void => {
    const existing = runTasks.get(chatId) ?? new Set<Promise<void>>();
    existing.add(task);
    runTasks.set(chatId, existing);

    void task.finally(() => {
      const tasksForChat = runTasks.get(chatId);
      if (!tasksForChat) {
        return;
      }

      tasksForChat.delete(task);
      if (tasksForChat.size === 0) {
        runTasks.delete(chatId);
      }
    });
  };

  const waitForRunTasks = async (chatId?: string): Promise<void> => {
    if (chatId) {
      let tasksForChat = runTasks.get(chatId);
      while (tasksForChat && tasksForChat.size > 0) {
        await Promise.allSettled([...tasksForChat]);
        tasksForChat = runTasks.get(chatId);
      }
      return;
    }

    while (runTasks.size > 0) {
      const allTasks = [...runTasks.values()].flatMap((tasksForChat) => [...tasksForChat]);
      if (allTasks.length === 0) {
        return;
      }

      await Promise.allSettled(allTasks);
    }
  };

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

  const queueMessage = (
    message: TelegramMessageLike,
    pendingMessageId?: string,
    bypassPendingLimit = false,
  ): boolean => {
    const chatId = String(message.chat.id);

    if (typeof message.message_id === 'number') {
      const latestMessageId = latestMessageIdByChat.get(chatId);
      if (latestMessageId !== undefined && message.message_id <= latestMessageId) {
        acknowledgePendingMessage(pendingMessageId);
        return false;
      }

      latestMessageIdByChat.set(chatId, message.message_id);
    }

    const pending = pendingPerChat.get(chatId) ?? 0;

    if (!bypassPendingLimit && pending >= maxPendingPerChat) {
      void options.sendMessage(
        message.chat.id,
        `Too many pending messages for this chat (limit: ${maxPendingPerChat}). Please wait and try again.`,
      );
      acknowledgePendingMessage(pendingMessageId);
      return false;
    }

    pendingPerChat.set(chatId, pending + 1);

    enqueue(chatId, async () => {
      try {
        const processing = await processTelegramMessage(
          options,
          message,
          controllers,
          (task) => trackRunTask(chatId, task),
        );

        if (pendingMessageId && durableInboxDir) {
          void processing.completion
            .then(() => {
              acknowledgePendingMessage(pendingMessageId);
            })
            .catch((error) => {
              console.error(
                `[telegram:${chatId}] durable message ${pendingMessageId} not acknowledged; will retry after restart:`,
                error,
              );
            });
        }
      } finally {
        const nextPending = (pendingPerChat.get(chatId) ?? 1) - 1;
        if (nextPending <= 0) {
          pendingPerChat.delete(chatId);
        } else {
          pendingPerChat.set(chatId, nextPending);
        }
      }
    });

    return true;
  };

  return {
    handleMessage(message: TelegramMessageLike): void {
      const chatId = String(message.chat.id);
      let pendingMessageId: string | undefined;

      if (durableInboxDir) {
        try {
          pendingMessageId = storeTelegramPendingMessage(durableInboxDir, message);
        } catch (error) {
          console.error(`[telegram:${chatId}] failed to store durable inbox message:`, error);
        }
      }

      const accepted = queueMessage(message, pendingMessageId);
      if (!accepted) {
        acknowledgePendingMessage(pendingMessageId);
      }
    },

    replayPendingMessages(): number {
      if (!durableInboxDir) {
        return 0;
      }

      const pendingMessages = loadTelegramPendingMessages(durableInboxDir);
      for (const pendingMessage of pendingMessages) {
        queueMessage(pendingMessage.message, pendingMessage.id, true);
      }

      return pendingMessages.length;
    },

    async waitForIdle(chatId?: string): Promise<void> {
      if (chatId) {
        await (chatQueue.get(chatId) ?? Promise.resolve());
        const controllerPromise = controllers.get(chatId);
        if (controllerPromise) {
          const controller = await controllerPromise;
          await controller.waitForIdle();
        }

        await waitForRunTasks(chatId);
        return;
      }

      await Promise.all([...chatQueue.values()]);

      const allControllers = await Promise.all([...controllers.values()]);
      await Promise.all(allControllers.map(async (controller) => controller.waitForIdle()));
      await waitForRunTasks();
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

  const telegramDurableInboxDir = join(statePaths.root, 'gateway', 'pending', 'telegram');
  await mkdir(telegramDurableInboxDir, { recursive: true });

  const bot = new TelegramBot(effectiveConfig.token, { polling: true });

  const maxPendingPerChat = effectiveConfig.maxPendingPerChat ?? DEFAULT_MAX_PENDING_PER_CHAT;
  const telegramRetryAttempts = toPositiveInteger(process.env.PERSONAL_AGENT_TELEGRAM_RETRY_ATTEMPTS)
    ?? DEFAULT_TELEGRAM_RETRY_ATTEMPTS;
  const telegramRetryBaseDelayMs = toPositiveInteger(process.env.PERSONAL_AGENT_TELEGRAM_RETRY_BASE_DELAY_MS)
    ?? DEFAULT_TELEGRAM_RETRY_BASE_DELAY_MS;

  const withTelegramRetry = async <T>(
    operationName: string,
    operation: () => Promise<T>,
  ): Promise<T> => retryAsync(operation, {
    operationName,
    attempts: telegramRetryAttempts,
    baseDelayMs: telegramRetryBaseDelayMs,
    shouldRetry: isRetriableTelegramApiError,
  });

  const discoveredHelp = await discoverPiHelpFromPi({
    profile: resolvedProfile,
    agentDir: runtime.agentDir,
    cwd: effectiveConfig.workingDirectory,
    sessionFile: join(telegramSessionDir, '__commands__.jsonl'),
  });
  const telegramCommands = mergeTelegramCommands(DEFAULT_TELEGRAM_COMMANDS, discoveredHelp.commands);
  const commandHelpText = formatTelegramCommands(telegramCommands);
  const skillsHelpText = formatTelegramSkills(discoveredHelp.skills);

  const modelCommands: ModelCommandSupport = {
    listModels: (search) => listPiModels({
      profile: resolvedProfile,
      agentDir: runtime.agentDir,
      cwd: effectiveConfig.workingDirectory,
      search,
    }),
    activeModelsByConversation: new Map(),
    pendingSelectionsByConversation: new Map(),
    defaultModel: getProfileDefaultModel(resolvedProfile),
  };

  try {
    await withTelegramRetry('telegram.setMyCommands', () => bot.setMyCommands(telegramCommands));
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
    durableInboxDir: telegramDurableInboxDir,
    commandHelpText,
    skillsHelpText,
    modelCommands,
    sendMessage: (chatId, text, options) => withTelegramRetry(
      `telegram.sendMessage chat=${chatId}`,
      () => bot.sendMessage(chatId, text, options),
    ),
    sendChatAction: (chatId, action) => withTelegramRetry(
      `telegram.sendChatAction chat=${chatId} action=${action}`,
      () => bot.sendChatAction(chatId, action),
    ),
    createConversationController: ({ sessionFile }) => createPersistentConversationController({
      profile: resolvedProfile,
      agentDir: runtime.agentDir,
      cwd: effectiveConfig.workingDirectory,
      sessionFile,
    }),
  });

  bot.on('message', handler.handleMessage);

  bot.on('polling_error', (error: unknown) => {
    console.error(gatewayWarning(`Telegram polling error: ${error instanceof Error ? error.message : String(error)}`));
  });

  bot.on('callback_query', (query: any) => {
    void (async () => {
      const callbackId = query.id;
      const callbackData = query.data;
      const callbackMessage = query.message;

      if (!callbackData || !callbackMessage) {
        await withTelegramRetry('telegram.answerCallbackQuery', () => bot.answerCallbackQuery(callbackId));
        return;
      }

      const callbackText = parseTelegramModelSelectionCallback(callbackData);
      if (!callbackText) {
        await withTelegramRetry('telegram.answerCallbackQuery', () => bot.answerCallbackQuery(callbackId));
        return;
      }

      handler.handleMessage({
        chat: { id: callbackMessage.chat.id },
        message_id: callbackMessage.message_id,
        text: callbackText,
        from: query.from
          ? {
            id: query.from.id,
            username: query.from.username,
            first_name: query.from.first_name,
            last_name: query.from.last_name,
          }
          : undefined,
      });

      await withTelegramRetry('telegram.answerCallbackQuery', () => bot.answerCallbackQuery(callbackId));
    })().catch((error) => {
      console.error('Telegram callback handling failed:', error);
    });
  });

  const recoveredPendingMessages = handler.replayPendingMessages();
  if (recoveredPendingMessages > 0) {
    console.log(gatewayWarning(`Recovered ${recoveredPendingMessages} pending telegram message(s) from durable inbox.`));
    logSystem('telegram', `Recovered ${recoveredPendingMessages} pending message(s) from durable inbox`);
  }

  console.log(gatewaySuccess(`Telegram bridge started (profile=${effectiveConfig.profile})`));
  console.log(gatewayKeyValue('Allowed chats', [...effectiveConfig.allowlist].join(', ')));
  console.log(gatewayKeyValue('Working directory', effectiveConfig.workingDirectory));
  console.log(gatewayKeyValue('Registered commands', telegramCommands.length));
  logSystem('telegram', `Bridge started for profile=${effectiveConfig.profile}`);
}

async function processDiscordMessage(
  options: CreateDiscordMessageHandlerOptions,
  message: DiscordMessageLike,
  controllers: Map<string, Promise<GatewayConversationController>>,
  registerRunTask: (task: Promise<void>) => void,
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

  logIncomingMessage('discord', channelId, message.authorUsername, text);

  const sessionFile = join(options.discordSessionDir, `${channelId}.jsonl`);
  const sessionFileExists = options.sessionFileExists ?? existsSync;
  const removeSessionFile = options.removeSessionFile ?? ((path: string) => rm(path, { force: true }));

  const normalized = normalizeTelegramCommandText(text);
  const command = normalized.command;

  const modelCommandHandled = await handleModelCommand({
    conversationId: channelId,
    conversationLabel: 'channel',
    command,
    args: normalized.args,
    normalizedText: normalized.normalizedText,
    modelCommands: options.modelCommands,
    sendMessage: message.sendMessage,
  });

  if (modelCommandHandled) {
    return;
  }

  if (command === '/new') {
    await disposeConversationController(controllers, channelId);

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

  if (command === '/status') {
    const activeModel = options.modelCommands?.activeModelsByConversation.get(channelId);
    const configuredModel = options.modelCommands?.defaultModel;
    const model = activeModel ?? configuredModel ?? '(pi default)';

    await message.sendMessage(
      `profile=${options.profileName}
agentDir=${options.agentDir}
session=${sessionFile}
model=${model}`,
    );
    return;
  }

  if (command === '/resume') {
    await message.sendMessage(
      'Gateway sessions already resume automatically per channel. Use /new to start a fresh session.',
    );
    return;
  }

  if (command === '/compact') {
    await message.sendMessage(
      'Manual /compact is not supported in gateway print mode yet. Open this session in Pi TUI to compact.',
    );
    return;
  }

  if (command === '/commands') {
    const commandHelp = options.commandHelpText
      ?? formatTelegramCommands(DEFAULT_TELEGRAM_COMMANDS);
    await sendLongText(message.sendMessage, commandHelp);
    return;
  }

  if (command === '/skills') {
    const skillsHelp = options.skillsHelpText ?? formatTelegramSkills([]);
    await sendLongText(message.sendMessage, skillsHelp);
    return;
  }

  if (command === '/stop') {
    const controllerPromise = controllers.get(channelId);
    if (!controllerPromise) {
      await message.sendMessage(NO_ACTIVE_REQUEST_MESSAGE);
      return;
    }

    const controller = await controllerPromise;
    const aborted = await controller.abortCurrent();
    if (aborted) {
      await message.sendMessage(STOPPED_ACTIVE_REQUEST_MESSAGE);
      return;
    }

    await message.sendMessage(NO_ACTIVE_REQUEST_MESSAGE);
    return;
  }

  let prompt = normalized.normalizedText;
  if (command === '/skill') {
    if (normalized.args.length === 0) {
      await message.sendMessage('Usage: /skill <name>\nExample: /skill tdd-feature');
      return;
    }

    prompt = `/skill:${normalized.args}`;
  } else if (command === '/followup') {
    if (normalized.args.length === 0) {
      await message.sendMessage('Usage: /followup <message>');
      return;
    }

    prompt = normalized.args;
  }

  const controller = await getOrCreateConversationController(
    controllers,
    channelId,
    sessionFile,
    options.createConversationController,
  );

  const submissionInput: RunPromptFnInput = {
    prompt,
    sessionFile,
    cwd: options.workingDirectory,
    model: options.modelCommands?.activeModelsByConversation.get(channelId),
    logContext: {
      source: 'discord',
      userId: channelId,
      userName: message.authorUsername,
    },
  };

  const submission = command === '/followup'
    ? await controller.submitFollowUp(submissionInput)
    : await controller.submitPrompt(submissionInput);

  if (submission.mode === 'started') {
    const stopTypingHeartbeat = startTypingHeartbeat(message.sendTyping);

    const runTask = submission.run
      .then(async (output) => {
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
      })
      .catch(async (error) => {
        const errorMessage = (error as Error).message;

        if (errorMessage === PROMPT_CANCELLED_ERROR_MESSAGE) {
          return;
        }

        await emitDaemonEventNonFatal({
          type: 'session.processing.failed',
          source: 'gateway',
          payload: {
            sessionFile,
            profile: options.profileName,
            cwd: options.workingDirectory,
            channelId,
            message: errorMessage,
          },
        });

        await message.sendMessage(`Error: ${errorMessage}`);
      })
      .finally(() => {
        stopTypingHeartbeat();
      });

    registerRunTask(runTask);
    return;
  }

  if (submission.mode === 'steered') {
    await message.sendMessage(STEERING_ACTIVE_REQUEST_MESSAGE);
    return;
  }

  await message.sendMessage(FOLLOWUP_QUEUED_MESSAGE);
}

export function createQueuedDiscordMessageHandler(
  options: CreateDiscordMessageHandlerOptions,
): QueuedDiscordMessageHandler {
  const channelQueue = new Map<string, Promise<void>>();
  const pendingPerChannel = new Map<string, number>();
  const controllers = new Map<string, Promise<GatewayConversationController>>();
  const runTasks = new Map<string, Set<Promise<void>>>();
  const maxPendingPerChannel = options.maxPendingPerChannel ?? DEFAULT_MAX_PENDING_PER_CHANNEL;

  const trackRunTask = (channelId: string, task: Promise<void>): void => {
    const existing = runTasks.get(channelId) ?? new Set<Promise<void>>();
    existing.add(task);
    runTasks.set(channelId, existing);

    void task.finally(() => {
      const tasksForChannel = runTasks.get(channelId);
      if (!tasksForChannel) {
        return;
      }

      tasksForChannel.delete(task);
      if (tasksForChannel.size === 0) {
        runTasks.delete(channelId);
      }
    });
  };

  const waitForRunTasks = async (channelId?: string): Promise<void> => {
    if (channelId) {
      let tasksForChannel = runTasks.get(channelId);
      while (tasksForChannel && tasksForChannel.size > 0) {
        await Promise.allSettled([...tasksForChannel]);
        tasksForChannel = runTasks.get(channelId);
      }
      return;
    }

    while (runTasks.size > 0) {
      const allTasks = [...runTasks.values()].flatMap((tasksForChannel) => [...tasksForChannel]);
      if (allTasks.length === 0) {
        return;
      }

      await Promise.allSettled(allTasks);
    }
  };

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
          await processDiscordMessage(
            options,
            message,
            controllers,
            (task) => trackRunTask(channelId, task),
          );
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
        const controllerPromise = controllers.get(channelId);
        if (controllerPromise) {
          const controller = await controllerPromise;
          await controller.waitForIdle();
        }

        await waitForRunTasks(channelId);
        return;
      }

      await Promise.all([...channelQueue.values()]);

      const allControllers = await Promise.all([...controllers.values()]);
      await Promise.all(allControllers.map(async (controller) => controller.waitForIdle()));
      await waitForRunTasks();
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

  const discoveredHelp = await discoverPiHelpFromPi({
    profile: resolvedProfile,
    agentDir: runtime.agentDir,
    cwd: effectiveConfig.workingDirectory,
    sessionFile: join(discordSessionDir, '__commands__.jsonl'),
  });
  const discordCommands = mergeTelegramCommands(DEFAULT_TELEGRAM_COMMANDS, discoveredHelp.commands);
  const commandHelpText = formatTelegramCommands(discordCommands);
  const skillsHelpText = formatTelegramSkills(discoveredHelp.skills);

  const modelCommands: ModelCommandSupport = {
    listModels: (search) => listPiModels({
      profile: resolvedProfile,
      agentDir: runtime.agentDir,
      cwd: effectiveConfig.workingDirectory,
      search,
    }),
    activeModelsByConversation: new Map(),
    pendingSelectionsByConversation: new Map(),
    defaultModel: getProfileDefaultModel(resolvedProfile),
  };

  const handler = createQueuedDiscordMessageHandler({
    allowlist: effectiveConfig.allowlist,
    profileName: effectiveConfig.profile,
    agentDir: runtime.agentDir,
    discordSessionDir,
    workingDirectory: effectiveConfig.workingDirectory,
    maxPendingPerChannel,
    commandHelpText,
    skillsHelpText,
    modelCommands,
    createConversationController: ({ sessionFile }) => createPersistentConversationController({
      profile: resolvedProfile,
      agentDir: runtime.agentDir,
      cwd: effectiveConfig.workingDirectory,
      sessionFile,
    }),
  });

  const DiscordClient = (DiscordJs as any).Client;
  if (typeof DiscordClient !== 'function') {
    throw new Error('Discord client is unavailable from discord.js');
  }

  const intentFlags = resolveDiscordIntentFlags();
  const channelPartial = resolveDiscordChannelPartial();

  const client = new DiscordClient({
    intents: intentFlags,
    partials: channelPartial ? [channelPartial] : [],
  });

  client.on('messageCreate', (message: any) => {
    if (!hasDiscordChannelMessaging(message.channel)) {
      return;
    }

    handler.handleMessage({
      channelId: message.channelId,
      content: message.content,
      authorIsBot: message.author?.bot ?? false,
      authorUsername: message.author?.username,
      authorId: message.author?.id,
      sendMessage: (text) => message.channel.send(text),
      sendTyping: () => message.channel.sendTyping(),
    });
  });

  client.once('ready', () => {
    console.log(gatewaySuccess(`Discord bridge started (profile=${effectiveConfig.profile})`));
    console.log(gatewayKeyValue('Allowed channels', [...effectiveConfig.allowlist].join(', ')));
    console.log(gatewayKeyValue('Working directory', effectiveConfig.workingDirectory));
    console.log(gatewayKeyValue('Available commands', discordCommands.length));
    logSystem('discord', `Bridge started for profile=${effectiveConfig.profile}`);
  });

  client.on('error', (error: unknown) => {
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

function isServiceToken(value: string | undefined): boolean {
  return value === 'service';
}

const GATEWAY_SERVICE_ACTIONS = ['install', 'uninstall', 'status'] as const;

type GatewayServiceRuntimeAction = (typeof GATEWAY_SERVICE_ACTIONS)[number];

type GatewayServiceCliAction = GatewayServiceRuntimeAction | 'help';

function isGatewayServiceRuntimeAction(value: string | undefined): value is GatewayServiceRuntimeAction {
  if (!value) {
    return false;
  }

  return (GATEWAY_SERVICE_ACTIONS as readonly string[]).includes(value);
}

function ensureNoExtraGatewayArgs(args: string[], expectedLength: number, command: string): void {
  if (args.length <= expectedLength) {
    return;
  }

  throw new Error(`Too many arguments for \`${command}\``);
}

export interface ParsedGatewayCliArgs {
  action: 'start' | 'setup' | 'help' | 'service';
  provider?: GatewayProvider;
  serviceAction?: GatewayServiceCliAction;
}

function parseGatewayServiceCliArgs(args: string[]): ParsedGatewayCliArgs {
  const [, rawAction, rawProvider] = args;

  if (!rawAction) {
    return {
      action: 'service',
      serviceAction: 'help',
    };
  }

  if (isHelpToken(rawAction)) {
    if (!rawProvider) {
      ensureNoExtraGatewayArgs(args, 2, 'pa gateway service help');
      return {
        action: 'service',
        serviceAction: 'help',
      };
    }

    if (!isGatewayProvider(rawProvider)) {
      throw new Error(`Unknown gateway provider: ${rawProvider}`);
    }

    ensureNoExtraGatewayArgs(args, 3, `pa gateway service help ${rawProvider}`);
    return {
      action: 'service',
      serviceAction: 'help',
      provider: rawProvider,
    };
  }

  if (!isGatewayServiceRuntimeAction(rawAction)) {
    throw new Error(`Unknown gateway service subcommand: ${rawAction}`);
  }

  if (!rawProvider) {
    ensureNoExtraGatewayArgs(args, 2, `pa gateway service ${rawAction}`);
    return {
      action: 'service',
      serviceAction: rawAction,
      provider: 'telegram',
    };
  }

  if (!isGatewayProvider(rawProvider)) {
    throw new Error(`Unknown gateway provider: ${rawProvider}`);
  }

  ensureNoExtraGatewayArgs(args, 3, `pa gateway service ${rawAction} ${rawProvider}`);

  return {
    action: 'service',
    serviceAction: rawAction,
    provider: rawProvider,
  };
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

  if (isServiceToken(first)) {
    return parseGatewayServiceCliArgs(args);
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

async function ensureDaemonRunningForGatewayStartup(): Promise<void> {
  if (process.env.PERSONAL_AGENT_DISABLE_DAEMON_EVENTS === '1') {
    return;
  }

  try {
    await startDaemonDetached();
  } catch (error) {
    console.warn(gatewayWarning(`Unable to auto-start personal-agentd: ${(error as Error).message}`));
  }
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

function printGatewayServiceHelp(provider?: GatewayProvider): void {
  const defaultProvider = provider ?? 'telegram';

  console.log(gatewaySection('Gateway service'));
  console.log('');
  console.log('Commands:');
  console.log('  pa gateway service help [provider]         Show gateway service help');
  console.log('  pa gateway service install [provider]      Install and start background service');
  console.log('  pa gateway service status [provider]       Show background service status');
  console.log('  pa gateway service uninstall [provider]    Stop and remove background service');
  console.log('');
  console.log(gatewayKeyValue('Default provider', defaultProvider));
  console.log(gatewayKeyValue('Supported platforms', 'macOS launchd, Linux systemd --user'));
  console.log(gatewayKeyValue('Daemon', 'Install also provisions personal-agentd as a managed user service'));
  console.log('');
  console.log(gatewayNext(`pa gateway service install ${defaultProvider}`));
}

function printGatewayServiceStatus(provider: GatewayProvider): void {
  const status = getGatewayServiceStatus(provider);

  console.log(gatewaySection(`Gateway service · ${provider}`));
  console.log('');
  console.log(gatewayKeyValue('Platform', status.platform));
  console.log(gatewayKeyValue('Service', status.identifier));
  console.log(gatewayKeyValue('Manifest', status.manifestPath));
  console.log(gatewayKeyValue('Installed', status.installed ? 'yes' : 'no'));
  console.log(gatewayKeyValue('Running', status.running ? 'yes' : 'no'));

  if (status.logFile) {
    console.log(gatewayKeyValue('Log file', status.logFile));
  }

  if (status.platform === 'systemd') {
    console.log(gatewayKeyValue('Logs', `journalctl --user -u ${status.identifier} -f`));
  }

  if (status.daemonService) {
    console.log('');
    console.log(gatewaySection('Daemon service'));
    console.log(gatewayKeyValue('Service', status.daemonService.identifier));
    console.log(gatewayKeyValue('Manifest', status.daemonService.manifestPath));
    console.log(gatewayKeyValue('Installed', status.daemonService.installed ? 'yes' : 'no'));
    console.log(gatewayKeyValue('Running', status.daemonService.running ? 'yes' : 'no'));

    if (status.daemonService.logFile) {
      console.log(gatewayKeyValue('Log file', status.daemonService.logFile));
    }

    if (status.platform === 'systemd') {
      console.log(gatewayKeyValue('Logs', `journalctl --user -u ${status.daemonService.identifier} -f`));
    }
  }

  if (!status.installed) {
    console.log(gatewayNext(`pa gateway service install ${provider}`));
  }
}

function runGatewayServiceAction(action: GatewayServiceRuntimeAction, provider: GatewayProvider): void {
  if (action === 'install') {
    const service = installGatewayService(provider);

    console.log(gatewaySuccess(`Installed ${provider} gateway service`));
    console.log(gatewayKeyValue('Platform', service.platform));
    console.log(gatewayKeyValue('Service', service.identifier));
    console.log(gatewayKeyValue('Manifest', service.manifestPath));

    if (service.logFile) {
      console.log(gatewayKeyValue('Log file', service.logFile));
    }

    if (service.platform === 'systemd') {
      console.log(gatewayKeyValue('Logs', `journalctl --user -u ${service.identifier} -f`));
    }

    if (service.daemonService) {
      console.log('');
      console.log(gatewaySection('Daemon service'));
      console.log(gatewayKeyValue('Service', service.daemonService.identifier));
      console.log(gatewayKeyValue('Manifest', service.daemonService.manifestPath));

      if (service.daemonService.logFile) {
        console.log(gatewayKeyValue('Log file', service.daemonService.logFile));
      }

      if (service.platform === 'systemd') {
        console.log(gatewayKeyValue('Logs', `journalctl --user -u ${service.daemonService.identifier} -f`));
      }
    }

    console.log(gatewayNext(`pa gateway service status ${provider}`));
    return;
  }

  if (action === 'status') {
    printGatewayServiceStatus(provider);
    return;
  }

  const removed = uninstallGatewayService(provider);
  console.log(gatewaySuccess(`Removed ${provider} gateway service`));
  console.log(gatewayKeyValue('Platform', removed.platform));
  console.log(gatewayKeyValue('Service', removed.identifier));
  console.log(gatewayKeyValue('Manifest', removed.manifestPath));

  if (removed.logFile) {
    console.log(gatewayKeyValue('Log file', removed.logFile));
  }

  console.log(gatewayNext(`pa gateway service install ${provider}`));
}

function printGatewayHelp(provider?: GatewayProvider): void {
  if (provider === 'telegram') {
    console.log(gatewaySection('Gateway · Telegram'));
    console.log('');
    console.log('Commands:');
    console.log('  pa gateway telegram setup                 Interactive setup for Telegram gateway');
    console.log('  pa gateway telegram start                 Start Telegram bridge in foreground');
    console.log('  pa gateway telegram help                  Show Telegram gateway help');
    console.log('  pa gateway service install telegram       Install Telegram background service');
    console.log('  pa gateway service status telegram        Show Telegram service status');
    console.log('  pa gateway service uninstall telegram     Remove Telegram background service');
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
    console.log('  pa gateway discord setup                  Interactive setup for Discord gateway');
    console.log('  pa gateway discord start                  Start Discord bridge in foreground');
    console.log('  pa gateway discord help                   Show Discord gateway help');
    console.log('  pa gateway service install discord        Install Discord background service');
    console.log('  pa gateway service status discord         Show Discord service status');
    console.log('  pa gateway service uninstall discord      Remove Discord background service');
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
  console.log('  pa gateway help                                          Show gateway help');
  console.log('  pa gateway setup [provider]                              Interactive setup walkthrough');
  console.log('  pa gateway start [provider]                              Start provider (default: telegram)');
  console.log('  pa gateway service [install|status|uninstall|help] [...] Manage background service');
  console.log('  pa gateway telegram [setup|start|help]                   Telegram gateway commands');
  console.log('  pa gateway discord [setup|start|help]                    Discord gateway commands');
  console.log('');
  console.log(`Config file: ${getGatewayConfigFilePath()}`);
  console.log('');
  console.log('Environment overrides (optional):');
  console.log('  PERSONAL_AGENT_PROFILE');
  console.log('  PERSONAL_AGENT_PI_TIMEOUT_MS');
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

  if (parsed.action === 'service') {
    const provider = parsed.provider ?? 'telegram';
    const serviceAction = parsed.serviceAction ?? 'help';

    if (serviceAction === 'help') {
      printGatewayServiceHelp(provider);
      return 0;
    }

    runGatewayServiceAction(serviceAction, provider);
    return 0;
  }

  await ensureDaemonRunningForGatewayStartup();
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
    usage: 'pa gateway [telegram|discord|service] [subcommand]',
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

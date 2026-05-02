#!/usr/bin/env node

import { mkdir, rm } from 'fs/promises';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'fs';
import { basename, dirname, extname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import TelegramBot from 'node-telegram-bot-api';
import {
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
  createAgentSession,
  createEventBus,
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
import {
  emitDaemonEventNonFatal,
  loadDaemonConfig,
  parseTaskDefinition,
  pullGatewayNotifications,
  resolveDaemonPaths,
  startDaemonDetached,
  type GatewayNotification,
  type ParsedTaskDefinition,
} from '@personal-agent/daemon';
import {
  readGatewayConfig,
  type GatewayStoredConfig,
  writeGatewayConfig,
} from './config.js';
import {
  resolveConfiguredAllowlistEntries,
  resolveConfiguredValue,
} from './secret-resolver.js';
import { parseAllowlist } from './allowlist.js';
import {
  parseGatewayCliArgs,
  printGatewayHelp,
  printGatewayServiceHelp,
  runGatewayServiceAction,
  runGatewaySetup,
} from './cli-helpers.js';
import { setGatewayExtensionRuntimeContext } from './extensions/runtime-context.js';
import {
  buildTelegramRunCliArgs,
  parseTelegramRunRequest,
  parseRunCliOutput,
  runGatewayRunCli,
  runTelegramRunCommand,
  type TelegramRunNotifyMode,
  type TelegramRunRequest,
} from './telegram-runs.js';

export {
  SUPPORTED_GATEWAY_PROVIDERS,
  getGatewayServiceStatus,
  getManagedDaemonServiceStatus,
  getWebUiServiceStatus,
  installGatewayService,
  installManagedDaemonService,
  installWebUiService,
  restartGatewayService,
  restartGatewayServiceIfInstalled,
  restartManagedDaemonServiceIfInstalled,
  restartWebUiService,
  restartWebUiServiceIfInstalled,
  startGatewayService,
  startManagedDaemonService,
  startWebUiService,
  stopGatewayService,
  stopManagedDaemonService,
  stopWebUiService,
  uninstallGatewayService,
  uninstallManagedDaemonService,
  uninstallWebUiService,
  type GatewayServiceStatus,
  type WebUiServiceInfo,
  type WebUiServiceOptions,
  type WebUiServiceStatus,
} from './service.js';
export {
  getGatewayConfigFilePath,
  readGatewayConfig,
  writeGatewayConfig,
  type GatewayStoredConfig,
  type TelegramStoredConfig,
} from './config.js';
export { parseAllowlist } from './allowlist.js';
export { parseGatewayCliArgs } from './cli-helpers.js';
export { resolveWebUiTailscaleUrl, syncWebUiTailscaleServe, type SyncWebUiTailscaleServeInput } from './tailscale-serve.js';
export {
  activateWebUiSlot,
  ensureActiveWebUiRelease,
  ensureWebUiReleaseNotMarkedBad,
  findBadWebUiRelease,
  getInactiveWebUiSlot,
  getWebUiDeploymentSummary,
  getWebUiSlotHealthPort,
  listBadWebUiReleases,
  markWebUiReleaseBad,
  rollbackWebUiDeployment,
  stageWebUiRelease,
  type RollbackWebUiDeploymentResult,
  type WebUiBadReleaseSummary,
  type WebUiDeploymentSummary,
  type WebUiReleaseSummary,
  type WebUiSlotName,
} from './web-ui-deploy.js';

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
  allowedUserIds?: Set<string>;
  blockedUserIds?: Set<string>;
  workingDirectory: string;
  maxPendingPerChat?: number;
  toolActivityStream?: boolean;
  clearRecentMessagesOnNew?: boolean;
}

type TelegramParseMode = 'HTML';

interface PromptImageAttachment {
  type: 'image';
  data: string;
  mimeType: string;
}

interface TelegramDocumentLike {
  file_id: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
}

interface TelegramPhotoSizeLike {
  file_id: string;
  width?: number;
  height?: number;
  file_size?: number;
}

interface TelegramVoiceLike {
  file_id: string;
  mime_type?: string;
  duration?: number;
  file_size?: number;
}

interface TelegramAnimationLike {
  file_id: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
  width?: number;
  height?: number;
  duration?: number;
}

interface TelegramVideoLike {
  file_id: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
  width?: number;
  height?: number;
  duration?: number;
}

interface TelegramStickerLike {
  file_id: string;
  file_size?: number;
  width?: number;
  height?: number;
  is_animated?: boolean;
  is_video?: boolean;
  emoji?: string;
}

interface TelegramChatLike {
  id: number;
  type?: string;
  title?: string;
  username?: string;
}

interface TelegramUserLike {
  id?: number;
  username?: string;
  first_name?: string;
  last_name?: string;
}

export interface TelegramMessageLike {
  chat: TelegramChatLike;
  message_id?: number;
  message_thread_id?: number;
  text?: string;
  caption?: string;
  document?: TelegramDocumentLike;
  photo?: TelegramPhotoSizeLike[];
  voice?: TelegramVoiceLike;
  animation?: TelegramAnimationLike;
  video?: TelegramVideoLike;
  sticker?: TelegramStickerLike;
  group_chat_created?: boolean;
  supergroup_chat_created?: boolean;
  channel_chat_created?: boolean;
  new_chat_participant?: TelegramUserLike;
  new_chat_member?: TelegramUserLike;
  new_chat_members?: TelegramUserLike[];
  left_chat_member?: TelegramUserLike;
  delete_chat_photo?: boolean;
  migrate_to_chat_id?: number;
  migrate_from_chat_id?: number;
  pinned_message?: unknown;
  reply_to_message?: {
    message_id?: number;
  };
  from?: TelegramUserLike;
}

interface TelegramCallbackQueryLike {
  id: string;
  data?: string;
  from?: TelegramUserLike;
  message?: TelegramMessageLike;
}

type TelegramInboundMediaKind = 'photo' | 'document' | 'voice' | 'animation' | 'video' | 'sticker';

interface TelegramInboundMediaReference {
  kind: TelegramInboundMediaKind;
  fileId: string;
  fileName?: string;
  mimeType?: string;
  fileSizeBytes?: number;
  durationSeconds?: number;
  width?: number;
  height?: number;
}

interface TelegramPreparedInboundMedia {
  kind: TelegramInboundMediaKind;
  localPath: string;
  fileName?: string;
  mimeType?: string;
  fileSizeBytes?: number;
  durationSeconds?: number;
  imageContent?: PromptImageAttachment;
}

type PrepareTelegramInboundMediaFn = (input: {
  chatId: string;
  messageId?: number;
  media: TelegramInboundMediaReference[];
}) => Promise<TelegramPreparedInboundMedia[]>;

interface TelegramInlineKeyboardButton {
  text: string;
  callback_data: string;
}

interface TelegramReplyMarkup {
  inline_keyboard?: TelegramInlineKeyboardButton[][];
  force_reply?: boolean;
}

interface TelegramSendMessageOptions {
  parse_mode?: TelegramParseMode;
  disable_web_page_preview?: boolean;
  reply_markup?: TelegramReplyMarkup;
  message_thread_id?: number;
}

interface TelegramSendFileOptions {
  caption?: string;
  parse_mode?: TelegramParseMode;
  message_thread_id?: number;
}

interface TelegramSendChatActionOptions {
  message_thread_id?: number;
}

type SendMessageFn = (chatId: number, text: string, options?: TelegramSendMessageOptions) => Promise<unknown>;

type EditMessageTextFn = (
  chatId: number,
  messageId: number,
  text: string,
  options?: TelegramSendMessageOptions,
) => Promise<unknown>;

type DeleteMessageFn = (chatId: number, messageId: number) => Promise<unknown>;

type DeleteMessagesFn = (chatId: number, messageIds: number[]) => Promise<unknown>;

type SendDocumentFn = (chatId: number, filePath: string, options?: TelegramSendFileOptions) => Promise<unknown>;

type SendPhotoFn = (chatId: number, filePath: string, options?: TelegramSendFileOptions) => Promise<unknown>;

interface CreatedTelegramForumTopic {
  messageThreadId: number;
  name: string;
}

type CreateTelegramForumTopicFn = (input: {
  chatId: number;
  name: string;
}) => Promise<CreatedTelegramForumTopic>;

interface SetTelegramWorkTopicBindingInput {
  sourceConversationId: string;
  sourceChatId: string;
  sourceMessageThreadId?: number;
  workConversationId: string;
  workChatId: number;
  workMessageThreadId: number;
  topicName: string;
  sessionFile: string;
}

type SendTextFn = (text: string) => Promise<unknown>;

type SendChatActionFn = (
  chatId: number,
  action: 'typing',
  options?: TelegramSendChatActionOptions,
) => Promise<unknown>;

interface ToolActivityEvent {
  phase: 'call' | 'result';
  toolName: string;
  args?: Record<string, unknown>;
  resultText?: string;
  isError?: boolean;
}

interface RunPromptFnInput {
  prompt: string;
  sessionFile: string;
  cwd: string;
  model?: string;
  images?: PromptImageAttachment[];
  abortSignal?: AbortSignal;
  onTextDelta?: (delta: string) => void;
  onToolActivity?: (event: ToolActivityEvent) => void;
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

export interface ForkableConversationMessage {
  entryId: string;
  text: string;
}

export interface ForkConversationResult {
  selectedText: string;
  cancelled: boolean;
  sessionFile: string;
}

export interface GatewayConversationController {
  submitPrompt: (input: RunPromptFnInput) => Promise<ConversationSubmitResult>;
  submitFollowUp: (input: RunPromptFnInput) => Promise<ConversationSubmitResult>;
  compact: (customInstructions?: string) => Promise<string>;
  getUserMessagesForForking: () => Promise<ForkableConversationMessage[]>;
  fork: (entryId: string) => Promise<ForkConversationResult>;
  getSessionFile: () => Promise<string>;
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
}

export interface ScheduledReplyContext {
  source: 'scheduled-task';
  taskId?: string;
  status?: 'success' | 'failed';
  message: string;
  logPath?: string;
  createdAt?: string;
}

const GATEWAY_TASK_STATUS_FILTERS = ['running', 'active', 'completed', 'disabled', 'pending', 'error'] as const;

type GatewayTaskStatus = (typeof GATEWAY_TASK_STATUS_FILTERS)[number];
type GatewayTaskStatusFilter = GatewayTaskStatus | 'all';

interface GatewayTaskRuntimeRecord {
  id?: string;
  filePath?: string;
  running?: boolean;
  lastStatus?: string;
  lastRunAt?: string;
  oneTimeResolvedStatus?: string;
  oneTimeCompletedAt?: string;
}

interface GatewayTaskSummaryEntry {
  task: ParsedTaskDefinition;
  status: GatewayTaskStatus;
  runtime: GatewayTaskRuntimeRecord | undefined;
}

type ListScheduledTasksFn = (input: {
  statusFilter: GatewayTaskStatusFilter;
}) => Promise<string>;

type HandleTelegramRoomAdminCommandFn = (input: {
  actorUserId?: string;
  actorLabel: string;
  args: string;
}) => Promise<string>;

type HandleTelegramRunCommandFn = (input: {
  args: string;
}) => Promise<string>;

type HandleTelegramRunRequestFn = (input: {
  run: TelegramRunRequest;
  sourceConversationId: string;
  sourceChatId: number;
  sourceMessageThreadId: number | undefined;
  sourceChatType: string | undefined;
  sourceChatTitle: string | undefined;
  sourceChatUsername: string | undefined;
  defaultSourceSessionFile: string;
  getForkableMessages: () => Promise<ForkableConversationMessage[]>;
  forkConversation: (entryId: string) => Promise<ForkConversationResult>;
  setConversationSessionFile: (input: {
    conversationId: string;
    sessionFile: string;
  }) => void;
  resolveConversationSessionFile: (input: {
    conversationId: string;
    defaultSessionFile: string;
  }) => string;
}) => Promise<string>;

export interface CreateTelegramMessageHandlerOptions {
  allowlist: Set<string>;
  allowedUserIds?: Set<string>;
  blockedUserIds?: Set<string>;
  profileName: string;
  agentDir: string;
  telegramSessionDir: string;
  workingDirectory: string;
  sendMessage: SendMessageFn;
  editMessageText?: EditMessageTextFn;
  deleteMessage?: DeleteMessageFn;
  deleteMessages?: DeleteMessagesFn;
  sendDocument?: SendDocumentFn;
  sendPhoto?: SendPhotoFn;
  sendChatAction: SendChatActionFn;
  prepareInboundMedia?: PrepareTelegramInboundMediaFn;
  telegramExportDir?: string;
  createConversationController: CreateConversationControllerFn;
  commandHelpText?: string;
  skillsHelpText?: string;
  sessionFileExists?: (path: string) => boolean;
  removeSessionFile?: (path: string) => Promise<void>;
  maxPendingPerChat?: number;
  streamToolActivity?: boolean;
  clearRecentMessagesOnNew?: boolean;
  modelCommands?: ModelCommandSupport;
  durableInboxDir?: string;
  listScheduledTasks?: ListScheduledTasksFn;
  handleRoomAdminCommand?: HandleTelegramRoomAdminCommandFn;
  handleRunCommand?: HandleTelegramRunCommandFn;
  handleRunRequest?: HandleTelegramRunRequestFn;
  createForumTopic?: CreateTelegramForumTopicFn;
  skillSlashCommandMap?: Map<string, string>;
  setWorkTopicBinding?: (input: SetTelegramWorkTopicBindingInput) => void;
  resolveConversationSessionFile?: (input: {
    conversationId: string;
    defaultSessionFile: string;
  }) => string;
  setConversationSessionFile?: (input: {
    conversationId: string;
    sessionFile: string;
  }) => void;
  clearConversationSessionFile?: (input: {
    conversationId: string;
  }) => void;
  persistAccessLists?: () => void;
  resolveScheduledReplyContext?: (input: {
    chatId: string;
    replyMessageId: number;
  }) => ScheduledReplyContext | undefined;
}

export interface QueuedTelegramMessageHandler {
  handleMessage: (message: TelegramMessageLike) => void;
  replayPendingMessages: () => number;
  waitForIdle: (chatId?: string) => Promise<void>;
}

const DEFAULT_PI_TIMEOUT_MS = 1_800_000;
const DEFAULT_MAX_PENDING_PER_CHAT = 20;
const TYPING_HEARTBEAT_INTERVAL_MS = 4_000;
const DEFAULT_TELEGRAM_RETRY_ATTEMPTS = 3;
const DEFAULT_TELEGRAM_RETRY_BASE_DELAY_MS = 300;
const DAEMON_NOTIFICATION_POLL_INTERVAL_MS = 5000;
const MAX_TRACKED_SCHEDULED_REPLY_CONTEXTS = 500;
const SCHEDULED_REPLY_CONTEXT_TTL_MS = 24 * 60 * 60 * 1000;
const TELEGRAM_MODEL_SELECTION_CALLBACK_PREFIX = 'model_select:';
const TELEGRAM_ACTION_CALLBACK_PREFIX = 'action:';
const TELEGRAM_ROOM_AUTH_CALLBACK_PREFIX = 'room_auth:';
const TELEGRAM_FORK_SELECTION_CALLBACK_PREFIX = 'fork_select:';
const TELEGRAM_RESUME_SELECTION_CALLBACK_PREFIX = 'resume_select:';
const TELEGRAM_ROOM_AUTH_REQUEST_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const TELEGRAM_MAX_PENDING_ROOM_AUTH_REQUESTS = 500;
const TELEGRAM_MAX_TRACKED_CONVERSATION_MESSAGES = 200;
const TELEGRAM_CLEAR_SWEEP_MESSAGE_LIMIT = 400;
const TELEGRAM_CLEAR_SWEEP_MESSAGE_LIMIT_ALL = 5000;
const TELEGRAM_DELETE_MESSAGES_CHUNK_SIZE = 100;
const TELEGRAM_MAX_MESSAGE_CHARS = 3900;
const TELEGRAM_STREAMING_EDIT_PREVIEW_MAX_CHARS = 3200;
const TELEGRAM_STREAMING_EDIT_INTERVAL_MS = 2500;
const TELEGRAM_LONG_OUTPUT_FILE_THRESHOLD_CHARS = 12_000;
const TELEGRAM_MAX_AUTO_ATTACHMENTS = 3;
const TELEGRAM_MAX_ATTACHMENT_BYTES = 45 * 1024 * 1024;
const PROMPT_CANCELLED_ERROR_MESSAGE = 'Request cancelled by /stop.';
const STOPPED_ACTIVE_REQUEST_MESSAGE = 'Stopped active request.';
const NO_ACTIVE_REQUEST_MESSAGE = 'No active request to stop.';
const STEERING_ACTIVE_REQUEST_MESSAGE = 'Steering current response...';
const FOLLOWUP_QUEUED_MESSAGE = 'Queued as follow-up.';
const STREAMING_FLUSH_TARGET_CHARS = 700;
const STREAMING_FLUSH_MIN_CHARS = 250;

function gatewaySuccess(message: string): string {
  return `✓ ${message}`;
}

function gatewayWarning(message: string): string {
  return `⚠ ${message}`;
}

function gatewayKeyValue(key: string, value: string | number): string {
  return `  ${key}: ${value}`;
}

export type GatewayProvider = 'telegram';

type ResolvedProfile = ReturnType<typeof resolveResourceProfile>;
type PiAgentSession = Awaited<ReturnType<typeof createAgentSession>>['session'];

interface PreparedGatewayRuntime {
  resolvedProfile: ResolvedProfile;
  statePaths: ReturnType<typeof resolveStatePaths>;
  runtime: Awaited<ReturnType<typeof preparePiAgentDir>>;
}

function normalizeTelegramMessageThreadId(value: number | undefined): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined;
  }

  const parsed = Math.floor(value);
  return parsed > 0 ? parsed : undefined;
}

function toTelegramUserIdString(value: number | undefined): string | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined;
  }

  const parsed = Math.floor(value);
  return Number.isSafeInteger(parsed) ? String(parsed) : undefined;
}

function buildTelegramConversationId(chatId: string, messageThreadId: number | undefined): string {
  if (messageThreadId === undefined) {
    return chatId;
  }

  return `${chatId}::thread:${messageThreadId}`;
}

function parseTelegramConversationId(conversationId: string): {
  chatId: string;
  messageThreadId: number | undefined;
} | undefined {
  const trimmed = conversationId.trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  const threadMatch = trimmed.match(/^(.*)::thread:(\d+)$/);
  if (!threadMatch) {
    return {
      chatId: trimmed,
      messageThreadId: undefined,
    };
  }

  const chatId = threadMatch[1]?.trim();
  const messageThreadId = normalizeTelegramMessageThreadId(Number.parseInt(threadMatch[2] ?? '', 10));
  if (!chatId || messageThreadId === undefined) {
    return undefined;
  }

  return {
    chatId,
    messageThreadId,
  };
}

function buildTelegramSessionFileName(chatId: string, messageThreadId: number | undefined): string {
  const chatToken = sanitizeTelegramPendingToken(chatId);
  if (messageThreadId === undefined) {
    return `${chatToken}.jsonl`;
  }

  return `${chatToken}__thread_${messageThreadId}.jsonl`;
}

function isTelegramServiceOnlyMessage(message: TelegramMessageLike): boolean {
  return Boolean(
    message.group_chat_created
    || message.supergroup_chat_created
    || message.channel_chat_created
    || message.new_chat_participant
    || message.new_chat_member
    || (Array.isArray(message.new_chat_members) && message.new_chat_members.length > 0)
    || message.left_chat_member
    || message.delete_chat_photo
    || message.migrate_to_chat_id !== undefined
    || message.migrate_from_chat_id !== undefined
    || message.pinned_message,
  );
}

function isTelegramConversationInChat(conversationId: string, chatId: string): boolean {
  return conversationId === chatId || conversationId.startsWith(`${chatId}::thread:`);
}

function applyTelegramThreadToMessageOptions(
  options: TelegramSendMessageOptions | undefined,
  messageThreadId: number | undefined,
): TelegramSendMessageOptions | undefined {
  if (messageThreadId === undefined) {
    return options;
  }

  return {
    ...(options ?? {}),
    message_thread_id: messageThreadId,
  };
}

function applyTelegramThreadToFileOptions(
  options: TelegramSendFileOptions | undefined,
  messageThreadId: number | undefined,
): TelegramSendFileOptions | undefined {
  if (messageThreadId === undefined) {
    return options;
  }

  return {
    ...(options ?? {}),
    message_thread_id: messageThreadId,
  };
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
  { command: 'clear', description: 'Clear messages in the current chat/topic' },
  { command: 'status', description: 'Show gateway status' },
  { command: 'chatid', description: 'Show current chat ID (and topic ID)' },
  { command: 'tasks', description: 'List scheduled tasks (usage: /tasks [status])' },
  { command: 'room', description: 'Manage room approvals (usage: /room help)' },
  { command: 'run', description: 'Start and inspect durable background runs (usage: /run help)' },
  { command: 'commands', description: 'List available commands' },
  { command: 'skills', description: 'List available skills' },
  { command: 'help', description: 'Show command help' },
  { command: 'skill', description: 'Load a skill (usage: /skill <name> or /skill:<name>)' },
  ...MODEL_TELEGRAM_COMMANDS,
  { command: 'stop', description: 'Stop active request' },
  { command: 'followup', description: 'Queue follow-up (or /followup to enter follow-up mode)' },
  { command: 'regenerate', description: 'Run the last prompt again' },
  { command: 'cancel', description: 'Cancel active model selection' },
  { command: 'compact', description: 'Compact context (usage: /compact [instructions])' },
  { command: 'fork', description: 'Fork to new topic (usage: /fork [topic name])' },
  { command: 'resume', description: 'Resume a saved conversation (usage: /resume [index|id|file])' },
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
      ? 'Load a skill (usage: /skill <name> or /skill:<name>)'
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

function stripMatchingQuotes(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length < 2) {
    return trimmed;
  }

  const startsWithSingle = trimmed.startsWith('\'');
  const startsWithDouble = trimmed.startsWith('"');

  if ((startsWithSingle && trimmed.endsWith('\'')) || (startsWithDouble && trimmed.endsWith('"'))) {
    return trimmed.slice(1, -1).trim();
  }

  return trimmed;
}

function parseMarkdownFrontmatter(content: string): Record<string, string> {
  const match = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/);
  if (!match) {
    return {};
  }

  const output: Record<string, string> = {};
  const body = match[1] ?? '';

  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith('#')) {
      continue;
    }

    const separatorIndex = trimmed.indexOf(':');
    if (separatorIndex <= 0) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim().toLowerCase();
    const value = stripMatchingQuotes(trimmed.slice(separatorIndex + 1));

    if (key.length === 0 || value.length === 0) {
      continue;
    }

    output[key] = value;
  }

  return output;
}

function listSkillDefinitionFiles(skillDir: string): string[] {
  if (!existsSync(skillDir)) {
    return [];
  }

  const output: string[] = [];
  const stack = [resolve(skillDir)];

  while (stack.length > 0) {
    const current = stack.pop() as string;
    const entries = readdirSync(current, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(current, entry.name);

      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }

      if (entry.isFile() && entry.name === 'SKILL.md') {
        output.push(fullPath);
      }
    }
  }

  output.sort();
  return output;
}

function parseSkillDefinitionFile(skillFile: string): TelegramSkillDefinition | undefined {
  try {
    const content = readFileSync(skillFile, 'utf-8');
    const frontmatter = parseMarkdownFrontmatter(content);

    const fallbackName = basename(dirname(skillFile));
    const name = (frontmatter.name ?? fallbackName).trim();
    if (name.length === 0) {
      return undefined;
    }

    const description = toTelegramCommandDescription(
      frontmatter.description?.trim() || 'No description available.',
    );

    return {
      name,
      description,
    };
  } catch {
    return undefined;
  }
}

function discoverProfileSkillsFromFilesystem(profile: ResolvedProfile): TelegramSkillDefinition[] {
  const discovered = new Map<string, TelegramSkillDefinition>();

  for (const skillDir of profile.skillDirs) {
    const skillFiles = listSkillDefinitionFiles(skillDir);

    for (const skillFile of skillFiles) {
      const parsedSkill = parseSkillDefinitionFile(skillFile);
      if (!parsedSkill) {
        continue;
      }

      discovered.set(parsedSkill.name, parsedSkill);
    }
  }

  return [...discovered.values()].sort((left, right) => left.name.localeCompare(right.name));
}

interface TelegramSkillSlashCommand {
  command: TelegramCommandDefinition;
  skillName: string;
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
  lines.push('Usage: /skill <name> or /skill:<name>');
  lines.push('Examples: /skill tdd-feature, /skill:tdd-feature');

  return lines.join('\n');
}

function toTelegramSkillSlashCommandBase(skillName: string): string {
  const normalized = skillName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+/, '')
    .replace(/_+$/, '');

  return `skill_${normalized.length > 0 ? normalized : 'skill'}`;
}

function buildTelegramSkillSlashCommands(
  skills: TelegramSkillDefinition[],
  reservedCommands: Set<string>,
): TelegramSkillSlashCommand[] {
  const usedCommands = new Set<string>(reservedCommands);
  const commands: TelegramSkillSlashCommand[] = [];

  for (const skill of skills) {
    const baseCommand = toTelegramSkillSlashCommandBase(skill.name).slice(0, 32);
    let candidate = baseCommand;
    let suffix = 2;

    while (usedCommands.has(candidate)) {
      const suffixToken = `_${suffix}`;
      const head = baseCommand.slice(0, Math.max(1, 32 - suffixToken.length));
      candidate = `${head}${suffixToken}`;
      suffix += 1;
    }

    usedCommands.add(candidate);
    commands.push({
      command: {
        command: candidate,
        description: toTelegramCommandDescription(`Run /skill:${skill.name}`),
      },
      skillName: skill.name,
    });
  }

  return commands;
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

function filterTelegramSlashMenuCommands(commands: TelegramCommandDefinition[]): TelegramCommandDefinition[] {
  return commands.filter((command) => command.command !== 'skills');
}

function formatTelegramCommands(commands: TelegramCommandDefinition[]): string {
  const lines = ['Available commands:'];

  for (const command of commands) {
    lines.push(`/${command.command} - ${command.description}`);
  }

  lines.push('');
  lines.push('Tip: use /skill <name> (or /skill:tdd-feature). Telegram slash menu also includes auto-generated /skill_* shortcuts.');

  return lines.join('\n');
}

function trimForkMessagePreview(text: string, maxLength = 120): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

function defaultTelegramForkTopicName(messageText: string): string {
  const preview = trimForkMessagePreview(messageText, 48).replace(/\s+/g, ' ').trim();
  if (preview.length === 0) {
    const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 16);
    return `fork ${timestamp}`;
  }

  return trimForkMessagePreview(`fork ${preview}`, 96);
}

function normalizeTelegramForkTopicName(requestedName: string, fallbackName: string): string {
  const normalized = requestedName.replace(/\s+/g, ' ').trim();
  if (normalized.length === 0) {
    return fallbackName;
  }

  return trimForkMessagePreview(normalized, 96);
}

function normalizeForkableMessages(messages: ForkableConversationMessage[]): ForkableConversationMessage[] {
  return [...messages]
    .map((entry) => ({
      entryId: entry.entryId,
      text: entry.text,
    }))
    .reverse();
}

function formatForkableMessages(messages: ForkableConversationMessage[]): string {
  if (messages.length === 0) {
    return [
      'No previous user messages available to fork from in this conversation yet.',
      '',
      'Send at least one prompt first, then run /fork again.',
    ].join('\n');
  }

  const maxRows = 15;
  const displayed = messages.slice(0, maxRows);
  const lines = ['Forkable messages (most recent first):'];

  for (let index = 0; index < displayed.length; index += 1) {
    const entry = displayed[index] as ForkableConversationMessage;
    lines.push(`${index + 1}. [${entry.entryId}] ${trimForkMessagePreview(entry.text)}`);
  }

  if (messages.length > displayed.length) {
    lines.push(`…and ${messages.length - displayed.length} older message(s).`);
  }

  lines.push('');
  lines.push('Usage: /fork <index|entryId>');
  lines.push('Example: /fork 1');

  return lines.join('\n');
}

function resolveForkEntryId(
  arg: string,
  messages: ForkableConversationMessage[],
): { entryId?: string; error?: string } {
  const trimmed = arg.trim();

  if (trimmed.length === 0) {
    return { error: 'Usage: /fork <index|entryId>' };
  }

  if (/^\d+$/.test(trimmed)) {
    const index = Number.parseInt(trimmed, 10);
    if (!Number.isFinite(index) || index <= 0 || index > messages.length) {
      return {
        error: `Fork index out of range. Choose 1-${messages.length}.`,
      };
    }

    return {
      entryId: (messages[index - 1] as ForkableConversationMessage).entryId,
    };
  }

  const matchedEntry = messages.find((entry) => entry.entryId === trimmed);
  if (!matchedEntry) {
    return {
      error: `Unknown fork entry ID: ${trimmed}`,
    };
  }

  return {
    entryId: matchedEntry.entryId,
  };
}

interface GatewayResumeConversationOption {
  sessionFile: string;
  sessionFileName: string;
  label: string;
  conversationId?: string;
  updatedAtMs: number;
}

interface GatewaySessionFileListing {
  sessionFile: string;
  sessionFileName: string;
  updatedAtMs: number;
}

function resolveSessionFileUpdatedAtMs(sessionFile: string): number {
  try {
    const stats = statSync(sessionFile);
    if (!stats.isFile()) {
      return 0;
    }

    const timestamp = Number.isFinite(stats.mtimeMs)
      ? stats.mtimeMs
      : stats.mtime.getTime();

    return Number.isFinite(timestamp) ? timestamp : 0;
  } catch {
    return 0;
  }
}

function listGatewaySessionFiles(sessionDir: string): GatewaySessionFileListing[] {
  if (!existsSync(sessionDir)) {
    return [];
  }

  let fileNames: string[] = [];

  try {
    fileNames = readdirSync(sessionDir);
  } catch {
    return [];
  }

  const listed: GatewaySessionFileListing[] = [];

  for (const fileName of fileNames) {
    if (fileName === '__commands__.jsonl' || !fileName.includes('.jsonl')) {
      continue;
    }

    const sessionFile = join(sessionDir, fileName);
    const updatedAtMs = resolveSessionFileUpdatedAtMs(sessionFile);
    if (updatedAtMs <= 0 && !existsSync(sessionFile)) {
      continue;
    }

    listed.push({
      sessionFile,
      sessionFileName: fileName,
      updatedAtMs,
    });
  }

  return listed;
}

function parseTelegramConversationFromSessionFileName(
  sessionFileName: string,
): { conversationId: string; label: string } | undefined {
  const threadMatch = sessionFileName.match(/^(.+)__thread_(\d+)\.jsonl$/);
  if (threadMatch) {
    const chatId = threadMatch[1]?.trim() ?? '';
    const messageThreadId = normalizeTelegramMessageThreadId(Number.parseInt(threadMatch[2] ?? '', 10));

    if (chatId.length > 0 && messageThreadId !== undefined) {
      return {
        conversationId: buildTelegramConversationId(chatId, messageThreadId),
        label: `chat ${chatId} • topic ${messageThreadId}`,
      };
    }
  }

  const chatMatch = sessionFileName.match(/^(.+)\.jsonl$/);
  if (!chatMatch) {
    return undefined;
  }

  const chatId = chatMatch[1]?.trim() ?? '';
  if (chatId.length === 0) {
    return undefined;
  }

  return {
    conversationId: chatId,
    label: `chat ${chatId}`,
  };
}

function buildResumeConversationOptions(input: {
  sessionDir: string;
  currentSessionFile: string;
  parseConversation: (sessionFileName: string) => { conversationId: string; label: string } | undefined;
}): GatewayResumeConversationOption[] {
  const listings = listGatewaySessionFiles(input.sessionDir);
  const optionsBySessionFile = new Map<string, GatewayResumeConversationOption>();

  for (const listing of listings) {
    const parsedConversation = input.parseConversation(listing.sessionFileName);

    optionsBySessionFile.set(listing.sessionFile, {
      sessionFile: listing.sessionFile,
      sessionFileName: listing.sessionFileName,
      label: parsedConversation?.label ?? listing.sessionFileName,
      conversationId: parsedConversation?.conversationId,
      updatedAtMs: listing.updatedAtMs,
    });
  }

  if (!optionsBySessionFile.has(input.currentSessionFile)) {
    const currentSessionFileName = basename(input.currentSessionFile);
    const parsedConversation = input.parseConversation(currentSessionFileName);

    optionsBySessionFile.set(input.currentSessionFile, {
      sessionFile: input.currentSessionFile,
      sessionFileName: currentSessionFileName,
      label: parsedConversation?.label ?? currentSessionFileName,
      conversationId: parsedConversation?.conversationId,
      updatedAtMs: resolveSessionFileUpdatedAtMs(input.currentSessionFile),
    });
  }

  return [...optionsBySessionFile.values()].sort((left, right) => {
    const updatedDelta = right.updatedAtMs - left.updatedAtMs;
    if (updatedDelta !== 0) {
      return updatedDelta;
    }

    return left.label.localeCompare(right.label);
  });
}

function formatSessionAgeFromNow(updatedAtMs: number): string {
  if (!Number.isFinite(updatedAtMs) || updatedAtMs <= 0) {
    return 'age unknown';
  }

  const elapsedMs = Math.max(0, Date.now() - updatedAtMs);
  if (elapsedMs < 60_000) {
    return 'just now';
  }

  const minutes = Math.floor(elapsedMs / 60_000);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }

  const days = Math.floor(hours / 24);
  if (days < 30) {
    return `${days}d ago`;
  }

  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

function formatResumeConversationSelectionPrompt(input: {
  entries: GatewayResumeConversationOption[];
  currentSessionFile: string;
}): string {
  const maxRows = 15;
  const displayedEntries = input.entries.slice(0, maxRows);
  const lines = ['Saved conversations (most recent first):'];

  for (let index = 0; index < displayedEntries.length; index += 1) {
    const entry = displayedEntries[index] as GatewayResumeConversationOption;
    const tags: string[] = [formatSessionAgeFromNow(entry.updatedAtMs)];

    if (entry.sessionFile === input.currentSessionFile) {
      tags.unshift('current');
    }

    lines.push(`${index + 1}. ${entry.label} (${tags.join(', ')})`);

    if (entry.conversationId) {
      lines.push(`   id=${entry.conversationId}`);
    }

    lines.push(`   file=${entry.sessionFileName}`);
  }

  if (input.entries.length > displayedEntries.length) {
    lines.push(`…and ${input.entries.length - displayedEntries.length} more conversation(s).`);
  }

  lines.push('');
  lines.push('Usage: /resume <index|conversation-id|file>');
  lines.push('Example: /resume 2');

  return lines.join('\n');
}

function resolveResumeConversationSelection(
  arg: string,
  entries: GatewayResumeConversationOption[],
): { entry?: GatewayResumeConversationOption; error?: string } {
  const trimmed = arg.trim();

  if (trimmed.length === 0) {
    return {
      error: 'Usage: /resume <index|conversation-id|file>',
    };
  }

  if (/^\d+$/.test(trimmed)) {
    const index = Number.parseInt(trimmed, 10);
    if (!Number.isFinite(index) || index <= 0 || index > entries.length) {
      return {
        error: `Resume index out of range. Choose 1-${entries.length}.`,
      };
    }

    return {
      entry: entries[index - 1],
    };
  }

  const byConversationId = entries.find((entry) => entry.conversationId === trimmed);
  if (byConversationId) {
    return { entry: byConversationId };
  }

  const byFileName = entries.find((entry) => entry.sessionFileName === trimmed);
  if (byFileName) {
    return { entry: byFileName };
  }

  const bySessionFilePath = entries.find((entry) => entry.sessionFile === trimmed);
  if (bySessionFilePath) {
    return { entry: bySessionFilePath };
  }

  return {
    error: `Unknown resume target: ${trimmed}`,
  };
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

  const skillShortcutMatch = first.match(/^\/skill:([^\s@]+)(?:@[^\s]+)?$/i);
  if (skillShortcutMatch) {
    const skillName = skillShortcutMatch[1]?.trim() ?? '';
    const trailingArgs = parts.slice(1).join(' ').trim();
    const args = [skillName, trailingArgs].filter((part) => part.length > 0).join(' ').trim();

    return {
      normalizedText: args.length > 0 ? `/skill ${args}` : '/skill',
      command: '/skill',
      args,
    };
  }

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

function gatewayTaskListUsageText(): string {
  return `Usage: /tasks [all|${GATEWAY_TASK_STATUS_FILTERS.join('|')}]`;
}

function parseGatewayTaskStatusFilter(rawArgs: string): GatewayTaskStatusFilter | undefined {
  const trimmed = rawArgs.trim();
  if (trimmed.length === 0) {
    return 'all';
  }

  const tokens = trimmed.split(/\s+/).filter((token) => token.length > 0);
  if (tokens.length !== 1) {
    return undefined;
  }

  const token = (tokens[0] as string).toLowerCase();
  const candidate = token.startsWith('status=')
    ? token.slice('status='.length)
    : token;

  if (candidate.length === 0) {
    return undefined;
  }

  if (candidate === 'all') {
    return 'all';
  }

  if ((GATEWAY_TASK_STATUS_FILTERS as readonly string[]).includes(candidate)) {
    return candidate as GatewayTaskStatus;
  }

  return undefined;
}

function isGatewayTaskStateRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function listGatewayTaskDefinitionFiles(taskDir: string): string[] {
  if (!existsSync(taskDir)) {
    return [];
  }

  const output: string[] = [];
  const stack = [resolve(taskDir)];

  while (stack.length > 0) {
    const current = stack.pop() as string;
    const entries = readdirSync(current, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(current, entry.name);

      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      if (!entry.name.endsWith('.task.md')) {
        continue;
      }

      output.push(fullPath);
    }
  }

  output.sort();
  return output;
}

function loadGatewayTaskRuntimeState(stateFile: string): Record<string, GatewayTaskRuntimeRecord> {
  if (!existsSync(stateFile)) {
    return {};
  }

  try {
    const parsed = JSON.parse(readFileSync(stateFile, 'utf-8')) as unknown;
    if (!isGatewayTaskStateRecord(parsed)) {
      return {};
    }

    const tasks = parsed.tasks;
    if (!isGatewayTaskStateRecord(tasks)) {
      return {};
    }

    const output: Record<string, GatewayTaskRuntimeRecord> = {};

    for (const [key, value] of Object.entries(tasks)) {
      if (!isGatewayTaskStateRecord(value)) {
        continue;
      }

      output[key] = {
        id: typeof value.id === 'string' ? value.id : undefined,
        filePath: typeof value.filePath === 'string' ? value.filePath : undefined,
        running: typeof value.running === 'boolean' ? value.running : undefined,
        lastStatus: typeof value.lastStatus === 'string' ? value.lastStatus : undefined,
        lastRunAt: typeof value.lastRunAt === 'string' ? value.lastRunAt : undefined,
        oneTimeResolvedStatus:
          typeof value.oneTimeResolvedStatus === 'string' ? value.oneTimeResolvedStatus : undefined,
        oneTimeCompletedAt:
          typeof value.oneTimeCompletedAt === 'string' ? value.oneTimeCompletedAt : undefined,
      };
    }

    return output;
  } catch {
    return {};
  }
}

function formatGatewayTaskSchedule(task: ParsedTaskDefinition): string {
  if (task.schedule.type === 'cron') {
    return `cron ${task.schedule.expression}`;
  }

  return `at ${task.schedule.at}`;
}

function resolveGatewayTaskStatus(
  task: ParsedTaskDefinition,
  runtime: GatewayTaskRuntimeRecord | undefined,
): GatewayTaskStatus {
  if (runtime?.running === true) {
    return 'running';
  }

  if (
    task.schedule.type === 'at'
    && (runtime?.oneTimeCompletedAt || runtime?.oneTimeResolvedStatus === 'success')
  ) {
    return 'completed';
  }

  if (runtime?.lastStatus === 'failed') {
    return 'error';
  }

  if (runtime?.lastStatus === 'skipped') {
    return 'pending';
  }

  return task.enabled ? 'active' : 'disabled';
}

function countGatewayTaskStatuses(entries: GatewayTaskSummaryEntry[]): Record<GatewayTaskStatus, number> {
  const counts: Record<GatewayTaskStatus, number> = {
    running: 0,
    active: 0,
    completed: 0,
    disabled: 0,
    pending: 0,
    error: 0,
  };

  for (const entry of entries) {
    counts[entry.status] += 1;
  }

  return counts;
}

const listScheduledTasks: ListScheduledTasksFn = async ({ statusFilter }) => {
  const config = loadDaemonConfig();
  const daemonPaths = resolveDaemonPaths(config.ipc.socketPath);
  const taskDir = config.modules.tasks.taskDir;
  const stateFile = join(daemonPaths.root, 'task-state.json');
  const taskFiles = listGatewayTaskDefinitionFiles(taskDir);
  const runtimeState = loadGatewayTaskRuntimeState(stateFile);

  const parsedTasks: ParsedTaskDefinition[] = [];
  const parseErrors: Array<{ filePath: string; error: string }> = [];

  for (const filePath of taskFiles) {
    try {
      parsedTasks.push(parseTaskDefinition({
        filePath,
        rawContent: readFileSync(filePath, 'utf-8'),
        defaultTimeoutSeconds: config.modules.tasks.defaultTimeoutSeconds,
      }));
    } catch (error) {
      parseErrors.push({
        filePath,
        error: (error as Error).message,
      });
    }
  }

  parsedTasks.sort((left, right) => left.id.localeCompare(right.id) || left.filePath.localeCompare(right.filePath));

  const entries = parsedTasks.map((task) => {
    const runtime = runtimeState[task.key];

    return {
      task,
      runtime,
      status: resolveGatewayTaskStatus(task, runtime),
    };
  });

  const filteredEntries = statusFilter === 'all'
    ? entries
    : entries.filter((entry) => entry.status === statusFilter);

  const counts = countGatewayTaskStatuses(entries);

  const lines = [
    'Scheduled tasks',
    `Filter: ${statusFilter}`,
    `Task directory: ${taskDir}`,
    `State file: ${stateFile}`,
    `Summary: running=${counts.running}, active=${counts.active}, completed=${counts.completed}, disabled=${counts.disabled}, pending=${counts.pending}, error=${counts.error}`,
  ];

  if (entries.length === 0) {
    lines.push('', 'No valid task files found.');
  } else if (filteredEntries.length === 0) {
    lines.push('', `No tasks matched filter: ${statusFilter}`);
  } else {
    lines.push('');

    for (const entry of filteredEntries) {
      const { task, runtime, status } = entry;
      lines.push(`- ${task.id} [${status}]`);
      lines.push(`  schedule: ${formatGatewayTaskSchedule(task)}`);
      lines.push(`  profile: ${task.profile}`);

      if (runtime?.lastRunAt) {
        lines.push(`  last run: ${new Date(runtime.lastRunAt).toLocaleString()}`);
      }

      if (runtime?.lastStatus) {
        lines.push(`  last status: ${runtime.lastStatus}`);
      }
    }
  }

  if (parseErrors.length > 0) {
    lines.push('', `Parse errors (${parseErrors.length}):`);
    for (const error of parseErrors) {
      lines.push(`- ${error.filePath}: ${error.error}`);
    }
  }

  return lines.join('\n');
};

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

function toOptionalBoolean(value: string | undefined): boolean | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized.length === 0) {
    return undefined;
  }

  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) {
    return true;
  }

  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) {
    return false;
  }

  return undefined;
}

function resolvePiTimeoutMs(): number | undefined {
  const raw = process.env.PERSONAL_AGENT_PI_TIMEOUT_MS;
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return DEFAULT_PI_TIMEOUT_MS;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_PI_TIMEOUT_MS;
  }

  if (parsed <= 0) {
    return undefined;
  }

  return Math.floor(parsed);
}

function splitMessage(text: string, chunkSize = TELEGRAM_MAX_MESSAGE_CHARS): string[] {
  if (text.length <= chunkSize) {
    return [text];
  }

  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    chunks.push(text.slice(start, start + chunkSize));
    start += chunkSize;
  }

  return chunks;
}

function splitLongLineForTelegram(line: string, maxLength: number): string[] {
  if (line.length <= maxLength) {
    return [line];
  }

  const segments: string[] = [];
  let remaining = line;

  while (remaining.length > maxLength) {
    const candidate = remaining.slice(0, maxLength);
    const splitAt = Math.max(
      candidate.lastIndexOf(' '),
      candidate.lastIndexOf('\t'),
      candidate.lastIndexOf(','),
      candidate.lastIndexOf(';'),
    );

    if (splitAt <= 0 || splitAt < Math.floor(maxLength * 0.4)) {
      segments.push(candidate);
      remaining = remaining.slice(maxLength);
      continue;
    }

    segments.push(remaining.slice(0, splitAt + 1));
    remaining = remaining.slice(splitAt + 1);
  }

  if (remaining.length > 0) {
    segments.push(remaining);
  }

  return segments;
}

export function splitTelegramMessage(text: string, chunkSize = TELEGRAM_MAX_MESSAGE_CHARS): string[] {
  if (text.length <= chunkSize) {
    return [text];
  }

  const chunks: string[] = [];
  const lines = text.split('\n');
  let currentChunk = '';
  let activeFenceLanguage: string | null = null;

  const pushChunk = (): void => {
    if (currentChunk.length === 0) {
      return;
    }

    let finalizedChunk = currentChunk;

    if (activeFenceLanguage !== null && !finalizedChunk.trimEnd().endsWith('```')) {
      finalizedChunk = `${finalizedChunk}${finalizedChunk.endsWith('\n') ? '' : '\n'}\`\`\``;
    }

    chunks.push(finalizedChunk);
    currentChunk = activeFenceLanguage !== null ? `\`\`\`${activeFenceLanguage}\n` : '';
  };

  const appendText = (segment: string): void => {
    let remaining = segment;

    while (remaining.length > 0) {
      const closingFenceReserve = activeFenceLanguage !== null ? 4 : 0;
      const available = chunkSize - currentChunk.length - closingFenceReserve;

      if (available <= 0) {
        pushChunk();
        continue;
      }

      if (remaining.length <= available) {
        currentChunk += remaining;
        remaining = '';
        continue;
      }

      const splitSegments = splitLongLineForTelegram(remaining, available);
      const nextSegment = splitSegments[0] ?? '';
      currentChunk += nextSegment;
      remaining = remaining.slice(nextSegment.length);
      pushChunk();
    }
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    const lineWithNewLine = index < lines.length - 1 ? `${line}\n` : line;

    appendText(lineWithNewLine);

    const fenceMatch = line.trim().match(/^```\s*([^`]*)$/);
    if (!fenceMatch) {
      continue;
    }

    if (activeFenceLanguage === null) {
      activeFenceLanguage = (fenceMatch[1] ?? '').trim();
    } else {
      activeFenceLanguage = null;
    }
  }

  if (currentChunk.length > 0) {
    if (activeFenceLanguage !== null && !currentChunk.trimEnd().endsWith('```')) {
      currentChunk = `${currentChunk}${currentChunk.endsWith('\n') ? '' : '\n'}\`\`\``;
    }

    chunks.push(currentChunk);
  }

  return chunks;
}

function inferMimeTypeFromPath(filePath: string): string | undefined {
  switch (extname(filePath).toLowerCase()) {
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.gif':
      return 'image/gif';
    case '.webp':
      return 'image/webp';
    case '.txt':
      return 'text/plain';
    case '.md':
      return 'text/markdown';
    case '.json':
      return 'application/json';
    case '.csv':
      return 'text/csv';
    case '.pdf':
      return 'application/pdf';
    case '.ogg':
      return 'audio/ogg';
    case '.wav':
      return 'audio/wav';
    case '.mp3':
      return 'audio/mpeg';
    default:
      return undefined;
  }
}

function selectBestTelegramPhoto(photoSizes: TelegramPhotoSizeLike[]): TelegramPhotoSizeLike | undefined {
  if (photoSizes.length === 0) {
    return undefined;
  }

  const sorted = [...photoSizes].sort((left, right) => {
    const leftSize = (left.file_size ?? 0) || ((left.width ?? 0) * (left.height ?? 0));
    const rightSize = (right.file_size ?? 0) || ((right.width ?? 0) * (right.height ?? 0));
    return leftSize - rightSize;
  });

  return sorted[sorted.length - 1];
}

function inferStickerMimeType(sticker: TelegramStickerLike): string {
  if (sticker.is_video) {
    return 'video/webm';
  }

  if (sticker.is_animated) {
    return 'application/x-tgsticker';
  }

  return 'image/webp';
}

function extractTelegramInboundMedia(message: TelegramMessageLike): TelegramInboundMediaReference[] {
  const media: TelegramInboundMediaReference[] = [];

  if (message.document?.file_id) {
    media.push({
      kind: 'document',
      fileId: message.document.file_id,
      fileName: message.document.file_name,
      mimeType: message.document.mime_type,
      fileSizeBytes: message.document.file_size,
    });
  }

  if (Array.isArray(message.photo) && message.photo.length > 0) {
    const bestPhoto = selectBestTelegramPhoto(message.photo);
    if (bestPhoto?.file_id) {
      media.push({
        kind: 'photo',
        fileId: bestPhoto.file_id,
        mimeType: 'image/jpeg',
        fileSizeBytes: bestPhoto.file_size,
        width: bestPhoto.width,
        height: bestPhoto.height,
      });
    }
  }

  if (message.voice?.file_id) {
    media.push({
      kind: 'voice',
      fileId: message.voice.file_id,
      mimeType: message.voice.mime_type,
      durationSeconds: message.voice.duration,
      fileSizeBytes: message.voice.file_size,
    });
  }

  if (message.animation?.file_id) {
    media.push({
      kind: 'animation',
      fileId: message.animation.file_id,
      fileName: message.animation.file_name,
      mimeType: message.animation.mime_type,
      fileSizeBytes: message.animation.file_size,
      durationSeconds: message.animation.duration,
      width: message.animation.width,
      height: message.animation.height,
    });
  }

  if (message.video?.file_id) {
    media.push({
      kind: 'video',
      fileId: message.video.file_id,
      fileName: message.video.file_name,
      mimeType: message.video.mime_type,
      fileSizeBytes: message.video.file_size,
      durationSeconds: message.video.duration,
      width: message.video.width,
      height: message.video.height,
    });
  }

  if (message.sticker?.file_id) {
    media.push({
      kind: 'sticker',
      fileId: message.sticker.file_id,
      mimeType: inferStickerMimeType(message.sticker),
      fileSizeBytes: message.sticker.file_size,
      width: message.sticker.width,
      height: message.sticker.height,
    });
  }

  return media;
}

function describeTelegramInboundMedia(media: TelegramPreparedInboundMedia): string {
  const details: string[] = [];

  if (media.fileName) {
    details.push(`name=${media.fileName}`);
  }

  if (media.mimeType) {
    details.push(`mime=${media.mimeType}`);
  }

  if (typeof media.fileSizeBytes === 'number') {
    details.push(`size=${media.fileSizeBytes}B`);
  }

  if (typeof media.durationSeconds === 'number') {
    details.push(`duration=${media.durationSeconds}s`);
  }

  const detailSuffix = details.length > 0 ? ` (${details.join(', ')})` : '';
  return `- [${media.kind}] \`${media.localPath}\`${detailSuffix}`;
}

function buildPromptFromTelegramMedia(
  baseText: string,
  preparedMedia: TelegramPreparedInboundMedia[],
): { prompt: string; images: PromptImageAttachment[] } {
  const images = preparedMedia
    .map((media) => media.imageContent)
    .filter((image): image is PromptImageAttachment => Boolean(image));

  const promptLines: string[] = [];
  if (baseText.trim().length > 0) {
    promptLines.push(baseText.trim());
  } else {
    promptLines.push('Please inspect the attached media and help the user.');
  }

  promptLines.push('', 'User attached the following media files:');
  for (const media of preparedMedia) {
    promptLines.push(describeTelegramInboundMedia(media));
  }

  promptLines.push('', 'Use the file paths above with tools when needed.');

  return {
    prompt: promptLines.join('\n'),
    images,
  };
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

function resolveGatewayExtensionPaths(): string[] {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const extensionNames = ['gateway-context'];
  const resolved: string[] = [];

  for (const extensionName of extensionNames) {
    const candidates = [
      join(moduleDir, 'extensions', `${extensionName}.js`),
      join(moduleDir, 'extensions', `${extensionName}.ts`),
    ];

    for (const candidate of candidates) {
      if (existsSync(candidate)) {
        resolved.push(candidate);
        break;
      }
    }
  }

  return resolved;
}

function buildGatewayExtensionEntries(profile: ResolvedProfile): string[] {
  const merged = [...profile.extensionEntries];

  for (const extensionPath of resolveGatewayExtensionPaths()) {
    if (!merged.includes(extensionPath)) {
      merged.push(extensionPath);
    }
  }

  return merged;
}

function buildGatewaySettingsManager(profile: ResolvedProfile, cwd: string, agentDir: string): SettingsManager {
  const settingsManager = SettingsManager.create(cwd, agentDir);

  if (profile.skillDirs.length > 0) {
    settingsManager.applyOverrides({
      skills: profile.skillDirs,
    });
  }

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
  provider?: 'telegram';
  conversationId?: string;
}): Promise<PiAgentSession> {
  const settingsManager = buildGatewaySettingsManager(options.profile, options.cwd, options.agentDir);
  const eventBus = createEventBus();

  const resourceLoader = new DefaultResourceLoader({
    cwd: options.cwd,
    agentDir: options.agentDir,
    settingsManager,
    eventBus,
    additionalExtensionPaths: buildGatewayExtensionEntries(options.profile),
    additionalPromptTemplatePaths: options.profile.promptEntries,
  });

  await resourceLoader.reload();

  const sessionManager = createPersistentSessionManager(options.cwd, options.sessionFile);
  if (options.provider && options.conversationId) {
    setGatewayExtensionRuntimeContext(sessionManager, {
      provider: options.provider,
      conversationId: options.conversationId,
    });
  }

  const { session, extensionsResult } = await createAgentSession({
    cwd: options.cwd,
    agentDir: options.agentDir,
    sessionManager,
    settingsManager,
    resourceLoader,
  });

  for (const { path, error } of extensionsResult.errors) {
    console.error(`Failed to load extension "${path}": ${error}`);
  }

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
    tools: [],
  });

  try {
    const search = options.search?.trim().toLowerCase();
    const seen = new Set<string>();
    const models: string[] = [];

    const availableModels = session.modelRegistry.getAvailable();
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
  images?: PromptImageAttachment[];
  abortSignal?: AbortSignal;
  logContext?: {
    source: string;
    userId: string;
    userName?: string;
  };
}

async function runPiPrintPrompt(options: RunPiPrintPromptOptions): Promise<string> {
  const timeoutMs = resolvePiTimeoutMs();

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

    if (timeoutMs !== undefined) {
      timeoutHandle = setTimeout(() => {
        fail(`pi timed out after ${timeoutMs}ms`);
      }, timeoutMs);
    }

    if (abortSignal?.aborted) {
      fail(PROMPT_CANCELLED_ERROR_MESSAGE);
      return;
    }

    abortSignal?.addEventListener('abort', onAbort, { once: true });

    void (async () => {
      try {
        await applyRequestedModel(session, options.model);
        await session.prompt(options.prompt, {
          images: options.images,
        });

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
  provider: 'telegram';
  conversationId: string;
  profile: ResolvedProfile;
  agentDir: string;
  cwd: string;
  sessionFile: string;
}

interface ActiveConversationRun {
  streamedOutput: string;
  parser?: PiJsonStreamParser;
  onTextDelta?: (delta: string) => void;
  onToolActivity?: (event: ToolActivityEvent) => void;
  toolCallsById: Map<string, { name: string; args: string }>;
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

function isLikelyUnsupportedImageInputError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();

  const mentionsImageInput = normalized.includes('image')
    || normalized.includes('vision')
    || normalized.includes('multimodal');

  const indicatesUnsupported = normalized.includes('not support')
    || normalized.includes('unsupported')
    || normalized.includes('not enabled')
    || normalized.includes('text-only')
    || normalized.includes('text only')
    || normalized.includes('invalid image')
    || normalized.includes('image input');

  return mentionsImageInput && indicatesUnsupported;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class PersistentConversationController implements GatewayConversationController {
  private readonly provider: 'telegram';
  private readonly conversationId: string;
  private readonly profile: ResolvedProfile;
  private readonly agentDir: string;
  private readonly cwd: string;
  private readonly initialSessionFile: string;

  private session?: PiAgentSession;
  private sessionPromise?: Promise<PiAgentSession>;
  private unsubscribe?: () => void;

  private activeRun?: ActiveConversationRun;
  private dispatchChain: Promise<void> = Promise.resolve();
  private disposed = false;

  constructor(options: PersistentConversationControllerOptions) {
    this.provider = options.provider;
    this.conversationId = options.conversationId;
    this.profile = options.profile;
    this.agentDir = options.agentDir;
    this.cwd = options.cwd;
    this.initialSessionFile = options.sessionFile;
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

  async compact(customInstructions?: string): Promise<string> {
    this.ensureActive();

    if (this.activeRun) {
      await this.abortCurrent();
    }

    const session = await this.getSession();
    const result = await session.compact(customInstructions?.trim() || undefined);

    const lines = ['Context compacted.'];
    lines.push(`Tokens before: ${result.tokensBefore}`);

    const summary = result.summary.trim();
    if (summary.length > 0) {
      lines.push('', summary);
    }

    return lines.join('\n');
  }

  async getUserMessagesForForking(): Promise<ForkableConversationMessage[]> {
    this.ensureActive();

    if (this.activeRun) {
      throw new Error('Cannot fork while a response is running. Use /stop first.');
    }

    const session = await this.getSession();
    const messages = session.getUserMessagesForForking();

    return messages.map((message) => ({
      entryId: message.entryId,
      text: message.text,
    }));
  }

  async fork(entryId: string): Promise<ForkConversationResult> {
    this.ensureActive();

    if (this.activeRun) {
      throw new Error('Cannot fork while a response is running. Use /stop first.');
    }

    const trimmedEntryId = entryId.trim();
    if (trimmedEntryId.length === 0) {
      throw new Error('Fork entry ID cannot be empty.');
    }

    const session = await this.getSession();
    const result = await session.fork(trimmedEntryId);

    return {
      selectedText: result.selectedText,
      cancelled: result.cancelled,
      sessionFile: session.sessionFile ?? this.initialSessionFile,
    };
  }

  async getSessionFile(): Promise<string> {
    this.ensureActive();

    const session = await this.getSession();
    return session.sessionFile ?? this.initialSessionFile;
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
      onTextDelta: input.onTextDelta,
      onToolActivity: input.onToolActivity,
      toolCallsById: new Map<string, { name: string; args: string }>(),
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

    const hasImages = Boolean(input.images && input.images.length > 0);

    try {
      await session.prompt(input.prompt, {
        images: input.images,
      });
    } catch (error) {
      if (!hasImages || !isLikelyUnsupportedImageInputError(error)) {
        throw error;
      }

      await session.prompt(input.prompt);
    }

    const streamed = activeRun.streamedOutput.trim();
    const fallback = extractLatestAssistantText(session.messages as unknown);
    return streamed.length > 0 ? streamed : fallback;
  }

  private async executeRunWithTimeout(
    input: RunPromptFnInput,
    activeRun: ActiveConversationRun,
  ): Promise<string> {
    const timeoutMs = resolvePiTimeoutMs();
    if (timeoutMs === undefined) {
      return this.executeRun(input, activeRun);
    }

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
        const hasImages = Boolean(input.images && input.images.length > 0);

        try {
          if (mode === 'steer') {
            await session.steer(input.prompt, input.images);
          } else {
            await session.followUp(input.prompt, input.images);
          }
        } catch (error) {
          if (!hasImages || !isLikelyUnsupportedImageInputError(error)) {
            throw error;
          }

          if (mode === 'steer') {
            await session.steer(input.prompt);
          } else {
            await session.followUp(input.prompt);
          }
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
      sessionFile: this.initialSessionFile,
      provider: this.provider,
      conversationId: this.conversationId,
    }).then((session) => {
      this.session = session;
      this.unsubscribe = session.subscribe((event) => {
        this.handleSessionEvent(event as unknown as PiJsonEvent);
      });
      return session;
    });

    return this.sessionPromise;
  }

  private emitToolActivity(activeRun: ActiveConversationRun, event: ToolActivityEvent): void {
    if (!activeRun.onToolActivity) {
      return;
    }

    try {
      activeRun.onToolActivity(event);
    } catch {
      // Ignore downstream tool activity callback failures and keep the run alive.
    }
  }

  private handleToolActivityEvent(event: PiJsonEvent, activeRun: ActiveConversationRun): void {
    if (!activeRun.onToolActivity) {
      return;
    }

    if (event.type === 'message_update') {
      const msgEvent = event.assistantMessageEvent;
      if (!msgEvent || !msgEvent.toolCall?.id) {
        return;
      }

      const toolId = msgEvent.toolCall.id;
      if (!toolId) {
        return;
      }

      if (msgEvent.type === 'toolcall_start') {
        activeRun.toolCallsById.set(toolId, {
          name: msgEvent.toolCall.name || 'unknown',
          args: '',
        });
        return;
      }

      if (msgEvent.type === 'toolcall_delta') {
        const existing = activeRun.toolCallsById.get(toolId);
        if (!existing || typeof msgEvent.delta !== 'string') {
          return;
        }

        existing.args += msgEvent.delta;
        return;
      }

      if (msgEvent.type === 'toolcall_end') {
        const existing = activeRun.toolCallsById.get(toolId);
        const toolName = existing?.name || msgEvent.toolCall.name || 'unknown';
        let args: Record<string, unknown> = {};

        if (existing?.args && existing.args.trim().length > 0) {
          try {
            const parsed = JSON.parse(existing.args) as unknown;
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
              args = parsed as Record<string, unknown>;
            } else {
              args = { raw: existing.args };
            }
          } catch {
            args = { raw: existing.args };
          }
        } else if (msgEvent.toolCall.arguments && typeof msgEvent.toolCall.arguments === 'object') {
          args = msgEvent.toolCall.arguments;
        }

        this.emitToolActivity(activeRun, {
          phase: 'call',
          toolName,
          args,
        });

        activeRun.toolCallsById.delete(toolId);
        return;
      }

      return;
    }

    if (event.type !== 'tool_execution_end') {
      return;
    }

    const toolName = event.toolName || 'unknown';
    const resultText = event.result?.content
      ?.filter((item) => item.type === 'text')
      .map((item) => item.text || '')
      .join('') || '';

    this.emitToolActivity(activeRun, {
      phase: 'result',
      toolName,
      resultText,
      isError: Boolean(event.isError || event.result?.isError),
    });
  }

  private handleSessionEvent(event: PiJsonEvent): void {
    const activeRun = this.activeRun;
    if (!activeRun) {
      return;
    }

    if (activeRun.parser) {
      activeRun.parser.parseEvent(event);
    }

    this.handleToolActivityEvent(event, activeRun);

    if (event.type === 'message_update' && event.assistantMessageEvent?.type === 'text_delta') {
      const delta = event.assistantMessageEvent.delta;
      if (typeof delta === 'string') {
        activeRun.streamedOutput += delta;

        if (activeRun.onTextDelta) {
          try {
            activeRun.onTextDelta(delta);
          } catch {
            // Ignore downstream streaming callback failures and keep the run alive.
          }
        }
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

interface ResponseChunkStreamer {
  pushDelta: (delta: string) => void;
  finalize: (finalOutput: string) => Promise<void>;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function escapeTelegramHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function escapeTelegramHtmlAttribute(value: string): string {
  return escapeTelegramHtml(value).replaceAll('"', '&quot;');
}

function renderTelegramRichText(text: string): { text: string; parseMode?: TelegramParseMode } {
  const normalizedText = text.length > 0 ? text : '(empty response)';

  const hasMarkdownFormatting = /```/.test(normalizedText)
    || /^(#{1,6})\s+.+$/m.test(normalizedText)
    || /\*\*[^*\n][\s\S]*?\*\*/.test(normalizedText)
    || /(?<!\*)\*[^\s*][^*\n]*?[^\s*]\*(?!\*)/.test(normalizedText)
    || /`[^`\n]+`/.test(normalizedText)
    || /\|\|[\s\S]+?\|\|/.test(normalizedText)
    || /\[[^\]\n]+\]\((https?:\/\/[^\s)]+)\)/.test(normalizedText);

  if (!hasMarkdownFormatting) {
    return {
      text: normalizedText,
    };
  }

  const codeBlocks: string[] = [];
  const codeBlockTokenPrefix = '@@TG_CODE_BLOCK_';
  let withCodeBlockTokens = normalizedText.replace(/```([a-zA-Z0-9_-]*)\n?([\s\S]*?)```/g, (_match, language, code) => {
    const index = codeBlocks.length;
    const normalizedLanguage = typeof language === 'string' ? language.trim() : '';
    const normalizedCode = typeof code === 'string' ? code : '';
    const prefix = normalizedLanguage.length > 0 ? `${normalizedLanguage}\n` : '';
    codeBlocks.push(`${prefix}${normalizedCode}`);
    return `${codeBlockTokenPrefix}${index}@@`;
  });

  withCodeBlockTokens = escapeTelegramHtml(withCodeBlockTokens);

  let rendered = withCodeBlockTokens
    .replace(/^(#{1,6})\s+(.+)$/gm, (_match, _hashes, title: string) => `<b>${title.trim()}</b>`)
    .replace(/\*\*([^*\n][\s\S]*?)\*\*/g, (_match, boldText: string) => `<b>${boldText}</b>`)
    .replace(/(?<!\*)\*([^\s*][^*\n]*?[^\s*])\*(?!\*)/g, (_match, italicText: string) => `<i>${italicText}</i>`)
    .replace(/`([^`\n]+)`/g, (_match, codeText: string) => `<code>${codeText}</code>`)
    .replace(/\|\|([\s\S]+?)\|\|/g, (_match, spoilerText: string) => `<tg-spoiler>${spoilerText}</tg-spoiler>`)
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, (_match, label: string, url: string) =>
      `<a href="${escapeTelegramHtmlAttribute(url)}">${label}</a>`);

  rendered = rendered.replace(/@@TG_CODE_BLOCK_(\d+)@@/g, (_match, rawIndex: string) => {
    const index = Number.parseInt(rawIndex, 10);
    const code = codeBlocks[index] ?? '';
    return `<pre><code>${escapeTelegramHtml(code)}</code></pre>`;
  });

  return {
    text: rendered,
    parseMode: 'HTML',
  };
}

function invokeTelegramSendMessage(
  sendMessage: SendMessageFn,
  chatId: number,
  text: string,
  options?: TelegramSendMessageOptions,
): Promise<unknown> {
  if (!options || Object.keys(options).length === 0) {
    return sendMessage(chatId, text);
  }

  return sendMessage(chatId, text, options);
}

function invokeTelegramEditMessageText(
  editMessageText: EditMessageTextFn,
  chatId: number,
  messageId: number,
  text: string,
  options?: TelegramSendMessageOptions,
): Promise<unknown> {
  if (!options || Object.keys(options).length === 0) {
    return editMessageText(chatId, messageId, text);
  }

  return editMessageText(chatId, messageId, text, options);
}

function stripTelegramParseMode(options?: TelegramSendMessageOptions): TelegramSendMessageOptions | undefined {
  if (!options) {
    return undefined;
  }

  const rest: TelegramSendMessageOptions = { ...options };
  delete rest.parse_mode;

  if (Object.keys(rest).length === 0) {
    return undefined;
  }

  return rest;
}

function isTelegramEntityParseError(error: unknown): boolean {
  const statusCode = getTelegramErrorStatusCode(error);
  if (statusCode !== 400) {
    return false;
  }

  const message = error instanceof Error ? error.message : String(error);
  return /parse entities|can't parse|entity is malformed/i.test(message);
}

function isTelegramMessageNotModifiedError(error: unknown): boolean {
  const statusCode = getTelegramErrorStatusCode(error);
  if (statusCode !== 400) {
    return false;
  }

  const message = error instanceof Error ? error.message : String(error);
  return /message is not modified|specified new message content.*exactly the same/i.test(message);
}

async function sendTelegramFormattedMessage(
  sendMessage: SendMessageFn,
  chatId: number,
  text: string,
  options?: TelegramSendMessageOptions,
): Promise<unknown> {
  const rendered = renderTelegramRichText(text);
  const renderedOptions: TelegramSendMessageOptions = {
    ...(options ?? {}),
    ...(rendered.parseMode ? { parse_mode: rendered.parseMode } : {}),
  };

  try {
    return await invokeTelegramSendMessage(sendMessage, chatId, rendered.text, renderedOptions);
  } catch (error) {
    if (!isTelegramEntityParseError(error)) {
      throw error;
    }

    const plainOptions = stripTelegramParseMode(options);
    return invokeTelegramSendMessage(sendMessage, chatId, text, plainOptions);
  }
}

async function editTelegramFormattedMessage(
  editMessageText: EditMessageTextFn,
  chatId: number,
  messageId: number,
  text: string,
  options?: TelegramSendMessageOptions,
): Promise<unknown> {
  const rendered = renderTelegramRichText(text);
  const renderedOptions: TelegramSendMessageOptions = {
    ...(options ?? {}),
    ...(rendered.parseMode ? { parse_mode: rendered.parseMode } : {}),
  };

  try {
    return await invokeTelegramEditMessageText(editMessageText, chatId, messageId, rendered.text, renderedOptions);
  } catch (error) {
    if (isTelegramMessageNotModifiedError(error)) {
      return undefined;
    }

    if (!isTelegramEntityParseError(error)) {
      throw error;
    }

    const plainOptions = stripTelegramParseMode(options);

    try {
      return await invokeTelegramEditMessageText(editMessageText, chatId, messageId, text, plainOptions);
    } catch (fallbackError) {
      if (isTelegramMessageNotModifiedError(fallbackError)) {
        return undefined;
      }

      throw fallbackError;
    }
  }
}

function buildTelegramResponseActionOptions(): TelegramSendMessageOptions | undefined {
  return undefined;
}

interface TelegramOutputAttachment {
  path: string;
  kind: 'photo' | 'document';
}

function isTelegramImagePath(path: string): boolean {
  const extension = extname(path).toLowerCase();
  return extension === '.png'
    || extension === '.jpg'
    || extension === '.jpeg'
    || extension === '.gif'
    || extension === '.webp';
}

function normalizeTelegramAttachmentCandidate(rawCandidate: string): string {
  return rawCandidate
    .trim()
    .replace(/^file:\/\//i, '')
    .replace(/^[['"(<]+/, '')
    .replace(/['")>\],.;:!?]+$/, '');
}

function extractTelegramAttachmentCandidates(text: string): string[] {
  const candidates: string[] = [];

  const markdownImageRegex = /!\[[^\]]*\]\(([^)\n]+)\)/g;
  const markdownLinkRegex = /\[[^\]]+\]\(([^)\n]+)\)/g;
  const inlineCodeRegex = /`([^`\n]+\.[a-zA-Z0-9]{1,8})`/g;

  for (const regex of [markdownImageRegex, markdownLinkRegex, inlineCodeRegex]) {
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      const candidate = match[1];
      if (candidate) {
        candidates.push(candidate);
      }
    }
  }

  return candidates;
}

function resolveTelegramAttachmentPath(candidate: string, cwd: string): string | undefined {
  const normalized = normalizeTelegramAttachmentCandidate(candidate);
  if (normalized.length === 0) {
    return undefined;
  }

  if (/^[a-z]+:\/\//i.test(normalized)) {
    return undefined;
  }

  const absolutePath = normalized.startsWith('/')
    ? normalized
    : resolve(cwd, normalized);

  if (!existsSync(absolutePath)) {
    return undefined;
  }

  let stats;
  try {
    stats = statSync(absolutePath);
  } catch {
    return undefined;
  }

  if (!stats.isFile() || stats.size > TELEGRAM_MAX_ATTACHMENT_BYTES) {
    return undefined;
  }

  return absolutePath;
}

function extractTelegramOutputAttachments(text: string, cwd: string): TelegramOutputAttachment[] {
  const resolved = new Set<string>();
  const attachments: TelegramOutputAttachment[] = [];

  for (const candidate of extractTelegramAttachmentCandidates(text)) {
    const absolutePath = resolveTelegramAttachmentPath(candidate, cwd);
    if (!absolutePath || resolved.has(absolutePath)) {
      continue;
    }

    const extension = extname(absolutePath);
    if (extension.length === 0) {
      continue;
    }

    resolved.add(absolutePath);
    attachments.push({
      path: absolutePath,
      kind: isTelegramImagePath(absolutePath) ? 'photo' : 'document',
    });

    if (attachments.length >= TELEGRAM_MAX_AUTO_ATTACHMENTS) {
      break;
    }
  }

  return attachments;
}

function createTelegramTextExportPath(chatId: number, outputDir: string): string {
  const timestampToken = new Date().toISOString().replace(/[:.]/g, '-');
  const chatToken = sanitizeTelegramPendingToken(String(chatId));
  const fileName = `response_${chatToken}_${timestampToken}.txt`;
  return join(outputDir, fileName);
}

interface DeliverTelegramFinalResponseOptions {
  chatId: number;
  finalOutput: string;
  workingDirectory: string;
  sendMessage: SendMessageFn;
  editMessageText?: EditMessageTextFn;
  sendDocument?: SendDocumentFn;
  sendPhoto?: SendPhotoFn;
  previewMessageId?: number;
  outputDir?: string;
}

async function sendTelegramOutputAttachments(
  chatId: number,
  text: string,
  workingDirectory: string,
  sendDocument: SendDocumentFn | undefined,
  sendPhoto: SendPhotoFn | undefined,
): Promise<void> {
  if (!sendDocument && !sendPhoto) {
    return;
  }

  const attachments = extractTelegramOutputAttachments(text, workingDirectory);
  if (attachments.length === 0) {
    return;
  }

  for (const attachment of attachments) {
    const caption = `Attachment: ${basename(attachment.path)}`;

    if (attachment.kind === 'photo' && sendPhoto) {
      await sendPhoto(chatId, attachment.path, { caption });
      continue;
    }

    if (sendDocument) {
      await sendDocument(chatId, attachment.path, { caption });
    }
  }
}

async function deliverTelegramFinalResponse(options: DeliverTelegramFinalResponseOptions): Promise<void> {
  const text = options.finalOutput.length > 0 ? options.finalOutput : '(no output)';
  const actionOptions = buildTelegramResponseActionOptions();

  if (text.length > TELEGRAM_LONG_OUTPUT_FILE_THRESHOLD_CHARS && options.sendDocument) {
    const exportRoot = options.outputDir ?? join(options.workingDirectory, '.pa-telegram-exports');
    mkdirSync(exportRoot, { recursive: true });

    const exportFilePath = createTelegramTextExportPath(options.chatId, exportRoot);
    writeFileSync(exportFilePath, `${text}\n`, 'utf-8');

    const summary = 'Response is long. Sending the full output as a text file attachment.';

    if (options.previewMessageId !== undefined && options.editMessageText) {
      await editTelegramFormattedMessage(
        options.editMessageText,
        options.chatId,
        options.previewMessageId,
        summary,
        actionOptions,
      );
    } else {
      await sendTelegramFormattedMessage(options.sendMessage, options.chatId, summary, actionOptions);
    }

    await options.sendDocument(options.chatId, exportFilePath, {
      caption: `Full response (${basename(exportFilePath)})`,
    });

    await sendTelegramOutputAttachments(
      options.chatId,
      text,
      options.workingDirectory,
      options.sendDocument,
      options.sendPhoto,
    );

    return;
  }

  const chunks = splitTelegramMessage(text, TELEGRAM_MAX_MESSAGE_CHARS);
  const [firstChunk, ...restChunks] = chunks;

  if (typeof firstChunk === 'string') {
    if (options.previewMessageId !== undefined && options.editMessageText) {
      await editTelegramFormattedMessage(
        options.editMessageText,
        options.chatId,
        options.previewMessageId,
        firstChunk,
        actionOptions,
      );
    } else {
      await sendTelegramFormattedMessage(options.sendMessage, options.chatId, firstChunk, actionOptions);
    }
  }

  for (const chunk of restChunks) {
    await sendTelegramFormattedMessage(options.sendMessage, options.chatId, chunk);
  }

  await sendTelegramOutputAttachments(
    options.chatId,
    text,
    options.workingDirectory,
    options.sendDocument,
    options.sendPhoto,
  );
}

function buildTelegramStreamingPreviewText(text: string): string {
  if (text.length <= TELEGRAM_STREAMING_EDIT_PREVIEW_MAX_CHARS) {
    return text;
  }

  const truncated = text.slice(0, TELEGRAM_STREAMING_EDIT_PREVIEW_MAX_CHARS);
  return `${truncated}\n\n…`;
}

function findStreamingFlushLength(text: string): number {
  if (text.length < STREAMING_FLUSH_TARGET_CHARS) {
    return 0;
  }

  const limit = Math.min(text.length, TELEGRAM_MAX_MESSAGE_CHARS);
  const candidate = text.slice(0, limit);

  const boundaryCandidates = [
    candidate.lastIndexOf('\n\n') + 2,
    candidate.lastIndexOf('\n') + 1,
    candidate.lastIndexOf('. ') + 2,
    candidate.lastIndexOf('! ') + 2,
    candidate.lastIndexOf('? ') + 2,
    candidate.lastIndexOf(' ') + 1,
  ];

  for (const boundary of boundaryCandidates) {
    if (boundary >= STREAMING_FLUSH_MIN_CHARS) {
      return boundary;
    }
  }

  return limit;
}

function createResponseChunkStreamer(sendMessage: SendTextFn): ResponseChunkStreamer {
  let buffered = '';
  let streamedOutput = '';
  let sawDelta = false;
  let sendError: Error | undefined;
  let sendChain: Promise<void> = Promise.resolve();

  const queueSend = (text: string): void => {
    if (text.length === 0) {
      return;
    }

    sendChain = sendChain
      .then(async () => {
        if (sendError) {
          return;
        }

        await sendLongText(sendMessage, text);
      })
      .catch((error) => {
        sendError = toError(error);
      });
  };

  const flushBuffered = (force: boolean): void => {
    while (buffered.length > 0) {
      const flushLength = force
        ? Math.min(buffered.length, TELEGRAM_MAX_MESSAGE_CHARS)
        : findStreamingFlushLength(buffered);

      if (flushLength <= 0) {
        return;
      }

      const chunk = buffered.slice(0, flushLength);
      buffered = buffered.slice(flushLength);
      queueSend(chunk);
    }
  };

  return {
    pushDelta: (delta: string): void => {
      if (delta.length === 0) {
        return;
      }

      sawDelta = true;
      streamedOutput += delta;
      buffered += delta;
      flushBuffered(false);
    },

    finalize: async (finalOutput: string): Promise<void> => {
      if (!sawDelta) {
        const fallback = finalOutput.length > 0 ? finalOutput : '(no output)';
        queueSend(fallback);
      } else {
        flushBuffered(true);

        if (finalOutput.length > 0) {
          let suffix = '';

          if (finalOutput.startsWith(streamedOutput)) {
            suffix = finalOutput.slice(streamedOutput.length);
          } else if (
            streamedOutput.startsWith(finalOutput)
            || streamedOutput.trim() === finalOutput.trim()
          ) {
            suffix = '';
          } else if (streamedOutput.length === 0) {
            suffix = finalOutput;
          }

          if (suffix.length > 0) {
            queueSend(suffix);
          }
        }
      }

      await sendChain;
      if (sendError) {
        throw sendError;
      }
    },
  };
}

interface TelegramResponseChunkStreamerOptions {
  chatId: number;
  workingDirectory: string;
  sendMessage: SendMessageFn;
  editMessageText?: EditMessageTextFn;
  sendDocument?: SendDocumentFn;
  sendPhoto?: SendPhotoFn;
  outputDir?: string;
}

function createTelegramResponseChunkStreamer(options: TelegramResponseChunkStreamerOptions): ResponseChunkStreamer {
  let streamedOutput = '';
  let sawDelta = false;
  let previewMessageId: number | undefined;
  let sendError: Error | undefined;
  let sendChain: Promise<void> = Promise.resolve();
  let lastPreviewText = '';
  let lastPreviewEditAt = 0;

  const queue = (task: () => Promise<void>): void => {
    sendChain = sendChain
      .then(async () => {
        if (sendError) {
          return;
        }

        await task();
      })
      .catch((error) => {
        sendError = toError(error);
      });
  };

  const ensurePreviewMessage = (): void => {
    if (!options.editMessageText || previewMessageId !== undefined) {
      return;
    }

    queue(async () => {
      if (previewMessageId !== undefined) {
        return;
      }

      const sent = await sendTelegramFormattedMessage(options.sendMessage, options.chatId, '…');
      const sentMessageId = toTelegramSentMessageId(sent);
      if (typeof sentMessageId === 'number') {
        previewMessageId = sentMessageId;
      }
    });
  };

  const flushPreview = (force: boolean): void => {
    if (!options.editMessageText) {
      return;
    }

    if (!force && Date.now() - lastPreviewEditAt < TELEGRAM_STREAMING_EDIT_INTERVAL_MS) {
      return;
    }

    const previewText = buildTelegramStreamingPreviewText(streamedOutput);
    if (previewText.length === 0 || previewText === lastPreviewText) {
      return;
    }

    ensurePreviewMessage();

    queue(async () => {
      if (!options.editMessageText || previewMessageId === undefined) {
        return;
      }

      await editTelegramFormattedMessage(
        options.editMessageText,
        options.chatId,
        previewMessageId,
        previewText,
      );

      lastPreviewText = previewText;
      lastPreviewEditAt = Date.now();
    });
  };

  return {
    pushDelta: (delta: string): void => {
      if (delta.length === 0) {
        return;
      }

      sawDelta = true;
      streamedOutput += delta;
      flushPreview(false);
    },

    finalize: async (finalOutput: string): Promise<void> => {
      if (!sawDelta) {
        streamedOutput = finalOutput.length > 0 ? finalOutput : '(no output)';
      } else if (finalOutput.length > 0) {
        streamedOutput = finalOutput;
      }

      flushPreview(true);
      await sendChain;

      if (sendError) {
        throw sendError;
      }

      await deliverTelegramFinalResponse({
        chatId: options.chatId,
        finalOutput: streamedOutput,
        workingDirectory: options.workingDirectory,
        sendMessage: options.sendMessage,
        editMessageText: options.editMessageText,
        sendDocument: options.sendDocument,
        sendPhoto: options.sendPhoto,
        previewMessageId,
        outputDir: options.outputDir,
      });
    },
  };
}

interface ToolActivityStreamer {
  push: (event: ToolActivityEvent) => void;
  finalize: () => Promise<void>;
}

interface TelegramToolActivityStreamerOptions {
  chatId: number;
  enabled: boolean;
  sendMessage: SendMessageFn;
  editMessageText?: EditMessageTextFn;
  deleteMessage?: DeleteMessageFn;
}

function createTelegramToolActivityStreamer(options: TelegramToolActivityStreamerOptions): ToolActivityStreamer {
  if (!options.enabled) {
    return {
      push: () => {
        // no-op
      },
      finalize: async () => undefined,
    };
  }

  let statusMessageId: number | undefined;
  let sendError: Error | undefined;
  let sendChain: Promise<void> = Promise.resolve();
  let closed = false;
  let acknowledgementQueued = false;

  const queue = (task: () => Promise<void>): void => {
    sendChain = sendChain
      .then(async () => {
        if (sendError) {
          return;
        }

        await task();
      })
      .catch((error) => {
        sendError = toError(error);
      });
  };

  const ensureAcknowledgement = (): void => {
    if (statusMessageId !== undefined || acknowledgementQueued) {
      return;
    }

    acknowledgementQueued = true;

    queue(async () => {
      if (statusMessageId !== undefined) {
        return;
      }

      const sent = await sendTelegramFormattedMessage(options.sendMessage, options.chatId, '⚙️ Working…');
      const messageId = toTelegramSentMessageId(sent);
      if (typeof messageId === 'number') {
        statusMessageId = messageId;
      }
    });
  };

  return {
    push: (_event: ToolActivityEvent): void => {
      if (closed) {
        return;
      }

      ensureAcknowledgement();
    },
    finalize: async (): Promise<void> => {
      if (closed) {
        return;
      }

      closed = true;

      if (statusMessageId !== undefined && options.deleteMessage) {
        const messageId = statusMessageId;

        queue(async () => {
          await options.deleteMessage!(options.chatId, messageId);
          if (statusMessageId === messageId) {
            statusMessageId = undefined;
          }
        });
      }

      await sendChain;

      if (sendError) {
        throw sendError;
      }
    },
  };
}

export interface FlushGatewayNotificationsOptions {
  gateway: 'telegram';
  limit?: number;
  deliverNotification: (notification: GatewayNotification) => Promise<void>;
  pullNotifications?: (input: {
    gateway: 'telegram';
    limit?: number;
  }) => Promise<GatewayNotification[]>;
  requeueNotification?: (notification: GatewayNotification) => Promise<void>;
}

function toGatewayNotificationEventPayload(notification: GatewayNotification): Record<string, unknown> {
  return {
    gateway: notification.gateway,
    destinationId: notification.destinationId,
    ...(typeof notification.messageThreadId === 'number' ? { messageThreadId: notification.messageThreadId } : {}),
    message: notification.message,
    taskId: notification.taskId,
    status: notification.status,
    logPath: notification.logPath,
    createdAt: notification.createdAt,
  };
}

export async function flushGatewayNotifications(
  options: FlushGatewayNotificationsOptions,
): Promise<number> {
  const pullNotifications = options.pullNotifications ?? pullGatewayNotifications;
  const requeueNotification = options.requeueNotification ?? ((notification: GatewayNotification) =>
    emitDaemonEventNonFatal({
      type: 'gateway.notification',
      source: 'gateway',
      payload: toGatewayNotificationEventPayload(notification),
    }));

  const notifications = await pullNotifications({
    gateway: options.gateway,
    limit: options.limit ?? 20,
  });

  if (notifications.length === 0) {
    return 0;
  }

  let deliveredCount = 0;

  for (const notification of notifications) {
    try {
      await options.deliverNotification(notification);
      deliveredCount += 1;
    } catch (error) {
      console.warn(gatewayWarning(
        `Failed to deliver daemon ${options.gateway} notification ${notification.id}: ${(error as Error).message}`,
      ));

      await requeueNotification(notification);
      break;
    }
  }

  return deliveredCount;
}

function toNumericDestinationId(value: string): number | undefined {
  if (!/^-?\d+$/.test(value.trim())) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function toTelegramSentMessageId(value: unknown): number | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const candidate = value as { message_id?: unknown };
  return typeof candidate.message_id === 'number' ? candidate.message_id : undefined;
}

function toTrackedScheduledReplyContextKey(chatId: string, messageId: number): string {
  return `${chatId}:${messageId}`;
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

interface TelegramConversationBindingRecord {
  sessionFile: string;
  updatedAt: string;
}

interface StoredTelegramConversationBindings {
  version: 1;
  conversations: Record<string, TelegramConversationBindingRecord>;
}

interface TelegramWorkTopicBinding {
  sourceConversationId: string;
  sourceChatId: string;
  sourceMessageThreadId?: number;
  workConversationId: string;
  workChatId: number;
  workMessageThreadId: number;
  topicName: string;
  sessionFile: string;
  createdAt: string;
  updatedAt: string;
}

interface StoredTelegramWorkTopicBindings {
  version: 1;
  bindings: TelegramWorkTopicBinding[];
}

function loadTelegramWorkTopicBindings(filePath: string): Map<string, TelegramWorkTopicBinding> {
  if (!existsSync(filePath)) {
    return new Map<string, TelegramWorkTopicBinding>();
  }

  try {
    const raw = readFileSync(filePath, 'utf-8').trim();
    if (raw.length === 0) {
      return new Map<string, TelegramWorkTopicBinding>();
    }

    const parsed = JSON.parse(raw) as Partial<StoredTelegramWorkTopicBindings>;
    if (parsed.version !== 1 || !Array.isArray(parsed.bindings)) {
      return new Map<string, TelegramWorkTopicBinding>();
    }

    const bindings = new Map<string, TelegramWorkTopicBinding>();

    for (const item of parsed.bindings) {
      if (!item || typeof item !== 'object') {
        continue;
      }

      const sourceConversationId = typeof item.sourceConversationId === 'string'
        ? item.sourceConversationId.trim()
        : '';
      const workConversationId = typeof item.workConversationId === 'string'
        ? item.workConversationId.trim()
        : '';
      const sourceChatId = typeof item.sourceChatId === 'string'
        ? item.sourceChatId.trim()
        : '';
      const topicName = typeof item.topicName === 'string'
        ? item.topicName.trim()
        : '';
      const sessionFile = typeof item.sessionFile === 'string'
        ? item.sessionFile.trim()
        : '';
      const workChatId = typeof item.workChatId === 'number' && Number.isFinite(item.workChatId)
        ? Math.floor(item.workChatId)
        : undefined;
      const workMessageThreadId = normalizeTelegramMessageThreadId(item.workMessageThreadId);

      if (!sourceConversationId || !workConversationId || !sourceChatId || !topicName || !sessionFile) {
        continue;
      }

      if (workChatId === undefined || workMessageThreadId === undefined) {
        continue;
      }

      bindings.set(sourceConversationId, {
        sourceConversationId,
        sourceChatId,
        sourceMessageThreadId: normalizeTelegramMessageThreadId(item.sourceMessageThreadId),
        workConversationId,
        workChatId,
        workMessageThreadId,
        topicName,
        sessionFile,
        createdAt: typeof item.createdAt === 'string' ? item.createdAt : new Date().toISOString(),
        updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : new Date().toISOString(),
      });
    }

    return bindings;
  } catch {
    return new Map<string, TelegramWorkTopicBinding>();
  }
}

function writeTelegramWorkTopicBindings(filePath: string, bindings: Map<string, TelegramWorkTopicBinding>): void {
  mkdirSync(dirname(filePath), { recursive: true });

  const payload: StoredTelegramWorkTopicBindings = {
    version: 1,
    bindings: [...bindings.values()],
  };

  writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8');
}

function readRunExitCodeFromLog(logPath: string | undefined): number | undefined {
  if (!logPath) {
    return undefined;
  }

  try {
    const text = readFileSync(logPath, 'utf-8');
    const matches = [...text.matchAll(/__PA_RUN_EXIT_CODE=(\d+)/g)];
    const last = matches[matches.length - 1];
    if (!last || !last[1]) {
      return undefined;
    }

    const parsed = Number.parseInt(last[1], 10);
    return Number.isFinite(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function readRunLogTail(logPath: string | undefined, lineCount = 40): string {
  if (!logPath) {
    return '';
  }

  try {
    const text = readFileSync(logPath, 'utf-8');
    const lines = text
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0)
      .slice(-lineCount);

    return lines.join('\n').trim();
  } catch {
    return '';
  }
}

function loadTelegramConversationBindings(filePath: string): Map<string, string> {
  if (!existsSync(filePath)) {
    return new Map<string, string>();
  }

  try {
    const raw = readFileSync(filePath, 'utf-8').trim();
    if (raw.length === 0) {
      return new Map<string, string>();
    }

    const parsed = JSON.parse(raw) as Partial<StoredTelegramConversationBindings>;
    if (parsed.version !== 1 || !parsed.conversations || typeof parsed.conversations !== 'object') {
      return new Map<string, string>();
    }

    const bindings = new Map<string, string>();
    for (const [conversationId, record] of Object.entries(parsed.conversations)) {
      if (!record || typeof record !== 'object') {
        continue;
      }

      const sessionFile = (record as { sessionFile?: unknown }).sessionFile;
      if (typeof sessionFile !== 'string') {
        continue;
      }

      const trimmedConversationId = conversationId.trim();
      const trimmedSessionFile = sessionFile.trim();
      if (trimmedConversationId.length === 0 || trimmedSessionFile.length === 0) {
        continue;
      }

      bindings.set(trimmedConversationId, trimmedSessionFile);
    }

    return bindings;
  } catch {
    return new Map<string, string>();
  }
}

function writeTelegramConversationBindings(filePath: string, bindings: Map<string, string>): void {
  mkdirSync(dirname(filePath), { recursive: true });

  const conversations: Record<string, TelegramConversationBindingRecord> = {};
  const updatedAt = new Date().toISOString();

  for (const [conversationId, sessionFile] of bindings.entries()) {
    const trimmedConversationId = conversationId.trim();
    const trimmedSessionFile = sessionFile.trim();

    if (trimmedConversationId.length === 0 || trimmedSessionFile.length === 0) {
      continue;
    }

    conversations[trimmedConversationId] = {
      sessionFile: trimmedSessionFile,
      updatedAt,
    };
  }

  const payload: StoredTelegramConversationBindings = {
    version: 1,
    conversations,
  };

  writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8');
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

  if (candidate.caption !== undefined && typeof candidate.caption !== 'string') {
    return false;
  }

  if (candidate.document !== undefined) {
    if (!candidate.document || typeof candidate.document !== 'object') {
      return false;
    }

    const document = candidate.document as Record<string, unknown>;
    if (typeof document.file_id !== 'string') {
      return false;
    }
  }

  if (candidate.photo !== undefined) {
    if (!Array.isArray(candidate.photo)) {
      return false;
    }

    for (const size of candidate.photo) {
      if (!size || typeof size !== 'object') {
        return false;
      }

      const photoSize = size as Record<string, unknown>;
      if (typeof photoSize.file_id !== 'string') {
        return false;
      }
    }
  }

  if (candidate.voice !== undefined) {
    if (!candidate.voice || typeof candidate.voice !== 'object') {
      return false;
    }

    const voice = candidate.voice as Record<string, unknown>;
    if (typeof voice.file_id !== 'string') {
      return false;
    }
  }

  if (candidate.reply_to_message !== undefined) {
    if (!candidate.reply_to_message || typeof candidate.reply_to_message !== 'object') {
      return false;
    }

    const replyTo = candidate.reply_to_message as Record<string, unknown>;
    if (replyTo.message_id !== undefined && typeof replyTo.message_id !== 'number') {
      return false;
    }
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

function isTelegramTopicCreationPermissionError(error: unknown): boolean {
  const statusCode = getTelegramErrorStatusCode(error);
  if (statusCode !== 400 && statusCode !== 403) {
    return false;
  }

  const message = error instanceof Error ? error.message : String(error);
  return /not enough rights to create a topic|not enough rights|forbidden/i.test(message);
}

function isTelegramTopicsNotEnabledError(error: unknown): boolean {
  const statusCode = getTelegramErrorStatusCode(error);
  if (statusCode !== 400) {
    return false;
  }

  const message = error instanceof Error ? error.message : String(error);
  return /topics? (are|is) not enabled|forum topic/i.test(message);
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

function buildTelegramForkSelectionOptions(messages: ForkableConversationMessage[]): TelegramSendMessageOptions | undefined {
  const inlineKeyboard: TelegramInlineKeyboardButton[][] = [];

  for (let index = 0; index < Math.min(messages.length, 5); index += 1) {
    const entry = messages[index] as ForkableConversationMessage;
    const callbackData = `${TELEGRAM_FORK_SELECTION_CALLBACK_PREFIX}${entry.entryId}`;

    if (callbackData.length > 64) {
      continue;
    }

    inlineKeyboard.push([
      {
        text: truncateTelegramButtonLabel(`${index + 1}. ${trimForkMessagePreview(entry.text, 44)}`),
        callback_data: callbackData,
      },
    ]);
  }

  if (inlineKeyboard.length === 0) {
    return undefined;
  }

  return {
    reply_markup: {
      inline_keyboard: inlineKeyboard,
    },
  };
}

function buildTelegramResumeSelectionOptions(
  entries: GatewayResumeConversationOption[],
): TelegramSendMessageOptions | undefined {
  const inlineKeyboard: TelegramInlineKeyboardButton[][] = [];

  for (let index = 0; index < Math.min(entries.length, 8); index += 1) {
    const entry = entries[index] as GatewayResumeConversationOption;

    inlineKeyboard.push([
      {
        text: truncateTelegramButtonLabel(`${index + 1}. ${entry.label}`, 52),
        callback_data: `${TELEGRAM_RESUME_SELECTION_CALLBACK_PREFIX}${index + 1}`,
      },
    ]);
  }

  if (inlineKeyboard.length === 0) {
    return undefined;
  }

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

function parseTelegramForkSelectionCallback(data: string): string | undefined {
  if (!data.startsWith(TELEGRAM_FORK_SELECTION_CALLBACK_PREFIX)) {
    return undefined;
  }

  const entryId = data.slice(TELEGRAM_FORK_SELECTION_CALLBACK_PREFIX.length).trim();
  if (entryId.length === 0) {
    return undefined;
  }

  return `/fork ${entryId}`;
}

function parseTelegramResumeSelectionCallback(data: string): string | undefined {
  if (!data.startsWith(TELEGRAM_RESUME_SELECTION_CALLBACK_PREFIX)) {
    return undefined;
  }

  const indexText = data.slice(TELEGRAM_RESUME_SELECTION_CALLBACK_PREFIX.length).trim();
  if (!/^\d+$/.test(indexText)) {
    return undefined;
  }

  return `/resume ${indexText}`;
}

function parseTelegramActionCallback(data: string): '/stop' | '/new' | '/regenerate' | '/followup' | undefined {
  if (!data.startsWith(TELEGRAM_ACTION_CALLBACK_PREFIX)) {
    return undefined;
  }

  const action = data.slice(TELEGRAM_ACTION_CALLBACK_PREFIX.length).trim().toLowerCase();

  switch (action) {
    case 'stop':
      return '/stop';
    case 'new':
      return '/new';
    case 'regenerate':
      return '/regenerate';
    case 'followup':
      return '/followup';
    default:
      return undefined;
  }
}

interface TelegramRoomAuthCallback {
  action: 'approve' | 'deny';
  requestToken: string;
}

function parseTelegramRoomAuthCallback(data: string): TelegramRoomAuthCallback | undefined {
  if (!data.startsWith(TELEGRAM_ROOM_AUTH_CALLBACK_PREFIX)) {
    return undefined;
  }

  const suffix = data.slice(TELEGRAM_ROOM_AUTH_CALLBACK_PREFIX.length);
  const [rawAction, ...tokenParts] = suffix.split(':');
  const action = rawAction?.trim().toLowerCase();
  const requestToken = tokenParts.join(':').trim();

  if ((action !== 'approve' && action !== 'deny') || requestToken.length === 0) {
    return undefined;
  }

  return {
    action,
    requestToken,
  };
}

interface TelegramChatMemberLike {
  status?: string;
  user?: TelegramUserLike;
}

interface TelegramChatMemberUpdateLike {
  chat?: TelegramChatLike;
  from?: TelegramUserLike;
  old_chat_member?: TelegramChatMemberLike;
  new_chat_member?: TelegramChatMemberLike;
}

function isTelegramChatMemberActiveStatus(status: string | undefined): boolean {
  return status === 'member'
    || status === 'administrator'
    || status === 'creator'
    || status === 'restricted';
}

function isTelegramBotAddedToChat(update: TelegramChatMemberUpdateLike): boolean {
  const oldStatus = update.old_chat_member?.status;
  const newStatus = update.new_chat_member?.status;

  return !isTelegramChatMemberActiveStatus(oldStatus)
    && isTelegramChatMemberActiveStatus(newStatus);
}

function formatTelegramUserLabel(user: TelegramUserLike | undefined): string {
  if (!user) {
    return 'unknown user';
  }

  const fullName = [user.first_name, user.last_name].filter(Boolean).join(' ').trim();
  const name = user.username
    ? `@${user.username}`
    : fullName.length > 0
      ? fullName
      : user.id !== undefined
        ? `id:${user.id}`
        : 'unknown user';

  if (user.id === undefined) {
    return name;
  }

  return `${name} (${user.id})`;
}

interface TelegramRoomAuthorizationRequest {
  token: string;
  chatId: string;
  chatNumericId: number;
  chatTitle: string;
  chatType: string;
  inviterUserId?: string;
  inviterNumericId?: number;
  inviterLabel: string;
  createdAtMs: number;
}

function createTelegramRoomAuthorizationToken(): string {
  const timestampToken = Date.now().toString(36);
  const nonce = Math.floor(Math.random() * 1_000_000_000).toString(36);
  return `${timestampToken}${nonce}`.slice(0, 24);
}

function buildTelegramRoomAuthorizationPrompt(request: TelegramRoomAuthorizationRequest): string {
  const lines = [
    'New Telegram room authorization request.',
    '',
    `Room: ${request.chatTitle}`,
    `Room ID: ${request.chatId}`,
    `Room type: ${request.chatType}`,
    `Added by: ${request.inviterLabel}`,
    '',
    'Authorize this room for gateway access?',
  ];

  return lines.join('\n');
}

function buildTelegramRoomAuthorizationOptions(
  requestToken: string,
): TelegramSendMessageOptions {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: '✅ Approve room',
            callback_data: `${TELEGRAM_ROOM_AUTH_CALLBACK_PREFIX}approve:${requestToken}`,
          },
        ],
        [
          {
            text: '❌ Deny + block inviter',
            callback_data: `${TELEGRAM_ROOM_AUTH_CALLBACK_PREFIX}deny:${requestToken}`,
          },
        ],
      ],
    },
  };
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

    const modelsForSelection = availableModels;

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

function buildPromptWithScheduledReplyContext(input: {
  userPrompt: string;
  context: ScheduledReplyContext;
}): string {
  const lines: string[] = [
    'You are responding to a user reply to a scheduled task notification.',
  ];

  if (input.context.taskId) {
    lines.push(`Task ID: ${input.context.taskId}`);
  }

  if (input.context.status) {
    lines.push(`Task status: ${input.context.status}`);
  }

  if (input.context.createdAt) {
    lines.push(`Task message created at: ${input.context.createdAt}`);
  }

  if (input.context.logPath) {
    lines.push(`Task log path: ${input.context.logPath}`);
  }

  lines.push('', 'Scheduled task notification message:', input.context.message, '', 'User reply:', input.userPrompt);

  return lines.join('\n');
}

interface TelegramPromptMemoryEntry {
  prompt: string;
  images?: PromptImageAttachment[];
}

interface ClearTrackedTelegramConversationMessagesInput {
  chatId: number;
  messageIds: number[];
  deleteMessage?: DeleteMessageFn;
  deleteMessages?: DeleteMessagesFn;
}

interface ClearTrackedTelegramConversationMessagesResult {
  attempted: number;
  deleted: number;
  usedBulkDelete: boolean;
}

function trackTelegramConversationMessageId(
  messageIdsByConversation: Map<string, number[]>,
  conversationId: string,
  messageId: number | undefined,
): void {
  if (typeof messageId !== 'number' || !Number.isSafeInteger(messageId) || messageId <= 0) {
    return;
  }

  const tracked = messageIdsByConversation.get(conversationId) ?? [];

  if (tracked.includes(messageId)) {
    return;
  }

  tracked.push(messageId);

  if (tracked.length > TELEGRAM_MAX_TRACKED_CONVERSATION_MESSAGES) {
    tracked.splice(0, tracked.length - TELEGRAM_MAX_TRACKED_CONVERSATION_MESSAGES);
  }

  messageIdsByConversation.set(conversationId, tracked);
}

function buildTelegramClearSweepMessageIds(
  latestMessageId: number | undefined,
  maxCount: number,
): number[] {
  if (typeof latestMessageId !== 'number' || !Number.isSafeInteger(latestMessageId) || latestMessageId <= 0) {
    return [];
  }

  const limit = Number.isFinite(maxCount) && maxCount > 0
    ? Math.floor(maxCount)
    : TELEGRAM_CLEAR_SWEEP_MESSAGE_LIMIT;
  const floor = Math.max(1, latestMessageId - limit + 1);
  const messageIds: number[] = [];

  for (let messageId = latestMessageId; messageId >= floor; messageId -= 1) {
    messageIds.push(messageId);
  }

  return messageIds;
}

function chunkTelegramMessageIds(messageIds: number[], chunkSize: number): number[][] {
  if (chunkSize <= 0) {
    return [messageIds];
  }

  const chunks: number[][] = [];

  for (let index = 0; index < messageIds.length; index += chunkSize) {
    chunks.push(messageIds.slice(index, index + chunkSize));
  }

  return chunks;
}

async function clearTrackedTelegramConversationMessages(
  input: ClearTrackedTelegramConversationMessagesInput,
): Promise<ClearTrackedTelegramConversationMessagesResult> {
  if ((!input.deleteMessage && !input.deleteMessages) || input.messageIds.length === 0) {
    return {
      attempted: 0,
      deleted: 0,
      usedBulkDelete: false,
    };
  }

  const messageIds = [...new Set(
    input.messageIds.filter((value): value is number => Number.isSafeInteger(value) && value > 0),
  )].sort((a, b) => b - a);

  let deleted = 0;
  let usedBulkDelete = false;

  if (input.deleteMessages) {
    const chunks = chunkTelegramMessageIds(messageIds, TELEGRAM_DELETE_MESSAGES_CHUNK_SIZE);

    for (const chunk of chunks) {
      if (chunk.length === 0) {
        continue;
      }

      try {
        await input.deleteMessages(input.chatId, chunk);
        deleted += chunk.length;
        usedBulkDelete = true;
        continue;
      } catch {
        // Fall through to per-message delete when available.
      }

      if (!input.deleteMessage) {
        continue;
      }

      for (const messageId of chunk) {
        try {
          await input.deleteMessage(input.chatId, messageId);
          deleted += 1;
        } catch {
          // Best-effort cleanup. Ignore individual delete failures.
        }
      }
    }

    return {
      attempted: messageIds.length,
      deleted,
      usedBulkDelete,
    };
  }

  for (const messageId of messageIds) {
    try {
      await input.deleteMessage!(input.chatId, messageId);
      deleted += 1;
    } catch {
      // Best-effort cleanup. Ignore individual delete failures.
    }
  }

  return {
    attempted: messageIds.length,
    deleted,
    usedBulkDelete,
  };
}

interface TelegramMessageHandlerState {
  lastPromptByConversation: Map<string, TelegramPromptMemoryEntry>;
  awaitingFollowUpByConversation: Set<string>;
  recentMessageIdsByConversation: Map<string, number[]>;
}

async function processTelegramMessage(
  options: CreateTelegramMessageHandlerOptions,
  message: TelegramMessageLike,
  controllers: Map<string, Promise<GatewayConversationController>>,
  state: TelegramMessageHandlerState,
  registerRunTask: (task: Promise<void>) => void,
): Promise<MessageProcessingResult> {
  const chatId = String(message.chat.id);
  const messageThreadId = normalizeTelegramMessageThreadId(message.message_thread_id);
  const conversationId = buildTelegramConversationId(chatId, messageThreadId);
  const senderUserId = toTelegramUserIdString(message.from?.id);
  const allowedUserIds = options.allowedUserIds ?? new Set<string>();
  const blockedUserIds = options.blockedUserIds ?? new Set<string>();
  const senderIsAllowedUser = senderUserId ? allowedUserIds.has(senderUserId) : false;

  if (senderUserId && blockedUserIds.has(senderUserId)) {
    return completedMessageProcessingResult();
  }

  const allowSenderlessMessageInAllowlistedChat = !senderUserId && options.allowlist.has(chatId);
  if (allowedUserIds.size > 0 && !senderIsAllowedUser && !allowSenderlessMessageInAllowlistedChat) {
    return completedMessageProcessingResult();
  }

  const trackConversationMessageId = (messageId: number | undefined): void => {
    trackTelegramConversationMessageId(state.recentMessageIdsByConversation, conversationId, messageId);
  };

  const sendMessageWithConversationThread: SendMessageFn = async (targetChatId, text, sendOptions) => {
    const threadedOptions = applyTelegramThreadToMessageOptions(sendOptions, messageThreadId);

    const sent = !threadedOptions || Object.keys(threadedOptions).length === 0
      ? await options.sendMessage(targetChatId, text)
      : await options.sendMessage(targetChatId, text, threadedOptions);

    trackConversationMessageId(toTelegramSentMessageId(sent));
    return sent;
  };

  const baseSendDocument = options.sendDocument;
  const sendDocumentWithConversationThread: SendDocumentFn | undefined = baseSendDocument
    ? async (targetChatId, filePath, sendOptions) => {
      const threadedOptions = applyTelegramThreadToFileOptions(sendOptions, messageThreadId);

      const sent = !threadedOptions || Object.keys(threadedOptions).length === 0
        ? await baseSendDocument(targetChatId, filePath)
        : await baseSendDocument(targetChatId, filePath, threadedOptions);

      trackConversationMessageId(toTelegramSentMessageId(sent));
      return sent;
    }
    : undefined;

  const baseSendPhoto = options.sendPhoto;
  const sendPhotoWithConversationThread: SendPhotoFn | undefined = baseSendPhoto
    ? async (targetChatId, filePath, sendOptions) => {
      const threadedOptions = applyTelegramThreadToFileOptions(sendOptions, messageThreadId);

      const sent = !threadedOptions || Object.keys(threadedOptions).length === 0
        ? await baseSendPhoto(targetChatId, filePath)
        : await baseSendPhoto(targetChatId, filePath, threadedOptions);

      trackConversationMessageId(toTelegramSentMessageId(sent));
      return sent;
    }
    : undefined;

  const sendMessageToConversation = (
    text: string,
    sendOptions?: TelegramSendMessageOptions,
  ): Promise<unknown> => invokeTelegramSendMessage(
    sendMessageWithConversationThread,
    message.chat.id,
    text,
    sendOptions,
  );

  const sendFormattedMessageToConversation = (
    text: string,
    sendOptions?: TelegramSendMessageOptions,
  ): Promise<unknown> => sendTelegramFormattedMessage(
    sendMessageWithConversationThread,
    message.chat.id,
    text,
    sendOptions,
  );

  const sendTypingActionToConversation = (): Promise<unknown> => {
    if (messageThreadId === undefined) {
      return options.sendChatAction(message.chat.id, 'typing');
    }

    return options.sendChatAction(message.chat.id, 'typing', {
      message_thread_id: messageThreadId,
    });
  };

  const rawText = (message.text ?? message.caption ?? '').trim();
  const inboundMediaReferences = extractTelegramInboundMedia(message);
  const isServiceOnlyMessage = rawText.length === 0
    && inboundMediaReferences.length === 0
    && isTelegramServiceOnlyMessage(message);
  const bypassAllowlistForDirectChat = senderIsAllowedUser && message.chat.type === 'private';
  const canAutoAuthorizeRoom = senderIsAllowedUser && message.chat.type !== 'private';

  if (!options.allowlist.has(chatId) && !bypassAllowlistForDirectChat) {
    if (canAutoAuthorizeRoom && !isServiceOnlyMessage) {
      options.allowlist.add(chatId);
      options.persistAccessLists?.();

      const chatTitle = message.chat.title?.trim()
        || (message.chat.username ? `@${message.chat.username}` : chatId);
      const senderLabel = formatTelegramUserLabel(message.from);
      logSystem('telegram', `Auto-authorized room ${chatTitle} (${chatId}) from allowed user ${senderLabel}`);
    } else {
      if (!isServiceOnlyMessage) {
        await sendMessageToConversation('This chat is not allowed.');
      }
      return completedMessageProcessingResult();
    }
  }

  if (isServiceOnlyMessage) {
    return completedMessageProcessingResult();
  }

  trackConversationMessageId(message.message_id);

  if (rawText.length === 0 && inboundMediaReferences.length === 0) {
    await sendMessageToConversation('Please send text, documents, images, or voice notes.');
    return completedMessageProcessingResult();
  }

  let preparedMedia: TelegramPreparedInboundMedia[] = [];
  if (inboundMediaReferences.length > 0) {
    if (!options.prepareInboundMedia) {
      await sendMessageToConversation('Media processing is not configured for this gateway instance.');
      return completedMessageProcessingResult();
    }

    try {
      preparedMedia = await options.prepareInboundMedia({
        chatId,
        messageId: message.message_id,
        media: inboundMediaReferences,
      });
    } catch (error) {
      await sendMessageToConversation(`Unable to process media attachment: ${(error as Error).message}`);
      return completedMessageProcessingResult();
    }

    if (preparedMedia.length === 0) {
      await sendMessageToConversation('Unable to download the attached media. Please try sending it again.');
      return completedMessageProcessingResult();
    }
  }

  const fullName = [message.from?.first_name, message.from?.last_name].filter(Boolean).join(' ');
  const userName = message.from?.username ?? (fullName || undefined);

  const incomingSummary = rawText.length > 0
    ? rawText
    : `[${preparedMedia.map((media) => media.kind).join(', ')} attachment]`;
  logIncomingMessage('telegram', conversationId, userName, incomingSummary);

  const defaultSessionFile = join(options.telegramSessionDir, buildTelegramSessionFileName(chatId, messageThreadId));
  const sessionFile = options.resolveConversationSessionFile
    ? options.resolveConversationSessionFile({
      conversationId,
      defaultSessionFile,
    })
    : defaultSessionFile;
  const sessionFileExists = options.sessionFileExists ?? existsSync;
  const removeSessionFile = options.removeSessionFile ?? ((path: string) => rm(path, { force: true }));

  const normalized = normalizeTelegramCommandText(rawText);
  let command = normalized.command;
  let commandArgs = normalized.args;

  const shouldConsumeFollowUpCapture = state.awaitingFollowUpByConversation.has(conversationId)
    && command === undefined
    && (rawText.length > 0 || preparedMedia.length > 0);

  if (shouldConsumeFollowUpCapture) {
    state.awaitingFollowUpByConversation.delete(conversationId);
    command = '/followup';
    commandArgs = rawText;
  }

  if (command) {
    const commandName = command.startsWith('/') ? command.slice(1) : command;
    const skillName = options.skillSlashCommandMap?.get(commandName);

    if (skillName) {
      command = '/skill';
      commandArgs = skillName;
    }
  }

  const modelCommandHandled = await handleModelCommand({
    conversationId,
    conversationLabel: 'chat',
    command,
    args: commandArgs,
    normalizedText: rawText,
    modelCommands: options.modelCommands,
    sendMessage: (messageText) => sendFormattedMessageToConversation(messageText),
    sendModelSelectionPrompt: async (promptText, models) => {
      await sendMessageToConversation(promptText, buildTelegramModelSelectionOptions(models));
    },
  });

  if (modelCommandHandled) {
    return completedMessageProcessingResult();
  }

  if (command === '/new') {
    await disposeConversationController(controllers, conversationId);

    options.clearConversationSessionFile?.({
      conversationId,
    });

    if (sessionFileExists(defaultSessionFile)) {
      await removeSessionFile(defaultSessionFile);
    }

    const trackedMessageIds = [...(state.recentMessageIdsByConversation.get(conversationId) ?? [])];
    state.recentMessageIdsByConversation.delete(conversationId);
    state.lastPromptByConversation.delete(conversationId);
    state.awaitingFollowUpByConversation.delete(conversationId);

    const shouldClearRecentMessagesOnNew = options.clearRecentMessagesOnNew ?? true;
    const clearResult = shouldClearRecentMessagesOnNew
      ? await clearTrackedTelegramConversationMessages({
        chatId: message.chat.id,
        messageIds: trackedMessageIds,
        deleteMessage: options.deleteMessage,
        deleteMessages: options.deleteMessages,
      })
      : {
        attempted: 0,
        deleted: 0,
        usedBulkDelete: false,
      };

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

    let response = 'Started a new session.';
    if (shouldClearRecentMessagesOnNew) {
      if (clearResult.attempted > 0 && clearResult.deleted > 0) {
        response = `Started a new session. Cleared ${clearResult.deleted} recent message${clearResult.deleted === 1 ? '' : 's'}.`;
        if (clearResult.deleted < clearResult.attempted) {
          response += ' Some messages could not be removed.';
        }
      } else if (clearResult.attempted > 0) {
        response = 'Started a new session. Unable to clear recent messages.';
      }
    }

    await sendMessageToConversation(response);
    return completedMessageProcessingResult();
  }

  if (command === '/clear') {
    if (!options.deleteMessage && !options.deleteMessages) {
      await sendMessageToConversation('Message clearing is not configured for this gateway instance.');
      return completedMessageProcessingResult();
    }

    const trackedMessageIds = [...(state.recentMessageIdsByConversation.get(conversationId) ?? [])];
    state.recentMessageIdsByConversation.delete(conversationId);

    const clearAllRequested = commandArgs.trim().toLowerCase() === 'all';
    const shouldSweepCurrentChat = messageThreadId === undefined;
    const sweepMessageIds = shouldSweepCurrentChat
      ? buildTelegramClearSweepMessageIds(
        message.message_id,
        clearAllRequested ? TELEGRAM_CLEAR_SWEEP_MESSAGE_LIMIT_ALL : TELEGRAM_CLEAR_SWEEP_MESSAGE_LIMIT,
      )
      : [];

    const clearResult = await clearTrackedTelegramConversationMessages({
      chatId: message.chat.id,
      messageIds: [...trackedMessageIds, ...sweepMessageIds],
      deleteMessage: options.deleteMessage,
      deleteMessages: shouldSweepCurrentChat ? undefined : options.deleteMessages,
    });

    let response = shouldSweepCurrentChat
      ? 'No recent messages to clear yet.'
      : 'No tracked messages to clear yet.';

    if (clearResult.attempted > 0 && clearResult.deleted > 0) {
      if (clearResult.usedBulkDelete && shouldSweepCurrentChat) {
        response = `Attempted to clear up to ${clearResult.attempted} recent messages.`;
      } else {
        response = `Cleared ${clearResult.deleted} recent message${clearResult.deleted === 1 ? '' : 's'}.`;
        if (clearResult.deleted < clearResult.attempted) {
          response += ' Some messages could not be removed.';
        }
      }
    } else if (clearResult.attempted > 0) {
      response = 'Unable to clear recent messages.';
    }

    if (!shouldSweepCurrentChat) {
      response += ' Topic mode only clears tracked messages for this topic.';
    }

    await sendMessageToConversation(response);
    return completedMessageProcessingResult();
  }

  if (command === '/status') {
    const activeModel = options.modelCommands?.activeModelsByConversation.get(conversationId);
    const configuredModel = options.modelCommands?.defaultModel;
    const model = activeModel ?? configuredModel ?? '(pi default)';

    await sendMessageToConversation(
      `profile=${options.profileName}
agentDir=${options.agentDir}
session=${sessionFile}
model=${model}`,
    );
    return completedMessageProcessingResult();
  }

  if (command === '/chatid') {
    const lines = [`chatId=${chatId}`];

    if (messageThreadId !== undefined) {
      lines.push(`messageThreadId=${messageThreadId}`);
    }

    await sendMessageToConversation(lines.join('\n'));
    return completedMessageProcessingResult();
  }

  if (command === '/resume') {
    const resumeOptions = buildResumeConversationOptions({
      sessionDir: options.telegramSessionDir,
      currentSessionFile: sessionFile,
      parseConversation: parseTelegramConversationFromSessionFileName,
    });

    const resumeSelectionPrompt = formatResumeConversationSelectionPrompt({
      entries: resumeOptions,
      currentSessionFile: sessionFile,
    });

    const selectionArg = commandArgs.trim();
    if (selectionArg.length === 0) {
      const resumeSelectionOptions = buildTelegramResumeSelectionOptions(resumeOptions);

      if (resumeSelectionOptions) {
        await sendFormattedMessageToConversation(resumeSelectionPrompt, resumeSelectionOptions);
      } else {
        await sendLongText(
          (chunk) => sendFormattedMessageToConversation(chunk),
          resumeSelectionPrompt,
        );
      }

      return completedMessageProcessingResult();
    }

    const resolvedResume = resolveResumeConversationSelection(selectionArg, resumeOptions);
    if (!resolvedResume.entry) {
      await sendLongText(
        (chunk) => sendFormattedMessageToConversation(chunk),
        `${resolvedResume.error ?? 'Unable to resolve resume target.'}\n\n${resumeSelectionPrompt}`,
      );
      return completedMessageProcessingResult();
    }

    const selectedResume = resolvedResume.entry;
    if (selectedResume.sessionFile === sessionFile) {
      await sendMessageToConversation('Already using that conversation in this chat/topic.');
      return completedMessageProcessingResult();
    }

    await disposeConversationController(controllers, conversationId);

    options.setConversationSessionFile?.({
      conversationId,
      sessionFile: selectedResume.sessionFile,
    });
    state.lastPromptByConversation.delete(conversationId);
    state.awaitingFollowUpByConversation.delete(conversationId);

    const resumedTarget = selectedResume.conversationId ?? selectedResume.sessionFileName;
    await sendMessageToConversation(`Resumed ${resumedTarget}. Continue chatting in this chat/topic.`);
    return completedMessageProcessingResult();
  }

  if (command === '/compact') {
    const controller = await getOrCreateConversationController(
      controllers,
      conversationId,
      sessionFile,
      options.createConversationController,
    );

    try {
      const compactResult = await controller.compact(commandArgs.length > 0 ? commandArgs : undefined);
      await sendLongText(
        (chunk) => sendFormattedMessageToConversation(chunk),
        compactResult,
      );
    } catch (error) {
      await sendMessageToConversation(`Unable to compact context: ${(error as Error).message}`);
    }

    return completedMessageProcessingResult();
  }

  if (command === '/fork') {
    const controller = await getOrCreateConversationController(
      controllers,
      conversationId,
      sessionFile,
      options.createConversationController,
    );

    try {
      const forkableMessages = normalizeForkableMessages(await controller.getUserMessagesForForking());

      if (forkableMessages.length === 0) {
        await sendLongText(
          (chunk) => sendFormattedMessageToConversation(chunk),
          formatForkableMessages(forkableMessages),
        );
        return completedMessageProcessingResult();
      }

      const canForkToTopic = Boolean(options.createForumTopic)
        && (message.chat.type === 'group' || message.chat.type === 'supergroup');

      if (canForkToTopic) {
        const selectedEntry = forkableMessages[0] as ForkableConversationMessage;
        const requestedTopicName = commandArgs.trim();
        const topicName = normalizeTelegramForkTopicName(
          requestedTopicName,
          defaultTelegramForkTopicName(selectedEntry.text),
        );

        try {
          const createdTopic = await options.createForumTopic!({
            chatId: message.chat.id,
            name: topicName,
          });

          const forkResult = await controller.fork(selectedEntry.entryId);
          if (forkResult.cancelled) {
            await sendMessageToConversation('Fork was cancelled by an extension.');
            return completedMessageProcessingResult();
          }

          const nextSessionFile = forkResult.sessionFile || await controller.getSessionFile();
          const targetConversationId = buildTelegramConversationId(chatId, createdTopic.messageThreadId);

          options.setConversationSessionFile?.({
            conversationId: targetConversationId,
            sessionFile: nextSessionFile,
          });

          options.setWorkTopicBinding?.({
            sourceConversationId: conversationId,
            sourceChatId: chatId,
            sourceMessageThreadId: messageThreadId,
            workConversationId: targetConversationId,
            workChatId: message.chat.id,
            workMessageThreadId: createdTopic.messageThreadId,
            topicName: createdTopic.name,
            sessionFile: nextSessionFile,
          });

          const selectedText = (forkResult.selectedText || selectedEntry.text).trim();
          const seedLines = [
            `🧵 Forked from ${conversationId}`,
            `entryId=${selectedEntry.entryId}`,
            `session=${nextSessionFile}`,
            '',
            'This topic is now a forked branch from the source conversation.',
          ];

          if (selectedText.length > 0) {
            seedLines.push('', 'Selected message:', trimForkMessagePreview(selectedText, 400));
          }

          await sendTelegramFormattedMessage(
            options.sendMessage,
            message.chat.id,
            seedLines.join('\n'),
            {
              message_thread_id: createdTopic.messageThreadId,
            },
          );

          const responseLines = [
            'Forked conversation to a new topic.',
            `topic=${createdTopic.name}`,
            `workConversation=${targetConversationId}`,
            `entryId=${selectedEntry.entryId}`,
            `session=${nextSessionFile}`,
          ];

          await sendLongText(
            (chunk) => sendFormattedMessageToConversation(chunk),
            responseLines.join('\n'),
          );
          return completedMessageProcessingResult();
        } catch (topicCreationError) {
          if (!isTelegramTopicCreationPermissionError(topicCreationError)
            && !isTelegramTopicsNotEnabledError(topicCreationError)) {
            throw topicCreationError;
          }

          const topicCreationMessage = topicCreationError instanceof Error
            ? topicCreationError.message
            : String(topicCreationError);

          await sendMessageToConversation(
            `Unable to create a new topic for /fork (${topicCreationMessage}). Falling back to this chat/topic.`,
          );

          const forkResult = await controller.fork(selectedEntry.entryId);
          if (forkResult.cancelled) {
            await sendMessageToConversation('Fork was cancelled by an extension.');
            return completedMessageProcessingResult();
          }

          const nextSessionFile = forkResult.sessionFile || await controller.getSessionFile();
          options.setConversationSessionFile?.({
            conversationId,
            sessionFile: nextSessionFile,
          });

          state.lastPromptByConversation.set(conversationId, {
            prompt: forkResult.selectedText,
          });
          state.awaitingFollowUpByConversation.delete(conversationId);

          const selectedText = (forkResult.selectedText || selectedEntry.text).trim();
          const lines = [
            'Forked conversation to a new session in the current chat/topic.',
            `entryId=${selectedEntry.entryId}`,
            `session=${nextSessionFile}`,
          ];

          if (selectedText.length > 0) {
            lines.push('', 'Selected message:', trimForkMessagePreview(selectedText, 400));
          }

          await sendLongText(
            (chunk) => sendFormattedMessageToConversation(chunk),
            lines.join('\n'),
          );
          return completedMessageProcessingResult();
        }
      }

      if (commandArgs.length === 0) {
        const forkMessageList = formatForkableMessages(forkableMessages);
        const forkSelectionOptions = buildTelegramForkSelectionOptions(forkableMessages);

        if (!forkSelectionOptions) {
          await sendLongText(
            (chunk) => sendFormattedMessageToConversation(chunk),
            forkMessageList,
          );
          return completedMessageProcessingResult();
        }

        await sendFormattedMessageToConversation(forkMessageList, forkSelectionOptions);
        return completedMessageProcessingResult();
      }

      const resolvedFork = resolveForkEntryId(commandArgs, forkableMessages);
      if (!resolvedFork.entryId) {
        const errorMessage = resolvedFork.error ?? 'Unable to resolve fork target.';
        await sendLongText(
          (chunk) => sendFormattedMessageToConversation(chunk),
          `${errorMessage}\n\n${formatForkableMessages(forkableMessages)}`,
        );
        return completedMessageProcessingResult();
      }

      const selectedEntry = forkableMessages.find((entry) => entry.entryId === resolvedFork.entryId);
      const forkResult = await controller.fork(resolvedFork.entryId);

      if (forkResult.cancelled) {
        await sendMessageToConversation('Fork was cancelled by an extension.');
        return completedMessageProcessingResult();
      }

      const nextSessionFile = forkResult.sessionFile || await controller.getSessionFile();
      options.setConversationSessionFile?.({
        conversationId,
        sessionFile: nextSessionFile,
      });

      state.lastPromptByConversation.set(conversationId, {
        prompt: forkResult.selectedText,
      });
      state.awaitingFollowUpByConversation.delete(conversationId);

      const lines = [
        'Forked conversation to a new session.',
        `entryId=${resolvedFork.entryId}`,
        `session=${nextSessionFile}`,
      ];

      const selectedText = selectedEntry?.text ?? forkResult.selectedText;
      const trimmedSelectedText = selectedText.trim();
      if (trimmedSelectedText.length > 0) {
        lines.push('', 'Selected message:', trimForkMessagePreview(trimmedSelectedText, 400));
      }

      await sendLongText(
        (chunk) => sendFormattedMessageToConversation(chunk),
        lines.join('\n'),
      );
    } catch (error) {
      await sendMessageToConversation(`Unable to fork conversation: ${(error as Error).message}`);
    }

    return completedMessageProcessingResult();
  }

  if (command === '/commands') {
    const commandHelp = options.commandHelpText
      ?? formatTelegramCommands(filterTelegramSlashMenuCommands(DEFAULT_TELEGRAM_COMMANDS));
    await sendLongText(
      (chunk) => sendFormattedMessageToConversation(chunk),
      commandHelp,
    );
    return completedMessageProcessingResult();
  }

  if (command === '/skills') {
    const skillsHelp = options.skillsHelpText ?? formatTelegramSkills([]);
    await sendLongText(
      (chunk) => sendFormattedMessageToConversation(chunk),
      skillsHelp,
    );
    return completedMessageProcessingResult();
  }

  if (command === '/room') {
    if (!options.handleRoomAdminCommand) {
      await sendMessageToConversation('Room admin commands are not available in this gateway instance.');
      return completedMessageProcessingResult();
    }

    const actorLabel = senderUserId
      ? userName
        ? `${userName} (${senderUserId})`
        : `id:${senderUserId}`
      : userName ?? 'unknown user';

    try {
      const roomCommandOutput = await options.handleRoomAdminCommand({
        actorUserId: senderUserId,
        actorLabel,
        args: commandArgs,
      });

      await sendLongText(
        (chunk) => sendFormattedMessageToConversation(chunk),
        roomCommandOutput,
      );
    } catch (error) {
      await sendMessageToConversation(`Unable to process /room command: ${(error as Error).message}`);
    }

    return completedMessageProcessingResult();
  }

  if (command === '/run') {
    const parsedRunRequest = parseTelegramRunRequest(commandArgs);
    if (parsedRunRequest.kind === 'invalid') {
      await sendLongText(
        (chunk) => sendFormattedMessageToConversation(chunk),
        parsedRunRequest.message,
      );
      return completedMessageProcessingResult();
    }

    if (parsedRunRequest.kind === 'run' && options.handleRunRequest) {
      try {
        const getController = async (): Promise<GatewayConversationController> => getOrCreateConversationController(
          controllers,
          conversationId,
          sessionFile,
          options.createConversationController,
        );

        const runOutput = await options.handleRunRequest({
          run: parsedRunRequest.value,
          sourceConversationId: conversationId,
          sourceChatId: message.chat.id,
          sourceMessageThreadId: messageThreadId,
          sourceChatType: message.chat.type,
          sourceChatTitle: message.chat.title,
          sourceChatUsername: message.chat.username,
          defaultSourceSessionFile: sessionFile,
          getForkableMessages: async () => {
            const controller = await getController();
            return controller.getUserMessagesForForking();
          },
          forkConversation: async (entryId) => {
            const controller = await getController();
            return controller.fork(entryId);
          },
          setConversationSessionFile: ({ conversationId: targetConversationId, sessionFile: targetSessionFile }) => {
            options.setConversationSessionFile?.({
              conversationId: targetConversationId,
              sessionFile: targetSessionFile,
            });
          },
          resolveConversationSessionFile: ({ conversationId: targetConversationId, defaultSessionFile: targetDefaultSessionFile }) => {
            if (options.resolveConversationSessionFile) {
              return options.resolveConversationSessionFile({
                conversationId: targetConversationId,
                defaultSessionFile: targetDefaultSessionFile,
              });
            }

            return targetDefaultSessionFile;
          },
        });

        await sendLongText(
          (chunk) => sendFormattedMessageToConversation(chunk),
          runOutput,
        );
      } catch (error) {
        await sendMessageToConversation(`Unable to process /run command: ${(error as Error).message}`);
      }

      return completedMessageProcessingResult();
    }

    if (!options.handleRunCommand) {
      await sendMessageToConversation('run commands are not available in this gateway instance.');
      return completedMessageProcessingResult();
    }

    try {
      const runOutput = await options.handleRunCommand({
        args: commandArgs,
      });

      await sendLongText(
        (chunk) => sendFormattedMessageToConversation(chunk),
        runOutput,
      );
    } catch (error) {
      await sendMessageToConversation(`Unable to process /run command: ${(error as Error).message}`);
    }

    return completedMessageProcessingResult();
  }

  if (command === '/tasks') {
    const statusFilter = parseGatewayTaskStatusFilter(commandArgs);
    if (!statusFilter) {
      await sendMessageToConversation(`${gatewayTaskListUsageText()}\nExample: /tasks completed`);
      return completedMessageProcessingResult();
    }

    try {
      const taskText = await (options.listScheduledTasks ?? listScheduledTasks)({ statusFilter });
      await sendLongText(
        (chunk) => sendFormattedMessageToConversation(chunk),
        taskText,
      );
    } catch (error) {
      await sendMessageToConversation(`Unable to list scheduled tasks: ${(error as Error).message}`);
    }

    return completedMessageProcessingResult();
  }

  if (command === '/stop') {
    const controllerPromise = controllers.get(conversationId);
    if (!controllerPromise) {
      await sendMessageToConversation(NO_ACTIVE_REQUEST_MESSAGE);
      return completedMessageProcessingResult();
    }

    const controller = await controllerPromise;
    const aborted = await controller.abortCurrent();
    if (aborted) {
      await sendMessageToConversation(STOPPED_ACTIVE_REQUEST_MESSAGE);
      return completedMessageProcessingResult();
    }

    await sendMessageToConversation(NO_ACTIVE_REQUEST_MESSAGE);
    return completedMessageProcessingResult();
  }

  let prompt = rawText;
  let promptImages: PromptImageAttachment[] | undefined;
  let useFollowUpSubmission = false;

  if (command === '/skill') {
    if (commandArgs.length === 0) {
      await sendMessageToConversation('Usage: /skill <name>\nExample: /skill tdd-feature\nAlso works: /skill:tdd-feature');
      return completedMessageProcessingResult();
    }

    prompt = `/skill:${commandArgs}`;
  } else if (command === '/followup') {
    useFollowUpSubmission = true;

    if (commandArgs.length === 0 && preparedMedia.length === 0) {
      state.awaitingFollowUpByConversation.add(conversationId);
      await sendMessageToConversation(
        'Send your follow-up message now. Your next message in this chat will be queued as a follow-up.',
        {
          reply_markup: {
            force_reply: true,
          },
        },
      );
      return completedMessageProcessingResult();
    }

    prompt = commandArgs;
  } else if (command === '/regenerate') {
    const lastPrompt = state.lastPromptByConversation.get(conversationId);
    if (!lastPrompt) {
      await sendMessageToConversation('No previous prompt to regenerate yet.');
      return completedMessageProcessingResult();
    }

    prompt = lastPrompt.prompt;
    promptImages = lastPrompt.images ? [...lastPrompt.images] : undefined;
  }

  if (preparedMedia.length > 0 && command !== '/skill' && command !== '/regenerate') {
    const mediaPrompt = buildPromptFromTelegramMedia(prompt, preparedMedia);
    prompt = mediaPrompt.prompt;
    if (mediaPrompt.images.length > 0) {
      promptImages = mediaPrompt.images;
    }
  }

  if (!command || command === '/followup') {
    const replyMessageId = message.reply_to_message?.message_id;
    if (typeof replyMessageId === 'number' && options.resolveScheduledReplyContext) {
      const scheduledReplyContext = options.resolveScheduledReplyContext({
        chatId,
        replyMessageId,
      });

      if (scheduledReplyContext) {
        prompt = buildPromptWithScheduledReplyContext({
          userPrompt: prompt,
          context: scheduledReplyContext,
        });
      }
    }
  }

  const controller = await getOrCreateConversationController(
    controllers,
    conversationId,
    sessionFile,
    options.createConversationController,
  );

  const shouldStreamWithMessageEdits = options.editMessageText
    && message.chat.type !== 'group'
    && message.chat.type !== 'supergroup';

  const responseStreamer = shouldStreamWithMessageEdits
    ? createTelegramResponseChunkStreamer({
      chatId: message.chat.id,
      workingDirectory: options.workingDirectory,
      sendMessage: sendMessageWithConversationThread,
      editMessageText: options.editMessageText,
      sendDocument: sendDocumentWithConversationThread,
      sendPhoto: sendPhotoWithConversationThread,
      outputDir: options.telegramExportDir,
    })
    : createResponseChunkStreamer((chunk) =>
      sendFormattedMessageToConversation(chunk));

  const toolActivityStreamer = createTelegramToolActivityStreamer({
    chatId: message.chat.id,
    enabled: options.streamToolActivity === true,
    sendMessage: sendMessageWithConversationThread,
    editMessageText: options.editMessageText,
    deleteMessage: options.deleteMessage,
  });

  const submissionInput: RunPromptFnInput = {
    prompt,
    sessionFile,
    cwd: options.workingDirectory,
    model: options.modelCommands?.activeModelsByConversation.get(conversationId),
    images: promptImages,
    onTextDelta: (delta) => {
      responseStreamer.pushDelta(delta);
    },
    onToolActivity: (event) => {
      toolActivityStreamer.push(event);
    },
    logContext: {
      source: 'telegram',
      userId: conversationId,
      userName,
    },
  };

  if (!useFollowUpSubmission && command !== '/regenerate') {
    state.lastPromptByConversation.set(conversationId, {
      prompt,
      images: promptImages ? [...promptImages] : undefined,
    });
  }

  const submission = useFollowUpSubmission
    ? await controller.submitFollowUp(submissionInput)
    : await controller.submitPrompt(submissionInput);

  if (submission.mode === 'started') {
    const stopTypingHeartbeat = startTypingHeartbeat(() => sendTypingActionToConversation());

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
            conversationId,
            messageThreadId,
          },
        });

        await responseStreamer.finalize(output);
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
            conversationId,
            messageThreadId,
            message: errorMessage,
          },
        });

        await sendMessageToConversation(`Error: ${errorMessage}`);
      })
      .finally(() => {
        stopTypingHeartbeat();
        return toolActivityStreamer.finalize().catch(() => {
          // Ignore non-critical tool activity cleanup failures.
        });
      });

    registerRunTask(runTask);
    return { completion: runTask };
  }

  if (submission.mode === 'steered') {
    await sendMessageToConversation(STEERING_ACTIVE_REQUEST_MESSAGE);
    return completedMessageProcessingResult();
  }

  await sendMessageToConversation(FOLLOWUP_QUEUED_MESSAGE);
  return completedMessageProcessingResult();
}

export function createQueuedTelegramMessageHandler(
  options: CreateTelegramMessageHandlerOptions,
): QueuedTelegramMessageHandler {
  const chatQueue = new Map<string, Promise<void>>();
  const pendingPerConversation = new Map<string, number>();
  const controllers = new Map<string, Promise<GatewayConversationController>>();
  const runTasks = new Map<string, Set<Promise<void>>>();
  const latestMessageIdByChat = new Map<string, number>();
  const lastPromptByConversation = new Map<string, TelegramPromptMemoryEntry>();
  const awaitingFollowUpByConversation = new Set<string>();
  const recentMessageIdsByConversation = new Map<string, number[]>();
  const maxPendingPerChat = options.maxPendingPerChat ?? DEFAULT_MAX_PENDING_PER_CHAT;
  const durableInboxDir = options.durableInboxDir;
  const conversationSessionOverrides = new Map<string, string>();

  const resolveConversationSessionFile = (input: {
    conversationId: string;
    defaultSessionFile: string;
  }): string => {
    if (options.resolveConversationSessionFile) {
      return options.resolveConversationSessionFile(input);
    }

    return conversationSessionOverrides.get(input.conversationId) ?? input.defaultSessionFile;
  };

  const setConversationSessionFile = (input: {
    conversationId: string;
    sessionFile: string;
  }): void => {
    if (options.setConversationSessionFile) {
      options.setConversationSessionFile(input);
      return;
    }

    conversationSessionOverrides.set(input.conversationId, input.sessionFile);
  };

  const clearConversationSessionFile = (input: {
    conversationId: string;
  }): void => {
    if (options.clearConversationSessionFile) {
      options.clearConversationSessionFile(input);
      return;
    }

    conversationSessionOverrides.delete(input.conversationId);
  };

  const runtimeOptions: CreateTelegramMessageHandlerOptions = {
    ...options,
    resolveConversationSessionFile,
    setConversationSessionFile,
    clearConversationSessionFile,
  };

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

  const trackRunTask = (conversationId: string, task: Promise<void>): void => {
    const existing = runTasks.get(conversationId) ?? new Set<Promise<void>>();
    existing.add(task);
    runTasks.set(conversationId, existing);

    void task.finally(() => {
      const tasksForConversation = runTasks.get(conversationId);
      if (!tasksForConversation) {
        return;
      }

      tasksForConversation.delete(task);
      if (tasksForConversation.size === 0) {
        runTasks.delete(conversationId);
      }
    });
  };

  const waitForRunTasks = async (chatId?: string): Promise<void> => {
    if (chatId) {
      let matchingTasks = [...runTasks.entries()]
        .filter(([conversationId]) => isTelegramConversationInChat(conversationId, chatId))
        .flatMap(([, tasks]) => [...tasks]);

      while (matchingTasks.length > 0) {
        await Promise.allSettled(matchingTasks);
        matchingTasks = [...runTasks.entries()]
          .filter(([conversationId]) => isTelegramConversationInChat(conversationId, chatId))
          .flatMap(([, tasks]) => [...tasks]);
      }

      return;
    }

    while (runTasks.size > 0) {
      const allTasks = [...runTasks.values()].flatMap((tasksForConversation) => [...tasksForConversation]);
      if (allTasks.length === 0) {
        return;
      }

      await Promise.allSettled(allTasks);
    }
  };

  const enqueue = (conversationId: string, task: () => Promise<void>) => {
    const previous = chatQueue.get(conversationId) ?? Promise.resolve();

    const next = previous
      .then(task)
      .catch((error) => {
        console.error(`[telegram:${conversationId}]`, error);
      })
      .finally(() => {
        if (chatQueue.get(conversationId) === next) {
          chatQueue.delete(conversationId);
        }
      });

    chatQueue.set(conversationId, next);
  };

  const queueMessage = (
    message: TelegramMessageLike,
    pendingMessageId?: string,
    bypassPendingLimit = false,
  ): boolean => {
    const chatId = String(message.chat.id);
    const messageThreadId = normalizeTelegramMessageThreadId(message.message_thread_id);
    const conversationId = buildTelegramConversationId(chatId, messageThreadId);

    if (typeof message.message_id === 'number') {
      const latestMessageId = latestMessageIdByChat.get(chatId);
      if (latestMessageId !== undefined && message.message_id <= latestMessageId) {
        acknowledgePendingMessage(pendingMessageId);
        return false;
      }

      latestMessageIdByChat.set(chatId, message.message_id);
    }

    const pending = pendingPerConversation.get(conversationId) ?? 0;

    if (!bypassPendingLimit && pending >= maxPendingPerChat) {
      const threadedOptions = applyTelegramThreadToMessageOptions(undefined, messageThreadId);
      void invokeTelegramSendMessage(
        options.sendMessage,
        message.chat.id,
        `Too many pending messages for this conversation (limit: ${maxPendingPerChat}). Please wait and try again.`,
        threadedOptions,
      );
      acknowledgePendingMessage(pendingMessageId);
      return false;
    }

    pendingPerConversation.set(conversationId, pending + 1);

    enqueue(conversationId, async () => {
      try {
        const processing = await processTelegramMessage(
          runtimeOptions,
          message,
          controllers,
          {
            lastPromptByConversation,
            awaitingFollowUpByConversation,
            recentMessageIdsByConversation,
          },
          (task) => trackRunTask(conversationId, task),
        );

        if (pendingMessageId && durableInboxDir) {
          void processing.completion
            .then(() => {
              acknowledgePendingMessage(pendingMessageId);
            })
            .catch((error) => {
              console.error(
                `[telegram:${conversationId}] durable message ${pendingMessageId} not acknowledged; will retry after restart:`,
                error,
              );
            });
        }
      } finally {
        const nextPending = (pendingPerConversation.get(conversationId) ?? 1) - 1;
        if (nextPending <= 0) {
          pendingPerConversation.delete(conversationId);
        } else {
          pendingPerConversation.set(conversationId, nextPending);
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
        const queueTasks = [...chatQueue.entries()]
          .filter(([conversationId]) => isTelegramConversationInChat(conversationId, chatId))
          .map(([, queued]) => queued);
        await Promise.all(queueTasks);

        const matchingControllerPromises = [...controllers.entries()]
          .filter(([conversationId]) => isTelegramConversationInChat(conversationId, chatId))
          .map(([, controllerPromise]) => controllerPromise);
        const matchingControllers = await Promise.all(matchingControllerPromises);
        await Promise.all(matchingControllers.map(async (controller) => controller.waitForIdle()));

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

  const token = resolveConfiguredValue(
    process.env.TELEGRAM_BOT_TOKEN ?? storedTelegram?.token,
    { fieldName: 'TELEGRAM_BOT_TOKEN (or gateway.telegram.token)' },
  );

  if (!token) {
    throw new Error('TELEGRAM_BOT_TOKEN is required. Run `pa gateway setup telegram` or set TELEGRAM_BOT_TOKEN.');
  }

  const profile = process.env.PERSONAL_AGENT_PROFILE || stored.profile || 'shared';

  const allowlistFromEnv = parseAllowlist(resolveConfiguredValue(
    process.env.PERSONAL_AGENT_TELEGRAM_ALLOWLIST,
    { fieldName: 'PERSONAL_AGENT_TELEGRAM_ALLOWLIST' },
  ));
  const storedAllowlist = resolveConfiguredAllowlistEntries(
    storedTelegram?.allowlist,
    { fieldName: 'gateway.telegram.allowlist' },
  );
  const allowlist = allowlistFromEnv.size > 0
    ? allowlistFromEnv
    : storedAllowlist;

  const allowedUserIdsFromEnv = parseAllowlist(resolveConfiguredValue(
    process.env.PERSONAL_AGENT_TELEGRAM_ALLOWED_USER_IDS,
    { fieldName: 'PERSONAL_AGENT_TELEGRAM_ALLOWED_USER_IDS' },
  ));
  const storedAllowedUserIds = resolveConfiguredAllowlistEntries(
    storedTelegram?.allowedUserIds,
    { fieldName: 'gateway.telegram.allowedUserIds' },
  );
  const allowedUserIds = allowedUserIdsFromEnv.size > 0
    ? allowedUserIdsFromEnv
    : storedAllowedUserIds;

  const blockedUserIdsFromEnv = parseAllowlist(resolveConfiguredValue(
    process.env.PERSONAL_AGENT_TELEGRAM_BLOCKED_USER_IDS,
    { fieldName: 'PERSONAL_AGENT_TELEGRAM_BLOCKED_USER_IDS' },
  ));
  const storedBlockedUserIds = resolveConfiguredAllowlistEntries(
    storedTelegram?.blockedUserIds,
    { fieldName: 'gateway.telegram.blockedUserIds' },
  );
  const blockedUserIds = blockedUserIdsFromEnv.size > 0
    ? blockedUserIdsFromEnv
    : storedBlockedUserIds;

  if (allowlist.size === 0 && allowedUserIds.size === 0) {
    throw new Error(
      'Telegram gateway requires at least one allowlisted chat ID or allowed user ID. ' +
      'Run `pa gateway setup telegram` to configure access controls.',
    );
  }

  const workingDirectory = process.env.PERSONAL_AGENT_TELEGRAM_CWD
    || storedTelegram?.workingDirectory
    || process.cwd();

  const maxPendingPerChat = toPositiveInteger(process.env.PERSONAL_AGENT_TELEGRAM_MAX_PENDING_PER_CHAT)
    ?? storedTelegram?.maxPendingPerChat;

  const toolActivityStream = toOptionalBoolean(process.env.PERSONAL_AGENT_TELEGRAM_TOOL_ACTIVITY_STREAM)
    ?? storedTelegram?.toolActivityStream
    ?? false;

  const clearRecentMessagesOnNew = toOptionalBoolean(process.env.PERSONAL_AGENT_TELEGRAM_CLEAR_RECENT_MESSAGES_ON_NEW)
    ?? storedTelegram?.clearRecentMessagesOnNew
    ?? true;

  return {
    token,
    profile,
    allowlist,
    allowedUserIds,
    blockedUserIds,
    workingDirectory,
    maxPendingPerChat,
    toolActivityStream,
    clearRecentMessagesOnNew,
  };
}

export async function startTelegramBridge(config?: TelegramBridgeConfig): Promise<void> {
  const effectiveConfig = config ?? await createTelegramConfigFromEnv();
  process.env.PERSONAL_AGENT_GATEWAY_MODE = '1';
  process.env.PERSONAL_AGENT_GATEWAY_PROVIDER = 'telegram';

  const { resolvedProfile, statePaths, runtime } = await prepareGatewayRuntime(effectiveConfig.profile);

  const telegramSessionDir = join(statePaths.session, 'telegram');
  await mkdir(telegramSessionDir, { recursive: true });

  const telegramDurableInboxDir = join(statePaths.root, 'gateway', 'pending', 'telegram');
  await mkdir(telegramDurableInboxDir, { recursive: true });

  const telegramMediaDir = join(statePaths.root, 'gateway', 'media', 'telegram');
  await mkdir(telegramMediaDir, { recursive: true });

  const telegramExportDir = join(statePaths.root, 'gateway', 'exports', 'telegram');
  await mkdir(telegramExportDir, { recursive: true });

  const telegramConversationBindingPath = join(statePaths.root, 'gateway', 'state', 'telegram-conversation-bindings.json');
  const telegramConversationSessionBindings = loadTelegramConversationBindings(telegramConversationBindingPath);

  const telegramWorkTopicBindingPath = join(statePaths.root, 'gateway', 'state', 'telegram-work-topics.json');
  const telegramWorkTopicBindings = loadTelegramWorkTopicBindings(telegramWorkTopicBindingPath);

  const persistTelegramConversationSessionBindings = (): void => {
    writeTelegramConversationBindings(telegramConversationBindingPath, telegramConversationSessionBindings);
  };

  const persistTelegramWorkTopicBindings = (): void => {
    writeTelegramWorkTopicBindings(telegramWorkTopicBindingPath, telegramWorkTopicBindings);
  };

  const resolveTelegramConversationSessionFile = (input: {
    conversationId: string;
    defaultSessionFile: string;
  }): string => telegramConversationSessionBindings.get(input.conversationId) ?? input.defaultSessionFile;

  const defaultTelegramSessionFileForConversation = (conversationId: string): string | undefined => {
    const parsed = parseTelegramConversationId(conversationId);
    if (!parsed) {
      return undefined;
    }

    return join(telegramSessionDir, buildTelegramSessionFileName(parsed.chatId, parsed.messageThreadId));
  };

  const setTelegramConversationSessionFile = (input: {
    conversationId: string;
    sessionFile: string;
  }): void => {
    const normalizedConversationId = input.conversationId.trim();
    const normalizedSessionFile = input.sessionFile.trim();

    if (normalizedConversationId.length === 0 || normalizedSessionFile.length === 0) {
      return;
    }

    const previous = telegramConversationSessionBindings.get(normalizedConversationId);
    if (previous !== normalizedSessionFile) {
      telegramConversationSessionBindings.set(normalizedConversationId, normalizedSessionFile);
      persistTelegramConversationSessionBindings();
    }

    let workTopicUpdated = false;
    for (const [sourceConversationId, binding] of telegramWorkTopicBindings.entries()) {
      if (binding.workConversationId !== normalizedConversationId) {
        continue;
      }

      if (binding.sessionFile === normalizedSessionFile) {
        continue;
      }

      telegramWorkTopicBindings.set(sourceConversationId, {
        ...binding,
        sessionFile: normalizedSessionFile,
        updatedAt: new Date().toISOString(),
      });
      workTopicUpdated = true;
    }

    if (workTopicUpdated) {
      persistTelegramWorkTopicBindings();
    }
  };

  const clearTelegramConversationSessionFile = (input: {
    conversationId: string;
  }): void => {
    const normalizedConversationId = input.conversationId.trim();
    if (normalizedConversationId.length === 0) {
      return;
    }

    const removed = telegramConversationSessionBindings.delete(normalizedConversationId);
    if (removed) {
      persistTelegramConversationSessionBindings();
    }

    const nextDefaultSessionFile = defaultTelegramSessionFileForConversation(normalizedConversationId);
    if (!nextDefaultSessionFile) {
      return;
    }

    let workTopicUpdated = false;
    for (const [sourceConversationId, binding] of telegramWorkTopicBindings.entries()) {
      if (binding.workConversationId !== normalizedConversationId) {
        continue;
      }

      telegramWorkTopicBindings.set(sourceConversationId, {
        ...binding,
        sessionFile: nextDefaultSessionFile,
        updatedAt: new Date().toISOString(),
      });
      workTopicUpdated = true;
    }

    if (workTopicUpdated) {
      persistTelegramWorkTopicBindings();
    }
  };

  const bot = new TelegramBot(effectiveConfig.token, { polling: true });

  const allowlist = effectiveConfig.allowlist;
  const allowedUserIds = effectiveConfig.allowedUserIds ?? new Set<string>();
  const blockedUserIds = effectiveConfig.blockedUserIds ?? new Set<string>();

  const maxPendingPerChat = effectiveConfig.maxPendingPerChat ?? DEFAULT_MAX_PENDING_PER_CHAT;
  const toolActivityStream = effectiveConfig.toolActivityStream ?? false;
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

  const sendTelegramMessageWithRetry = (
    chatId: number,
    text: string,
    options?: TelegramSendMessageOptions,
  ): Promise<unknown> => withTelegramRetry(
    `telegram.sendMessage chat=${chatId}`,
    () => {
      if (!options) {
        return bot.sendMessage(chatId, text);
      }

      return bot.sendMessage(chatId, text, options as Parameters<typeof bot.sendMessage>[2]);
    },
  );

  const editTelegramMessageTextWithRetry = (
    chatId: number,
    messageId: number,
    text: string,
    options?: TelegramSendMessageOptions,
  ): Promise<unknown> => withTelegramRetry(
    `telegram.editMessageText chat=${chatId} message=${messageId}`,
    () => bot.editMessageText(text, {
      chat_id: chatId,
      message_id: messageId,
      ...(options ?? {}),
    } as Parameters<typeof bot.editMessageText>[1]),
  );

  const deleteTelegramMessageWithRetry = (
    chatId: number,
    messageId: number,
  ): Promise<unknown> => withTelegramRetry(
    `telegram.deleteMessage chat=${chatId} message=${messageId}`,
    () => bot.deleteMessage(chatId, messageId),
  );

  const botWithDeleteMessages = bot as unknown as {
    deleteMessages?: (targetChatId: number, targetMessageIds: number[]) => Promise<unknown>;
  };

  const deleteTelegramMessagesWithRetry: DeleteMessagesFn | undefined =
    typeof botWithDeleteMessages.deleteMessages === 'function'
      ? (chatId, messageIds) => withTelegramRetry(
        `telegram.deleteMessages chat=${chatId} count=${messageIds.length}`,
        () => botWithDeleteMessages.deleteMessages!(chatId, messageIds),
      )
      : undefined;

  const sendTelegramDocumentWithRetry = (
    chatId: number,
    filePath: string,
    options?: TelegramSendFileOptions,
  ): Promise<unknown> => withTelegramRetry(
    `telegram.sendDocument chat=${chatId}`,
    () => bot.sendDocument(chatId, filePath, options ?? {}),
  );

  const sendTelegramPhotoWithRetry = (
    chatId: number,
    filePath: string,
    options?: TelegramSendFileOptions,
  ): Promise<unknown> => withTelegramRetry(
    `telegram.sendPhoto chat=${chatId}`,
    () => bot.sendPhoto(chatId, filePath, options ?? {}),
  );

  const trackedScheduledReplyContexts = new Map<string, ScheduledReplyContext & { trackedAtMs: number }>();

  const pruneTrackedScheduledReplyContexts = (): void => {
    const nowMs = Date.now();

    for (const [key, context] of trackedScheduledReplyContexts) {
      if (nowMs - context.trackedAtMs > SCHEDULED_REPLY_CONTEXT_TTL_MS) {
        trackedScheduledReplyContexts.delete(key);
      }
    }

    while (trackedScheduledReplyContexts.size > MAX_TRACKED_SCHEDULED_REPLY_CONTEXTS) {
      const oldestKey = trackedScheduledReplyContexts.keys().next().value;
      if (typeof oldestKey !== 'string') {
        break;
      }

      trackedScheduledReplyContexts.delete(oldestKey);
    }
  };

  const trackScheduledReplyContext = (chatId: number, messageId: number, notification: GatewayNotification): void => {
    trackedScheduledReplyContexts.set(
      toTrackedScheduledReplyContextKey(String(chatId), messageId),
      {
        source: 'scheduled-task',
        taskId: notification.taskId,
        status: notification.status,
        message: notification.message,
        logPath: notification.logPath,
        createdAt: notification.createdAt,
        trackedAtMs: Date.now(),
      },
    );

    pruneTrackedScheduledReplyContexts();
  };

  const resolveScheduledReplyContext = (
    chatId: string,
    replyMessageId: number,
  ): ScheduledReplyContext | undefined => {
    pruneTrackedScheduledReplyContexts();

    const tracked = trackedScheduledReplyContexts.get(toTrackedScheduledReplyContextKey(chatId, replyMessageId));
    if (!tracked) {
      return undefined;
    }

    return {
      source: tracked.source,
      taskId: tracked.taskId,
      status: tracked.status,
      message: tracked.message,
      logPath: tracked.logPath,
      createdAt: tracked.createdAt,
    };
  };

  const pendingRoomAuthorizationRequests = new Map<string, TelegramRoomAuthorizationRequest>();

  const prunePendingRoomAuthorizationRequests = (): void => {
    const nowMs = Date.now();

    for (const [token, request] of pendingRoomAuthorizationRequests) {
      if (nowMs - request.createdAtMs > TELEGRAM_ROOM_AUTH_REQUEST_TTL_MS) {
        pendingRoomAuthorizationRequests.delete(token);
      }
    }

    while (pendingRoomAuthorizationRequests.size > TELEGRAM_MAX_PENDING_ROOM_AUTH_REQUESTS) {
      const oldestToken = pendingRoomAuthorizationRequests.keys().next().value;
      if (typeof oldestToken !== 'string') {
        break;
      }

      pendingRoomAuthorizationRequests.delete(oldestToken);
    }
  };

  const persistTelegramAccessLists = (): void => {
    const current = readGatewayConfig();
    const existingTelegram = current.telegram ?? {};

    const sortedAllowlist = [...allowlist].sort((a, b) => a.localeCompare(b));
    const sortedAllowedUsers = [...allowedUserIds].sort((a, b) => a.localeCompare(b));
    const sortedBlockedUsers = [...blockedUserIds].sort((a, b) => a.localeCompare(b));

    const updated: GatewayStoredConfig = {
      ...current,
      telegram: {
        ...existingTelegram,
        allowlist: sortedAllowlist,
        allowedUserIds: sortedAllowedUsers.length > 0 ? sortedAllowedUsers : undefined,
        blockedUserIds: sortedBlockedUsers.length > 0 ? sortedBlockedUsers : undefined,
      },
    };

    writeGatewayConfig(updated);
  };

  const sendAuthorizationNotificationToOwners = async (
    text: string,
    sendOptions?: TelegramSendMessageOptions,
  ): Promise<number> => {
    if (allowedUserIds.size === 0) {
      console.warn(gatewayWarning(
        'Telegram allowed user IDs are empty; cannot send room authorization prompt. ' +
        'Set PERSONAL_AGENT_TELEGRAM_ALLOWED_USER_IDS or gateway.telegram.allowedUserIds.',
      ));
      return 0;
    }

    let delivered = 0;

    for (const ownerUserId of allowedUserIds) {
      const ownerChatId = toNumericDestinationId(ownerUserId);
      if (typeof ownerChatId !== 'number') {
        console.warn(gatewayWarning(`Skipping invalid allowed user id ${ownerUserId} for Telegram room authorization`));
        continue;
      }

      try {
        await sendTelegramFormattedMessage(sendTelegramMessageWithRetry, ownerChatId, text, sendOptions);
        delivered += 1;
      } catch (error) {
        console.warn(gatewayWarning(
          `Failed to deliver Telegram room authorization prompt to ${ownerUserId}: ${(error as Error).message}`,
        ));
      }
    }

    return delivered;
  };

  const findPendingRoomRequestByChatId = (chatId: string): TelegramRoomAuthorizationRequest | undefined => {
    prunePendingRoomAuthorizationRequests();

    const matching = [...pendingRoomAuthorizationRequests.values()]
      .filter((request) => request.chatId === chatId)
      .sort((a, b) => b.createdAtMs - a.createdAtMs);

    return matching[0];
  };

  const formatPendingRequestAge = (createdAtMs: number): string => {
    const ageMs = Math.max(0, Date.now() - createdAtMs);
    const minutes = Math.floor(ageMs / 60_000);

    if (minutes < 1) {
      return '<1m';
    }

    if (minutes < 60) {
      return `${minutes}m`;
    }

    const hours = Math.floor(minutes / 60);
    if (hours < 24) {
      return `${hours}h`;
    }

    const days = Math.floor(hours / 24);
    return `${days}d`;
  };

  const formatPendingRoomRequests = (): string => {
    prunePendingRoomAuthorizationRequests();

    const requests = [...pendingRoomAuthorizationRequests.values()]
      .sort((a, b) => b.createdAtMs - a.createdAtMs);

    if (requests.length === 0) {
      return 'No pending room authorization requests.';
    }

    const lines = ['Pending room authorization requests:'];
    for (const request of requests) {
      lines.push(
        `- ${request.chatTitle} (${request.chatId}) · inviter=${request.inviterLabel} · age=${formatPendingRequestAge(request.createdAtMs)}`,
      );
    }

    return lines.join('\n');
  };

  const formatBlockedUsers = (): string => {
    if (blockedUserIds.size === 0) {
      return 'Blocked Telegram user IDs: (none)';
    }

    const values = [...blockedUserIds].sort((a, b) => a.localeCompare(b));
    return `Blocked Telegram user IDs:\n- ${values.join('\n- ')}`;
  };

  const executeRoomAuthorizationDecision = async (input: {
    request: TelegramRoomAuthorizationRequest;
    action: 'approve' | 'deny';
    actingUserLabel: string;
    notifyOwners: boolean;
  }): Promise<string> => {
    pendingRoomAuthorizationRequests.delete(input.request.token);

    if (input.action === 'approve') {
      allowlist.add(input.request.chatId);
      persistTelegramAccessLists();

      const summary = [
        '✅ Room authorized.',
        `Room: ${input.request.chatTitle} (${input.request.chatId})`,
        `Approved by: ${input.actingUserLabel}`,
      ].join('\n');

      if (input.notifyOwners) {
        await sendAuthorizationNotificationToOwners(summary);
      }

      return summary;
    }

    allowlist.delete(input.request.chatId);

    if (input.request.inviterUserId) {
      blockedUserIds.add(input.request.inviterUserId);
    }

    persistTelegramAccessLists();

    let leaveResult = 'left room';
    try {
      await withTelegramRetry(
        `telegram.leaveChat chat=${input.request.chatNumericId}`,
        () => bot.leaveChat(input.request.chatNumericId),
      );
    } catch (error) {
      leaveResult = `unable to leave room (${(error as Error).message})`;
    }

    let blockResult = input.request.inviterUserId
      ? `blocked inviter ${input.request.inviterUserId} in bot policy`
      : 'inviter unavailable for bot policy block';

    if (input.request.inviterNumericId !== undefined) {
      try {
        await withTelegramRetry(
          `telegram.banChatMember chat=${input.request.chatNumericId} user=${input.request.inviterNumericId}`,
          () => (bot as { banChatMember: (chatId: number, userId: number) => Promise<unknown> })
            .banChatMember(input.request.chatNumericId, input.request.inviterNumericId!),
        );
        blockResult = `${blockResult}; banned inviter in chat`;
      } catch (error) {
        blockResult = `${blockResult}; unable to ban in chat (${(error as Error).message})`;
      }
    }

    const summary = [
      '❌ Room denied.',
      `Room: ${input.request.chatTitle} (${input.request.chatId})`,
      `Denied by: ${input.actingUserLabel}`,
      `Action: ${leaveResult}`,
      `Block: ${blockResult}`,
    ].join('\n');

    if (input.notifyOwners) {
      await sendAuthorizationNotificationToOwners(summary);
    }

    return summary;
  };

  const handleRoomAdminCommand: HandleTelegramRoomAdminCommandFn = async (input) => {
    if (input.actorUserId && blockedUserIds.has(input.actorUserId)) {
      return 'You are blocked from this bot.';
    }

    if (allowedUserIds.size > 0 && (!input.actorUserId || !allowedUserIds.has(input.actorUserId))) {
      return 'Not authorized.';
    }

    const args = input.args.trim();
    const parts = args.length > 0 ? args.split(/\s+/) : [];
    const subcommand = (parts[0] ?? 'help').toLowerCase();
    const value = parts[1];

    if (subcommand === 'help') {
      return [
        'Room admin commands:',
        '/room pending',
        '/room approve <chatId>',
        '/room deny <chatId>',
        '/room blocked',
      ].join('\n');
    }

    if (subcommand === 'pending') {
      return formatPendingRoomRequests();
    }

    if (subcommand === 'blocked') {
      return formatBlockedUsers();
    }

    if (subcommand === 'approve' || subcommand === 'deny') {
      if (!value) {
        return `Usage: /room ${subcommand} <chatId>`;
      }

      const request = findPendingRoomRequestByChatId(value);
      if (!request) {
        return `No pending room authorization request for ${value}.`;
      }

      return executeRoomAuthorizationDecision({
        request,
        action: subcommand,
        actingUserLabel: input.actorLabel,
        notifyOwners: true,
      });
    }

    return `Unknown /room subcommand: ${subcommand}. Use /room help.`;
  };

  interface TelegramRunGroupSession {
    sessionName: string;
    taskSlug: string;
    commandText: string;
    logPath?: string;
    status: 'running' | 'success' | 'failed' | 'unknown';
    startedAt: string;
    completedAt?: string;
    exitCode?: number;
  }

  interface TelegramRunGroup {
    id: string;
    sourceConversationId: string;
    sourceChatId: number;
    sourceMessageThreadId?: number;
    targetConversationId: string;
    targetChatId: number;
    targetMessageThreadId?: number;
    targetTopicName?: string;
    notifyMode: TelegramRunNotifyMode;
    status: 'running' | 'completed';
    sessions: TelegramRunGroupSession[];
    dashboardMessageId?: number;
    createdAt: string;
    updatedAt: string;
    resumeTriggered?: boolean;
  }

  interface TelegramRunWatch {
    sessionName: string;
    groupId: string;
    logPath?: string;
  }

  const runGroups = new Map<string, TelegramRunGroup>();
  const runWatches = new Map<string, TelegramRunWatch>();
  let runWatchPollInFlight = false;
  let syntheticInternalMessageId = Date.now();
  const telegramHandlerRef: { current?: QueuedTelegramMessageHandler } = {};

  const buildSyntheticTelegramSender = (): TelegramUserLike | undefined => {
    const syntheticSenderId = [...allowedUserIds]
      .map((userId) => toNumericDestinationId(userId))
      .find((value): value is number => typeof value === 'number');

    if (allowedUserIds.size > 0 && typeof syntheticSenderId !== 'number') {
      return undefined;
    }

    if (typeof syntheticSenderId !== 'number') {
      return undefined;
    }

    return {
      id: syntheticSenderId,
      username: 'pa-system',
      first_name: 'PA',
      last_name: 'System',
    };
  };

  const dispatchSyntheticTelegramFollowUp = (conversationId: string, prompt: string): boolean => {
    if (!telegramHandlerRef.current) {
      return false;
    }

    const parsed = parseTelegramConversationId(conversationId);
    if (!parsed) {
      return false;
    }

    const syntheticSender = buildSyntheticTelegramSender();
    if (allowedUserIds.size > 0 && !syntheticSender) {
      return false;
    }

    syntheticInternalMessageId += 1;
    telegramHandlerRef.current.handleMessage({
      chat: {
        id: Number(parsed.chatId),
        type: 'supergroup',
      },
      message_id: syntheticInternalMessageId,
      message_thread_id: parsed.messageThreadId,
      text: `/followup ${prompt}`,
      from: syntheticSender,
    });
    return true;
  };

  const pickMoreVerboseNotifyMode = (
    left: TelegramRunNotifyMode,
    right: TelegramRunNotifyMode,
  ): TelegramRunNotifyMode => {
    const rank = (mode: TelegramRunNotifyMode): number => {
      if (mode === 'resume') {
        return 3;
      }

      if (mode === 'message') {
        return 2;
      }

      return 1;
    };

    return rank(right) > rank(left) ? right : left;
  };

  const toThreadedMessageOptions = (messageThreadId: number | undefined): TelegramSendMessageOptions | undefined =>
    applyTelegramThreadToMessageOptions(undefined, messageThreadId);

  const sendTelegramMessageToConversation = async (
    chatId: number,
    messageThreadId: number | undefined,
    text: string,
  ): Promise<unknown> => sendTelegramFormattedMessage(
    sendTelegramMessageWithRetry,
    chatId,
    text,
    toThreadedMessageOptions(messageThreadId),
  );

  const updateTelegramMessageInConversation = async (
    chatId: number,
    messageId: number,
    text: string,
  ): Promise<void> => {
    await editTelegramFormattedMessage(
      editTelegramMessageTextWithRetry,
      chatId,
      messageId,
      text,
      undefined,
    );
  };

  const sanitizeRunGroupToken = (value: string): string => {
    const normalized = value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+/, '')
      .replace(/-+$/, '');

    return normalized.length > 0 ? normalized.slice(0, 64) : 'auto';
  };

  const createTelegramRunGroupId = (taskSlug: string): string => {
    const task = sanitizeRunGroupToken(taskSlug).slice(0, 24) || 'task';
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    return `${task}-${timestamp}`;
  };

  const defaultWorkTopicName = (taskSlug: string): string => {
    const task = sanitizeRunGroupToken(taskSlug).replaceAll('_', '-').slice(0, 32) || 'task';
    const timestamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 12);
    return `work-${task}-${timestamp}`;
  };

  const formatRunGroupDashboard = (group: TelegramRunGroup): string => {
    const lines = [`🧵 run group: ${group.id}`, `status=${group.status}`, `notify=${group.notifyMode}`];

    if (group.targetMessageThreadId !== undefined) {
      lines.push(`threadId=${group.targetMessageThreadId}`);
    }

    lines.push('', 'Runs:');

    for (const session of group.sessions) {
      const icon = session.status === 'running'
        ? '⏳'
        : session.status === 'success'
          ? '✅'
          : session.status === 'failed'
            ? '❌'
            : '⚠️';

      const metadata: string[] = [session.sessionName, `task=${session.taskSlug}`, `status=${session.status}`];
      if (typeof session.exitCode === 'number') {
        metadata.push(`exit=${session.exitCode}`);
      }

      lines.push(`- ${icon} ${metadata.join(' · ')}`);
    }

    return lines.join('\n');
  };

  const formatRunGroupCompletion = (group: TelegramRunGroup): string => {
    const succeeded = group.sessions.filter((session) => session.status === 'success').length;
    const failed = group.sessions.filter((session) => session.status === 'failed').length;
    const unknown = group.sessions.filter((session) => session.status === 'unknown').length;

    const lines = [
      `run group completed: ${group.id}`,
      `success=${succeeded} failed=${failed} unknown=${unknown}`,
    ];

    const failedSessions = group.sessions.filter((session) => session.status === 'failed');
    if (failedSessions.length > 0) {
      lines.push('', 'Failed runs:');
      for (const session of failedSessions) {
        lines.push(`- ${session.sessionName}${typeof session.exitCode === 'number' ? ` (exit=${session.exitCode})` : ''}`);
      }
    }

    return lines.join('\n');
  };

  const updateRunGroupDashboard = async (group: TelegramRunGroup): Promise<void> => {
    const text = formatRunGroupDashboard(group);

    if (group.dashboardMessageId !== undefined) {
      await updateTelegramMessageInConversation(group.targetChatId, group.dashboardMessageId, text);
      return;
    }

    const sent = await sendTelegramMessageToConversation(
      group.targetChatId,
      group.targetMessageThreadId,
      text,
    );

    const messageId = toTelegramSentMessageId(sent);
    if (typeof messageId === 'number') {
      group.dashboardMessageId = messageId;
      group.updatedAt = new Date().toISOString();
    }
  };

  const summarizeRunGroupForFollowUp = (group: TelegramRunGroup): string => {
    const lines = [
      `run group ${group.id} completed. Continue from this point.`,
      '',
      'Run results:',
    ];

    for (const session of group.sessions) {
      const summary = [`- ${session.sessionName}`, `status=${session.status}`];
      if (typeof session.exitCode === 'number') {
        summary.push(`exit=${session.exitCode}`);
      }

      const tail = readRunLogTail(session.logPath, 12);
      if (tail.length > 0) {
        summary.push(`tail=${tail}`);
      }

      lines.push(summary.join(' · '));
    }

    lines.push('', 'Please summarize outcomes and continue with next concrete steps.');
    return lines.join('\n');
  };

  const dispatchInternalFollowUp = (group: TelegramRunGroup): boolean =>
    dispatchSyntheticTelegramFollowUp(group.targetConversationId, summarizeRunGroupForFollowUp(group));

  const finalizeRunWatch = async (watch: TelegramRunWatch): Promise<void> => {
    const group = runGroups.get(watch.groupId);
    if (!group) {
      return;
    }

    const session = group.sessions.find((entry) => entry.sessionName === watch.sessionName);
    if (!session) {
      return;
    }

    const exitCode = readRunExitCodeFromLog(watch.logPath ?? session.logPath);
    session.exitCode = exitCode;
    session.completedAt = new Date().toISOString();
    session.status = exitCode === undefined
      ? 'unknown'
      : exitCode === 0
        ? 'success'
        : 'failed';

    group.updatedAt = new Date().toISOString();

    await updateRunGroupDashboard(group);

    const hasRunningSessions = group.sessions.some((entry) => entry.status === 'running');
    if (hasRunningSessions) {
      return;
    }

    group.status = 'completed';
    group.updatedAt = new Date().toISOString();

    const completionSummary = formatRunGroupCompletion(group);

    if (group.notifyMode !== 'none') {
      await sendTelegramMessageToConversation(
        group.targetChatId,
        group.targetMessageThreadId,
        completionSummary,
      );

      const sourceDiffers = group.sourceChatId !== group.targetChatId
        || group.sourceMessageThreadId !== group.targetMessageThreadId;

      if (sourceDiffers) {
        await sendTelegramMessageToConversation(
          group.sourceChatId,
          group.sourceMessageThreadId,
          `run group ${group.id} finished in thread ${String(group.targetMessageThreadId ?? 'n/a')}.`,
        );
      }
    }

    if (group.notifyMode === 'resume' && !group.resumeTriggered) {
      group.resumeTriggered = true;
      const resumed = dispatchInternalFollowUp(group);

      if (!resumed) {
        await sendTelegramMessageToConversation(
          group.targetChatId,
          group.targetMessageThreadId,
          'Unable to auto-resume: no authorized synthetic sender is configured. Reply in this thread to continue.',
        );
      }
    }

    runGroups.delete(group.id);
  };

  const pollRunWatches = async (): Promise<void> => {
    if (runWatchPollInFlight || runWatches.size === 0) {
      return;
    }

    runWatchPollInFlight = true;

    try {
      for (const [sessionName, watch] of [...runWatches.entries()]) {
        const inspect = runGatewayRunCli(
          ['show', sessionName, '--json'],
          effectiveConfig.workingDirectory,
        );

        if (!inspect.ok) {
          const normalizedOutput = inspect.output.toLowerCase();
          if (normalizedOutput.includes('run not found')) {
            runWatches.delete(sessionName);
            await finalizeRunWatch(watch);
          }
          continue;
        }

        try {
          const parsed = JSON.parse(inspect.output) as {
            run?: {
              status?: {
                status?: string;
              };
            };
          };
          const status = parsed.run?.status?.status;
          if (status !== 'completed' && status !== 'failed' && status !== 'cancelled') {
            continue;
          }

          runWatches.delete(sessionName);
          await finalizeRunWatch(watch);
        } catch {
          continue;
        }
      }
    } finally {
      runWatchPollInFlight = false;
    }
  };

  const runWatchPollHandle = setInterval(() => {
    void pollRunWatches().catch((error) => {
      console.warn(gatewayWarning(`Failed to poll background runs: ${(error as Error).message}`));
    });
  }, 5000);
  runWatchPollHandle.unref();

  const handleRunCommand: HandleTelegramRunCommandFn = async ({ args }) =>
    runTelegramRunCommand({
      args,
      workingDirectory: effectiveConfig.workingDirectory,
    });

  const handleRunRequest: HandleTelegramRunRequestFn = async (input) => {
    const sourceConversationId = input.sourceConversationId;
    const sourceChatIdToken = String(input.sourceChatId);
    const sourceSessionFile = input.resolveConversationSessionFile({
      conversationId: sourceConversationId,
      defaultSessionFile: input.defaultSourceSessionFile,
    });

    let targetConversationId = sourceConversationId;
    let targetChatId = input.sourceChatId;
    let targetMessageThreadId = input.sourceMessageThreadId;
    let targetTopicName: string | undefined;

    const sourceBinding = telegramWorkTopicBindings.get(sourceConversationId);
    const sourceWorkBinding = sourceBinding
      ?? [...telegramWorkTopicBindings.values()].find((binding) => binding.workConversationId === sourceConversationId);
    const sourceIsExistingWorkTopic = Boolean(sourceWorkBinding)
      && sourceWorkBinding?.workConversationId === sourceConversationId;

    const canCreateWorkTopic = input.sourceChatType === 'group' || input.sourceChatType === 'supergroup';

    const shouldCreateNewTopic = input.run.forkMode === 'new-topic'
      || (input.run.forkMode === 'auto' && !sourceBinding && !sourceIsExistingWorkTopic);

    const shouldReuseTopic = input.run.forkMode === 'reuse-topic'
      || (input.run.forkMode === 'auto' && Boolean(sourceBinding));

    if (input.run.forkMode !== 'none') {
      if (sourceIsExistingWorkTopic && (input.run.forkMode === 'auto' || input.run.forkMode === 'reuse-topic')) {
        const binding = sourceWorkBinding as TelegramWorkTopicBinding;
        targetConversationId = sourceConversationId;
        targetChatId = input.sourceChatId;
        targetMessageThreadId = input.sourceMessageThreadId;
        targetTopicName = binding.topicName;

        input.setConversationSessionFile({
          conversationId: targetConversationId,
          sessionFile: binding.sessionFile,
        });
      }

      if (shouldReuseTopic && !sourceBinding && !sourceIsExistingWorkTopic) {
        throw new Error('No existing work topic is bound to this conversation. Use fork=new-topic or fork=auto first.');
      }

      if (shouldReuseTopic && sourceBinding) {
        targetConversationId = sourceBinding.workConversationId;
        targetChatId = sourceBinding.workChatId;
        targetMessageThreadId = sourceBinding.workMessageThreadId;
        targetTopicName = sourceBinding.topicName;

        input.setConversationSessionFile({
          conversationId: targetConversationId,
          sessionFile: sourceBinding.sessionFile,
        });
      }

      if (shouldCreateNewTopic) {
        if (!canCreateWorkTopic) {
          throw new Error('Auto topic forking requires a Telegram group/supergroup conversation.');
        }

        if (typeof (bot as { createForumTopic?: unknown }).createForumTopic !== 'function') {
          throw new Error('Forum topic creation is not supported by this Telegram runtime.');
        }

        const topicName = input.run.topic !== 'auto'
          ? input.run.topic
          : defaultWorkTopicName(input.run.taskSlug);

        const topicResult = await withTelegramRetry(
          `telegram.createForumTopic chat=${input.sourceChatId}`,
          () => (bot as { createForumTopic: (chatId: number, name: string) => Promise<unknown> })
            .createForumTopic(input.sourceChatId, topicName),
        );

        const createdThreadId = normalizeTelegramMessageThreadId(
          (topicResult as { message_thread_id?: number }).message_thread_id,
        );

        if (createdThreadId === undefined) {
          throw new Error('Telegram createForumTopic did not return a valid message_thread_id.');
        }

        const forkableMessages = input.getForkableMessages();
        const sortedForkableMessages = normalizeForkableMessages(await forkableMessages);
        const selectedForkEntry = sortedForkableMessages[0];

        if (!selectedForkEntry) {
          throw new Error('No user message is available to fork from yet. Send a prompt first, then retry /run.');
        }

        const forkResult = await input.forkConversation(selectedForkEntry.entryId);
        if (forkResult.cancelled) {
          throw new Error('Fork was cancelled by an extension.');
        }

        const nextSessionFile = forkResult.sessionFile || sourceSessionFile;

        targetChatId = input.sourceChatId;
        targetMessageThreadId = createdThreadId;
        targetConversationId = buildTelegramConversationId(sourceChatIdToken, createdThreadId);
        targetTopicName = typeof (topicResult as { name?: string }).name === 'string'
          ? ((topicResult as { name?: string }).name as string)
          : topicName;

        input.setConversationSessionFile({
          conversationId: targetConversationId,
          sessionFile: nextSessionFile,
        });

        telegramWorkTopicBindings.set(sourceConversationId, {
          sourceConversationId,
          sourceChatId: sourceChatIdToken,
          sourceMessageThreadId: input.sourceMessageThreadId,
          workConversationId: targetConversationId,
          workChatId: targetChatId,
          workMessageThreadId: createdThreadId,
          topicName: targetTopicName,
          sessionFile: nextSessionFile,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
        persistTelegramWorkTopicBindings();

        const seedLines = [
          `🧵 Forked from ${sourceConversationId}`,
          `Source session: ${sourceSessionFile}`,
          `Fork entry: ${selectedForkEntry.entryId}`,
          `Forked session: ${nextSessionFile}`,
          '',
          'Selected message:',
          trimForkMessagePreview(selectedForkEntry.text, 400),
          '',
          'This topic is now the work thread for background runs started with fork=auto.',
        ];

        await sendTelegramMessageToConversation(
          targetChatId,
          targetMessageThreadId,
          seedLines.join('\n'),
        );
      }
    }

    const resolvedGroupToken = sanitizeRunGroupToken(input.run.group);
    const existingGroup = resolvedGroupToken !== 'auto'
      ? runGroups.get(resolvedGroupToken)
      : [...runGroups.values()].find((group) =>
        group.status === 'running'
        && group.sourceConversationId === sourceConversationId
        && group.targetConversationId === targetConversationId
      );

    const groupId = existingGroup?.id
      ?? (resolvedGroupToken !== 'auto' ? resolvedGroupToken : createTelegramRunGroupId(input.run.taskSlug));

    const group = existingGroup ?? {
      id: groupId,
      sourceConversationId,
      sourceChatId: input.sourceChatId,
      sourceMessageThreadId: input.sourceMessageThreadId,
      targetConversationId,
      targetChatId,
      targetMessageThreadId,
      targetTopicName,
      notifyMode: input.run.notifyMode,
      status: 'running' as const,
      sessions: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    group.notifyMode = pickMoreVerboseNotifyMode(group.notifyMode, input.run.notifyMode);
    group.updatedAt = new Date().toISOString();
    runGroups.set(group.id, group);

    const runCliArgs = buildTelegramRunCliArgs(input.run);
    const runResult = runGatewayRunCli(runCliArgs, effectiveConfig.workingDirectory);
    if (!runResult.ok) {
      throw new Error(runResult.output);
    }

    const parsedRunOutput = parseRunCliOutput(runResult.output);
    if (!parsedRunOutput.runId) {
      throw new Error(`Unable to parse durable run id from output:\n${runResult.output}`);
    }

    const sessionName = parsedRunOutput.runId;
    const sessionLogPath = parsedRunOutput.logPath;

    group.sessions.push({
      sessionName,
      taskSlug: input.run.taskSlug,
      commandText: input.run.commandText,
      logPath: sessionLogPath,
      status: 'running',
      startedAt: new Date().toISOString(),
    });

    group.updatedAt = new Date().toISOString();

    runWatches.set(sessionName, {
      sessionName,
      groupId: group.id,
      logPath: sessionLogPath,
    });

    await updateRunGroupDashboard(group);
    void pollRunWatches();

    if (group.targetConversationId !== sourceConversationId) {
      await sendTelegramMessageToConversation(
        group.targetChatId,
        group.targetMessageThreadId,
        [
          `Started durable run ${sessionName}.`,
          `group=${group.id}`,
          `task=${input.run.taskSlug}`,
          `notify=${input.run.notifyMode}`,
          ...(sessionLogPath ? [`log=${sessionLogPath}`] : []),
        ].join('\n'),
      );
    }

    const sourceReplyLines = [
      `Started durable run ${sessionName}.`,
      `group=${group.id}`,
      `notify=${input.run.notifyMode}`,
    ];

    if (group.targetConversationId !== sourceConversationId) {
      sourceReplyLines.push(
        `workConversation=${group.targetConversationId}`,
        `workThreadId=${String(group.targetMessageThreadId ?? 'n/a')}`,
      );
    }

    if (sessionLogPath) {
      sourceReplyLines.push(`log=${sessionLogPath}`);
    }

    return sourceReplyLines.join('\n');
  };

  const discoveredHelp = await discoverPiHelpFromPi({
    profile: resolvedProfile,
    agentDir: runtime.agentDir,
    cwd: effectiveConfig.workingDirectory,
    sessionFile: join(telegramSessionDir, '__commands__.jsonl'),
  });
  const discoveredProfileSkills = discoverProfileSkillsFromFilesystem(resolvedProfile);
  const discoveredSkills = discoveredProfileSkills.length > 0
    ? discoveredProfileSkills
    : discoveredHelp.skills;

  const baseTelegramCommands = filterTelegramSlashMenuCommands(
    mergeTelegramCommands(DEFAULT_TELEGRAM_COMMANDS, discoveredHelp.commands),
  );

  const skillSlashCommands = buildTelegramSkillSlashCommands(
    discoveredSkills,
    new Set(baseTelegramCommands.map((command) => command.command)),
  );

  const telegramCommands = [...baseTelegramCommands];
  const skillSlashCommandMap = new Map<string, string>();

  for (const skillCommand of skillSlashCommands) {
    if (telegramCommands.length >= 100) {
      break;
    }

    telegramCommands.push(skillCommand.command);
    skillSlashCommandMap.set(skillCommand.command.command, skillCommand.skillName);
  }

  const commandHelpText = formatTelegramCommands(telegramCommands);
  const skillsHelpText = formatTelegramSkills(discoveredSkills);

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
    allowlist,
    allowedUserIds,
    blockedUserIds,
    profileName: effectiveConfig.profile,
    agentDir: runtime.agentDir,
    telegramSessionDir,
    workingDirectory: effectiveConfig.workingDirectory,
    maxPendingPerChat,
    durableInboxDir: telegramDurableInboxDir,
    telegramExportDir,
    commandHelpText,
    skillsHelpText,
    skillSlashCommandMap,
    modelCommands,
    resolveScheduledReplyContext: ({ chatId, replyMessageId }) =>
      resolveScheduledReplyContext(chatId, replyMessageId),
    handleRoomAdminCommand,
    handleRunCommand,
    handleRunRequest,
    createForumTopic: typeof (bot as { createForumTopic?: unknown }).createForumTopic === 'function'
      ? async ({ chatId, name }) => {
        const topicResult = await withTelegramRetry(
          `telegram.createForumTopic chat=${chatId}`,
          () => (bot as { createForumTopic: (targetChatId: number, topicName: string) => Promise<unknown> })
            .createForumTopic(chatId, name),
        );

        const messageThreadId = normalizeTelegramMessageThreadId(
          (topicResult as { message_thread_id?: number }).message_thread_id,
        );

        if (messageThreadId === undefined) {
          throw new Error('Telegram createForumTopic did not return a valid message_thread_id.');
        }

        const topicName = typeof (topicResult as { name?: string }).name === 'string'
          ? ((topicResult as { name?: string }).name as string)
          : name;

        return {
          messageThreadId,
          name: topicName,
        };
      }
      : undefined,
    setWorkTopicBinding: (binding) => {
      const existing = telegramWorkTopicBindings.get(binding.sourceConversationId);
      const now = new Date().toISOString();

      telegramWorkTopicBindings.set(binding.sourceConversationId, {
        sourceConversationId: binding.sourceConversationId,
        sourceChatId: binding.sourceChatId,
        sourceMessageThreadId: binding.sourceMessageThreadId,
        workConversationId: binding.workConversationId,
        workChatId: binding.workChatId,
        workMessageThreadId: binding.workMessageThreadId,
        topicName: binding.topicName,
        sessionFile: binding.sessionFile,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      });

      persistTelegramWorkTopicBindings();
    },
    resolveConversationSessionFile: resolveTelegramConversationSessionFile,
    setConversationSessionFile: setTelegramConversationSessionFile,
    clearConversationSessionFile: clearTelegramConversationSessionFile,
    persistAccessLists: persistTelegramAccessLists,
    streamToolActivity: toolActivityStream,
    clearRecentMessagesOnNew: effectiveConfig.clearRecentMessagesOnNew,
    sendMessage: (chatId, text, options) => sendTelegramMessageWithRetry(chatId, text, options),
    editMessageText: (chatId, messageId, text, options) =>
      editTelegramMessageTextWithRetry(chatId, messageId, text, options),
    deleteMessage: (chatId, messageId) => deleteTelegramMessageWithRetry(chatId, messageId),
    deleteMessages: deleteTelegramMessagesWithRetry
      ? (chatId, messageIds) => deleteTelegramMessagesWithRetry(chatId, messageIds)
      : undefined,
    sendDocument: (chatId, filePath, options) => sendTelegramDocumentWithRetry(chatId, filePath, options),
    sendPhoto: (chatId, filePath, options) => sendTelegramPhotoWithRetry(chatId, filePath, options),
    sendChatAction: (chatId, action, actionOptions) => withTelegramRetry(
      `telegram.sendChatAction chat=${chatId} action=${action}`,
      () => bot.sendChatAction(chatId, action, actionOptions as Parameters<typeof bot.sendChatAction>[2]),
    ),
    prepareInboundMedia: async ({ chatId, messageId, media }) => {
      const chatDir = join(telegramMediaDir, sanitizeTelegramPendingToken(chatId));
      const messageToken = messageId !== undefined ? String(messageId) : Date.now().toString();
      const messageDir = join(chatDir, sanitizeTelegramPendingToken(messageToken));
      await mkdir(messageDir, { recursive: true });

      const prepared: TelegramPreparedInboundMedia[] = [];

      for (const mediaRef of media) {
        try {
          const downloadedPath = await withTelegramRetry(
            `telegram.downloadFile chat=${chatId} kind=${mediaRef.kind}`,
            () => bot.downloadFile(mediaRef.fileId, messageDir),
          );

          const resolvedPath = resolve(downloadedPath);
          const mimeType = mediaRef.mimeType ?? inferMimeTypeFromPath(resolvedPath);

          const preparedEntry: TelegramPreparedInboundMedia = {
            kind: mediaRef.kind,
            localPath: resolvedPath,
            fileName: mediaRef.fileName ?? basename(resolvedPath),
            mimeType,
            fileSizeBytes: mediaRef.fileSizeBytes,
            durationSeconds: mediaRef.durationSeconds,
          };

          const isImageAttachment = mediaRef.kind === 'photo'
            || Boolean(mimeType && mimeType.startsWith('image/'));

          if (isImageAttachment) {
            const imageMimeType = mimeType ?? 'image/jpeg';
            preparedEntry.imageContent = {
              type: 'image',
              data: readFileSync(resolvedPath).toString('base64'),
              mimeType: imageMimeType,
            };
          }

          prepared.push(preparedEntry);
        } catch (error) {
          console.warn(gatewayWarning(
            `Failed to download telegram ${mediaRef.kind} attachment for chat ${chatId}: ${(error as Error).message}`,
          ));
        }
      }

      return prepared;
    },
    createConversationController: ({ conversationId, sessionFile }) => createPersistentConversationController({
      provider: 'telegram',
      conversationId,
      profile: resolvedProfile,
      agentDir: runtime.agentDir,
      cwd: effectiveConfig.workingDirectory,
      sessionFile,
    }),
  });

  telegramHandlerRef.current = handler;

  bot.on('message', handler.handleMessage);

  bot.on('polling_error', (error: unknown) => {
    console.error(gatewayWarning(`Telegram polling error: ${error instanceof Error ? error.message : String(error)}`));
  });

  const answerTelegramCallbackQuery = async (
    callbackId: string,
    text?: string,
  ): Promise<void> => {
    await withTelegramRetry('telegram.answerCallbackQuery', () => {
      if (!text) {
        return bot.answerCallbackQuery(callbackId);
      }

      return bot.answerCallbackQuery(callbackId, { text });
    });
  };

  const editTelegramCallbackMessage = async (
    query: TelegramCallbackQueryLike,
    text: string,
  ): Promise<void> => {
    const callbackMessage = query?.message;
    if (!callbackMessage || !callbackMessage.chat || typeof callbackMessage.message_id !== 'number') {
      return;
    }

    await editTelegramFormattedMessage(
      editTelegramMessageTextWithRetry,
      callbackMessage.chat.id,
      callbackMessage.message_id,
      text,
    );
  };

  const handleRoomAuthorizationDecision = async (
    callbackId: string,
    query: TelegramCallbackQueryLike,
    decision: TelegramRoomAuthCallback,
  ): Promise<void> => {
    const actingUserId = toTelegramUserIdString(query?.from?.id);

    if (actingUserId && blockedUserIds.has(actingUserId)) {
      await answerTelegramCallbackQuery(callbackId, 'You are blocked from this bot.');
      return;
    }

    if (allowedUserIds.size > 0 && (!actingUserId || !allowedUserIds.has(actingUserId))) {
      await answerTelegramCallbackQuery(callbackId, 'Not authorized.');
      return;
    }

    prunePendingRoomAuthorizationRequests();
    const request = pendingRoomAuthorizationRequests.get(decision.requestToken);
    if (!request) {
      await answerTelegramCallbackQuery(callbackId, 'Request expired or already handled.');
      return;
    }

    const actingUserLabel = formatTelegramUserLabel(query?.from as TelegramUserLike | undefined);

    const summary = await executeRoomAuthorizationDecision({
      request,
      action: decision.action,
      actingUserLabel,
      notifyOwners: true,
    });

    await editTelegramCallbackMessage(query, summary);
    await answerTelegramCallbackQuery(
      callbackId,
      decision.action === 'approve' ? 'Room authorized.' : 'Room denied.',
    );
  };

  bot.on('my_chat_member', (update: TelegramChatMemberUpdateLike) => {
    void (async () => {
      if (!isTelegramBotAddedToChat(update)) {
        return;
      }

      const chat = update.chat;
      if (!chat || typeof chat.id !== 'number' || chat.type === 'private') {
        return;
      }

      const chatId = String(chat.id);
      if (allowlist.has(chatId)) {
        return;
      }

      const inviterUserId = toTelegramUserIdString(update.from?.id);
      const inviterNumericId = update.from?.id !== undefined && Number.isSafeInteger(update.from.id)
        ? Math.floor(update.from.id)
        : undefined;
      const inviterLabel = formatTelegramUserLabel(update.from);
      const chatTitle = chat.title?.trim()
        || (chat.username ? `@${chat.username}` : chatId);
      const chatType = chat.type ?? 'unknown';

      if (inviterUserId && blockedUserIds.has(inviterUserId)) {
        try {
          await withTelegramRetry(`telegram.leaveChat chat=${chat.id}`, () => bot.leaveChat(chat.id));
        } catch (error) {
          console.warn(gatewayWarning(`Failed to leave blocked-inviter chat ${chatId}: ${(error as Error).message}`));
        }

        await sendAuthorizationNotificationToOwners(
          `Blocked user ${inviterLabel} attempted to add the bot to ${chatTitle} (${chatId}). Left room automatically.`,
        );
        return;
      }

      if (inviterUserId && allowedUserIds.has(inviterUserId)) {
        allowlist.add(chatId);
        persistTelegramAccessLists();
        logSystem('telegram', `Auto-authorized room ${chatTitle} (${chatId}) added by allowed user ${inviterLabel}`);
        return;
      }

      if (allowedUserIds.size === 0) {
        console.warn(gatewayWarning(
          `Bot was added to ${chatTitle} (${chatId}) but no allowed Telegram user IDs are configured for approval prompts.`,
        ));

        try {
          await withTelegramRetry(`telegram.leaveChat chat=${chat.id}`, () => bot.leaveChat(chat.id));
        } catch (error) {
          console.warn(gatewayWarning(`Failed to leave unowned chat ${chatId}: ${(error as Error).message}`));
        }

        return;
      }

      const token = createTelegramRoomAuthorizationToken();
      const request: TelegramRoomAuthorizationRequest = {
        token,
        chatId,
        chatNumericId: chat.id,
        chatTitle,
        chatType,
        inviterUserId,
        inviterNumericId,
        inviterLabel,
        createdAtMs: Date.now(),
      };

      pendingRoomAuthorizationRequests.set(token, request);
      prunePendingRoomAuthorizationRequests();

      const deliveredCount = await sendAuthorizationNotificationToOwners(
        buildTelegramRoomAuthorizationPrompt(request),
        buildTelegramRoomAuthorizationOptions(token),
      );

      if (deliveredCount === 0) {
        pendingRoomAuthorizationRequests.delete(token);

        try {
          await withTelegramRetry(`telegram.leaveChat chat=${chat.id}`, () => bot.leaveChat(chat.id));
        } catch (error) {
          console.warn(gatewayWarning(`Failed to leave unauthorized chat ${chatId}: ${(error as Error).message}`));
        }

        return;
      }

      logSystem(
        'telegram',
        `Queued room authorization request for ${chatTitle} (${chatId}) added by ${inviterLabel}`,
      );
    })().catch((error) => {
      console.error(gatewayWarning(`Telegram room authorization flow failed: ${(error as Error).message}`));
    });
  });

  bot.on('callback_query', (query: TelegramCallbackQueryLike) => {
    void (async () => {
      const callbackId = query.id;
      const callbackData = query.data;
      const callbackMessage = query.message;

      if (!callbackData || !callbackMessage) {
        await answerTelegramCallbackQuery(callbackId);
        return;
      }

      const roomDecision = parseTelegramRoomAuthCallback(callbackData);
      if (roomDecision) {
        await handleRoomAuthorizationDecision(callbackId, query, roomDecision);
        return;
      }

      const callbackText = parseTelegramModelSelectionCallback(callbackData)
        ?? parseTelegramForkSelectionCallback(callbackData)
        ?? parseTelegramResumeSelectionCallback(callbackData)
        ?? parseTelegramActionCallback(callbackData);
      if (!callbackText) {
        await answerTelegramCallbackQuery(callbackId);
        return;
      }

      handler.handleMessage({
        chat: {
          id: callbackMessage.chat.id,
          type: callbackMessage.chat.type,
          title: callbackMessage.chat.title,
          username: callbackMessage.chat.username,
        },
        message_id: callbackMessage.message_id,
        message_thread_id: callbackMessage.message_thread_id,
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

      await answerTelegramCallbackQuery(callbackId);
    })().catch((error) => {
      console.error('Telegram callback handling failed:', error);
    });
  });

  const recoveredPendingMessages = handler.replayPendingMessages();
  if (recoveredPendingMessages > 0) {
    console.log(gatewayWarning(`Recovered ${recoveredPendingMessages} pending telegram message(s) from durable inbox.`));
    logSystem('telegram', `Recovered ${recoveredPendingMessages} pending message(s) from durable inbox`);
  }

  let daemonNotificationFlushInFlight = false;

  const triggerDaemonNotificationFlush = (): void => {
    if (daemonNotificationFlushInFlight) {
      return;
    }

    daemonNotificationFlushInFlight = true;
    void flushGatewayNotifications({
      gateway: 'telegram',
      limit: 10,
      deliverNotification: async (notification) => {
        if (!allowlist.has(notification.destinationId)) {
          console.warn(gatewayWarning(
            `Dropping daemon telegram notification for non-allowlisted chat ${notification.destinationId}`,
          ));
          return;
        }

        const chatId = toNumericDestinationId(notification.destinationId);
        if (typeof chatId !== 'number') {
          console.warn(gatewayWarning(
            `Dropping daemon telegram notification with invalid chat id ${notification.destinationId}`,
          ));
          return;
        }

        const chunks = splitTelegramMessage(notification.message || '(empty response)');
        const threadedOptions = applyTelegramThreadToMessageOptions(
          undefined,
          normalizeTelegramMessageThreadId(notification.messageThreadId),
        );

        for (const chunk of chunks) {
          const sent = await sendTelegramFormattedMessage(sendTelegramMessageWithRetry, chatId, chunk, threadedOptions);
          const sentMessageId = toTelegramSentMessageId(sent);
          if (typeof sentMessageId === 'number') {
            trackScheduledReplyContext(chatId, sentMessageId, notification);
          }
        }
      },
    })
      .then((deliveredCount) => {
        if (deliveredCount > 0) {
          logSystem('telegram', `Delivered ${deliveredCount} daemon notification(s)`);
        }
      })
      .catch((error) => {
        console.warn(gatewayWarning(`Failed to flush daemon notifications: ${(error as Error).message}`));
      })
      .finally(() => {
        daemonNotificationFlushInFlight = false;
      });
  };

  triggerDaemonNotificationFlush();
  const daemonNotificationInterval = setInterval(
    triggerDaemonNotificationFlush,
    DAEMON_NOTIFICATION_POLL_INTERVAL_MS,
  );
  daemonNotificationInterval.unref();

  const allowedChatsSummary = [...allowlist].join(', ');
  const allowedUsersSummary = [...allowedUserIds].join(', ');
  const blockedUsersSummary = [...blockedUserIds].join(', ');

  console.log(gatewaySuccess(`Telegram bridge started (profile=${effectiveConfig.profile})`));
  console.log(gatewayKeyValue('Allowed chats', allowedChatsSummary.length > 0 ? allowedChatsSummary : '(none yet)'));
  console.log(gatewayKeyValue('Allowed users', allowedUsersSummary.length > 0 ? allowedUsersSummary : '(none)'));
  console.log(gatewayKeyValue('Blocked users', blockedUsersSummary.length > 0 ? blockedUsersSummary : '(none)'));
  console.log(gatewayKeyValue('Working directory', effectiveConfig.workingDirectory));
  console.log(gatewayKeyValue('Tool activity stream', toolActivityStream ? 'enabled' : 'disabled'));
  console.log(gatewayKeyValue('Clear recent messages on /new', effectiveConfig.clearRecentMessagesOnNew ? 'enabled' : 'disabled'));
  console.log(gatewayKeyValue('Registered commands', telegramCommands.length));
  logSystem('telegram', `Bridge started for profile=${effectiveConfig.profile}`);
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

async function startGateway(_provider: GatewayProvider): Promise<void> {
  await startTelegramBridge();
}

function waitIndefinitely(): Promise<void> {
  return new Promise(() => {
    // Keep process alive in foreground mode until interrupted (Ctrl+C).
  });
}

function gatewaySendUsageText(provider?: GatewayProvider): string {
  if (provider === 'telegram') {
    return 'Usage: pa gateway telegram send <message> [--chat-id <id>]... [--chat-ids <id,id,...>] [--json]';
  }

  return 'Usage: pa gateway send <message> [--chat-id <id>]... [--chat-ids <id,id,...>] [--json]';
}

interface ParsedGatewaySendArgs {
  message: string;
  explicitChatIds: string[];
  jsonMode: boolean;
}

function parseGatewaySendArgs(args: string[], provider?: GatewayProvider): ParsedGatewaySendArgs {
  const usage = gatewaySendUsageText(provider);
  const explicitChatIds: string[] = [];
  const messageParts: string[] = [];
  let jsonMode = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--') {
      messageParts.push(...args.slice(index + 1));
      break;
    }

    if (arg === '--json') {
      jsonMode = true;
      continue;
    }

    if (arg === '--chat-id') {
      const value = args[index + 1];
      if (!value) {
        throw new Error(usage);
      }

      explicitChatIds.push(value);
      index += 1;
      continue;
    }

    if (arg.startsWith('--chat-id=')) {
      const value = arg.slice('--chat-id='.length);
      if (value.trim().length === 0) {
        throw new Error(usage);
      }

      explicitChatIds.push(value);
      continue;
    }

    if (arg === '--chat-ids') {
      const value = args[index + 1];
      if (!value) {
        throw new Error(usage);
      }

      explicitChatIds.push(...parseAllowlist(value));
      index += 1;
      continue;
    }

    if (arg.startsWith('--chat-ids=')) {
      const value = arg.slice('--chat-ids='.length);
      if (value.trim().length === 0) {
        throw new Error(usage);
      }

      explicitChatIds.push(...parseAllowlist(value));
      continue;
    }

    if (arg.startsWith('--')) {
      throw new Error(usage);
    }

    messageParts.push(arg);
  }

  const message = messageParts.join(' ').trim();
  if (message.length === 0) {
    throw new Error(usage);
  }

  return {
    message,
    explicitChatIds,
    jsonMode,
  };
}

function resolveTelegramSendTargets(explicitChatIds: string[]): number[] {
  const stored = readGatewayConfig();
  const storedTelegram = stored.telegram;

  const explicitTargets = new Set<string>();
  for (const explicitChatId of explicitChatIds) {
    const resolved = resolveConfiguredValue(explicitChatId, { fieldName: '--chat-id' });
    if (!resolved) {
      continue;
    }

    for (const entry of parseAllowlist(resolved)) {
      explicitTargets.add(entry);
    }
  }

  const allowlistFromEnv = parseAllowlist(resolveConfiguredValue(
    process.env.PERSONAL_AGENT_TELEGRAM_ALLOWLIST,
    { fieldName: 'PERSONAL_AGENT_TELEGRAM_ALLOWLIST' },
  ));
  const storedAllowlist = resolveConfiguredAllowlistEntries(
    storedTelegram?.allowlist,
    { fieldName: 'gateway.telegram.allowlist' },
  );
  const allowlist = allowlistFromEnv.size > 0
    ? allowlistFromEnv
    : storedAllowlist;

  const allowedUserIdsFromEnv = parseAllowlist(resolveConfiguredValue(
    process.env.PERSONAL_AGENT_TELEGRAM_ALLOWED_USER_IDS,
    { fieldName: 'PERSONAL_AGENT_TELEGRAM_ALLOWED_USER_IDS' },
  ));
  const storedAllowedUserIds = resolveConfiguredAllowlistEntries(
    storedTelegram?.allowedUserIds,
    { fieldName: 'gateway.telegram.allowedUserIds' },
  );
  const allowedUserIds = allowedUserIdsFromEnv.size > 0
    ? allowedUserIdsFromEnv
    : storedAllowedUserIds;

  const targetIds = explicitTargets.size > 0
    ? explicitTargets
    : (allowedUserIds.size > 0 ? allowedUserIds : allowlist);

  if (targetIds.size === 0) {
    throw new Error(
      'No Telegram destination configured. Pass --chat-id <id> or configure PERSONAL_AGENT_TELEGRAM_ALLOWED_USER_IDS. ' +
      'As a fallback, gateway allowlist chat IDs are also used when allowed user IDs are empty.',
    );
  }

  const numericTargetIds = [...targetIds]
    .map((value) => {
      const parsed = toNumericDestinationId(value);
      if (typeof parsed !== 'number') {
        throw new Error(`Invalid Telegram chat id: ${value}`);
      }

      return parsed;
    });

  return [...new Set(numericTargetIds)];
}

function resolveTelegramSendToken(): string {
  const stored = readGatewayConfig();
  const token = resolveConfiguredValue(
    process.env.TELEGRAM_BOT_TOKEN ?? stored.telegram?.token,
    { fieldName: 'TELEGRAM_BOT_TOKEN (or gateway.telegram.token)' },
  );

  if (!token) {
    throw new Error('TELEGRAM_BOT_TOKEN is required. Run `pa gateway setup telegram` or set TELEGRAM_BOT_TOKEN.');
  }

  return token;
}

async function runGatewaySendCommand(provider: GatewayProvider, args: string[]): Promise<number> {
  if (provider !== 'telegram') {
    throw new Error(`Unsupported gateway provider for send: ${provider}`);
  }

  const parsed = parseGatewaySendArgs(args, provider);
  const token = resolveTelegramSendToken();
  const targetChatIds = resolveTelegramSendTargets(parsed.explicitChatIds);
  const chunks = splitTelegramMessage(parsed.message);

  const bot = new TelegramBot(token, { polling: false });
  const failures: Array<{ chatId: number; message: string }> = [];
  const deliveries: Array<{ chatId: number; sentMessageIds: number[] }> = [];

  for (const chatId of targetChatIds) {
    try {
      const sentMessageIds: number[] = [];

      for (const chunk of chunks) {
        const sent = await bot.sendMessage(chatId, chunk);
        const sentMessageId = toTelegramSentMessageId(sent);
        if (typeof sentMessageId === 'number') {
          sentMessageIds.push(sentMessageId);
        }
      }

      deliveries.push({ chatId, sentMessageIds });
    } catch (error) {
      failures.push({
        chatId,
        message: (error as Error).message,
      });
    }
  }

  if (failures.length > 0) {
    const detail = failures.map((failure) => `- chat ${failure.chatId}: ${failure.message}`).join('\n');
    throw new Error(`Failed to send Telegram message to ${failures.length} chat(s):\n${detail}`);
  }

  if (parsed.jsonMode) {
    console.log(JSON.stringify({
      provider,
      message: parsed.message,
      chunkCount: chunks.length,
      targets: deliveries,
    }, null, 2));
    return 0;
  }

  console.log(gatewaySuccess(`Sent Telegram message to ${deliveries.length} chat${deliveries.length === 1 ? '' : 's'}`));
  console.log(gatewayKeyValue('Targets', deliveries.map((delivery) => String(delivery.chatId)).join(', ')));
  console.log(gatewayKeyValue('Chunks', chunks.length));

  return 0;
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

  if (parsed.action === 'send') {
    return runGatewaySendCommand(parsed.provider ?? 'telegram', parsed.sendArgs ?? []);
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
    usage: 'pa gateway [telegram|service|send] [subcommand]',
    description: 'Run messaging gateway commands',
    run: runGatewayCommand,
  });
}

async function startGatewayFromEnv(): Promise<void> {
  const providerValue = process.env.PERSONAL_AGENT_GATEWAY_PROVIDER?.trim().toLowerCase();

  if (providerValue && providerValue !== 'telegram') {
    throw new Error(`Unsupported PERSONAL_AGENT_GATEWAY_PROVIDER: ${providerValue}`);
  }

  await startTelegramBridge();
  await waitIndefinitely();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startGatewayFromEnv().catch((error) => {
    console.error((error as Error).message);
    process.exit(1);
  });
}

import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  statSync,
} from 'node:fs';
import { join } from 'node:path';
import { resolveStatePaths } from '@personal-agent/core';
import {
  getGatewayServiceStatus,
  installGatewayService,
  readGatewayConfig,
  restartGatewayService,
  startGatewayService,
  stopGatewayService,
  uninstallGatewayService,
  writeGatewayConfig,
} from '@personal-agent/gateway';
import {
  buildGatewayStoredConfig,
  readGatewayConfigFilePath,
  summarizeGatewayToken,
  type GatewayConfigUpdateInput,
  type GatewayTokenSource,
} from './gatewayConfig.js';
import { readSessionMetaByFile } from './sessions.js';

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

interface TelegramPendingChatLike {
  id?: number;
}

interface TelegramPendingUserLike {
  id?: number;
  username?: string;
  first_name?: string;
  last_name?: string;
}

interface TelegramPendingDocumentLike {
  file_name?: string;
}

interface TelegramPendingMessageLike {
  chat?: TelegramPendingChatLike;
  message_id?: number;
  message_thread_id?: number;
  text?: string;
  caption?: string;
  document?: TelegramPendingDocumentLike;
  photo?: unknown[];
  voice?: unknown;
  animation?: unknown;
  video?: unknown;
  sticker?: unknown;
  from?: TelegramPendingUserLike;
}

interface StoredTelegramPendingMessage {
  version: 1;
  storedAt: string;
  message: TelegramPendingMessageLike;
}

interface GatewayServiceSummary {
  provider: 'telegram';
  platform: string;
  identifier: string;
  manifestPath: string;
  installed: boolean;
  running: boolean;
  logFile?: string;
  error?: string;
  daemonService?: {
    identifier: string;
    manifestPath: string;
    installed: boolean;
    running: boolean;
    logFile?: string;
  };
}

interface GatewayAccessSummary {
  tokenConfigured: boolean;
  tokenSource: GatewayTokenSource;
  tokenPreview?: string;
  defaultModel?: string;
  allowlistChatIds: string[];
  allowedUserIds: string[];
  blockedUserIds: string[];
  workingDirectory?: string;
  maxPendingPerChat?: number;
  toolActivityStream?: boolean;
  clearRecentMessagesOnNew?: boolean;
}

interface GatewayWorkTopicSummary {
  sourceConversationId: string;
  workConversationId: string;
  topicName: string;
  updatedAt: string;
}

interface GatewayConversationSummary {
  conversationId: string;
  label: string;
  chatId: string;
  messageThreadId?: number;
  sessionFile: string;
  sessionMissing: boolean;
  sessionOverride: boolean;
  title: string;
  messageCount: number;
  model: string;
  cwd: string;
  lastActivityAt: string;
  bindingUpdatedAt?: string;
  workTopic?: GatewayWorkTopicSummary;
  sourceWorkTopic?: GatewayWorkTopicSummary;
}

interface GatewayPendingMessageSummary {
  id: string;
  storedAt: string;
  conversationId: string;
  chatId: string;
  messageThreadId?: number;
  senderLabel?: string;
  preview: string;
  hasMedia: boolean;
}

interface GatewayLogTail {
  path?: string;
  lines: string[];
}

export interface GatewayStateSnapshot {
  provider: 'telegram';
  currentProfile: string;
  configuredProfile: string;
  configFilePath: string;
  envOverrideKeys: string[];
  warnings: string[];
  service: GatewayServiceSummary;
  access: GatewayAccessSummary;
  conversations: GatewayConversationSummary[];
  pendingMessages: GatewayPendingMessageSummary[];
  gatewayLog: GatewayLogTail;
  daemonLog?: GatewayLogTail;
}

function normalizeTelegramMessageThreadId(value: number | undefined): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined;
  }

  const parsed = Math.floor(value);
  return parsed > 0 ? parsed : undefined;
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

function sanitizeTelegramPendingToken(token: string): string {
  return token.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function buildTelegramSessionFileName(chatId: string, messageThreadId: number | undefined): string {
  const chatToken = sanitizeTelegramPendingToken(chatId);
  if (messageThreadId === undefined) {
    return `${chatToken}.jsonl`;
  }

  return `${chatToken}__thread_${messageThreadId}.jsonl`;
}

function parseTelegramConversationFromSessionFileName(sessionFileName: string): {
  conversationId: string;
  label: string;
} | undefined {
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

function loadTelegramConversationBindings(filePath: string): Map<string, TelegramConversationBindingRecord> {
  if (!existsSync(filePath)) {
    return new Map<string, TelegramConversationBindingRecord>();
  }

  try {
    const raw = readFileSync(filePath, 'utf-8').trim();
    if (raw.length === 0) {
      return new Map<string, TelegramConversationBindingRecord>();
    }

    const parsed = JSON.parse(raw) as Partial<StoredTelegramConversationBindings>;
    if (parsed.version !== 1 || !parsed.conversations || typeof parsed.conversations !== 'object') {
      return new Map<string, TelegramConversationBindingRecord>();
    }

    const bindings = new Map<string, TelegramConversationBindingRecord>();
    for (const [conversationId, record] of Object.entries(parsed.conversations)) {
      if (!record || typeof record !== 'object') {
        continue;
      }

      const sessionFile = typeof (record as { sessionFile?: unknown }).sessionFile === 'string'
        ? (record as { sessionFile: string }).sessionFile.trim()
        : '';
      const updatedAt = typeof (record as { updatedAt?: unknown }).updatedAt === 'string'
        ? (record as { updatedAt: string }).updatedAt
        : new Date(0).toISOString();
      const normalizedConversationId = conversationId.trim();

      if (!normalizedConversationId || !sessionFile) {
        continue;
      }

      bindings.set(normalizedConversationId, {
        sessionFile,
        updatedAt,
      });
    }

    return bindings;
  } catch {
    return new Map<string, TelegramConversationBindingRecord>();
  }
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
        createdAt: typeof item.createdAt === 'string' ? item.createdAt : new Date(0).toISOString(),
        updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : new Date(0).toISOString(),
      });
    }

    return bindings;
  } catch {
    return new Map<string, TelegramWorkTopicBinding>();
  }
}

function readTailLines(filePath: string | undefined, maxLines = 60, maxBytes = 64 * 1024): string[] {
  if (!filePath || !existsSync(filePath)) {
    return [];
  }

  let fd: number | undefined;

  try {
    const stats = statSync(filePath);
    const readLength = Math.min(maxBytes, stats.size);
    if (readLength <= 0) {
      return [];
    }

    const buffer = Buffer.alloc(readLength);
    fd = openSync(filePath, 'r');
    readSync(fd, buffer, 0, readLength, stats.size - readLength);

    const text = buffer.toString('utf-8');
    return text
      .split(/\r?\n/)
      .map((line) => line.trimEnd())
      .filter((line) => line.length > 0)
      .slice(-maxLines);
  } catch {
    return [];
  } finally {
    if (fd !== undefined) {
      closeSync(fd);
    }
  }
}

function formatTelegramPendingSenderLabel(sender: TelegramPendingUserLike | undefined): string | undefined {
  if (!sender) {
    return undefined;
  }

  if (typeof sender.username === 'string' && sender.username.trim().length > 0) {
    return `@${sender.username.trim()}`;
  }

  const fullName = [sender.first_name, sender.last_name]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .join(' ')
    .trim();
  if (fullName.length > 0) {
    return fullName;
  }

  if (typeof sender.id === 'number' && Number.isFinite(sender.id)) {
    return String(Math.floor(sender.id));
  }

  return undefined;
}

function buildTelegramPendingPreview(message: TelegramPendingMessageLike): {
  preview: string;
  hasMedia: boolean;
} {
  const text = typeof message.text === 'string' && message.text.trim().length > 0
    ? message.text.trim()
    : undefined;
  if (text) {
    return { preview: text, hasMedia: false };
  }

  const caption = typeof message.caption === 'string' && message.caption.trim().length > 0
    ? message.caption.trim()
    : undefined;
  if (caption) {
    return { preview: caption, hasMedia: true };
  }

  const kinds: string[] = [];
  if (Array.isArray(message.photo) && message.photo.length > 0) kinds.push('photo');
  if (message.document) kinds.push(message.document.file_name ? `document:${message.document.file_name}` : 'document');
  if (message.voice) kinds.push('voice');
  if (message.animation) kinds.push('animation');
  if (message.video) kinds.push('video');
  if (message.sticker) kinds.push('sticker');

  if (kinds.length > 0) {
    return {
      preview: `[${kinds.join(', ')}]`,
      hasMedia: true,
    };
  }

  return {
    preview: '(empty message)',
    hasMedia: false,
  };
}

function loadTelegramPendingMessages(inboxDir: string): GatewayPendingMessageSummary[] {
  if (!existsSync(inboxDir)) {
    return [];
  }

  const fileNames = readdirSync(inboxDir)
    .filter((entry) => entry.endsWith('.json'))
    .sort((left, right) => left.localeCompare(right));

  const loaded: GatewayPendingMessageSummary[] = [];

  for (const fileName of fileNames) {
    try {
      const raw = readFileSync(join(inboxDir, fileName), 'utf-8');
      const parsed = JSON.parse(raw) as Partial<StoredTelegramPendingMessage>;
      if (parsed.version !== 1 || !parsed.message || typeof parsed.message !== 'object') {
        continue;
      }

      const chatId = typeof parsed.message.chat?.id === 'number' && Number.isFinite(parsed.message.chat.id)
        ? String(Math.floor(parsed.message.chat.id))
        : undefined;
      if (!chatId) {
        continue;
      }

      const messageThreadId = normalizeTelegramMessageThreadId(parsed.message.message_thread_id);
      const { preview, hasMedia } = buildTelegramPendingPreview(parsed.message);
      loaded.push({
        id: fileName.slice(0, -'.json'.length),
        storedAt: typeof parsed.storedAt === 'string' ? parsed.storedAt : new Date(0).toISOString(),
        conversationId: buildTelegramConversationId(chatId, messageThreadId),
        chatId,
        messageThreadId,
        senderLabel: formatTelegramPendingSenderLabel(parsed.message.from),
        preview,
        hasMedia,
      });
    } catch {
      continue;
    }
  }

  return loaded.sort((left, right) => left.storedAt.localeCompare(right.storedAt));
}

function buildDefaultTelegramSessionFile(sessionDir: string, conversationId: string): string | undefined {
  const parsed = parseTelegramConversationId(conversationId);
  if (!parsed) {
    return undefined;
  }

  return join(sessionDir, buildTelegramSessionFileName(parsed.chatId, parsed.messageThreadId));
}

function buildConversationLabel(conversationId: string): string {
  const parsed = parseTelegramConversationId(conversationId);
  if (!parsed) {
    return conversationId;
  }

  if (parsed.messageThreadId === undefined) {
    return `chat ${parsed.chatId}`;
  }

  return `chat ${parsed.chatId} • topic ${parsed.messageThreadId}`;
}

function listTelegramSessionFiles(sessionDir: string): Array<{
  sessionFile: string;
  sessionFileName: string;
}> {
  if (!existsSync(sessionDir)) {
    return [];
  }

  const fileNames = readdirSync(sessionDir)
    .filter((entry) => entry.endsWith('.jsonl'))
    .sort((left, right) => left.localeCompare(right));

  return fileNames.map((fileName) => ({
    sessionFile: join(sessionDir, fileName),
    sessionFileName: fileName,
  }));
}

function readGatewayServiceSummary(): GatewayServiceSummary {
  try {
    const status = getGatewayServiceStatus('telegram');
    return {
      provider: 'telegram',
      platform: status.platform,
      identifier: status.identifier,
      manifestPath: status.manifestPath,
      installed: status.installed,
      running: status.running,
      logFile: status.logFile,
      daemonService: status.daemonService
        ? {
          identifier: status.daemonService.identifier,
          manifestPath: status.daemonService.manifestPath,
          installed: status.daemonService.installed,
          running: status.daemonService.running,
          logFile: status.daemonService.logFile,
        }
        : undefined,
    };
  } catch (error) {
    return {
      provider: 'telegram',
      platform: process.platform,
      identifier: 'telegram',
      manifestPath: '',
      installed: false,
      running: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function readGatewayState(currentProfile: string): GatewayStateSnapshot {
  const statePaths = resolveStatePaths();
  const stored = readGatewayConfig();
  const telegram = stored.telegram ?? {};
  const configuredProfile = stored.profile ?? 'shared';
  const service = readGatewayServiceSummary();

  const telegramSessionDir = join(statePaths.session, 'telegram');
  const telegramPendingDir = join(statePaths.root, 'gateway', 'pending', 'telegram');
  const telegramConversationBindingPath = join(statePaths.root, 'gateway', 'state', 'telegram-conversation-bindings.json');
  const telegramWorkTopicBindingPath = join(statePaths.root, 'gateway', 'state', 'telegram-work-topics.json');

  const conversationBindings = loadTelegramConversationBindings(telegramConversationBindingPath);
  const workTopicBindings = loadTelegramWorkTopicBindings(telegramWorkTopicBindingPath);
  const workTopicsByConversationId = new Map<string, TelegramWorkTopicBinding>();
  for (const binding of workTopicBindings.values()) {
    workTopicsByConversationId.set(binding.workConversationId, binding);
  }

  const conversationEntries = new Map<string, {
    sessionFile: string;
    bindingUpdatedAt?: string;
    sessionOverride: boolean;
  }>();

  for (const listing of listTelegramSessionFiles(telegramSessionDir)) {
    const parsed = parseTelegramConversationFromSessionFileName(listing.sessionFileName);
    if (!parsed) {
      continue;
    }

    conversationEntries.set(parsed.conversationId, {
      sessionFile: listing.sessionFile,
      sessionOverride: false,
    });
  }

  for (const [conversationId, binding] of conversationBindings.entries()) {
    const defaultSessionFile = buildDefaultTelegramSessionFile(telegramSessionDir, conversationId);
    conversationEntries.set(conversationId, {
      sessionFile: binding.sessionFile,
      bindingUpdatedAt: binding.updatedAt,
      sessionOverride: defaultSessionFile !== binding.sessionFile,
    });
  }

  for (const binding of workTopicBindings.values()) {
    if (conversationEntries.has(binding.workConversationId)) {
      continue;
    }

    conversationEntries.set(binding.workConversationId, {
      sessionFile: binding.sessionFile,
      bindingUpdatedAt: binding.updatedAt,
      sessionOverride: true,
    });
  }

  const conversations: GatewayConversationSummary[] = [...conversationEntries.entries()]
    .map(([conversationId, entry]) => {
      const parsedConversation = parseTelegramConversationId(conversationId);
      const chatId = parsedConversation?.chatId ?? conversationId;
      const messageThreadId = parsedConversation?.messageThreadId;
      const sessionMissing = !existsSync(entry.sessionFile);
      const sessionMeta = sessionMissing ? null : readSessionMetaByFile(entry.sessionFile);
      const workTopic = workTopicsByConversationId.get(conversationId);
      const sourceWorkTopic = workTopicBindings.get(conversationId);

      let lastActivityAt = entry.bindingUpdatedAt ?? workTopic?.updatedAt ?? sourceWorkTopic?.updatedAt ?? new Date(0).toISOString();
      if (!sessionMissing) {
        try {
          lastActivityAt = new Date(statSync(entry.sessionFile).mtimeMs).toISOString();
        } catch {
          // Keep fallback last-activity timestamp.
        }
      }

      return {
        conversationId,
        label: buildConversationLabel(conversationId),
        chatId,
        messageThreadId,
        sessionFile: entry.sessionFile,
        sessionMissing,
        sessionOverride: entry.sessionOverride,
        title: sessionMeta?.title ?? workTopic?.topicName ?? 'New Conversation',
        messageCount: sessionMeta?.messageCount ?? 0,
        model: sessionMeta?.model ?? 'unknown',
        cwd: sessionMeta?.cwd ?? '',
        lastActivityAt,
        bindingUpdatedAt: entry.bindingUpdatedAt,
        workTopic: workTopic
          ? {
            sourceConversationId: workTopic.sourceConversationId,
            workConversationId: workTopic.workConversationId,
            topicName: workTopic.topicName,
            updatedAt: workTopic.updatedAt,
          }
          : undefined,
        sourceWorkTopic: sourceWorkTopic
          ? {
            sourceConversationId: sourceWorkTopic.sourceConversationId,
            workConversationId: sourceWorkTopic.workConversationId,
            topicName: sourceWorkTopic.topicName,
            updatedAt: sourceWorkTopic.updatedAt,
          }
          : undefined,
      };
    })
    .sort((left, right) => right.lastActivityAt.localeCompare(left.lastActivityAt));

  const pendingMessages = loadTelegramPendingMessages(telegramPendingDir);
  const warnings: string[] = [];
  const configFilePath = readGatewayConfigFilePath();
  const envOverrideKeys: string[] = [];
  const tokenSummary = summarizeGatewayToken(telegram.token);
  const effectiveTokenConfigured = tokenSummary.configured;
  const effectiveProfile = configuredProfile;

  if (!effectiveTokenConfigured) {
    warnings.push('Telegram bot token is not configured. Save it below or run `pa gateway telegram setup`.');
  }

  if (currentProfile !== effectiveProfile) {
    warnings.push(`Web profile is ${currentProfile}, but the gateway will use ${effectiveProfile}.`);
  }

  if (service.error) {
    warnings.push(`Could not inspect gateway service status: ${service.error}`);
  } else if (service.installed && !service.running) {
    warnings.push('Gateway service is installed but not running.');
  } else if (!service.installed) {
    warnings.push('Gateway service is not installed. Install it from this page or run `pa gateway service install telegram`.');
  }

  if (pendingMessages.length > 0) {
    warnings.push(`There ${pendingMessages.length === 1 ? 'is' : 'are'} ${pendingMessages.length} pending inbound Telegram message${pendingMessages.length === 1 ? '' : 's'}.`);
  }

  return {
    provider: 'telegram',
    currentProfile,
    configuredProfile,
    configFilePath,
    envOverrideKeys,
    warnings,
    service,
    access: {
      tokenConfigured: tokenSummary.configured,
      tokenSource: tokenSummary.source,
      tokenPreview: tokenSummary.preview,
      defaultModel: stored.defaultModel,
      allowlistChatIds: telegram.allowlist ?? [],
      allowedUserIds: telegram.allowedUserIds ?? [],
      blockedUserIds: telegram.blockedUserIds ?? [],
      workingDirectory: telegram.workingDirectory,
      maxPendingPerChat: telegram.maxPendingPerChat,
      toolActivityStream: telegram.toolActivityStream,
      clearRecentMessagesOnNew: telegram.clearRecentMessagesOnNew,
    },
    conversations,
    pendingMessages,
    gatewayLog: {
      path: service.logFile,
      lines: readTailLines(service.logFile),
    },
    daemonLog: service.daemonService
      ? {
        path: service.daemonService.logFile,
        lines: readTailLines(service.daemonService.logFile),
      }
      : undefined,
  };
}

export function saveGatewayConfigAndReadState(
  currentProfile: string,
  input: GatewayConfigUpdateInput,
): GatewayStateSnapshot {
  const updated = buildGatewayStoredConfig(readGatewayConfig(), input);
  writeGatewayConfig(updated);
  return readGatewayState(currentProfile);
}

export function installGatewayAndReadState(currentProfile: string): GatewayStateSnapshot {
  installGatewayService('telegram');
  return readGatewayState(currentProfile);
}

export function startGatewayAndReadState(currentProfile: string): GatewayStateSnapshot {
  startGatewayService('telegram');
  return readGatewayState(currentProfile);
}

export function restartGatewayAndReadState(currentProfile: string): GatewayStateSnapshot {
  restartGatewayService('telegram');
  return readGatewayState(currentProfile);
}

export function stopGatewayAndReadState(currentProfile: string): GatewayStateSnapshot {
  stopGatewayService('telegram');
  return readGatewayState(currentProfile);
}

export function uninstallGatewayAndReadState(currentProfile: string): GatewayStateSnapshot {
  uninstallGatewayService('telegram');
  return readGatewayState(currentProfile);
}

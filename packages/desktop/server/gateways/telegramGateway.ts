import {
  attachGatewayConversation,
  findGatewayChatTarget,
  findGatewayChatTargetByConversation,
  hasGatewayBinding,
  recordGatewayEvent,
  upsertGatewayChatTarget,
} from './gatewayState.js';
import { formatTelegramGatewayHelp, parseTelegramGatewayCommand } from './telegramCommands.js';

interface TelegramChat {
  id: number | string;
  first_name?: string;
  last_name?: string;
  username?: string;
  title?: string;
}

interface TelegramPhotoSize {
  file_id: string;
  file_unique_id?: string;
  width?: number;
  height?: number;
  file_size?: number;
}

interface TelegramMessage {
  message_id: number;
  chat: TelegramChat;
  text?: string;
  caption?: string;
  photo?: TelegramPhotoSize[];
}

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

interface TelegramApiResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
}

export interface TelegramGatewayRuntimeDependencies {
  stateRoot: string;
  profile: string;
  authFile: string;
  createConversation: (input: { title: string }) => Promise<{ id: string }>;
  submitPrompt: (input: {
    conversationId: string;
    text: string;
    images?: Array<{ data: string; mimeType: string; name?: string }>;
  }) => Promise<void>;
  renameConversation: (conversationId: string, title: string) => Promise<void> | void;
  compactConversation: (conversationId: string) => Promise<void>;
  archiveConversation: (conversationId: string) => Promise<void>;
  getCurrentModel: (conversationId: string) => Promise<string | null> | string | null;
  setModel: (conversationId: string, model: string) => Promise<void>;
  readBotToken: () => string | null;
  notifyNewConversation?: (conversationId: string) => void;
  fetch?: typeof fetch;
}

const TYPING_INTERVAL_MS = 4_000;

class TypingIndicator {
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly send: () => Promise<void>) {}

  start(): void {
    if (this.timer) return;
    void this.send().catch(() => undefined);
    this.timer = setInterval(() => void this.send().catch(() => undefined), TYPING_INTERVAL_MS);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

export class TelegramGatewayRuntime {
  private abortController: AbortController | null = null;
  private polling = false;
  private nextOffset = 0;
  private typingIndicators = new Map<string, TypingIndicator>();

  constructor(private readonly dependencies: TelegramGatewayRuntimeDependencies) {}

  start(): void {
    if (this.polling) return;
    const token = this.dependencies.readBotToken();
    if (!token) return;
    this.abortController = new AbortController();
    this.polling = true;
    void this.pollLoop(token, this.abortController.signal);
  }

  stop(): void {
    this.polling = false;
    this.abortController?.abort();
    this.abortController = null;
    for (const indicator of this.typingIndicators.values()) indicator.stop();
    this.typingIndicators.clear();
  }

  async processUpdate(update: TelegramUpdate): Promise<void> {
    const message = update.message;
    if (!message) return;

    const externalChatId = String(message.chat.id);
    const externalChatLabel = formatTelegramChatLabel(message.chat);
    const text = (message.text ?? message.caption ?? '').trim();
    const command = parseTelegramGatewayCommand(text);
    const target = await this.ensureChatTarget({ externalChatId, externalChatLabel, forceNew: command?.kind === 'new' });

    if (command) {
      await this.handleCommand(command, { conversationId: target.conversationId, externalChatId, externalChatLabel });
      return;
    }

    if (!text && !message.photo?.length) {
      await this.sendMessage(externalChatId, 'Unsupported Telegram message type. Send text or a photo.');
      return;
    }

    const images = message.photo?.length ? await this.loadTelegramPhotos(message.photo) : undefined;
    this.startTyping(externalChatId);
    await this.dependencies.submitPrompt({
      conversationId: target.conversationId,
      text: text || 'Please review this Telegram photo.',
      images,
    });
  }

  async deliverAssistantReply(input: { conversationId: string; text: string }): Promise<boolean> {
    const text = input.text.trim();
    if (!text) return false;

    const target = findGatewayChatTargetByConversation({
      stateRoot: this.dependencies.stateRoot,
      profile: this.dependencies.profile,
      provider: 'telegram',
      conversationId: input.conversationId,
    });
    if (!target) return false;

    this.stopTyping(target.externalChatId);
    await this.sendMessage(target.externalChatId, text);
    recordGatewayEvent({
      stateRoot: this.dependencies.stateRoot,
      profile: this.dependencies.profile,
      provider: 'telegram',
      conversationId: input.conversationId,
      kind: 'outbound',
      message: `Delivered assistant reply to ${target.externalChatLabel || target.externalChatId}`,
    });
    return true;
  }

  private async ensureChatTarget(input: {
    externalChatId: string;
    externalChatLabel: string;
    forceNew?: boolean;
  }): Promise<{ conversationId: string; conversationTitle: string }> {
    const existing = input.forceNew
      ? null
      : findGatewayChatTarget({
          stateRoot: this.dependencies.stateRoot,
          profile: this.dependencies.profile,
          provider: 'telegram',
          externalChatId: input.externalChatId,
        });
    if (existing && existing.conversationId) {
      return { conversationId: existing.conversationId, conversationTitle: existing.conversationTitle || existing.conversationId };
    }

    const title = `Telegram: ${input.externalChatLabel || input.externalChatId}`;
    const created = await this.dependencies.createConversation({ title });
    void this.dependencies.notifyNewConversation?.(created.id);
    upsertGatewayChatTarget({
      stateRoot: this.dependencies.stateRoot,
      profile: this.dependencies.profile,
      provider: 'telegram',
      externalChatId: input.externalChatId,
      externalChatLabel: input.externalChatLabel,
      conversationId: created.id,
      conversationTitle: title,
    });

    if (!hasGatewayBinding({ stateRoot: this.dependencies.stateRoot, profile: this.dependencies.profile, provider: 'telegram' })) {
      attachGatewayConversation({
        stateRoot: this.dependencies.stateRoot,
        profile: this.dependencies.profile,
        provider: 'telegram',
        conversationId: created.id,
        conversationTitle: title,
        externalChatId: input.externalChatId,
        externalChatLabel: input.externalChatLabel,
      });
    }

    await this.dependencies.renameConversation(created.id, title);
    return { conversationId: created.id, conversationTitle: title };
  }

  private async handleCommand(
    command: NonNullable<ReturnType<typeof parseTelegramGatewayCommand>>,
    target: { conversationId: string; externalChatId: string; externalChatLabel: string },
  ): Promise<void> {
    switch (command.kind) {
      case 'start':
        await this.sendMessage(target.externalChatId, `Connected to ${target.externalChatLabel}. Use /help for commands.`);
        return;
      case 'help':
        await this.sendMessage(target.externalChatId, formatTelegramGatewayHelp());
        return;
      case 'status': {
        const model = await this.dependencies.getCurrentModel(target.conversationId);
        await this.sendMessage(
          target.externalChatId,
          `Telegram gateway active. Conversation: ${target.conversationId}${model ? `\nModel: ${model}` : ''}`,
        );
        return;
      }
      case 'stop':
      case 'detach':
        upsertGatewayChatTarget({
          stateRoot: this.dependencies.stateRoot,
          profile: this.dependencies.profile,
          provider: 'telegram',
          externalChatId: target.externalChatId,
          externalChatLabel: target.externalChatLabel,
          conversationId: target.conversationId,
          repliesEnabled: false,
        });
        await this.sendMessage(target.externalChatId, 'Telegram replies paused for this conversation. Use /resume to re-enable.');
        return;
      case 'resume':
      case 'attach':
        upsertGatewayChatTarget({
          stateRoot: this.dependencies.stateRoot,
          profile: this.dependencies.profile,
          provider: 'telegram',
          externalChatId: target.externalChatId,
          externalChatLabel: target.externalChatLabel,
          conversationId: target.conversationId,
          repliesEnabled: true,
        });
        attachGatewayConversation({
          stateRoot: this.dependencies.stateRoot,
          profile: this.dependencies.profile,
          provider: 'telegram',
          conversationId: target.conversationId,
          externalChatId: target.externalChatId,
          externalChatLabel: target.externalChatLabel,
        });
        await this.sendMessage(target.externalChatId, 'Telegram replies enabled and this chat is attached.');
        return;
      case 'new':
        await this.sendMessage(target.externalChatId, 'Started a new Telegram conversation.');
        return;
      case 'model':
        if (!command.model) {
          const model = await this.dependencies.getCurrentModel(target.conversationId);
          await this.sendMessage(target.externalChatId, model ? `Current model: ${model}` : 'No model selected.');
          return;
        }
        await this.dependencies.setModel(target.conversationId, command.model);
        await this.sendMessage(target.externalChatId, `Model set to ${command.model}.`);
        return;
      case 'compact':
        await this.dependencies.compactConversation(target.conversationId);
        await this.sendMessage(target.externalChatId, 'Compaction requested.');
        return;
      case 'rename':
        await this.dependencies.renameConversation(target.conversationId, command.title);
        await this.sendMessage(target.externalChatId, `Renamed thread to ${command.title}.`);
        return;
      case 'archive':
        await this.dependencies.archiveConversation(target.conversationId);
        await this.sendMessage(target.externalChatId, 'Archived and detached this thread.');
        return;
    }
  }

  private async pollLoop(token: string, signal: AbortSignal): Promise<void> {
    while (this.polling && !signal.aborted) {
      try {
        const updates = await this.telegramRequest<TelegramUpdate[]>(token, 'getUpdates', {
          timeout: 50,
          offset: this.nextOffset || undefined,
          allowed_updates: ['message'],
        });
        for (const update of updates) {
          this.nextOffset = Math.max(this.nextOffset, update.update_id + 1);
          await this.processUpdate(update);
        }
      } catch (error) {
        if (signal.aborted) return;
        await sleep(10_000);
      }
    }
  }

  private async loadTelegramPhotos(
    photos: TelegramPhotoSize[],
  ): Promise<Array<{ data: string; mimeType: string; name?: string }> | undefined> {
    const best = [...photos].sort((left, right) => (right.file_size ?? 0) - (left.file_size ?? 0))[0];
    const token = this.dependencies.readBotToken();
    if (!best || !token) return undefined;
    const file = await this.telegramRequest<{ file_path?: string }>(token, 'getFile', { file_id: best.file_id });
    if (!file.file_path) return undefined;
    const fetchImpl = this.dependencies.fetch ?? fetch;
    const response = await fetchImpl(`https://api.telegram.org/file/bot${token}/${file.file_path}`);
    if (!response.ok) return undefined;
    const bytes = new Uint8Array(await response.arrayBuffer());
    return [{ data: bytesToBase64(bytes), mimeType: response.headers.get('content-type') || 'image/jpeg', name: 'telegram-photo.jpg' }];
  }

  private startTyping(chatId: string): void {
    if (this.typingIndicators.has(chatId)) return;
    const token = this.dependencies.readBotToken();
    if (!token) return;
    const indicator = new TypingIndicator(() => this.telegramRequest(token, 'sendChatAction', { chat_id: chatId, action: 'typing' }));
    this.typingIndicators.set(chatId, indicator);
    indicator.start();
  }

  private stopTyping(chatId: string): void {
    this.typingIndicators.get(chatId)?.stop();
    this.typingIndicators.delete(chatId);
  }

  private async sendMessage(chatId: string, text: string): Promise<void> {
    const token = this.dependencies.readBotToken();
    if (!token) return;
    await this.telegramRequest(token, 'sendMessage', { chat_id: chatId, text });
  }

  private async telegramRequest<T>(token: string, method: string, body: unknown): Promise<T> {
    const fetchImpl = this.dependencies.fetch ?? fetch;
    const response = await fetchImpl(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: this.abortController?.signal,
    });
    const payload = (await response.json()) as TelegramApiResponse<T>;
    if (!response.ok || !payload.ok) {
      throw new Error(payload.description || `Telegram ${method} failed`);
    }
    return payload.result as T;
  }
}

function formatTelegramChatLabel(chat: TelegramChat): string {
  if (chat.title?.trim()) return chat.title.trim();
  const name = [chat.first_name, chat.last_name]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(' ');
  return name || chat.username || String(chat.id);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function bytesToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

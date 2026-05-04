import { callMcpTool } from '@personal-agent/core';

import {
  attachGatewayConversation,
  detachGatewayConversation,
  findGatewayChatTarget,
  findGatewayChatTargetByConversation,
  readGatewayState,
  recordGatewayEvent,
  updateGatewayConnectionStatus,
  upsertGatewayChatTarget,
} from './gatewayState.js';
import { formatSlackMcpGatewayHelp, parseSlackMcpGatewayCommand } from './slackMcpCommands.js';

interface SlackMcpMessage {
  ts: string;
  text: string;
  user?: string;
  username?: string;
  bot_id?: string;
  subtype?: string;
}

export interface SlackMcpChannelSummary {
  id: string;
  name: string;
  isPrivate?: boolean;
}

export interface SlackMcpGatewayRuntimeDependencies {
  stateRoot: string;
  profile: string;
  mcpServer?: string;
  createConversation: (input: { title: string }) => Promise<{ id: string }>;
  submitPrompt: (input: {
    conversationId: string;
    text: string;
    behavior?: 'followUp';
  }) => Promise<{ delivery?: 'started' | 'queued' } | void>;
  abortConversation: (conversationId: string) => Promise<void>;
  compactConversation: (conversationId: string) => Promise<void>;
  renameConversation: (conversationId: string, title: string) => Promise<void> | void;
  getCurrentModel: (conversationId: string) => Promise<string | null> | string | null;
  setModel: (conversationId: string, model: string) => Promise<void>;
  isConversationBusy: (conversationId: string) => boolean;
  callSlackTool?: (tool: string, args: Record<string, unknown>) => Promise<unknown>;
}

const DISCLOSURE_SUFFIX = '— Patrick’s agent';
const DEFAULT_POLL_MS = 15_000;
const SLOW_RETRY_MS = 60_000;

export class SlackMcpGatewayRuntime {
  private timer: NodeJS.Timeout | null = null;
  private polling = false;
  private sentMessageTs = new Set<string>();
  private selfUserIds = new Set<string>();
  private pendingFollowUp = new Map<string, string[]>();
  private displayNameCache = new Map<string, string>();

  constructor(private readonly dependencies: SlackMcpGatewayRuntimeDependencies) {}

  start(): void {
    if (this.polling) return;
    this.polling = true;
    void this.pollOnceAndSchedule(0);
  }

  stop(): void {
    this.polling = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  async searchChannels(query: string): Promise<SlackMcpChannelSummary[]> {
    const result = await this.callSlackTool('slack_search_channels', { query, limit: 10, response_format: 'detailed' });
    return extractSlackChannels(result).slice(0, 10);
  }

  async attachChannel(input: { channelId: string; channelLabel?: string }): Promise<{ conversationId: string; title: string }> {
    const externalChatId = input.channelId.trim();
    if (!externalChatId) throw new Error('Slack channel id required');
    const title = `Slack: ${input.channelLabel || externalChatId}`;
    const created = await this.dependencies.createConversation({ title });
    await this.dependencies.renameConversation(created.id, title);

    upsertGatewayChatTarget({
      stateRoot: this.dependencies.stateRoot,
      profile: this.dependencies.profile,
      provider: 'slack_mcp',
      externalChatId,
      externalChatLabel: input.channelLabel,
      conversationId: created.id,
      conversationTitle: title,
      lastExternalMessageId: String(Date.now() / 1000),
      repliesEnabled: true,
    });
    attachGatewayConversation({
      stateRoot: this.dependencies.stateRoot,
      profile: this.dependencies.profile,
      provider: 'slack_mcp',
      conversationId: created.id,
      conversationTitle: title,
      externalChatId,
      externalChatLabel: input.channelLabel,
    });
    updateGatewayConnectionStatus({
      stateRoot: this.dependencies.stateRoot,
      profile: this.dependencies.profile,
      provider: 'slack_mcp',
      status: 'active',
      enabled: true,
    });
    recordGatewayEvent({
      stateRoot: this.dependencies.stateRoot,
      profile: this.dependencies.profile,
      provider: 'slack_mcp',
      conversationId: created.id,
      kind: 'routing',
      message: `Slack MCP attached to ${input.channelLabel || externalChatId}`,
    });
    this.start();
    return { conversationId: created.id, title };
  }

  async handleTurnEnd(conversationId: string, assistantText: string | null): Promise<boolean> {
    let delivered = false;
    if (assistantText?.trim()) {
      delivered = await this.deliverAssistantReply({ conversationId, text: assistantText });
    }
    await this.flushPendingFollowUp(conversationId);
    return delivered;
  }

  async deliverAssistantReply(input: { conversationId: string; text: string }): Promise<boolean> {
    const text = input.text.trim();
    if (!text) return false;
    const target = findGatewayChatTargetByConversation({
      stateRoot: this.dependencies.stateRoot,
      profile: this.dependencies.profile,
      provider: 'slack_mcp',
      conversationId: input.conversationId,
    });
    if (!target) return false;

    try {
      const result = await this.callSlackTool('slack_send_message', {
        channel_id: target.externalChatId,
        message: `${text}\n\n${DISCLOSURE_SUFFIX}`,
      });
      const sentTs = extractSlackMessageTs(result);
      if (sentTs) this.sentMessageTs.add(sentTs);
      recordGatewayEvent({
        stateRoot: this.dependencies.stateRoot,
        profile: this.dependencies.profile,
        provider: 'slack_mcp',
        conversationId: input.conversationId,
        kind: 'outbound',
        message: `Delivered assistant reply to ${target.externalChatLabel || target.externalChatId}`,
      });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      updateGatewayConnectionStatus({
        stateRoot: this.dependencies.stateRoot,
        profile: this.dependencies.profile,
        provider: 'slack_mcp',
        status: 'needs_attention',
        enabled: true,
        statusMessage: `Slack send failed: ${message}`,
      });
      recordGatewayEvent({
        stateRoot: this.dependencies.stateRoot,
        profile: this.dependencies.profile,
        provider: 'slack_mcp',
        conversationId: input.conversationId,
        kind: 'error',
        message: `Slack delivery failed: ${message}`,
      });
      return false;
    }
  }

  private async pollOnceAndSchedule(delayMs = DEFAULT_POLL_MS): Promise<void> {
    if (!this.polling) return;
    if (delayMs > 0) {
      this.timer = setTimeout(() => void this.pollOnceAndSchedule(0), delayMs);
      return;
    }

    let nextDelay = DEFAULT_POLL_MS;
    try {
      await this.pollAttachedChannel();
    } catch (error) {
      nextDelay = SLOW_RETRY_MS;
      const message = error instanceof Error ? error.message : String(error);
      updateGatewayConnectionStatus({
        stateRoot: this.dependencies.stateRoot,
        profile: this.dependencies.profile,
        provider: 'slack_mcp',
        status: 'needs_attention',
        enabled: true,
        statusMessage: `Slack poll failed: ${message}`,
      });
    } finally {
      if (this.polling) {
        this.timer = setTimeout(() => void this.pollOnceAndSchedule(0), nextDelay);
      }
    }
  }

  private async pollAttachedChannel(): Promise<void> {
    const state = readGatewayState({
      stateRoot: this.dependencies.stateRoot,
      profile: this.dependencies.profile,
    });
    const connection = state.connections.find((candidate) => candidate.provider === 'slack_mcp' && candidate.enabled);
    if (!connection) return;
    const binding = state.bindings.find((candidate) => candidate.provider === 'slack_mcp' && candidate.connectionId === connection.id);
    if (!binding?.externalChatId) return;
    const target = findGatewayChatTarget({
      stateRoot: this.dependencies.stateRoot,
      profile: this.dependencies.profile,
      provider: 'slack_mcp',
      externalChatId: binding.externalChatId,
    });
    if (!target) return;

    const result = await this.callSlackTool('slack_read_channel', {
      channel_id: binding.externalChatId,
      limit: 25,
      response_format: 'detailed',
    });
    const messages = extractSlackMessages(result)
      .filter((message) => !target.lastExternalMessageId || message.ts > target.lastExternalMessageId)
      .filter((message) => !this.isSelfMessage(message))
      .sort((left, right) => left.ts.localeCompare(right.ts));
    if (messages.length === 0) return;

    let latestTs = target.updatedAt;
    const lines: string[] = [];
    for (const message of messages) {
      latestTs = latestTs.localeCompare(message.ts) > 0 ? latestTs : message.ts;
      const author = await this.resolveDisplayName(message.user || message.username || 'unknown');
      lines.push(`[${formatSlackTs(message.ts)}] ${author}: ${message.text.trim()}`);
    }

    upsertGatewayChatTarget({
      stateRoot: this.dependencies.stateRoot,
      profile: this.dependencies.profile,
      provider: 'slack_mcp',
      externalChatId: binding.externalChatId,
      externalChatLabel: binding.externalChatLabel,
      conversationId: target.conversationId,
      conversationTitle: target.conversationTitle,
      lastExternalMessageId: latestTs,
      repliesEnabled: target.repliesEnabled,
    });
    await this.submitInboundBatch({
      conversationId: target.conversationId,
      channelLabel: binding.externalChatLabel || binding.externalChatId,
      lines,
      latestTs,
    });
  }

  private async submitInboundBatch(input: {
    conversationId: string;
    channelLabel: string;
    lines: string[];
    latestTs: string;
  }): Promise<void> {
    const text = [`Slack channel ${input.channelLabel} sent:`, ...input.lines].join('\n');
    const command = input.lines.length === 1 ? parseSlackMcpGatewayCommand(input.lines[0]!.replace(/^\[[^\]]+\]\s+[^:]+:\s*/, '')) : null;
    if (command) {
      await this.handleCommand(command, input.conversationId);
      return;
    }

    recordGatewayEvent({
      stateRoot: this.dependencies.stateRoot,
      profile: this.dependencies.profile,
      provider: 'slack_mcp',
      conversationId: input.conversationId,
      kind: 'inbound',
      message: `Received ${input.lines.length} Slack message${input.lines.length === 1 ? '' : 's'}`,
    });

    if (this.dependencies.isConversationBusy(input.conversationId)) {
      this.pendingFollowUp.set(input.conversationId, [...(this.pendingFollowUp.get(input.conversationId) ?? []), text]);
      return;
    }

    const result = await this.dependencies.submitPrompt({ conversationId: input.conversationId, text });
    if (result && result.delivery === 'queued') {
      this.pendingFollowUp.set(input.conversationId, [...(this.pendingFollowUp.get(input.conversationId) ?? []), text]);
    }
  }

  private async flushPendingFollowUp(conversationId: string): Promise<void> {
    const pending = this.pendingFollowUp.get(conversationId);
    if (!pending?.length || this.dependencies.isConversationBusy(conversationId)) return;
    this.pendingFollowUp.delete(conversationId);
    await this.dependencies.submitPrompt({ conversationId, text: pending.join('\n\n'), behavior: 'followUp' });
  }

  private async handleCommand(command: NonNullable<ReturnType<typeof parseSlackMcpGatewayCommand>>, conversationId: string): Promise<void> {
    const target = findGatewayChatTargetByConversation({
      stateRoot: this.dependencies.stateRoot,
      profile: this.dependencies.profile,
      provider: 'slack_mcp',
      conversationId,
    });
    const channelId = target?.externalChatId;
    if (!channelId) return;

    switch (command.kind) {
      case 'help':
        await this.sendSystemMessage(channelId, formatSlackMcpGatewayHelp());
        return;
      case 'status': {
        const model = await this.dependencies.getCurrentModel(conversationId);
        await this.sendSystemMessage(
          channelId,
          `Slack MCP gateway active. Conversation: ${conversationId}${model ? `\nModel: ${model}` : ''}`,
        );
        return;
      }
      case 'stop':
        await this.dependencies.abortConversation(conversationId);
        this.pendingFollowUp.delete(conversationId);
        await this.sendSystemMessage(channelId, 'Stopped the current agent turn.');
        return;
      case 'new': {
        const created = await this.attachChannel({ channelId, channelLabel: target.externalChatLabel });
        await this.sendSystemMessage(channelId, `Started a fresh conversation: ${created.title}.`);
        return;
      }
      case 'model':
        if (!command.model) {
          const model = await this.dependencies.getCurrentModel(conversationId);
          await this.sendSystemMessage(channelId, model ? `Current model: ${model}` : 'No model selected.');
          return;
        }
        await this.dependencies.setModel(conversationId, command.model);
        await this.sendSystemMessage(channelId, `Model set to ${command.model}.`);
        return;
      case 'compact':
        await this.dependencies.compactConversation(conversationId);
        await this.sendSystemMessage(channelId, 'Compaction requested.');
        return;
      case 'detach':
        detachGatewayConversation({
          stateRoot: this.dependencies.stateRoot,
          profile: this.dependencies.profile,
          provider: 'slack_mcp',
          conversationId,
        });
        await this.sendSystemMessage(channelId, 'Detached Slack MCP gateway from this conversation.');
        return;
    }
  }

  private async sendSystemMessage(channelId: string, text: string): Promise<void> {
    const result = await this.callSlackTool('slack_send_message', { channel_id: channelId, message: `${text}\n\n${DISCLOSURE_SUFFIX}` });
    const sentTs = extractSlackMessageTs(result);
    if (sentTs) this.sentMessageTs.add(sentTs);
  }

  private async resolveDisplayName(userId: string): Promise<string> {
    if (!userId || userId === 'unknown') return 'Unknown';
    const cached = this.displayNameCache.get(userId);
    if (cached) return cached;
    try {
      const result = await this.callSlackTool('slack_read_user_profile', { user_id: userId, response_format: 'detailed' });
      const name = extractDisplayName(result) || userId;
      this.displayNameCache.set(userId, name);
      return name;
    } catch {
      return userId;
    }
  }

  private isSelfMessage(message: SlackMcpMessage): boolean {
    if (message.ts && this.sentMessageTs.has(message.ts)) return true;
    if (message.user && this.selfUserIds.has(message.user)) return true;
    if (message.text.includes(DISCLOSURE_SUFFIX)) return true;
    return false;
  }

  private async callSlackTool(tool: string, args: Record<string, unknown>): Promise<unknown> {
    if (this.dependencies.callSlackTool) return this.dependencies.callSlackTool(tool, args);
    const result = await callMcpTool(this.dependencies.mcpServer ?? 'slack', tool, args, { timeoutMs: 30_000 });
    if (!result.data) {
      throw new Error(result.error ?? result.stderr ?? `Slack MCP ${tool} failed`);
    }
    return result.data.parsed;
  }
}

function extractSlackMessages(value: unknown): SlackMcpMessage[] {
  const root = unwrapMcpResult(value);
  const candidates = findArrays(root)
    .flatMap((array) => array)
    .filter(isSlackMessage);
  const unique = new Map<string, SlackMcpMessage>();
  for (const message of candidates) unique.set(message.ts, message);
  return [...unique.values()];
}

function extractSlackChannels(value: unknown): SlackMcpChannelSummary[] {
  const root = unwrapMcpResult(value);
  return findArrays(root)
    .flatMap((array) => array)
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const record = item as Record<string, unknown>;
      const id = stringValue(record.id) || stringValue(record.channel_id) || stringValue(record.channelId);
      const name = stringValue(record.name) || stringValue(record.channel_name) || stringValue(record.label) || id;
      if (!id || !name) return null;
      return { id, name, isPrivate: Boolean(record.is_private ?? record.isPrivate) };
    })
    .filter((item): item is SlackMcpChannelSummary => item !== null);
}

function extractSlackMessageTs(value: unknown): string | null {
  const root = unwrapMcpResult(value);
  if (root && typeof root === 'object') {
    const record = root as Record<string, unknown>;
    return (
      stringValue(record.ts) ||
      (record.message && typeof record.message === 'object' ? stringValue((record.message as Record<string, unknown>).ts) : null)
    );
  }
  return null;
}

function extractDisplayName(value: unknown): string | null {
  const root = unwrapMcpResult(value);
  if (root && typeof root === 'object') {
    const record = root as Record<string, unknown>;
    const profile = record.profile && typeof record.profile === 'object' ? (record.profile as Record<string, unknown>) : record;
    return stringValue(profile.display_name) || stringValue(profile.real_name) || stringValue(profile.name);
  }
  return null;
}

function unwrapMcpResult(value: unknown): unknown {
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (Array.isArray(record.content)) {
      const text = record.content
        .map((item) => (item && typeof item === 'object' ? stringValue((item as Record<string, unknown>).text) : null))
        .filter(Boolean)
        .join('\n');
      if (text) {
        try {
          return JSON.parse(text);
        } catch {
          return { text };
        }
      }
    }
    if (record.structuredContent) return record.structuredContent;
  }
  return value;
}

function findArrays(value: unknown): unknown[][] {
  if (Array.isArray(value)) return [value];
  if (!value || typeof value !== 'object') return [];
  const arrays: unknown[][] = [];
  for (const child of Object.values(value as Record<string, unknown>)) {
    if (Array.isArray(child)) arrays.push(child);
    else arrays.push(...findArrays(child));
  }
  return arrays;
}

function isSlackMessage(value: unknown): value is SlackMcpMessage {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return typeof record.ts === 'string' && typeof record.text === 'string';
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function formatSlackTs(ts: string): string {
  const seconds = Number(ts.split('.')[0]);
  if (!Number.isFinite(seconds)) return ts;
  return new Date(seconds * 1000).toISOString();
}

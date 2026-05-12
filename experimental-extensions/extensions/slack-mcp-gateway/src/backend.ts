import { authenticateMcpServerDirect, clearMcpServerAuthDirect, getStateRoot, hasStoredMcpServerTokens } from '@personal-agent/core';

import {
  abortLiveSessionCapability,
  compactLiveSessionCapability,
  createLiveSessionCapability,
  submitLiveSessionPromptCapability,
} from '../../../../packages/desktop/server/conversations/liveSessionCapability.js';
import { registerLiveSessionLifecycleHandler } from '../../../../packages/desktop/server/conversations/liveSessionLifecycle.js';
import {
  getAvailableModelObjects,
  getLiveSessions,
  renameSession,
  updateLiveSessionModelPreferences,
} from '../../../../packages/desktop/server/conversations/liveSessions.js';
import { readSessionBlocks } from '../../../../packages/desktop/server/conversations/sessions.js';
import type { ExtensionBackendContext } from '../../../../packages/desktop/server/extensions/extensionBackend.js';
import {
  ensureGatewayConnection,
  readGatewayState,
  updateGatewayConnectionStatus,
} from '../../../../packages/desktop/server/gateways/gatewayState.js';
import { SLACK_MCP_SERVER_CONFIG, SlackMcpGatewayRuntime } from '../../../../packages/desktop/server/gateways/slackMcpGateway.js';
import { invalidateAppTopics, publishAppEvent } from '../../../../packages/desktop/server/shared/appEvents.js';

let runtime: SlackMcpGatewayRuntime | null = null;
let lifecycleRegistered = false;
const lastDeliveryByConversation = new Map<string, string>();

function gatewayContext(ctx: ExtensionBackendContext): { stateRoot: string; profile: string } {
  return { stateRoot: getStateRoot(), profile: ctx.profile };
}

function liveSessionContext(ctx: ExtensionBackendContext) {
  return {
    getCurrentProfile: () => ctx.profile,
    getRepoRoot: ctx.runtime.getRepoRoot,
    getDefaultWebCwd: () => process.cwd(),
    buildLiveSessionResourceOptions: () => ctx.runtime.getLiveSessionResourceOptions(),
    buildLiveSessionExtensionFactories: () => [],
    flushLiveDeferredResumes: async () => {},
    listTasksForCurrentProfile: () => [],
    listMemoryDocs: () => [],
  };
}

function readLatestAssistantText(conversationId: string): string | null {
  const detail = readSessionBlocks(conversationId, { tailBlocks: 20 });
  const block = [...(detail?.blocks ?? [])].reverse().find((candidate) => candidate.type === 'text');
  return block && block.type === 'text' && block.text.trim() ? block.text.trim() : null;
}

function ensureRuntime(ctx: ExtensionBackendContext): SlackMcpGatewayRuntime {
  if (runtime) return runtime;
  runtime = new SlackMcpGatewayRuntime({
    ...gatewayContext(ctx),
    createConversation: async (input) => {
      const created = await createLiveSessionCapability({}, liveSessionContext(ctx));
      renameSession(created.id, input.title);
      return { id: created.id };
    },
    notifyNewConversation: (conversationId) => publishAppEvent({ type: 'open_session', sessionId: conversationId }),
    submitPrompt: async (input) =>
      submitLiveSessionPromptCapability(
        { conversationId: input.conversationId, text: input.text, ...(input.behavior ? { behavior: input.behavior } : {}) },
        liveSessionContext(ctx),
      ),
    abortConversation: async (conversationId) => {
      await abortLiveSessionCapability({ conversationId });
    },
    compactConversation: async (conversationId) => {
      await compactLiveSessionCapability({ conversationId });
    },
    renameConversation: (conversationId, title) => renameSession(conversationId, title),
    getCurrentModel: () => null,
    setModel: async (conversationId, model) => {
      await updateLiveSessionModelPreferences(conversationId, { model }, getAvailableModelObjects());
    },
    isConversationBusy: (conversationId) => getLiveSessions().some((session) => session.id === conversationId && session.isStreaming),
  });
  return runtime;
}

function registerLifecycle(ctx: ExtensionBackendContext): void {
  if (lifecycleRegistered) return;
  lifecycleRegistered = true;
  registerLiveSessionLifecycleHandler(async (event) => {
    if (event.trigger !== 'turn_end') return;
    const text = readLatestAssistantText(event.conversationId);
    const slackText = text && lastDeliveryByConversation.get(event.conversationId) !== text ? text : null;
    const delivered = await ensureRuntime(ctx).handleTurnEnd(event.conversationId, slackText);
    if (delivered && text) lastDeliveryByConversation.set(event.conversationId, text);
  });
}

export async function start(_input: unknown, ctx: ExtensionBackendContext) {
  registerLifecycle(ctx);
  const connection = readGatewayState(gatewayContext(ctx)).connections.find((candidate) => candidate.provider === 'slack_mcp');
  if (connection?.enabled) ensureRuntime(ctx).start();
  return { ok: true };
}

export async function stop(_input: unknown, ctx: ExtensionBackendContext) {
  ensureRuntime(ctx).stop();
  return { ok: true };
}

export async function state(_input: unknown, ctx: ExtensionBackendContext) {
  return readGatewayState(gatewayContext(ctx));
}

export async function authState() {
  return { authenticated: hasStoredMcpServerTokens(SLACK_MCP_SERVER_CONFIG) };
}

export async function connect(_input: unknown, ctx: ExtensionBackendContext) {
  const result = await authenticateMcpServerDirect(SLACK_MCP_SERVER_CONFIG, { timeoutMs: 120_000 });
  if (result.error) throw new Error(result.error);
  ensureGatewayConnection({ ...gatewayContext(ctx), provider: 'slack_mcp' });
  const nextState = updateGatewayConnectionStatus({ ...gatewayContext(ctx), provider: 'slack_mcp', status: 'connected', enabled: true });
  ensureRuntime(ctx).start();
  return { authenticated: true, state: nextState };
}

export async function disconnect(_input: unknown, ctx: ExtensionBackendContext) {
  await clearMcpServerAuthDirect(SLACK_MCP_SERVER_CONFIG);
  ensureRuntime(ctx).stop();
  const nextState = updateGatewayConnectionStatus({
    ...gatewayContext(ctx),
    provider: 'slack_mcp',
    status: 'needs_config',
    enabled: false,
    statusMessage: 'Slack disconnected',
  });
  return { authenticated: false, state: nextState };
}

function readString(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} required`);
  return value.trim();
}

export async function saveChannel(input: unknown, ctx: ExtensionBackendContext) {
  const record = (input ?? {}) as Record<string, unknown>;
  ensureGatewayConnection({ ...gatewayContext(ctx), provider: 'slack_mcp' });
  ensureRuntime(ctx).saveChannel({
    channelId: readString(record.channelId, 'channelId'),
    channelLabel: typeof record.channelLabel === 'string' ? record.channelLabel : undefined,
  });
  return readGatewayState(gatewayContext(ctx));
}

export async function attach(input: unknown, ctx: ExtensionBackendContext) {
  const record = (input ?? {}) as Record<string, unknown>;
  await ensureRuntime(ctx).attachChannelToConversation({
    conversationId: readString(record.conversationId, 'conversationId'),
    conversationTitle:
      typeof record.conversationTitle === 'string' && record.conversationTitle.trim()
        ? record.conversationTitle.trim()
        : readString(record.conversationId, 'conversationId'),
    externalChatId: readString(record.externalChatId, 'externalChatId'),
    externalChatLabel: typeof record.externalChatLabel === 'string' ? record.externalChatLabel : undefined,
  });
  invalidateAppTopics('sessions');
  return readGatewayState(gatewayContext(ctx));
}

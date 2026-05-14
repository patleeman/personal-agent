import { getStateRoot } from '@personal-agent/core';

interface ExtensionBackendContext {
  profile: string;
  runtime: {
    getRepoRoot: () => string;
    getLiveSessionResourceOptions: () => Record<string, unknown>;
  };
}

interface SlackGatewayRuntime {
  start(): void;
  stop(): void;
  saveChannel(input: { channelId: string; channelLabel?: string }): void;
  attachChannelToConversation(input: {
    conversationId: string;
    conversationTitle: string;
    externalChatId: string;
    externalChatLabel?: string;
  }): Promise<void>;
  handleTurnEnd(conversationId: string, text: string | null): Promise<boolean>;
}

const dynamicImport = new Function('specifier', 'return import(specifier)') as <T>(specifier: string) => Promise<T>;

let runtime: SlackGatewayRuntime | null = null;
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

async function readLatestAssistantText(conversationId: string): Promise<string | null> {
  const module = await dynamicImport<typeof import('../../conversations/sessions.js')>('../../conversations/sessions.js');
  const detail = module.readSessionBlocks(conversationId, { tailBlocks: 20 });
  const block = [...(detail?.blocks ?? [])].reverse().find((candidate) => candidate.type === 'text');
  return block && block.type === 'text' && block.text.trim() ? block.text.trim() : null;
}

async function ensureRuntime(ctx: ExtensionBackendContext): Promise<SlackGatewayRuntime> {
  if (runtime) return runtime;
  const [capabilities, liveSessions, appEvents, gateway] = await Promise.all([
    dynamicImport<typeof import('../../conversations/liveSessionCapability.js')>('../../conversations/liveSessionCapability.js'),
    dynamicImport<typeof import('../../conversations/liveSessions.js')>('../../conversations/liveSessions.js'),
    dynamicImport<typeof import('../../shared/appEvents.js')>('../../shared/appEvents.js'),
    dynamicImport<typeof import('../../gateways/slackMcpGateway.js')>('../../gateways/slackMcpGateway.js'),
  ]);
  runtime = new gateway.SlackMcpGatewayRuntime({
    ...gatewayContext(ctx),
    createConversation: async (input) => {
      const created = await capabilities.createLiveSessionCapability({}, liveSessionContext(ctx));
      liveSessions.renameSession(created.id, input.title);
      return { id: created.id };
    },
    notifyNewConversation: (conversationId) => appEvents.publishAppEvent({ type: 'open_session', sessionId: conversationId }),
    submitPrompt: async (input) =>
      capabilities.submitLiveSessionPromptCapability(
        { conversationId: input.conversationId, text: input.text, ...(input.behavior ? { behavior: input.behavior } : {}) },
        liveSessionContext(ctx),
      ),
    abortConversation: async (conversationId) => {
      await capabilities.abortLiveSessionCapability({ conversationId });
    },
    compactConversation: async (conversationId) => {
      await capabilities.compactLiveSessionCapability({ conversationId });
    },
    renameConversation: (conversationId, title) => liveSessions.renameSession(conversationId, title),
    getCurrentModel: () => null,
    setModel: async (conversationId, model) => {
      await liveSessions.updateLiveSessionModelPreferences(conversationId, { model }, liveSessions.getAvailableModelObjects());
    },
    isConversationBusy: (conversationId) =>
      liveSessions.getLiveSessions().some((session) => session.id === conversationId && session.isStreaming),
  });
  return runtime;
}

async function registerLifecycle(ctx: ExtensionBackendContext): Promise<void> {
  if (lifecycleRegistered) return;
  lifecycleRegistered = true;
  const module = await dynamicImport<typeof import('../../conversations/liveSessionLifecycle.js')>(
    '../../conversations/liveSessionLifecycle.js',
  );
  module.registerLiveSessionLifecycleHandler(async (event) => {
    if (event.trigger !== 'turn_end') return;
    const text = await readLatestAssistantText(event.conversationId);
    const slackText = text && lastDeliveryByConversation.get(event.conversationId) !== text ? text : null;
    const delivered = await (await ensureRuntime(ctx)).handleTurnEnd(event.conversationId, slackText);
    if (delivered && text) lastDeliveryByConversation.set(event.conversationId, text);
  });
}

async function gatewayStateModule() {
  return dynamicImport<typeof import('../../gateways/gatewayState.js')>('../../gateways/gatewayState.js');
}

async function slackConfig() {
  return (await dynamicImport<typeof import('../../gateways/slackMcpGateway.js')>('../../gateways/slackMcpGateway.js'))
    .SLACK_MCP_SERVER_CONFIG;
}

export async function startSlackMcpGateway(ctx: ExtensionBackendContext) {
  await registerLifecycle(ctx);
  const gatewayState = await gatewayStateModule();
  const connection = gatewayState.readGatewayState(gatewayContext(ctx)).connections.find((candidate) => candidate.provider === 'slack_mcp');
  if (connection?.enabled) (await ensureRuntime(ctx)).start();
  return { ok: true };
}

export async function stopSlackMcpGateway(ctx: ExtensionBackendContext) {
  (await ensureRuntime(ctx)).stop();
  return { ok: true };
}

export async function readSlackMcpGatewayState(ctx: ExtensionBackendContext) {
  return (await gatewayStateModule()).readGatewayState(gatewayContext(ctx));
}

export async function readSlackMcpGatewayAuthState() {
  const core = await dynamicImport<typeof import('@personal-agent/core')>('@personal-agent/core');
  return { authenticated: core.hasStoredMcpServerTokens(await slackConfig()) };
}

export async function connectSlackMcpGateway(ctx: ExtensionBackendContext) {
  const [core, gatewayState, config] = await Promise.all([
    dynamicImport<typeof import('@personal-agent/core')>('@personal-agent/core'),
    gatewayStateModule(),
    slackConfig(),
  ]);
  const result = await core.authenticateMcpServerDirect(config, { timeoutMs: 120_000 });
  if (result.error) throw new Error(result.error);
  gatewayState.ensureGatewayConnection({ ...gatewayContext(ctx), provider: 'slack_mcp' });
  const nextState = gatewayState.updateGatewayConnectionStatus({
    ...gatewayContext(ctx),
    provider: 'slack_mcp',
    status: 'connected',
    enabled: true,
  });
  (await ensureRuntime(ctx)).start();
  return { authenticated: true, state: nextState };
}

export async function disconnectSlackMcpGateway(ctx: ExtensionBackendContext) {
  const [core, gatewayState, config] = await Promise.all([
    dynamicImport<typeof import('@personal-agent/core')>('@personal-agent/core'),
    gatewayStateModule(),
    slackConfig(),
  ]);
  await core.clearMcpServerAuthDirect(config);
  (await ensureRuntime(ctx)).stop();
  const nextState = gatewayState.updateGatewayConnectionStatus({
    ...gatewayContext(ctx),
    provider: 'slack_mcp',
    status: 'needs_config',
    enabled: false,
    statusMessage: 'Slack disconnected',
  });
  return { authenticated: false, state: nextState };
}

export async function saveSlackMcpGatewayChannel(input: { channelId: string; channelLabel?: string }, ctx: ExtensionBackendContext) {
  const gatewayState = await gatewayStateModule();
  gatewayState.ensureGatewayConnection({ ...gatewayContext(ctx), provider: 'slack_mcp' });
  (await ensureRuntime(ctx)).saveChannel(input);
  return gatewayState.readGatewayState(gatewayContext(ctx));
}

export async function attachSlackMcpGateway(
  input: {
    conversationId: string;
    conversationTitle: string;
    externalChatId: string;
    externalChatLabel?: string;
  },
  ctx: ExtensionBackendContext,
) {
  await (await ensureRuntime(ctx)).attachChannelToConversation(input);
  (await dynamicImport<typeof import('../../shared/appEvents.js')>('../../shared/appEvents.js')).invalidateAppTopics('sessions');
  return (await gatewayStateModule()).readGatewayState(gatewayContext(ctx));
}

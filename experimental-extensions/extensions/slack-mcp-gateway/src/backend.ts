import {
  attachSlackMcpGateway,
  connectSlackMcpGateway,
  disconnectSlackMcpGateway,
  readSlackMcpGatewayAuthState,
  readSlackMcpGatewayState,
  saveSlackMcpGatewayChannel,
  startSlackMcpGateway,
  stopSlackMcpGateway,
} from '../../../../packages/desktop/server/extensions/backendApi/slackMcpGateway.js';
import type { ExtensionBackendContext } from '../../../../packages/desktop/server/extensions/extensionBackend.js';

export async function start(_input: unknown, ctx: ExtensionBackendContext) {
  return startSlackMcpGateway(ctx);
}

export async function stop(_input: unknown, ctx: ExtensionBackendContext) {
  return stopSlackMcpGateway(ctx);
}

export async function state(_input: unknown, ctx: ExtensionBackendContext) {
  return readSlackMcpGatewayState(ctx);
}

export async function authState() {
  return readSlackMcpGatewayAuthState();
}

export async function connect(_input: unknown, ctx: ExtensionBackendContext) {
  return connectSlackMcpGateway(ctx);
}

export async function disconnect(_input: unknown, ctx: ExtensionBackendContext) {
  return disconnectSlackMcpGateway(ctx);
}

function readString(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} required`);
  return value.trim();
}

export async function saveChannel(input: unknown, ctx: ExtensionBackendContext) {
  const record = (input ?? {}) as Record<string, unknown>;
  return saveSlackMcpGatewayChannel(
    {
      channelId: readString(record.channelId, 'channelId'),
      ...(typeof record.channelLabel === 'string' ? { channelLabel: record.channelLabel } : {}),
    },
    ctx,
  );
}

export async function attach(input: unknown, ctx: ExtensionBackendContext) {
  const record = (input ?? {}) as Record<string, unknown>;
  return attachSlackMcpGateway(
    {
      conversationId: readString(record.conversationId, 'conversationId'),
      conversationTitle:
        typeof record.conversationTitle === 'string' && record.conversationTitle.trim()
          ? record.conversationTitle.trim()
          : readString(record.conversationId, 'conversationId'),
      externalChatId: readString(record.externalChatId, 'externalChatId'),
      ...(typeof record.externalChatLabel === 'string' ? { externalChatLabel: record.externalChatLabel } : {}),
    },
    ctx,
  );
}

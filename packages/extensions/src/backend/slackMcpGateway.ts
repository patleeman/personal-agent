import type { ExtensionBackendContext } from '../index';

export interface SlackMcpGatewayChannelInput {
  channelId: string;
  channelLabel?: string;
}

export interface SlackMcpGatewayAttachInput {
  conversationId: string;
  conversationTitle: string;
  externalChatId: string;
  externalChatLabel?: string;
}

export async function startSlackMcpGateway(_ctx: ExtensionBackendContext): Promise<unknown> {
  throw new Error('@personal-agent/extensions/backend/slackMcpGateway must be resolved by the Personal Agent host runtime.');
}

export async function stopSlackMcpGateway(_ctx: ExtensionBackendContext): Promise<unknown> {
  throw new Error('@personal-agent/extensions/backend/slackMcpGateway must be resolved by the Personal Agent host runtime.');
}

export async function readSlackMcpGatewayState(_ctx: ExtensionBackendContext): Promise<unknown> {
  throw new Error('@personal-agent/extensions/backend/slackMcpGateway must be resolved by the Personal Agent host runtime.');
}

export async function readSlackMcpGatewayAuthState(): Promise<unknown> {
  throw new Error('@personal-agent/extensions/backend/slackMcpGateway must be resolved by the Personal Agent host runtime.');
}

export async function connectSlackMcpGateway(_ctx: ExtensionBackendContext): Promise<unknown> {
  throw new Error('@personal-agent/extensions/backend/slackMcpGateway must be resolved by the Personal Agent host runtime.');
}

export async function disconnectSlackMcpGateway(_ctx: ExtensionBackendContext): Promise<unknown> {
  throw new Error('@personal-agent/extensions/backend/slackMcpGateway must be resolved by the Personal Agent host runtime.');
}

export async function saveSlackMcpGatewayChannel(_input: SlackMcpGatewayChannelInput, _ctx: ExtensionBackendContext): Promise<unknown> {
  throw new Error('@personal-agent/extensions/backend/slackMcpGateway must be resolved by the Personal Agent host runtime.');
}

export async function attachSlackMcpGateway(_input: SlackMcpGatewayAttachInput, _ctx: ExtensionBackendContext): Promise<unknown> {
  throw new Error('@personal-agent/extensions/backend/slackMcpGateway must be resolved by the Personal Agent host runtime.');
}

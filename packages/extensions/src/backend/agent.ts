import type { ExtensionBackendContext } from '../index';

export interface ExtensionAgentImageInput {
  type: 'image';
  data: string;
  mimeType: string;
}

export interface ExtensionAgentRunTaskInput {
  cwd?: string;
  modelRef?: string;
  prompt: string;
  images?: ExtensionAgentImageInput[];
  tools?: 'none' | 'default';
  timeoutMs?: number;
}

export interface ExtensionAgentRunTaskResult {
  text: string;
  model?: string;
  provider?: string;
}

export interface ExtensionAgentConversationCreateInput {
  title?: string;
  cwd?: string;
  modelRef?: string;
  tools?: 'none' | 'default';
  visibility?: 'hidden';
  persistence?: 'ephemeral';
}

export interface ExtensionAgentConversationSendInput {
  conversationId: string;
  text: string;
  images?: ExtensionAgentImageInput[];
  timeoutMs?: number;
}

export interface ExtensionAgentConversationSummary {
  id: string;
  ownerExtensionId: string;
  title: string;
  cwd: string;
  model?: string;
  provider?: string;
  visibility: 'hidden';
  persistence: 'ephemeral';
  tools: 'none' | 'default';
  createdAt: string;
  updatedAt: string;
  isBusy: boolean;
  disposed: boolean;
  messageCount: number;
  lastText?: string;
}

export interface ExtensionAgentConversationMessageResult extends ExtensionAgentConversationSummary {
  text: string;
}

function hostResolved(): never {
  throw new Error('@personal-agent/extensions/backend/agent must be resolved by the Personal Agent host runtime.');
}

export async function createAgentConversation(
  _input: ExtensionAgentConversationCreateInput,
  _ctx: ExtensionBackendContext,
): Promise<ExtensionAgentConversationSummary> {
  hostResolved();
}

export async function sendAgentMessage(
  _input: ExtensionAgentConversationSendInput,
  _ctx: ExtensionBackendContext,
): Promise<ExtensionAgentConversationMessageResult> {
  hostResolved();
}

export async function getAgentConversation(
  _input: { conversationId: string },
  _ctx: ExtensionBackendContext,
): Promise<ExtensionAgentConversationSummary> {
  hostResolved();
}

export async function listAgentConversations(_input: unknown, _ctx: ExtensionBackendContext): Promise<ExtensionAgentConversationSummary[]> {
  hostResolved();
}

export async function abortAgentConversation(
  _input: { conversationId: string },
  _ctx: ExtensionBackendContext,
): Promise<ExtensionAgentConversationSummary> {
  hostResolved();
}

export async function disposeAgentConversation(
  _input: { conversationId: string },
  _ctx: ExtensionBackendContext,
): Promise<{ ok: true; conversationId: string }> {
  hostResolved();
}

export async function runAgentTask(
  _input: ExtensionAgentRunTaskInput,
  _ctx: ExtensionBackendContext,
): Promise<ExtensionAgentRunTaskResult> {
  hostResolved();
}

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
  tools?: 'none';
  timeoutMs?: number;
}

export interface ExtensionAgentRunTaskResult {
  text: string;
  model?: string;
  provider?: string;
}

export async function runAgentTask(
  _input: ExtensionAgentRunTaskInput,
  _ctx: ExtensionBackendContext,
): Promise<ExtensionAgentRunTaskResult> {
  throw new Error('@personal-agent/extensions/backend/agent must be resolved by the Personal Agent host runtime.');
}

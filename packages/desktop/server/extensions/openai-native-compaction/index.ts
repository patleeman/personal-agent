import { arch, platform } from 'node:os';
import { compact, type ExtensionAPI } from '@mariozechner/pi-coding-agent';
import type { AgentMessage } from '@mariozechner/pi-agent-core';

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type JsonRecord = { [key: string]: unknown };
type ModelLike = JsonRecord;

type ResponseContentItem =
  | { type: 'input_text'; text: string }
  | { type: 'input_image'; image_url: string }
  | { type: 'output_text'; text: string };

type ResponseItem =
  | {
      type: 'message';
      role: string;
      content: ResponseContentItem[];
      phase?: 'commentary' | 'final_answer';
      end_turn?: boolean;
    }
  | {
      type: 'reasoning';
      summary: Array<{ type: 'summary_text'; text: string }>;
      content?: Array<{ type: 'reasoning_text' | 'text'; text: string }>;
      encrypted_content: string | null;
    }
  | { type: 'function_call'; name: string; arguments: string; call_id: string }
  | {
      type: 'function_call_output';
      call_id: string;
      output:
        | string
        | Array<{ type: 'input_text'; text: string } | { type: 'input_image'; image_url: string }>;
    }
  | { type: string; [key: string]: unknown };

type NativeCompactionDetails = {
  version: 1;
  provider: 'openai-responses-compact';
  modelKey: string;
  replacementHistory: ResponseItem[];
  usage?: Json;
};

type BranchEntry = {
  id: string;
  type: string;
  details?: unknown;
  summary?: string;
  content?: unknown;
  display?: boolean;
  customType?: string;
  message?: AgentMessage;
};

type RequestShape = {
  tools?: unknown[];
  parallelToolCalls?: boolean;
  reasoning?: Record<string, unknown>;
  text?: Record<string, unknown>;
};

const ENABLED = process.env.PI_OPENAI_NATIVE_COMPACTION !== '0';
const NOTIFY = process.env.PI_OPENAI_NATIVE_COMPACTION_NOTIFY === '1';
const requestShapeBySession = new Map<string, RequestShape>();

function isRecord(value: unknown): value is JsonRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function cloneJson<T>(value: T): T {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

function notify(
  ctx: { hasUI: boolean; ui: { notify(message: string, level: 'info' | 'warning' | 'error'): void } },
  message: string,
  level: 'info' | 'warning' | 'error' = 'info',
): void {
  if (NOTIFY && ctx.hasUI) ctx.ui.notify(message, level);
}

function getSessionId(ctx: { sessionManager: { getSessionId(): string } }): string {
  return ctx.sessionManager.getSessionId();
}

function hostnameFromBaseUrl(baseUrl: unknown): string | undefined {
  if (typeof baseUrl !== 'string' || !baseUrl.trim()) return undefined;
  try {
    return new URL(baseUrl).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

export function modelKey(model: ModelLike): string {
  return `${String(model.provider)}:${String(model.api)}:${String(model.id)}`;
}

function isDirectOpenAIResponsesModel(model: unknown): model is ModelLike {
  if (!isRecord(model)) return false;
  if (model.api !== 'openai-responses') return false;
  if (model.provider !== 'openai') return false;
  const host = hostnameFromBaseUrl(model.baseUrl);
  return host === undefined || host === 'api.openai.com';
}

function isCodexResponsesModel(model: unknown): model is ModelLike {
  if (!isRecord(model)) return false;
  if (model.api !== 'openai-codex-responses') return false;
  if (model.provider === 'openai-codex') return true;
  return hostnameFromBaseUrl(model.baseUrl) === 'chatgpt.com';
}

function supportsNativeCompaction(model: unknown): model is ModelLike {
  return isDirectOpenAIResponsesModel(model) || isCodexResponsesModel(model);
}

function describeProviderCompaction(model: ModelLike): string {
  return isCodexResponsesModel(model) ? 'Codex compaction' : 'OpenAI compaction';
}

function normalizeBaseUrl(baseUrl: unknown, fallback: string): string {
  return typeof baseUrl === 'string' && baseUrl.trim() ? baseUrl.trim().replace(/\/+$/, '') : fallback;
}

export function compactEndpointUrl(model: ModelLike): string {
  if (isDirectOpenAIResponsesModel(model)) {
    const baseUrl = normalizeBaseUrl(model.baseUrl, 'https://api.openai.com/v1');
    return baseUrl.endsWith('/v1') ? `${baseUrl}/responses/compact` : `${baseUrl}/v1/responses/compact`;
  }

  if (isCodexResponsesModel(model)) {
    const baseUrl = normalizeBaseUrl(model.baseUrl, 'https://chatgpt.com/backend-api');
    if (baseUrl.endsWith('/codex/responses')) return `${baseUrl}/compact`;
    if (baseUrl.endsWith('/codex')) return `${baseUrl}/responses/compact`;
    return `${baseUrl}/codex/responses/compact`;
  }

  throw new Error('Unsupported model for native compaction.');
}

export function extractCodexAccountId(token: string): string | undefined {
  const parts = token.split('.');
  if (parts.length !== 3) return undefined;
  try {
    const payload = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8'));
    const auth = isRecord(payload) && isRecord(payload['https://api.openai.com/auth'])
      ? payload['https://api.openai.com/auth']
      : undefined;
    return typeof auth?.chatgpt_account_id === 'string' && auth.chatgpt_account_id
      ? auth.chatgpt_account_id
      : undefined;
  } catch {
    return undefined;
  }
}

export function buildCompactHeaders(params: {
  model: ModelLike;
  apiKey: string;
  headers?: Record<string, string>;
  sessionId?: string;
}): Record<string, string> {
  if (isDirectOpenAIResponsesModel(params.model)) {
    return {
      authorization: `Bearer ${params.apiKey}`,
      ...(params.sessionId ? { session_id: params.sessionId } : {}),
      ...(params.headers ?? {}),
    };
  }

  if (isCodexResponsesModel(params.model)) {
    const accountId = extractCodexAccountId(params.apiKey);
    return {
      authorization: `Bearer ${params.apiKey}`,
      ...(accountId ? { 'chatgpt-account-id': accountId } : {}),
      ...(params.sessionId ? { session_id: params.sessionId } : {}),
      originator: 'pi',
      'user-agent': `pi-native-compaction (${platform()}; ${arch()})`,
      'OpenAI-Beta': 'responses=experimental',
      ...(params.headers ?? {}),
    };
  }

  throw new Error('Unsupported model for native compaction.');
}

function looksLikeResponsesPayload(payload: unknown): payload is { model: string; input: unknown[]; [key: string]: unknown } {
  return isRecord(payload) && typeof payload.model === 'string' && Array.isArray(payload.input);
}

function isPromptEnvelopeItem(item: unknown): boolean {
  return isRecord(item) && (item.role === 'developer' || item.role === 'system');
}

function splitPromptEnvelope(input: unknown[]): { leading: unknown[]; trailing: unknown[] } | undefined {
  let start = 0;
  while (start < input.length && isPromptEnvelopeItem(input[start])) start += 1;

  let end = input.length;
  while (end > start && isPromptEnvelopeItem(input[end - 1])) end -= 1;

  for (let index = start; index < end; index += 1) {
    if (isPromptEnvelopeItem(input[index])) return undefined;
  }

  return {
    leading: cloneJson(input.slice(0, start)),
    trailing: cloneJson(input.slice(end)),
  };
}

function extractRequestShape(payload: Record<string, unknown>): RequestShape {
  return {
    ...(Array.isArray(payload.tools) ? { tools: cloneJson(payload.tools) } : {}),
    ...(typeof payload.parallel_tool_calls === 'boolean' ? { parallelToolCalls: payload.parallel_tool_calls } : {}),
    ...(isRecord(payload.reasoning) ? { reasoning: cloneJson(payload.reasoning) } : {}),
    ...(isRecord(payload.text) ? { text: cloneJson(payload.text) } : {}),
  };
}

function normalizeTextInput(content: unknown): Array<{ type: 'input_text'; text: string } | { type: 'input_image'; image_url: string }> {
  if (typeof content === 'string') {
    return content ? [{ type: 'input_text', text: content }] : [];
  }
  if (!Array.isArray(content)) return [];

  const items: Array<{ type: 'input_text'; text: string } | { type: 'input_image'; image_url: string }> = [];
  for (const part of content) {
    if (!isRecord(part)) continue;
    if ((part.type === 'text' || part.type === 'input_text' || part.type === 'output_text') && typeof part.text === 'string') {
      items.push({ type: 'input_text', text: part.text });
      continue;
    }
    if (part.type === 'image' && typeof part.data === 'string' && typeof part.mimeType === 'string') {
      items.push({ type: 'input_image', image_url: `data:${part.mimeType};base64,${part.data}` });
      continue;
    }
    if (part.type === 'input_image' && isRecord(part.source) && part.source.type === 'url' && typeof part.source.url === 'string') {
      items.push({ type: 'input_image', image_url: part.source.url });
    }
  }
  return items;
}

function parseReasoningSignature(signature: unknown): ResponseItem | undefined {
  if (typeof signature !== 'string' || !signature.trim()) return undefined;
  try {
    const parsed = JSON.parse(signature);
    if (!isRecord(parsed) || parsed.type !== 'reasoning') return undefined;

    const summary = Array.isArray(parsed.summary)
      ? parsed.summary
        .map((item) => (isRecord(item) && typeof item.text === 'string' ? { type: 'summary_text' as const, text: item.text } : undefined))
        .filter((item): item is { type: 'summary_text'; text: string } => Boolean(item))
      : [];

    const content = Array.isArray(parsed.content)
      ? parsed.content
        .map((item) => {
          if (!isRecord(item) || typeof item.text !== 'string') return undefined;
          return {
            type: item.type === 'reasoning_text' ? 'reasoning_text' : 'text',
            text: item.text,
          } as const;
        })
        .filter((item): item is { type: 'reasoning_text' | 'text'; text: string } => Boolean(item))
      : undefined;

    return {
      type: 'reasoning',
      summary,
      ...(content && content.length > 0 ? { content } : {}),
      encrypted_content: typeof parsed.encrypted_content === 'string' ? parsed.encrypted_content : null,
    };
  } catch {
    return undefined;
  }
}

function parseAssistantPhase(signature: unknown): 'commentary' | 'final_answer' | undefined {
  if (typeof signature !== 'string' || !signature.trim()) return undefined;
  try {
    const parsed = JSON.parse(signature);
    return parsed?.phase === 'commentary' || parsed?.phase === 'final_answer' ? parsed.phase : undefined;
  } catch {
    return undefined;
  }
}

function assistantMessageToResponseItems(message: Extract<AgentMessage, { role: 'assistant' }>): ResponseItem[] {
  const items: ResponseItem[] = [];
  let phase: 'commentary' | 'final_answer' | undefined;
  let textBlocks: string[] = [];

  const flushText = () => {
    if (textBlocks.length === 0) return;
    items.push({
      type: 'message',
      role: 'assistant',
      content: [{ type: 'output_text', text: textBlocks.join('') }],
      ...(phase ? { phase } : {}),
    });
    textBlocks = [];
  };

  for (const block of message.content) {
    if (block.type === 'text') {
      if (!phase) phase = parseAssistantPhase(block.textSignature);
      textBlocks.push(block.text);
      continue;
    }

    if (block.type === 'thinking') {
      flushText();
      const reasoning = parseReasoningSignature(block.thinkingSignature);
      if (reasoning) items.push(reasoning);
      continue;
    }

    if (block.type === 'toolCall') {
      flushText();
      const callId = typeof block.id === 'string' ? block.id.split('|', 1)[0] : String(block.id);
      items.push({
        type: 'function_call',
        name: block.name,
        call_id: callId,
        arguments: JSON.stringify(block.arguments ?? {}),
      });
    }
  }

  flushText();
  return items;
}

function messageToResponseItems(message: AgentMessage): ResponseItem[] {
  if (message.role === 'user') {
    const content = normalizeTextInput(message.content);
    return content.length > 0 ? [{ type: 'message', role: 'user', content }] : [];
  }

  if (message.role === 'assistant') {
    return assistantMessageToResponseItems(message);
  }

  if (message.role === 'toolResult') {
    const callId = message.toolCallId.split('|', 1)[0];
    const output = normalizeTextInput(message.content);
    return [{
      type: 'function_call_output',
      call_id: callId,
      output: output.length > 0 ? output : '',
    }];
  }

  if (message.role === 'bashExecution') {
    return normalizeTextInput(`Bash command:\n${message.command}\n\nOutput:\n${message.output}`)
      .map((content) => ({ type: 'message', role: 'user', content: [content] })) as ResponseItem[];
  }

  if (message.role === 'custom') {
    const content = normalizeTextInput(message.content);
    return content.length > 0 ? [{ type: 'message', role: 'user', content }] : [];
  }

  if (message.role === 'branchSummary') {
    return [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: `Branch summary:\n${message.summary}` }] }];
  }

  if (message.role === 'compactionSummary') {
    return [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: `Compaction summary:\n${message.summary}` }] }];
  }

  return [];
}

function entryToResponseItems(entry: BranchEntry): ResponseItem[] {
  if (entry.type === 'message' && entry.message) return messageToResponseItems(entry.message);
  if (entry.type === 'custom_message') {
    const content = normalizeTextInput(entry.content);
    return content.length > 0 ? [{ type: 'message', role: 'user', content }] : [];
  }
  if (entry.type === 'branch_summary' && typeof entry.summary === 'string') {
    return [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: `Branch summary:\n${entry.summary}` }] }];
  }
  if (entry.type === 'compaction' && typeof entry.summary === 'string') {
    return [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: `Compaction summary:\n${entry.summary}` }] }];
  }
  return [];
}

function extractNativeDetails(details: unknown): NativeCompactionDetails | undefined {
  if (!isRecord(details)) return undefined;
  const native = isRecord(details.nativeCompaction) ? details.nativeCompaction : details;
  if (!isRecord(native)) return undefined;
  if (native.provider !== 'openai-responses-compact' || native.version !== 1) return undefined;
  if (typeof native.modelKey !== 'string') return undefined;
  if (!Array.isArray(native.replacementHistory)) return undefined;

  const replacementHistory = native.replacementHistory.filter((item): item is ResponseItem => isRecord(item) && typeof item.type === 'string');
  if (replacementHistory.length === 0) return undefined;

  return {
    version: 1,
    provider: 'openai-responses-compact',
    modelKey: native.modelKey,
    replacementHistory: cloneJson(replacementHistory),
    ...(native.usage !== undefined ? { usage: cloneJson(native.usage as Json) } : {}),
  };
}

function assistantMatchesModel(message: AgentMessage, targetModelKey: string): boolean {
  if (!isRecord(message)) return false;
  const [provider, api, id] = targetModelKey.split(':', 3);
  return !!provider && !!api && !!id && message.role === 'assistant' && message.provider === provider && message.model === id;
}

function sanitizeResponseHistory(items: ResponseItem[]): ResponseItem[] {
  const knownToolCallIds = new Set<string>();
  const sanitized: ResponseItem[] = [];

  for (const item of items) {
    if (item.type === 'function_call') {
      const callId = typeof item.call_id === 'string' ? item.call_id.trim() : '';
      if (!callId) {
        continue;
      }

      knownToolCallIds.add(callId);
      sanitized.push(item);
      continue;
    }

    if (item.type === 'function_call_output') {
      const callId = typeof item.call_id === 'string' ? item.call_id.trim() : '';
      if (!callId || !knownToolCallIds.has(callId)) {
        continue;
      }

      sanitized.push(item);
      continue;
    }

    sanitized.push(item);
  }

  return sanitized;
}

export function reconstructNativeState(
  branchEntries: BranchEntry[],
  model: ModelLike,
): { details: NativeCompactionDetails; explicitHistory: ResponseItem[] } | undefined {
  const targetKey = modelKey(model);
  let latestCompactionIndex = -1;
  let latestDetails: NativeCompactionDetails | undefined;

  branchEntries.forEach((entry, index) => {
    if (entry.type !== 'compaction') return;
    const details = extractNativeDetails(entry.details);
    if (!details || details.modelKey !== targetKey) return;
    latestCompactionIndex = index;
    latestDetails = details;
  });

  if (!latestDetails || latestCompactionIndex < 0) return undefined;

  const trailing: ResponseItem[] = [];
  let pendingTurn: ResponseItem[] = [];

  for (const entry of branchEntries.slice(latestCompactionIndex + 1)) {
    const items = entryToResponseItems(entry);
    if (items.length === 0) continue;

    const isAssistantMessage = entry.type === 'message' && entry.message?.role === 'assistant';
    if (isAssistantMessage) {
      if (assistantMatchesModel(entry.message!, latestDetails.modelKey)) {
        trailing.push(...pendingTurn, ...items);
      }
      pendingTurn = [];
      continue;
    }

    pendingTurn.push(...items);
  }

  return {
    details: latestDetails,
    explicitHistory: sanitizeResponseHistory([
      ...cloneJson(latestDetails.replacementHistory),
      ...pendingTurn.length ? [...trailing, ...pendingTurn] : trailing,
    ]),
  };
}

async function callNativeCompaction(params: {
  model: ModelLike;
  apiKey: string;
  headers?: Record<string, string>;
  sessionId?: string;
  input: ResponseItem[];
  instructions: string;
  shape?: RequestShape;
  signal?: AbortSignal;
}): Promise<{ output: ResponseItem[]; usage?: Json }> {
  const response = await fetch(compactEndpointUrl(params.model), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...buildCompactHeaders({
        model: params.model,
        apiKey: params.apiKey,
        headers: params.headers,
        sessionId: params.sessionId,
      }),
    },
    body: JSON.stringify({
      model: params.model.id,
      input: params.input,
      instructions: params.instructions,
      ...(params.shape?.tools ? { tools: params.shape.tools } : {}),
      ...(typeof params.shape?.parallelToolCalls === 'boolean' ? { parallel_tool_calls: params.shape.parallelToolCalls } : {}),
      ...(params.shape?.reasoning ? { reasoning: params.shape.reasoning } : {}),
      ...(params.shape?.text ? { text: params.shape.text } : {}),
    }),
    signal: params.signal,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`native compaction failed (${response.status}): ${text || response.statusText}`);
  }

  const json = await response.json() as { output?: unknown; usage?: Json };
  if (!Array.isArray(json.output)) throw new Error('native compaction returned no output array');

  const output = json.output.filter((item): item is ResponseItem => isRecord(item) && typeof item.type === 'string');
  if (output.length === 0) throw new Error('native compaction returned an empty output array');

  return {
    output: cloneJson(output),
    ...(json.usage !== undefined ? { usage: cloneJson(json.usage) } : {}),
  };
}

function clearSessionState(sessionId: string | undefined): void {
  if (sessionId) requestShapeBySession.delete(sessionId);
}

export default function openaiNativeCompactionExtension(pi: ExtensionAPI): void {
  if (!ENABLED) return;

  pi.on('session_start', (_event, ctx) => {
    clearSessionState(getSessionId(ctx));
  });

  for (const eventName of ['session_before_switch', 'session_before_fork', 'session_before_tree', 'model_select'] as const) {
    pi.on(eventName, (_event, ctx) => {
      clearSessionState(getSessionId(ctx));
    });
  }

  pi.on('session_shutdown', (_event, ctx) => {
    clearSessionState(getSessionId(ctx));
  });

  pi.on('before_provider_request', (event, ctx) => {
    const model = ctx.model;
    if (!supportsNativeCompaction(model)) return undefined;
    if (!looksLikeResponsesPayload(event.payload)) return undefined;

    const sessionId = getSessionId(ctx);
    requestShapeBySession.set(sessionId, extractRequestShape(event.payload));

    const nativeState = reconstructNativeState(ctx.sessionManager.getBranch() as BranchEntry[], model);
    if (!nativeState) return undefined;

    const envelope = splitPromptEnvelope(event.payload.input);
    if (!envelope) return undefined;

    const rewritten: Record<string, unknown> = {
      ...event.payload,
      input: [
        ...envelope.leading,
        ...cloneJson(nativeState.explicitHistory as unknown[]),
        ...envelope.trailing,
      ],
    };
    delete rewritten.messages;
    delete rewritten.previous_response_id;

    notify(ctx, `Using ${describeProviderCompaction(model)} for ${String(model.provider)}/${String(model.id)}`);
    return rewritten;
  });

  pi.on('session_before_compact', async (event, ctx) => {
    const model = ctx.model;
    if (!supportsNativeCompaction(model)) return undefined;

    const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
    if (!auth.ok || !auth.apiKey) return undefined;

    const sessionId = getSessionId(ctx);
    const nativeState = reconstructNativeState(event.branchEntries as BranchEntry[], model);
    const input = nativeState
      ? nativeState.explicitHistory
      : sanitizeResponseHistory((event.branchEntries as BranchEntry[]).flatMap((entry) => entryToResponseItems(entry)));

    const shape = requestShapeBySession.get(sessionId);

    const [localSummary, remoteCompaction] = await Promise.allSettled([
      compact(
        event.preparation,
        model as never,
        auth.apiKey,
        auth.headers,
        event.customInstructions,
        event.signal,
      ),
      callNativeCompaction({
        model,
        apiKey: auth.apiKey,
        headers: auth.headers,
        sessionId,
        input,
        instructions: ctx.getSystemPrompt(),
        shape,
        signal: event.signal,
      }),
    ]);

    if (event.signal.aborted) return { cancel: true };

    if (remoteCompaction.status !== 'fulfilled') {
      if (localSummary.status === 'fulfilled') {
        notify(ctx, `${describeProviderCompaction(model)} failed; using normal Pi compaction`, 'warning');
        return { compaction: localSummary.value };
      }
      if (ctx.hasUI) {
        const message = remoteCompaction.reason instanceof Error ? remoteCompaction.reason.message : String(remoteCompaction.reason);
        ctx.ui.notify(`${describeProviderCompaction(model)} failed; using normal Pi behavior. ${message}`, 'warning');
      }
      return undefined;
    }

    const fallbackSummary = `${describeProviderCompaction(model)} applied for ${String(model.provider)}/${String(model.id)}. Pi keeps this text summary for display and portability; supported future turns reuse the provider's compacted history.`;
    const summary = localSummary.status === 'fulfilled'
      ? localSummary.value
      : {
        summary: fallbackSummary,
        firstKeptEntryId: event.preparation.firstKeptEntryId,
        tokensBefore: event.preparation.tokensBefore,
      };

    return {
      compaction: {
        summary: summary.summary,
        firstKeptEntryId: summary.firstKeptEntryId,
        tokensBefore: summary.tokensBefore,
        details: {
          ...(summary.details !== undefined ? { localCompaction: summary.details } : {}),
          nativeCompaction: {
            version: 1,
            provider: 'openai-responses-compact',
            modelKey: modelKey(model),
            replacementHistory: sanitizeResponseHistory(remoteCompaction.value.output),
            ...(remoteCompaction.value.usage !== undefined ? { usage: remoteCompaction.value.usage } : {}),
          } satisfies NativeCompactionDetails,
        },
      },
    };
  });
}

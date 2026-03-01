import { createAgentSession, SessionManager } from '@mariozechner/pi-coding-agent';
import { buildMemoryCardPrompt, buildSummaryPrompt } from './memory-transcript.js';
import type {
  ResolvedMemoryConfig,
  SessionMemoryCardRequest,
  SessionSummaryRequest,
} from './memory-types.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function extractLatestAssistantText(messages: unknown): string {
  if (!Array.isArray(messages)) {
    return '';
  }

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!isRecord(message)) {
      continue;
    }

    if (message.role !== 'assistant') {
      continue;
    }

    const content = message.content;
    if (!Array.isArray(content)) {
      continue;
    }

    const texts: string[] = [];
    for (const block of content) {
      if (!isRecord(block)) {
        continue;
      }

      if (block.type !== 'text') {
        continue;
      }

      if (typeof block.text !== 'string') {
        continue;
      }

      texts.push(block.text);
    }

    const joined = texts.join('\n').trim();
    if (joined.length > 0) {
      return joined;
    }
  }

  return '';
}

async function runPiSdkPrompt(prompt: string, config: ResolvedMemoryConfig): Promise<string> {
  // Use memory summary dir as cwd to avoid pulling large project-specific context
  // files and keep summarization token usage predictable.
  const sdkCwd = config.summaryDir;

  const { session } = await createAgentSession({
    cwd: sdkCwd,
    agentDir: config.agentDir,
    sessionManager: SessionManager.inMemory(),
    tools: [],
  });

  if (session.sessionFile !== undefined) {
    session.dispose();
    throw new Error('pi sdk summarizer must run with in-memory session manager');
  }

  let output = '';

  const unsubscribe = session.subscribe((event) => {
    if (event.type !== 'message_update') {
      return;
    }

    if (event.assistantMessageEvent.type !== 'text_delta') {
      return;
    }

    output += event.assistantMessageEvent.delta;
  });

  try {
    await session.prompt(prompt);

    const streamed = output.trim();
    const fallback = extractLatestAssistantText(session.messages as unknown);
    const finalOutput = streamed.length > 0 ? streamed : fallback;

    if (finalOutput.trim().length === 0) {
      throw new Error('pi sdk summarizer returned empty output');
    }

    return finalOutput.trim();
  } finally {
    unsubscribe();
    session.dispose();
  }
}

export async function summarizeWithPiSdk(
  request: SessionSummaryRequest,
  config: ResolvedMemoryConfig,
): Promise<string> {
  return runPiSdkPrompt(buildSummaryPrompt(request), config);
}

export async function summarizeMemoryCardWithPiSdk(
  request: SessionMemoryCardRequest,
  config: ResolvedMemoryConfig,
): Promise<string> {
  return runPiSdkPrompt(buildMemoryCardPrompt(request), config);
}

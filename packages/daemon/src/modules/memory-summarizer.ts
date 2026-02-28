import { createAgentSession, SessionManager } from '@mariozechner/pi-coding-agent';
import { buildSummaryPrompt } from './memory-transcript.js';
import type { ResolvedMemoryConfig, SessionSummaryRequest } from './memory-types.js';

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

export async function summarizeWithPiSdk(
  request: SessionSummaryRequest,
  config: ResolvedMemoryConfig,
): Promise<string> {
  const prompt = buildSummaryPrompt(request);

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

  let markdown = '';

  const unsubscribe = session.subscribe((event) => {
    if (event.type !== 'message_update') {
      return;
    }

    if (event.assistantMessageEvent.type !== 'text_delta') {
      return;
    }

    markdown += event.assistantMessageEvent.delta;
  });

  try {
    await session.prompt(prompt);

    const streamed = markdown.trim();
    const fallback = extractLatestAssistantText(session.messages as unknown);
    const finalSummary = streamed.length > 0 ? streamed : fallback;

    if (finalSummary.trim().length === 0) {
      throw new Error('pi sdk summarizer returned empty output');
    }

    return finalSummary.trim();
  } finally {
    unsubscribe();
    session.dispose();
  }
}

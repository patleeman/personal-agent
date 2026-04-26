import { existsSync, unlinkSync } from 'node:fs';
import { SessionManager } from '@mariozechner/pi-coding-agent';
import { readSessionBlocksByFile } from './sessions.js';
import { createPreparedLiveAgentSession } from './liveSessionFactory.js';
import { resolveLiveSessionFile } from './liveSessionPersistence.js';
import type { LiveSessionLoaderOptions } from './liveSessionLoader.js';

function buildRelatedConversationCompactionInstructions(prompt: string): string {
  return [
    'You are preparing a compact handoff from an older conversation for reuse in a brand new conversation.',
    'Focus only on context that still helps with the user\'s next prompt.',
    '',
    'The next prompt is:',
    prompt.trim(),
    '',
    'Include only the most relevant goals, decisions, file paths, commands, errors, and unresolved work.',
    'Drop unrelated history and repetition. If the conversation is not directly relevant, say so briefly.',
  ].join('\n');
}

function extractLatestCompactionSummaryText(detail: ReturnType<typeof readSessionBlocksByFile>): string | null {
  const blocks = detail?.blocks ?? [];
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index];
    if (block?.type === 'summary' && block.kind === 'compaction' && block.text.trim().length > 0) {
      return block.text.trim();
    }
  }

  return null;
}

export async function summarizeSessionFileForPromptWithLiveSession(input: {
  sessionFile: string;
  cwd: string;
  prompt: string;
  agentDir: string;
  settingsFile: string;
  persistentSessionDir: string;
  options?: LiveSessionLoaderOptions;
}): Promise<string> {
  const options = input.options ?? {};
  const sessionManager = SessionManager.forkFrom(input.sessionFile, input.cwd, input.persistentSessionDir);
  const { session } = await createPreparedLiveAgentSession({
    cwd: input.cwd,
    agentDir: options.agentDir ?? input.agentDir,
    sessionManager,
    settingsFile: input.settingsFile,
    options,
  });

  const temporarySessionFile = resolveLiveSessionFile(session) ?? '';

  try {
    await session.compact(buildRelatedConversationCompactionInstructions(input.prompt));
    const detail = temporarySessionFile
      ? readSessionBlocksByFile(temporarySessionFile)
      : null;
    const summary = extractLatestCompactionSummaryText(detail);
    if (!summary) {
      throw new Error('Compaction did not produce a reusable summary.');
    }

    return summary;
  } finally {
    session.dispose();
    if (temporarySessionFile && existsSync(temporarySessionFile)) {
      try {
        unlinkSync(temporarySessionFile);
      } catch {
        // Ignore temp session cleanup failures.
      }
    }
  }
}

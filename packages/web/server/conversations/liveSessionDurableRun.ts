import { syncWebLiveConversationRun, type WebLiveConversationRunState } from './conversationRuns.js';

export interface LiveSessionDurableRunHost {
  sessionId: string;
  cwd: string;
  title: string;
  lastDurableRunState?: WebLiveConversationRunState;
  session: {
    sessionFile?: string | null;
    sessionName?: string;
  };
}

export function resolveLiveSessionProfile(): string | undefined {
  const profile = process.env.PERSONAL_AGENT_ACTIVE_PROFILE ?? process.env.PERSONAL_AGENT_PROFILE;
  const normalized = profile?.trim();
  return normalized && normalized.length > 0 ? normalized : undefined;
}

export function resolveDurableRunTitle(entry: LiveSessionDurableRunHost): string {
  const sessionName = entry.session.sessionName?.trim();
  if (sessionName) {
    return sessionName;
  }

  return entry.title.trim();
}

export async function syncLiveSessionDurableRun(
  entry: LiveSessionDurableRunHost,
  state: WebLiveConversationRunState,
  input: { force?: boolean; lastError?: string } = {},
): Promise<void> {
  const sessionFile = entry.session.sessionFile?.trim();
  if (!sessionFile) {
    return;
  }

  if (!input.force && entry.lastDurableRunState === state && !input.lastError) {
    return;
  }

  entry.lastDurableRunState = state;

  try {
    await syncWebLiveConversationRun({
      conversationId: entry.sessionId,
      sessionFile,
      cwd: entry.cwd,
      title: resolveDurableRunTitle(entry),
      profile: resolveLiveSessionProfile(),
      state,
      lastError: input.lastError,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[${new Date().toISOString()}] [web] [error] conversation durable run sync failed sessionId=${entry.sessionId} state=${state} message=${message}`);
  }
}

export type { WebLiveConversationRunState };

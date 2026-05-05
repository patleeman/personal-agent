import { type AgentSession, SessionManager } from '@mariozechner/pi-coding-agent';

import { createPreparedLiveAgentSession } from './liveSessionFactory.js';
import { type LiveSessionLoaderOptions, queuePrewarmLiveSessionLoader } from './liveSessionLoader.js';
import { resolveLiveSessionFile } from './liveSessionPersistence.js';
import { readSessionMetaByFile } from './sessions.js';

export async function createLiveSession(input: {
  cwd: string;
  agentDir: string;
  settingsFile: string;
  persistentSessionDir: string;
  options?: LiveSessionLoaderOptions;
  wireSession: (id: string, session: AgentSession, cwd: string) => unknown;
}): Promise<{ id: string; sessionFile: string }> {
  const options = input.options ?? {};
  const sessionManager = SessionManager.create(input.cwd, input.persistentSessionDir);
  const { session } = await createPreparedLiveAgentSession({
    cwd: input.cwd,
    agentDir: options.agentDir ?? input.agentDir,
    sessionManager,
    settingsFile: input.settingsFile,
    options,
    applyInitialPreferences: true,
  });

  const id = session.sessionId;
  input.wireSession(id, session, input.cwd);
  queuePrewarmLiveSessionLoader(input.cwd, options);
  return { id, sessionFile: resolveLiveSessionFile(session) ?? '' };
}

export async function createLiveSessionFromExisting(input: {
  sessionFile: string;
  cwd: string;
  agentDir: string;
  settingsFile: string;
  persistentSessionDir: string;
  options?: LiveSessionLoaderOptions;
  wireSession: (id: string, session: AgentSession, cwd: string) => unknown;
}): Promise<{ id: string; sessionFile: string }> {
  const options = input.options ?? {};
  const sessionManager = SessionManager.forkFrom(input.sessionFile, input.cwd, input.persistentSessionDir);
  const { session } = await createPreparedLiveAgentSession({
    cwd: input.cwd,
    agentDir: options.agentDir ?? input.agentDir,
    sessionManager,
    settingsFile: input.settingsFile,
    options,
  });

  const id = session.sessionId;
  input.wireSession(id, session, input.cwd);
  queuePrewarmLiveSessionLoader(input.cwd, options);
  return { id, sessionFile: resolveLiveSessionFile(session) ?? '' };
}

export async function resumeLiveSession(input: {
  sessionFile: string;
  agentDir: string;
  settingsFile: string;
  options?: LiveSessionLoaderOptions & { cwdOverride?: string };
  findLiveSessionByFile: (sessionFile: string) => { id: string } | null;
  wireSession: (id: string, session: AgentSession, cwd: string) => unknown;
}): Promise<{ id: string }> {
  const live = input.findLiveSessionByFile(input.sessionFile);
  if (live) {
    return live;
  }

  const { cwdOverride, ...loaderOptions } = input.options ?? {};
  const normalizedCwdOverride = typeof cwdOverride === 'string' && cwdOverride.trim().length > 0 ? cwdOverride.trim() : undefined;

  const metadataCwd = readSessionMetaByFile(input.sessionFile)?.cwd;
  const effectiveCwdOverride = normalizedCwdOverride ?? metadataCwd;
  const sessionManager = SessionManager.open(input.sessionFile, undefined, effectiveCwdOverride);
  const cwd = effectiveCwdOverride ?? sessionManager.getCwd();
  const { session } = await createPreparedLiveAgentSession({
    cwd,
    agentDir: loaderOptions.agentDir ?? input.agentDir,
    sessionManager,
    settingsFile: input.settingsFile,
    options: loaderOptions,
    ensureSessionFile: false,
  });

  const id = session.sessionId;
  input.wireSession(id, session, cwd);
  queuePrewarmLiveSessionLoader(cwd, loaderOptions);
  return { id };
}

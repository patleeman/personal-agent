import { appendFileSync, existsSync } from 'node:fs';
import { type AgentSession, type SessionManager } from '@mariozechner/pi-coding-agent';

interface PersistableSessionManager {
  persist?: boolean;
  sessionFile?: string;
  flushed?: boolean;
  _rewriteFile?: () => void;
  _persist?: (entry: unknown) => void;
}

const SESSION_MANAGER_PERSISTENCE_PATCH = Symbol('pa.session-manager-persistence-patch');

export function patchSessionManagerPersistence(sessionManager: SessionManager): void {
  const manager = sessionManager as unknown as PersistableSessionManager & {
    [SESSION_MANAGER_PERSISTENCE_PATCH]?: boolean;
  };

  if (manager[SESSION_MANAGER_PERSISTENCE_PATCH]) {
    return;
  }

  if (typeof manager._rewriteFile !== 'function') {
    return;
  }

  const rewriteFile = manager._rewriteFile.bind(manager);
  manager._persist = (entry: unknown) => {
    if (!manager.persist || !manager.sessionFile) {
      return;
    }

    if (!manager.flushed || !existsSync(manager.sessionFile)) {
      rewriteFile();
      manager.flushed = true;
      return;
    }

    appendFileSync(manager.sessionFile, `${JSON.stringify(entry)}\n`);
  };

  manager[SESSION_MANAGER_PERSISTENCE_PATCH] = true;
}

export function ensureSessionFileExists(sessionManager: SessionManager): void {
  const manager = sessionManager as unknown as PersistableSessionManager;
  if (!manager.persist || !manager.sessionFile || typeof manager._rewriteFile !== 'function') {
    return;
  }

  if (existsSync(manager.sessionFile) && manager.flushed) {
    return;
  }

  manager._rewriteFile();
  manager.flushed = true;
}

export function resolveLiveSessionFile(
  session: Pick<AgentSession, 'sessionFile'> & { sessionManager?: Pick<SessionManager, 'getSessionFile'> },
  options: { ensurePersisted?: boolean } = {},
): string | undefined {
  if (options.ensurePersisted && session.sessionManager) {
    ensureSessionFileExists(session.sessionManager as SessionManager);
  }

  const managerFile = typeof session.sessionManager?.getSessionFile === 'function'
    ? session.sessionManager.getSessionFile()?.trim()
    : '';
  if (managerFile) {
    return managerFile;
  }

  const sessionFile = session.sessionFile?.trim();
  return sessionFile || undefined;
}

import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { SessionManager } from '@mariozechner/pi-coding-agent';
import { afterEach, describe, expect, it } from 'vitest';

import { closeAutomationDbs, createStoredAutomation, setStoredAutomationThreadBinding } from './automation-store.js';
import { ensureAutomationThread } from './automation-threads.js';

const tempDirs: string[] = [];

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  closeAutomationDbs();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('ensureAutomationThread', () => {
  it('creates and persists a dedicated automation thread by default', () => {
    const stateRoot = createTempDir('pa-automation-thread-state-');
    const dbPath = join(stateRoot, 'runtime.db');
    const task = createStoredAutomation({
      dbPath,
      profile: 'assistant',
      title: 'Daily report',
      cron: '0 9 * * 1-5',
      cwd: '/tmp/project-a',
      prompt: 'Summarize the day.',
    });

    const ensured = ensureAutomationThread(task.id, { dbPath, stateRoot });

    expect(ensured.threadMode).toBe('dedicated');
    expect(ensured.threadConversationId).toBeTruthy();
    expect(ensured.threadSessionFile).toBeTruthy();
    expect(existsSync(ensured.threadSessionFile as string)).toBe(true);

    const session = SessionManager.open(ensured.threadSessionFile as string);
    expect(session.getSessionId()).toBe(ensured.threadConversationId);
    expect(session.getCwd()).toBe('/tmp/project-a');
    expect(session.getSessionName()).toBe('Automation: Daily report');

    session.appendMessage({ role: 'assistant', content: 'hello' } as never);
    const persisted = readFileSync(ensured.threadSessionFile as string, 'utf-8');
    expect(persisted.match(/"type":"session"/g) ?? []).toHaveLength(1);
    expect(persisted.match(/"type":"session_info"/g) ?? []).toHaveLength(1);
  });

  it('uses the neutral Chat workspace for dedicated automation threads without an explicit cwd', () => {
    const stateRoot = createTempDir('pa-automation-thread-state-');
    const dbPath = join(stateRoot, 'runtime.db');
    const task = createStoredAutomation({
      dbPath,
      profile: 'assistant',
      title: 'Morning check-in',
      cron: '0 9 * * *',
      prompt: 'Start the morning check-in.',
    });

    const ensured = ensureAutomationThread(task.id, { dbPath, stateRoot });

    const session = SessionManager.open(ensured.threadSessionFile as string);
    expect(session.getCwd()).toBe(join(stateRoot, 'pi-agent-runtime', 'chat-workspaces', 'assistant'));
    expect(existsSync(session.getCwd())).toBe(true);
  });

  it('keeps existing-thread bindings intact when the session exists', () => {
    const stateRoot = createTempDir('pa-automation-thread-state-');
    const dbPath = join(stateRoot, 'runtime.db');
    const existingSession = SessionManager.create('/tmp/project-b', join(stateRoot, 'sync', 'pi-agent', 'sessions'));
    existingSession.appendSessionInfo('Release thread');
    (existingSession as unknown as { _rewriteFile?: () => void })._rewriteFile?.();
    const existingSessionFile = existingSession.getSessionFile() as string;
    const existingConversationId = existingSession.getSessionId();

    const task = createStoredAutomation({
      dbPath,
      profile: 'assistant',
      title: 'Release watcher',
      cron: '*/5 * * * *',
      cwd: '/tmp/project-b',
      prompt: 'Watch the release.',
    });

    setStoredAutomationThreadBinding(task.id, {
      dbPath,
      mode: 'existing',
      conversationId: existingConversationId,
      sessionFile: existingSessionFile,
    });

    const ensured = ensureAutomationThread(task.id, { dbPath, stateRoot });

    expect(ensured.threadMode).toBe('existing');
    expect(ensured.threadConversationId).toBe(existingConversationId);
    expect(ensured.threadSessionFile).toBe(existingSessionFile);
  });
});

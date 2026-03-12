import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearSessionCaches, listSessions, readSessionBlocks } from './sessions.js';

const originalEnv = process.env;
const tempDirs: string[] = [];

function createTempSessionsDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pa-web-sessions-'));
  tempDirs.push(dir);
  return dir;
}

function sessionIndexPathFor(sessionsDir: string): string {
  return join(dirname(sessionsDir), `${basename(sessionsDir)}-session-meta-index.json`);
}

function configureSessionEnv(sessionsDir: string): string {
  const indexFile = sessionIndexPathFor(sessionsDir);
  process.env.PA_SESSIONS_DIR = sessionsDir;
  process.env.PA_SESSIONS_INDEX_FILE = indexFile;
  return indexFile;
}

function writeSessionFile(options: {
  sessionsDir: string;
  cwdSlug?: string | null;
  fileName?: string;
  sessionId: string;
  timestamp?: string;
  cwd?: string;
  modelId?: string;
  title?: string;
  assistantTexts?: string[];
  sessionName?: string;
}): string {
  const cwdSlug = options.cwdSlug ?? '--tmp-project--';
  const fileName = options.fileName ?? `2026-03-11T12-00-00-000Z_${options.sessionId}.jsonl`;
  const dir = cwdSlug ? join(options.sessionsDir, cwdSlug) : options.sessionsDir;
  mkdirSync(dir, { recursive: true });

  const timestamp = options.timestamp ?? '2026-03-11T12:00:00.000Z';
  const cwd = options.cwd ?? '/tmp/project';
  const title = options.title ?? 'Initial title';
  const assistantTexts = options.assistantTexts ?? ['Assistant reply'];
  const lastAssistantId = assistantTexts.length > 0
    ? `${options.sessionId}-assistant-${assistantTexts.length}`
    : `${options.sessionId}-user-1`;

  const lines = [
    JSON.stringify({ type: 'session', id: options.sessionId, timestamp, cwd }),
    JSON.stringify({ type: 'model_change', modelId: options.modelId ?? 'test-model' }),
    JSON.stringify({
      type: 'message',
      id: `${options.sessionId}-user-1`,
      parentId: null,
      timestamp,
      message: { role: 'user', content: title },
    }),
    ...assistantTexts.map((text, index) => JSON.stringify({
      type: 'message',
      id: `${options.sessionId}-assistant-${index + 1}`,
      parentId: index === 0 ? `${options.sessionId}-user-1` : `${options.sessionId}-assistant-${index}`,
      timestamp: `2026-03-11T12:00:0${index + 1}.000Z`,
      message: {
        role: 'assistant',
        content: [{ type: 'text', text }],
      },
    })),
    ...(options.sessionName
      ? [JSON.stringify({
          type: 'session_info',
          id: `${options.sessionId}-session-info`,
          parentId: lastAssistantId,
          timestamp: '2026-03-11T12:00:59.000Z',
          name: options.sessionName,
        })]
      : []),
  ];

  const filePath = join(dir, fileName);
  writeFileSync(filePath, lines.join('\n') + '\n');
  return filePath;
}

beforeEach(() => {
  process.env = { ...originalEnv };
  clearSessionCaches();
});

afterEach(() => {
  clearSessionCaches();
  process.env = originalEnv;
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('sessions', () => {
  it('reads a session directly even before the session list was built', () => {
    const sessionsDir = createTempSessionsDir();
    configureSessionEnv(sessionsDir);

    writeSessionFile({
      sessionsDir,
      sessionId: 'session-0',
      title: 'Direct open',
      assistantTexts: ['Loaded without listing first'],
    });

    const detail = readSessionBlocks('session-0');
    expect(detail).not.toBeNull();
    expect(detail?.meta).toEqual(expect.objectContaining({
      id: 'session-0',
      title: 'Direct open',
    }));
    expect(detail?.blocks.filter((block) => block.type === 'text').map((block) => block.text)).toEqual([
      'Loaded without listing first',
    ]);
  });

  it('prefers a persisted session display name over the first user message fallback', () => {
    const sessionsDir = createTempSessionsDir();
    configureSessionEnv(sessionsDir);

    writeSessionFile({
      sessionsDir,
      sessionId: 'session-named',
      title: 'Fallback first user prompt',
      assistantTexts: ['Generated answer'],
      sessionName: 'Generated conversation title',
    });

    expect(listSessions()[0]).toEqual(expect.objectContaining({
      id: 'session-named',
      title: 'Generated conversation title',
      messageCount: 2,
    }));
    expect(readSessionBlocks('session-named')?.meta.title).toBe('Generated conversation title');
  });

  it('writes a persistent session index and reuses it after cache clear', () => {
    const sessionsDir = createTempSessionsDir();
    const indexFile = configureSessionEnv(sessionsDir);

    const filePath = writeSessionFile({
      sessionsDir,
      sessionId: 'session-persist',
      title: 'Persistent title',
      assistantTexts: ['Persisted reply'],
    });

    const first = listSessions();
    expect(first[0]?.title).toBe('Persistent title');
    expect(existsSync(indexFile)).toBe(true);
    expect(readFileSync(indexFile, 'utf-8')).toContain('session-persist');

    clearSessionCaches();

    chmodSync(filePath, 0o000);
    try {
      const second = listSessions();
      expect(second).toHaveLength(1);
      expect(second[0]).toEqual(expect.objectContaining({
        id: 'session-persist',
        title: 'Persistent title',
        messageCount: 2,
      }));
    } finally {
      chmodSync(filePath, 0o644);
    }
  });

  it('refreshes cached session metadata when the file changes', () => {
    const sessionsDir = createTempSessionsDir();
    configureSessionEnv(sessionsDir);

    writeSessionFile({
      sessionsDir,
      sessionId: 'session-1',
      title: 'Original title',
      assistantTexts: ['First reply'],
    });

    const first = listSessions();
    expect(first).toHaveLength(1);
    expect(first[0]).toEqual(expect.objectContaining({
      id: 'session-1',
      title: 'Original title',
      messageCount: 2,
      model: 'test-model',
    }));

    writeSessionFile({
      sessionsDir,
      sessionId: 'session-1',
      title: 'Updated title that is definitely different',
      assistantTexts: ['First reply', 'Second reply with extra text'],
    });

    const second = listSessions();
    expect(second).toHaveLength(1);
    expect(second[0]).toEqual(expect.objectContaining({
      id: 'session-1',
      title: 'Updated title that is definitely different',
      messageCount: 3,
    }));
  });

  it('lists sessions stored directly in the sessions root after restart', () => {
    const sessionsDir = createTempSessionsDir();
    configureSessionEnv(sessionsDir);

    writeSessionFile({
      sessionsDir,
      cwdSlug: null,
      sessionId: 'session-root',
      title: 'Root-level session',
      assistantTexts: ['Root reply'],
    });

    expect(listSessions()).toEqual([
      expect.objectContaining({
        id: 'session-root',
        title: 'Root-level session',
        cwd: '/tmp/project',
      }),
    ]);

    clearSessionCaches();

    expect(listSessions()).toEqual([
      expect.objectContaining({
        id: 'session-root',
        title: 'Root-level session',
      }),
    ]);
    expect(readSessionBlocks('session-root')?.blocks.filter((block) => block.type === 'text').map((block) => block.text)).toEqual([
      'Root reply',
    ]);
  });

  it('refreshes persisted metadata after a restart when the file changes', () => {
    const sessionsDir = createTempSessionsDir();
    const indexFile = configureSessionEnv(sessionsDir);

    writeSessionFile({
      sessionsDir,
      sessionId: 'session-restart',
      title: 'Before restart',
      assistantTexts: ['Old reply'],
    });

    expect(listSessions()[0]?.title).toBe('Before restart');
    expect(existsSync(indexFile)).toBe(true);

    clearSessionCaches();

    writeSessionFile({
      sessionsDir,
      sessionId: 'session-restart',
      title: 'After restart',
      assistantTexts: ['Old reply', 'Newest reply'],
    });

    const afterRestart = listSessions();
    expect(afterRestart[0]).toEqual(expect.objectContaining({
      id: 'session-restart',
      title: 'After restart',
      messageCount: 3,
    }));
  });

  it('reads the latest session blocks even when metadata was cached earlier', () => {
    const sessionsDir = createTempSessionsDir();
    configureSessionEnv(sessionsDir);

    writeSessionFile({
      sessionsDir,
      sessionId: 'session-2',
      title: 'Before update',
      assistantTexts: ['Old reply'],
    });

    const listed = listSessions();
    expect(listed[0]?.title).toBe('Before update');

    writeSessionFile({
      sessionsDir,
      sessionId: 'session-2',
      title: 'After update',
      assistantTexts: ['Old reply', 'Newest reply'],
    });

    const detail = readSessionBlocks('session-2');
    expect(detail).not.toBeNull();
    expect(detail?.meta.title).toBe('After update');
    expect(detail?.blocks.filter((block) => block.type === 'text').map((block) => block.text)).toEqual([
      'Old reply',
      'Newest reply',
    ]);
  });

  it('removes deleted session files from the cache and persistent index', () => {
    const sessionsDir = createTempSessionsDir();
    const indexFile = configureSessionEnv(sessionsDir);

    const filePath = writeSessionFile({
      sessionsDir,
      sessionId: 'session-3',
      title: 'To be deleted',
    });

    expect(listSessions()).toHaveLength(1);

    unlinkSync(filePath);

    expect(listSessions()).toEqual([]);
    expect(readSessionBlocks('session-3')).toBeNull();
    expect(readFileSync(indexFile, 'utf-8')).toContain('"entries":[]');
  });
});

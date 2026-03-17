import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildDisplayBlocksFromEntries, clearSessionCaches, listSessions, readSessionBlock, readSessionBlocks, readSessionTree, renameStoredSession } from './sessions.js';

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

  it('can load only the newest tail of conversation blocks for large archived transcripts', () => {
    const sessionsDir = createTempSessionsDir();
    configureSessionEnv(sessionsDir);

    writeSessionFile({
      sessionsDir,
      sessionId: 'session-tail',
      title: 'Tail block test',
      assistantTexts: ['Reply 1', 'Reply 2', 'Reply 3', 'Reply 4'],
    });

    const detail = readSessionBlocks('session-tail', { tailBlocks: 2 });
    expect(detail).not.toBeNull();
    expect(detail?.totalBlocks).toBe(5);
    expect(detail?.blockOffset).toBe(3);
    expect(detail?.blocks.map((block) => block.type === 'text' ? block.text : block.type)).toEqual([
      'Reply 3',
      'Reply 4',
    ]);
  });

  it('defers heavy tool output and image payloads in partial archived transcript loads', () => {
    const sessionsDir = createTempSessionsDir();
    configureSessionEnv(sessionsDir);

    const sessionId = 'session-heavy';
    const cwdSlug = '--tmp-project--';
    const dir = join(sessionsDir, cwdSlug);
    mkdirSync(dir, { recursive: true });
    const filePath = join(dir, `2026-03-11T12-00-00-000Z_${sessionId}.jsonl`);

    const lines: string[] = [
      JSON.stringify({ type: 'session', id: sessionId, timestamp: '2026-03-11T12:00:00.000Z', cwd: '/tmp/project', version: 3 }),
      JSON.stringify({ type: 'model_change', id: 'm1', parentId: null, timestamp: '2026-03-11T12:00:00.100Z', modelId: 'test-model' }),
      JSON.stringify({ type: 'message', id: 'u1', parentId: 'm1', timestamp: '2026-03-11T12:00:01.000Z', message: { role: 'user', content: [{ type: 'text', text: 'warmup' }] } }),
      JSON.stringify({ type: 'message', id: 'a1', parentId: 'u1', timestamp: '2026-03-11T12:00:02.000Z', message: { role: 'assistant', content: [{ type: 'text', text: 'ack' }] } }),
      JSON.stringify({
        type: 'message',
        id: 'u2',
        parentId: 'a1',
        timestamp: '2026-03-11T12:00:03.000Z',
        message: {
          role: 'user',
          content: [
            { type: 'text', text: 'inspect this screenshot' },
            { type: 'image', data: 'QUJDRA==', mimeType: 'image/png', name: 'diagram.png' },
          ],
        },
      }),
      JSON.stringify({
        type: 'message',
        id: 'a2',
        parentId: 'u2',
        timestamp: '2026-03-11T12:00:04.000Z',
        message: {
          role: 'assistant',
          content: [{ type: 'toolCall', id: 'tool-1', name: 'bash', arguments: { command: 'printf heavy' } }],
        },
      }),
      JSON.stringify({
        type: 'message',
        id: 't1',
        parentId: 'a2',
        timestamp: '2026-03-11T12:00:05.000Z',
        message: {
          role: 'toolResult',
          toolCallId: 'tool-1',
          toolName: 'bash',
          content: [
            { type: 'text', text: 'x'.repeat(1200) },
            { type: 'image', data: 'RUZHSA==', mimeType: 'image/png' },
          ],
        },
      }),
      JSON.stringify({ type: 'message', id: 'a3', parentId: 't1', timestamp: '2026-03-11T12:00:06.000Z', message: { role: 'assistant', content: [{ type: 'text', text: 'continuing' }] } }),
    ];

    let parentId = 'a3';
    for (let index = 0; index < 45; index += 1) {
      const userId = `u${index + 10}`;
      const assistantId = `a${index + 10}`;
      lines.push(JSON.stringify({
        type: 'message',
        id: userId,
        parentId,
        timestamp: `2026-03-11T12:01:${String(index).padStart(2, '0')}.000Z`,
        message: { role: 'user', content: [{ type: 'text', text: `follow-up ${index}` }] },
      }));
      lines.push(JSON.stringify({
        type: 'message',
        id: assistantId,
        parentId: userId,
        timestamp: `2026-03-11T12:02:${String(index).padStart(2, '0')}.000Z`,
        message: { role: 'assistant', content: [{ type: 'text', text: `answer ${index}` }] },
      }));
      parentId = assistantId;
    }

    writeFileSync(filePath, lines.join('\n') + '\n');

    const detail = readSessionBlocks(sessionId, { tailBlocks: 95 });
    expect(detail).not.toBeNull();
    expect(detail?.blockOffset).toBeGreaterThan(0);

    const userBlock = detail?.blocks.find((block) => block.type === 'user' && block.id === 'u2');
    expect(userBlock).toEqual(expect.objectContaining({ type: 'user' }));
    expect(userBlock && 'images' in userBlock ? userBlock.images?.[0] : undefined).toEqual(expect.objectContaining({ deferred: true, src: undefined }));

    const toolBlock = detail?.blocks.find((block) => block.type === 'tool_use');
    expect(toolBlock).toEqual(expect.objectContaining({ type: 'tool_use', outputDeferred: true }));
    expect(toolBlock && 'output' in toolBlock ? toolBlock.output.endsWith('…') : false).toBe(true);

    const imageBlock = detail?.blocks.find((block) => block.type === 'image');
    expect(imageBlock).toEqual(expect.objectContaining({ type: 'image', deferred: true, src: undefined }));

    const hydratedToolBlock = toolBlock ? readSessionBlock(sessionId, toolBlock.id) : null;
    expect(hydratedToolBlock).toEqual(expect.objectContaining({ type: 'tool_use' }));
    expect(hydratedToolBlock && 'outputDeferred' in hydratedToolBlock ? hydratedToolBlock.outputDeferred : undefined).toBeUndefined();
    expect(hydratedToolBlock && 'output' in hydratedToolBlock ? hydratedToolBlock.output.length : 0).toBe(1200);

    const hydratedUserBlock = readSessionBlock(sessionId, 'u2');
    expect(hydratedUserBlock).toEqual(expect.objectContaining({ type: 'user' }));
    expect(hydratedUserBlock && 'images' in hydratedUserBlock ? hydratedUserBlock.images?.[0]?.src : undefined).toContain('data:image/png;base64,');
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

  it('renames a stored conversation by appending session metadata', () => {
    const sessionsDir = createTempSessionsDir();
    configureSessionEnv(sessionsDir);

    const filePath = writeSessionFile({
      sessionsDir,
      sessionId: 'session-rename',
      title: 'Fallback first prompt',
      assistantTexts: ['Generated answer'],
    });

    expect(renameStoredSession('session-rename', '  Better manual title  ')).toEqual(expect.objectContaining({
      id: 'session-rename',
      title: 'Better manual title',
    }));
    expect(listSessions()[0]).toEqual(expect.objectContaining({
      id: 'session-rename',
      title: 'Better manual title',
      messageCount: 2,
    }));
    expect(readSessionBlocks('session-rename')?.meta.title).toBe('Better manual title');
    expect(readFileSync(filePath, 'utf-8')).toContain('"name":"Better manual title"');
  });

  it('lets the latest manual rename win over earlier session names', () => {
    const sessionsDir = createTempSessionsDir();
    configureSessionEnv(sessionsDir);

    writeSessionFile({
      sessionsDir,
      sessionId: 'session-renamed-twice',
      title: 'Fallback first prompt',
      assistantTexts: ['Generated answer'],
      sessionName: 'Original generated title',
    });

    renameStoredSession('session-renamed-twice', 'Updated manual title');

    expect(listSessions()[0]).toEqual(expect.objectContaining({
      id: 'session-renamed-twice',
      title: 'Updated manual title',
    }));
    expect(readSessionBlocks('session-renamed-twice')?.meta.title).toBe('Updated manual title');
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

  it('shows the latest compaction summary and only the kept transcript tail', () => {
    const sessionsDir = createTempSessionsDir();
    configureSessionEnv(sessionsDir);

    const dir = join(sessionsDir, '--tmp-project--');
    mkdirSync(dir, { recursive: true });
    const filePath = join(dir, '2026-03-11T12-00-00-000Z_session-compact.jsonl');
    writeFileSync(filePath, [
      JSON.stringify({ type: 'session', version: 3, id: 'session-compact', timestamp: '2026-03-11T12:00:00.000Z', cwd: '/tmp/project' }),
      JSON.stringify({ type: 'model_change', id: 'session-compact-model', parentId: null, timestamp: '2026-03-11T12:00:00.000Z', modelId: 'test-model' }),
      JSON.stringify({
        type: 'message',
        id: 'session-compact-user-1',
        parentId: null,
        timestamp: '2026-03-11T12:00:00.000Z',
        message: { role: 'user', content: 'Before compaction' },
      }),
      JSON.stringify({
        type: 'message',
        id: 'session-compact-assistant-1',
        parentId: 'session-compact-user-1',
        timestamp: '2026-03-11T12:00:01.000Z',
        message: { role: 'assistant', content: [{ type: 'text', text: 'Older reply' }] },
      }),
      JSON.stringify({
        type: 'message',
        id: 'session-compact-user-2',
        parentId: 'session-compact-assistant-1',
        timestamp: '2026-03-11T12:00:02.000Z',
        message: { role: 'user', content: 'Keep this prompt' },
      }),
      JSON.stringify({
        type: 'message',
        id: 'session-compact-assistant-2',
        parentId: 'session-compact-user-2',
        timestamp: '2026-03-11T12:00:03.000Z',
        message: { role: 'assistant', content: [{ type: 'text', text: 'Keep this reply' }] },
      }),
      JSON.stringify({
        type: 'compaction',
        id: 'session-compact-compaction-1',
        parentId: 'session-compact-assistant-2',
        timestamp: '2026-03-11T12:00:04.000Z',
        summary: '## Goal\nKeep only the latest summary.\n\n## Progress\n- Preserved the recent turn.',
        firstKeptEntryId: 'session-compact-user-2',
        tokensBefore: 1234,
      }),
      JSON.stringify({
        type: 'message',
        id: 'session-compact-user-3',
        parentId: 'session-compact-compaction-1',
        timestamp: '2026-03-11T12:00:05.000Z',
        message: { role: 'user', content: 'Continue after compaction' },
      }),
      JSON.stringify({
        type: 'message',
        id: 'session-compact-assistant-3',
        parentId: 'session-compact-user-3',
        timestamp: '2026-03-11T12:00:06.000Z',
        message: { role: 'assistant', content: [{ type: 'text', text: 'Newest reply' }] },
      }),
    ].join('\n') + '\n');

    const detail = readSessionBlocks('session-compact');
    expect(detail?.blocks).toEqual([
      {
        type: 'user',
        id: 'session-compact-user-1',
        ts: '2026-03-11T12:00:00.000Z',
        text: 'Before compaction',
      },
      {
        type: 'text',
        id: 'session-compact-assistant-1-x1',
        ts: '2026-03-11T12:00:01.000Z',
        text: 'Older reply',
      },
      {
        type: 'user',
        id: 'session-compact-user-2',
        ts: '2026-03-11T12:00:02.000Z',
        text: 'Keep this prompt',
      },
      {
        type: 'text',
        id: 'session-compact-assistant-2-x3',
        ts: '2026-03-11T12:00:03.000Z',
        text: 'Keep this reply',
      },
      {
        type: 'summary',
        id: 'session-compact-compaction-1',
        ts: '2026-03-11T12:00:04.000Z',
        kind: 'compaction',
        title: 'Compaction summary',
        text: '## Goal\nKeep only the latest summary.\n\n## Progress\n- Preserved the recent turn.',
      },
      {
        type: 'user',
        id: 'session-compact-user-3',
        ts: '2026-03-11T12:00:05.000Z',
        text: 'Continue after compaction',
      },
      {
        type: 'text',
        id: 'session-compact-assistant-3-x6',
        ts: '2026-03-11T12:00:06.000Z',
        text: 'Newest reply',
      },
    ]);
  });

  it('builds a tree snapshot that includes inactive branches with no jump target', () => {
    const sessionsDir = createTempSessionsDir();
    configureSessionEnv(sessionsDir);

    const dir = join(sessionsDir, '--tmp-project--');
    mkdirSync(dir, { recursive: true });
    const filePath = join(dir, '2026-03-11T12-30-00-000Z_session-tree.jsonl');
    writeFileSync(filePath, [
      JSON.stringify({ type: 'session', version: 3, id: 'session-tree', timestamp: '2026-03-11T12:30:00.000Z', cwd: '/tmp/project' }),
      JSON.stringify({ type: 'model_change', id: 'session-tree-model', parentId: null, timestamp: '2026-03-11T12:30:00.000Z', modelId: 'test-model' }),
      JSON.stringify({
        type: 'message',
        id: 'tree-user-1',
        parentId: null,
        timestamp: '2026-03-11T12:30:00.000Z',
        message: { role: 'user', content: 'Start here' },
      }),
      JSON.stringify({
        type: 'message',
        id: 'tree-assistant-1',
        parentId: 'tree-user-1',
        timestamp: '2026-03-11T12:30:01.000Z',
        message: { role: 'assistant', content: [{ type: 'text', text: 'Choose a direction' }] },
      }),
      JSON.stringify({
        type: 'message',
        id: 'tree-user-branch-a',
        parentId: 'tree-assistant-1',
        timestamp: '2026-03-11T12:30:02.000Z',
        message: { role: 'user', content: 'Take branch A' },
      }),
      JSON.stringify({
        type: 'message',
        id: 'tree-assistant-branch-a',
        parentId: 'tree-user-branch-a',
        timestamp: '2026-03-11T12:30:03.000Z',
        message: { role: 'assistant', content: [{ type: 'text', text: 'Branch A answer' }] },
      }),
      JSON.stringify({
        type: 'message',
        id: 'tree-user-branch-b',
        parentId: 'tree-assistant-1',
        timestamp: '2026-03-11T12:30:04.000Z',
        message: { role: 'user', content: 'Take branch B' },
      }),
      JSON.stringify({
        type: 'message',
        id: 'tree-assistant-branch-b',
        parentId: 'tree-user-branch-b',
        timestamp: '2026-03-11T12:30:05.000Z',
        message: { role: 'assistant', content: [{ type: 'text', text: 'Branch B answer' }] },
      }),
    ].join('\n') + '\n');

    const detail = readSessionBlocks('session-tree');
    expect(detail?.blocks.map((block) => block.id)).toEqual([
      'tree-user-1',
      'tree-assistant-1-x1',
      'tree-user-branch-b',
      'tree-assistant-branch-b-x3',
    ]);

    const tree = readSessionTree('session-tree');
    expect(tree?.leafId).toBe('tree-assistant-branch-b');
    expect(tree?.roots).toEqual([
      {
        id: 'tree-user-1',
        kind: 'user',
        label: 'user',
        preview: 'Start here',
        ts: '2026-03-11T12:30:00.000Z',
        blockIndex: 0,
        active: false,
        onActivePath: true,
        children: [
          {
            id: 'tree-assistant-1',
            kind: 'assistant',
            label: 'asst',
            preview: 'Choose a direction',
            ts: '2026-03-11T12:30:01.000Z',
            blockIndex: 1,
            active: false,
            onActivePath: true,
            children: [
              {
                id: 'tree-user-branch-a',
                kind: 'user',
                label: 'user',
                preview: 'Take branch A',
                ts: '2026-03-11T12:30:02.000Z',
                blockIndex: null,
                active: false,
                onActivePath: false,
                children: [
                  {
                    id: 'tree-assistant-branch-a',
                    kind: 'assistant',
                    label: 'asst',
                    preview: 'Branch A answer',
                    ts: '2026-03-11T12:30:03.000Z',
                    blockIndex: null,
                    active: false,
                    onActivePath: false,
                    children: [],
                  },
                ],
              },
              {
                id: 'tree-user-branch-b',
                kind: 'user',
                label: 'user',
                preview: 'Take branch B',
                ts: '2026-03-11T12:30:04.000Z',
                blockIndex: 2,
                active: false,
                onActivePath: true,
                children: [
                  {
                    id: 'tree-assistant-branch-b',
                    kind: 'assistant',
                    label: 'asst',
                    preview: 'Branch B answer',
                    ts: '2026-03-11T12:30:05.000Z',
                    blockIndex: 3,
                    active: true,
                    onActivePath: true,
                    children: [],
                  },
                ],
              },
            ],
          },
        ],
      },
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

  it('preserves tool result details on parsed tool blocks', () => {
    const blocks = buildDisplayBlocksFromEntries([
      {
        id: 'assistant-1',
        timestamp: '2026-03-12T16:00:00.000Z',
        message: {
          role: 'assistant',
          content: [{ type: 'toolCall', id: 'tool-1', name: 'artifact', arguments: { action: 'save', title: 'Counter demo', kind: 'html' } }],
        },
      },
      {
        id: 'tool-result-1',
        timestamp: '2026-03-12T16:00:01.000Z',
        message: {
          role: 'toolResult',
          toolCallId: 'tool-1',
          toolName: 'artifact',
          content: [{ type: 'text', text: 'Saved artifact counter-demo [html] "Counter demo".' }],
          details: {
            action: 'save',
            conversationId: 'conv-123',
            artifactId: 'counter-demo',
            title: 'Counter demo',
            kind: 'html',
            revision: 1,
            openRequested: true,
          },
        },
      },
    ]);

    expect(blocks).toEqual([
      expect.objectContaining({
        type: 'tool_use',
        tool: 'artifact',
        output: 'Saved artifact counter-demo [html] "Counter demo".',
        details: expect.objectContaining({
          artifactId: 'counter-demo',
          revision: 1,
          openRequested: true,
        }),
      }),
    ]);
  });

  it('surfaces assistant error messages as error blocks', () => {
    const blocks = buildDisplayBlocksFromEntries([
      {
        id: 'assistant-error',
        timestamp: '2026-03-12T16:05:00.000Z',
        message: {
          role: 'assistant',
          content: [{ type: 'thinking', thinking: 'Checking the provider response…' }],
          stopReason: 'error',
          errorMessage: 'Codex error: upstream overloaded',
        },
      },
    ]);

    expect(blocks).toEqual([
      {
        type: 'thinking',
        id: 'assistant-error-t0',
        ts: '2026-03-12T16:05:00.000Z',
        text: 'Checking the provider response…',
      },
      {
        type: 'error',
        id: 'assistant-error-e1',
        ts: '2026-03-12T16:05:00.000Z',
        message: 'Codex error: upstream overloaded',
      },
    ]);
  });
});

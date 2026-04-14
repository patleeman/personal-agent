import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildAppendOnlySessionDetailResponse, buildDisplayBlocksFromEntries, clearSessionCaches, listSessions, readSessionBlock, readSessionBlocks, readSessionBlocksWithTelemetry, readSessionImageAsset, renameStoredSession } from './sessions.js';

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
  parentSession?: string;
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
    JSON.stringify({
      type: 'session',
      id: options.sessionId,
      timestamp,
      cwd,
      ...(options.parentSession ? { parentSession: options.parentSession } : {}),
    }),
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

  it('builds append-only transcript responses when a cached tail window only needs new blocks', () => {
    const detail = {
      meta: {
        id: 'session-append-only',
        file: '/tmp/session-append-only.jsonl',
        timestamp: '2026-03-11T12:00:00.000Z',
        cwd: '/tmp/project',
        cwdSlug: '--tmp-project--',
        model: 'test-model',
        title: 'Append only',
        messageCount: 6,
      },
      blocks: [
        { type: 'text' as const, id: 'assistant-2', ts: '2026-03-11T12:00:02.000Z', text: 'Reply 2' },
        { type: 'text' as const, id: 'assistant-3', ts: '2026-03-11T12:00:03.000Z', text: 'Reply 3' },
        { type: 'text' as const, id: 'assistant-4', ts: '2026-03-11T12:00:04.000Z', text: 'Reply 4' },
      ],
      blockOffset: 3,
      totalBlocks: 6,
      contextUsage: null,
      signature: 'sig-2',
    };

    expect(buildAppendOnlySessionDetailResponse({
      detail,
      knownBlockOffset: 2,
      knownTotalBlocks: 5,
      knownLastBlockId: 'assistant-3',
    })).toEqual({
      appendOnly: true,
      meta: detail.meta,
      blocks: [{ type: 'text', id: 'assistant-4', ts: '2026-03-11T12:00:04.000Z', text: 'Reply 4' }],
      blockOffset: 3,
      totalBlocks: 6,
      contextUsage: null,
      signature: 'sig-2',
    });
  });

  it('refuses append-only transcript reuse when the cached tail no longer matches the current branch', () => {
    const detail = {
      meta: {
        id: 'session-append-mismatch',
        file: '/tmp/session-append-mismatch.jsonl',
        timestamp: '2026-03-11T12:00:00.000Z',
        cwd: '/tmp/project',
        cwdSlug: '--tmp-project--',
        model: 'test-model',
        title: 'Append mismatch',
        messageCount: 6,
      },
      blocks: [
        { type: 'text' as const, id: 'assistant-2', ts: '2026-03-11T12:00:02.000Z', text: 'Reply 2' },
        { type: 'text' as const, id: 'assistant-3b', ts: '2026-03-11T12:00:03.000Z', text: 'Forked reply' },
        { type: 'text' as const, id: 'assistant-4', ts: '2026-03-11T12:00:04.000Z', text: 'Reply 4' },
      ],
      blockOffset: 3,
      totalBlocks: 6,
      contextUsage: null,
      signature: 'sig-2',
    };

    expect(buildAppendOnlySessionDetailResponse({
      detail,
      knownBlockOffset: 2,
      knownTotalBlocks: 5,
      knownLastBlockId: 'assistant-3',
    })).toBeNull();
  });

  it('reports cache and loader telemetry for archived transcript tail reads', () => {
    const sessionsDir = createTempSessionsDir();
    configureSessionEnv(sessionsDir);

    writeSessionFile({
      sessionsDir,
      sessionId: 'session-telemetry',
      title: 'Telemetry test',
      assistantTexts: ['Reply 1', 'Reply 2', 'Reply 3'],
    });

    const firstRead = readSessionBlocksWithTelemetry('session-telemetry', { tailBlocks: 2 });
    expect(firstRead.detail?.blocks.map((block) => block.type === 'text' ? block.text : block.type)).toEqual([
      'Reply 2',
      'Reply 3',
    ]);
    expect(firstRead.telemetry).toMatchObject({
      cache: 'miss',
      loader: 'fast-tail',
      requestedTailBlocks: 2,
      totalBlocks: 4,
      blockOffset: 2,
      contextUsageIncluded: false,
    });
    expect(firstRead.telemetry?.durationMs).toBeGreaterThanOrEqual(0);

    const secondRead = readSessionBlocksWithTelemetry('session-telemetry', { tailBlocks: 2 });
    expect(secondRead.telemetry).toMatchObject({
      cache: 'hit',
      loader: 'fast-tail',
      requestedTailBlocks: 2,
      totalBlocks: 4,
      blockOffset: 2,
      contextUsageIncluded: false,
    });
    expect(secondRead.telemetry?.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('invalidates cached archived transcript detail when the session file changes', () => {
    const sessionsDir = createTempSessionsDir();
    configureSessionEnv(sessionsDir);

    writeSessionFile({
      sessionsDir,
      sessionId: 'session-cache',
      title: 'Cache invalidation test',
      assistantTexts: ['Reply 1'],
    });

    const initialDetail = readSessionBlocks('session-cache', { tailBlocks: 2 });
    expect(initialDetail?.blocks.map((block) => block.type === 'text' ? block.text : block.type)).toEqual([
      'user',
      'Reply 1',
    ]);
    expect(initialDetail?.signature).toMatch(/^\d+:\d+(?:\.\d+)?$/);

    writeSessionFile({
      sessionsDir,
      sessionId: 'session-cache',
      title: 'Cache invalidation test',
      assistantTexts: ['Reply 1', 'Reply 2'],
    });

    const detail = readSessionBlocks('session-cache', { tailBlocks: 2 });
    expect(detail?.signature).toMatch(/^\d+:\d+(?:\.\d+)?$/);
    expect(detail?.signature).not.toBe(initialDetail?.signature);
    expect(detail?.totalBlocks).toBe(3);
    expect(detail?.blockOffset).toBe(1);
    expect(detail?.blocks.map((block) => block.type === 'text' ? block.text : block.type)).toEqual([
      'Reply 1',
      'Reply 2',
    ]);
  });

  it('keeps exact tail counts when archived sessions include compaction summaries', () => {
    const sessionsDir = createTempSessionsDir();
    configureSessionEnv(sessionsDir);

    const dir = join(sessionsDir, '--tmp-project--');
    mkdirSync(dir, { recursive: true });
    const filePath = join(dir, '2026-03-11T12-00-00-000Z_session-tail-compaction.jsonl');
    writeFileSync(filePath, [
      JSON.stringify({ type: 'session', version: 3, id: 'session-tail-compaction', timestamp: '2026-03-11T12:00:00.000Z', cwd: '/tmp/project' }),
      JSON.stringify({ type: 'model_change', id: 'session-tail-compaction-model', parentId: null, timestamp: '2026-03-11T12:00:00.000Z', modelId: 'test-model' }),
      JSON.stringify({ type: 'message', id: 'c-user-1', parentId: null, timestamp: '2026-03-11T12:00:00.000Z', message: { role: 'user', content: 'Before compaction' } }),
      JSON.stringify({ type: 'message', id: 'c-assistant-1', parentId: 'c-user-1', timestamp: '2026-03-11T12:00:01.000Z', message: { role: 'assistant', content: [{ type: 'text', text: 'Older reply' }] } }),
      JSON.stringify({ type: 'message', id: 'c-user-2', parentId: 'c-assistant-1', timestamp: '2026-03-11T12:00:02.000Z', message: { role: 'user', content: 'Keep this prompt' } }),
      JSON.stringify({ type: 'message', id: 'c-assistant-2', parentId: 'c-user-2', timestamp: '2026-03-11T12:00:03.000Z', message: { role: 'assistant', content: [{ type: 'text', text: 'Keep this reply' }] } }),
      JSON.stringify({ type: 'compaction', id: 'c-compaction-1', parentId: 'c-assistant-2', timestamp: '2026-03-11T12:00:04.000Z', summary: 'Compacted.', firstKeptEntryId: 'c-user-2', tokensBefore: 1234 }),
      JSON.stringify({ type: 'message', id: 'c-user-3', parentId: 'c-compaction-1', timestamp: '2026-03-11T12:00:05.000Z', message: { role: 'user', content: 'Continue after compaction' } }),
      JSON.stringify({ type: 'message', id: 'c-assistant-3', parentId: 'c-user-3', timestamp: '2026-03-11T12:00:06.000Z', message: { role: 'assistant', content: [{ type: 'text', text: 'Newest reply' }] } }),
    ].join('\n') + '\n');

    const detail = readSessionBlocks('session-tail-compaction', { tailBlocks: 2 });
    expect(detail?.totalBlocks).toBe(7);
    expect(detail?.blockOffset).toBe(5);
    expect(detail?.blocks).toEqual([
      expect.objectContaining({ type: 'user', text: 'Continue after compaction' }),
      expect.objectContaining({ type: 'text', text: 'Newest reply' }),
    ]);
  });

  it('keeps hidden archived automation turns out of the visible tail', () => {
    const sessionsDir = createTempSessionsDir();
    configureSessionEnv(sessionsDir);

    const dir = join(sessionsDir, '--tmp-project--');
    mkdirSync(dir, { recursive: true });
    const filePath = join(dir, '2026-03-11T12-00-00-000Z_session-tail-hidden.jsonl');
    writeFileSync(filePath, [
      JSON.stringify({ type: 'session', version: 3, id: 'session-tail-hidden', timestamp: '2026-03-11T12:00:00.000Z', cwd: '/tmp/project' }),
      JSON.stringify({ type: 'model_change', id: 'session-tail-hidden-model', parentId: null, timestamp: '2026-03-11T12:00:00.000Z', modelId: 'test-model' }),
      JSON.stringify({ type: 'message', id: 'h-user-1', parentId: null, timestamp: '2026-03-11T12:00:00.000Z', message: { role: 'user', content: 'Visible prompt' } }),
      JSON.stringify({ type: 'message', id: 'h-assistant-1', parentId: 'h-user-1', timestamp: '2026-03-11T12:00:01.000Z', message: { role: 'assistant', content: [{ type: 'text', text: 'Visible answer' }] } }),
      JSON.stringify({ type: 'custom_message', id: 'h-hidden-1', parentId: 'h-assistant-1', timestamp: '2026-03-11T12:00:02.000Z', customType: 'conversation_automation_review', content: [{ type: 'text', text: 'Hidden bookkeeping prompt.' }], display: false }),
      JSON.stringify({ type: 'message', id: 'h-assistant-2', parentId: 'h-hidden-1', timestamp: '2026-03-11T12:00:03.000Z', message: { role: 'assistant', content: [{ type: 'text', text: 'Hidden assistant reply' }] } }),
      JSON.stringify({ type: 'message', id: 'h-tool-1', parentId: 'h-assistant-2', timestamp: '2026-03-11T12:00:04.000Z', message: { role: 'toolResult', toolCallId: 'call-1', toolName: 'bash', content: [{ type: 'text', text: 'ls' }] } }),
    ].join('\n') + '\n');

    const detail = readSessionBlocks('session-tail-hidden', { tailBlocks: 5 });
    expect(detail?.totalBlocks).toBe(2);
    expect(detail?.blockOffset).toBe(0);
    expect(detail?.blocks).toEqual([
      expect.objectContaining({ type: 'user', text: 'Visible prompt' }),
      expect.objectContaining({ type: 'text', text: 'Visible answer' }),
    ]);
  });

  it('keeps later user turns visible in archived tails after hidden automation turns', () => {
    const sessionsDir = createTempSessionsDir();
    configureSessionEnv(sessionsDir);

    const dir = join(sessionsDir, '--tmp-project--');
    mkdirSync(dir, { recursive: true });
    const filePath = join(dir, '2026-03-11T12-00-00-000Z_session-tail-user-after-hidden.jsonl');
    writeFileSync(filePath, [
      JSON.stringify({ type: 'session', version: 3, id: 'session-tail-user-after-hidden', timestamp: '2026-03-11T12:00:00.000Z', cwd: '/tmp/project' }),
      JSON.stringify({ type: 'model_change', id: 'uah-model', parentId: null, timestamp: '2026-03-11T12:00:00.000Z', modelId: 'test-model' }),
      JSON.stringify({ type: 'message', id: 'uah-user-1', parentId: 'uah-model', timestamp: '2026-03-11T12:00:01.000Z', message: { role: 'user', content: 'First prompt' } }),
      JSON.stringify({ type: 'message', id: 'uah-assistant-1', parentId: 'uah-user-1', timestamp: '2026-03-11T12:00:02.000Z', message: { role: 'assistant', content: [{ type: 'text', text: 'First answer' }] } }),
      JSON.stringify({ type: 'custom_message', id: 'uah-hidden-1', parentId: 'uah-assistant-1', timestamp: '2026-03-11T12:00:03.000Z', customType: 'conversation_automation_review', content: [{ type: 'text', text: 'Hidden bookkeeping prompt.' }], display: false }),
      JSON.stringify({ type: 'message', id: 'uah-assistant-2', parentId: 'uah-hidden-1', timestamp: '2026-03-11T12:00:04.000Z', message: { role: 'assistant', content: [{ type: 'text', text: 'Hidden automation reply' }] } }),
      JSON.stringify({ type: 'message', id: 'uah-tool-1', parentId: 'uah-assistant-2', timestamp: '2026-03-11T12:00:05.000Z', message: { role: 'toolResult', toolCallId: 'call-1', toolName: 'wait_for_user', content: [{ type: 'text', text: 'Waiting for user.' }] } }),
      JSON.stringify({ type: 'message', id: 'uah-assistant-3', parentId: 'uah-tool-1', timestamp: '2026-03-11T12:00:06.000Z', message: { role: 'assistant', content: [{ type: 'text', text: 'Still hidden automation summary.' }] } }),
      JSON.stringify({ type: 'message', id: 'uah-user-2', parentId: 'uah-assistant-3', timestamp: '2026-03-11T12:00:07.000Z', message: { role: 'user', content: 'Second prompt' } }),
      JSON.stringify({ type: 'message', id: 'uah-assistant-4', parentId: 'uah-user-2', timestamp: '2026-03-11T12:00:08.000Z', message: { role: 'assistant', content: [{ type: 'text', text: 'Second answer' }] } }),
    ].join('\n') + '\n');

    const detail = readSessionBlocks('session-tail-user-after-hidden', { tailBlocks: 400 });
    expect(detail?.totalBlocks).toBe(4);
    expect(detail?.blockOffset).toBe(0);
    expect(detail?.blocks).toEqual([
      expect.objectContaining({ type: 'user', text: 'First prompt' }),
      expect.objectContaining({ type: 'text', text: 'First answer' }),
      expect.objectContaining({ type: 'user', text: 'Second prompt' }),
      expect.objectContaining({ type: 'text', text: 'Second answer' }),
    ]);
  });

  it('keeps walking backward through non-display parent links when reading archived tails', () => {
    const sessionsDir = createTempSessionsDir();
    configureSessionEnv(sessionsDir);

    const dir = join(sessionsDir, '--tmp-project--');
    mkdirSync(dir, { recursive: true });
    const filePath = join(dir, '2026-03-11T12-00-00-000Z_session-tail-lineage.jsonl');
    writeFileSync(filePath, [
      JSON.stringify({ type: 'session', version: 3, id: 'session-tail-lineage', timestamp: '2026-03-11T12:00:00.000Z', cwd: '/tmp/project' }),
      JSON.stringify({ type: 'model_change', id: 'lineage-model', parentId: null, timestamp: '2026-03-11T12:00:00.000Z', modelId: 'test-model' }),
      JSON.stringify({ type: 'message', id: 'lineage-user-1', parentId: 'lineage-model', timestamp: '2026-03-11T12:00:01.000Z', message: { role: 'user', content: 'First prompt' } }),
      JSON.stringify({ type: 'message', id: 'lineage-assistant-1', parentId: 'lineage-user-1', timestamp: '2026-03-11T12:00:02.000Z', message: { role: 'assistant', content: [{ type: 'text', text: 'First answer' }] } }),
      JSON.stringify({ type: 'message', id: 'lineage-user-2', parentId: 'lineage-assistant-1', timestamp: '2026-03-11T12:00:03.000Z', message: { role: 'user', content: 'Second prompt' } }),
      JSON.stringify({ type: 'session_info', id: 'lineage-session-info', parentId: 'lineage-user-2', timestamp: '2026-03-11T12:00:04.000Z', name: 'Renamed session' }),
      JSON.stringify({ type: 'message', id: 'lineage-assistant-2', parentId: 'lineage-session-info', timestamp: '2026-03-11T12:00:05.000Z', message: { role: 'assistant', content: [{ type: 'text', text: 'Second answer' }] } }),
      JSON.stringify({ type: 'custom_message', id: 'lineage-hidden-1', parentId: 'lineage-assistant-2', timestamp: '2026-03-11T12:00:06.000Z', customType: 'conversation_automation_review', content: [{ type: 'text', text: 'Hidden bookkeeping prompt.' }], display: false }),
      JSON.stringify({ type: 'message', id: 'lineage-hidden-assistant-1', parentId: 'lineage-hidden-1', timestamp: '2026-03-11T12:00:07.000Z', message: { role: 'assistant', content: [{ type: 'text', text: 'Hidden assistant reply' }] } }),
    ].join('\n') + '\n');

    const detail = readSessionBlocks('session-tail-lineage', { tailBlocks: 400 });
    expect(detail?.totalBlocks).toBe(4);
    expect(detail?.blockOffset).toBe(0);
    expect(detail?.blocks).toEqual([
      expect.objectContaining({ type: 'user', text: 'First prompt' }),
      expect.objectContaining({ type: 'text', text: 'First answer' }),
      expect.objectContaining({ type: 'user', text: 'Second prompt' }),
      expect.objectContaining({ type: 'text', text: 'Second answer' }),
    ]);
  });

  it('serves persisted session images through routes instead of inline data urls', () => {
    const sessionsDir = createTempSessionsDir();
    configureSessionEnv(sessionsDir);

    const dir = join(sessionsDir, '--tmp-project--');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, '2026-03-11T12-00-00-000Z_session-images.jsonl'), [
      JSON.stringify({ type: 'session', id: 'session-images', timestamp: '2026-03-11T12:00:00.000Z', cwd: '/tmp/project' }),
      JSON.stringify({ type: 'model_change', modelId: 'test-model' }),
      JSON.stringify({
        type: 'message',
        id: 'session-images-user-1',
        parentId: null,
        timestamp: '2026-03-11T12:00:00.000Z',
        message: {
          role: 'user',
          content: [
            { type: 'text', text: 'Here is an image' },
            { type: 'image', data: 'aGVsbG8=', mimeType: 'image/png', name: 'hello.png' },
          ],
        },
      }),
      JSON.stringify({
        type: 'message',
        id: 'session-images-tool-1',
        parentId: 'session-images-user-1',
        timestamp: '2026-03-11T12:00:01.000Z',
        message: {
          role: 'toolResult',
          toolCallId: 'tool-1',
          toolName: 'render',
          content: [
            { type: 'image', data: 'aGVsbG8=', mimeType: 'image/png', name: 'result.png' },
          ],
        },
      }),
    ].join('\n') + '\n');

    const detail = readSessionBlocks('session-images');
    const userBlock = detail?.blocks.find((block) => block.type === 'user');
    const imageBlock = detail?.blocks.find((block) => block.type === 'image');
    expect(userBlock).toEqual(expect.objectContaining({
      type: 'user',
      images: [expect.objectContaining({ src: `/api/sessions/session-images/blocks/${userBlock?.id}/images/0` })],
    }));
    expect(imageBlock).toEqual(expect.objectContaining({
      type: 'image',
      src: `/api/sessions/session-images/blocks/${imageBlock?.id}/image`,
    }));

    expect(imageBlock ? readSessionBlock('session-images', imageBlock.id) : null).toEqual(expect.objectContaining({
      type: 'image',
      src: `/api/sessions/session-images/blocks/${imageBlock?.id}/image`,
    }));

    expect(userBlock ? readSessionImageAsset('session-images', userBlock.id, 0) : null).toEqual(expect.objectContaining({
      mimeType: 'image/png',
      fileName: 'hello.png',
      data: Buffer.from('aGVsbG8=', 'base64'),
    }));
    expect(imageBlock ? readSessionImageAsset('session-images', imageBlock.id) : null).toEqual(expect.objectContaining({
      mimeType: 'image/png',
      fileName: 'result.png',
      data: Buffer.from('aGVsbG8=', 'base64'),
    }));
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

    const userBlock = detail?.blocks.find((block) => block.type === 'user' && block.text === 'inspect this screenshot');
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

    const hydratedUserBlock = userBlock ? readSessionBlock(sessionId, userBlock.id) : null;
    expect(hydratedUserBlock).toEqual(expect.objectContaining({ type: 'user' }));
    expect(hydratedUserBlock && 'images' in hydratedUserBlock ? hydratedUserBlock.images?.[0]?.src : undefined)
      .toBe(`/api/sessions/${sessionId}/blocks/${userBlock?.id}/images/0`);
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

  it('renders visible custom message entries as transcript text blocks', () => {
    const sessionsDir = createTempSessionsDir();
    configureSessionEnv(sessionsDir);

    const dir = join(sessionsDir, '--tmp-project--');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, '2026-03-11T12-00-00-000Z_session-custom.jsonl'), [
      JSON.stringify({ type: 'session', id: 'session-custom', timestamp: '2026-03-11T12:00:00.000Z', cwd: '/tmp/project' }),
      JSON.stringify({ type: 'model_change', modelId: 'test-model' }),
      JSON.stringify({
        type: 'message',
        id: 'session-custom-user-1',
        parentId: null,
        timestamp: '2026-03-11T12:00:00.000Z',
        message: { role: 'user', content: [{ type: 'text', text: 'Investigate this result' }] },
      }),
      JSON.stringify({
        type: 'custom_message',
        id: 'session-custom-note-1',
        parentId: 'session-custom-user-1',
        timestamp: '2026-03-11T12:00:01.000Z',
        customType: 'note',
        content: [{ type: 'text', text: 'Imported summary note.' }],
        display: true,
      }),
    ].join('\n') + '\n');

    const detail = readSessionBlocks('session-custom');
    expect(detail?.meta.messageCount).toBe(2);
    expect(detail?.blocks.filter((block) => block.type === 'text').map((block) => block.text)).toContain('Imported summary note.');
  });

  it('keeps hidden custom context entries out of the visible transcript', () => {
    const blocks = buildDisplayBlocksFromEntries([
      {
        id: 'context-1',
        timestamp: '2026-03-12T16:00:00.000Z',
        message: {
          role: 'custom',
          customType: 'referenced_context',
          display: false,
          content: [{ type: 'text', text: 'Conversation automation context:\n- Review the agent reminders.' }],
        },
      },
    ]);

    expect(blocks).toEqual([]);
  });

  it('renders hidden related thread context as a visible summary event', () => {
    const blocks = buildDisplayBlocksFromEntries([
      {
        id: 'related-1',
        timestamp: '2026-03-12T16:00:00.000Z',
        message: {
          role: 'custom',
          customType: 'related_threads_context',
          display: false,
          content: [{
            type: 'text',
            text: [
              'The user explicitly selected previous conversations to reuse as background context for the next prompt.',
              'Use only the parts that still help. Prefer the current prompt and current repo state over stale historical details.',
              '',
              'Conversation 1 — Release signing',
              'Workspace: /repo/a',
              'Created: 2026-04-10T10:00:00.000Z',
              '',
              'Keep the notarization mapping fix.',
              '',
              'Conversation 2 — Auto mode wakeups',
              'Workspace: /repo/b',
              'Created: 2026-04-11T10:00:00.000Z',
              '',
              'Wakeups use durable run callbacks.',
            ].join('\n'),
          }],
        },
      },
    ]);

    expect(blocks).toEqual([
      expect.objectContaining({
        type: 'summary',
        kind: 'related',
        title: 'Reused thread summaries',
        detail: '2 selected conversations were summarized and injected before this prompt so this thread could start with reused context.',
      }),
    ]);
    expect(blocks[0]).toMatchObject({
      text: expect.stringContaining('### Conversation 1 — Release signing'),
    });
    expect((blocks[0] as Extract<(typeof blocks)[number], { type: 'summary' }>).text).toContain('- Workspace: `/repo/a`');
    expect((blocks[0] as Extract<(typeof blocks)[number], { type: 'summary' }>).text).toContain('Wakeups use durable run callbacks.');
  });

  it('keeps assistant replies from generic hidden custom turns out of the visible transcript', () => {
    const blocks = buildDisplayBlocksFromEntries([
      {
        id: 'user-1',
        timestamp: '2026-03-12T16:00:00.000Z',
        message: {
          role: 'user',
          content: [{ type: 'text', text: 'Create a new project.' }],
        },
      },
      {
        id: 'hidden-1',
        parentId: 'user-1',
        timestamp: '2026-03-12T16:00:01.000Z',
        message: {
          role: 'custom',
          customType: 'conversation_automation_review',
          display: false,
          content: [{ type: 'text', text: 'Hidden bookkeeping prompt.' }],
        },
      },
      {
        id: 'assistant-1',
        parentId: 'hidden-1',
        timestamp: '2026-03-12T16:00:02.000Z',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'No automation changes needed.' }],
        },
      },
      {
        id: 'tool-1',
        parentId: 'assistant-1',
        timestamp: '2026-03-12T16:00:03.000Z',
        message: {
          role: 'toolResult',
          toolCallId: 'call-1',
          toolName: 'bash',
          content: [{ type: 'text', text: 'ls' }],
        },
      },
    ]);

    expect(blocks).toEqual([
      expect.objectContaining({
        type: 'user',
        text: 'Create a new project.',
      }),
    ]);
  });

  it('shows auto review descendants in the visible transcript as internal work', () => {
    const blocks = buildDisplayBlocksFromEntries([
      {
        id: 'user-1',
        timestamp: '2026-03-12T16:00:00.000Z',
        message: {
          role: 'user',
          content: [{ type: 'text', text: 'First visible user message.' }],
        },
      },
      {
        id: 'assistant-1',
        parentId: 'user-1',
        timestamp: '2026-03-12T16:00:01.000Z',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'First visible assistant reply.' }],
        },
      },
      {
        id: 'hidden-1',
        parentId: 'assistant-1',
        timestamp: '2026-03-12T16:00:02.000Z',
        message: {
          role: 'custom',
          customType: 'conversation_automation_post_turn_review',
          display: false,
          content: [{ type: 'text', text: 'Hidden bookkeeping prompt.' }],
        },
      },
      {
        id: 'assistant-2',
        parentId: 'hidden-1',
        timestamp: '2026-03-12T16:00:03.000Z',
        message: {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'Reviewing whether auto mode should keep going.' },
            { type: 'toolCall', id: 'call-1', name: 'conversation_auto_control', arguments: { action: 'stop', reason: 'done' } },
          ],
        },
      },
      {
        id: 'tool-1',
        parentId: 'assistant-2',
        timestamp: '2026-03-12T16:00:04.000Z',
        message: {
          role: 'toolResult',
          toolCallId: 'call-1',
          toolName: 'conversation_auto_control',
          content: [{ type: 'text', text: 'Stopped auto mode: done.' }],
        },
      },
      {
        id: 'user-2',
        parentId: 'tool-1',
        timestamp: '2026-03-12T16:00:05.000Z',
        message: {
          role: 'user',
          content: [{ type: 'text', text: 'Second visible user message.' }],
        },
      },
      {
        id: 'assistant-3',
        parentId: 'user-2',
        timestamp: '2026-03-12T16:00:06.000Z',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'Second visible assistant reply.' }],
        },
      },
    ]);

    expect(blocks).toEqual([
      expect.objectContaining({
        type: 'user',
        text: 'First visible user message.',
      }),
      expect.objectContaining({
        type: 'text',
        text: 'First visible assistant reply.',
      }),
      expect.objectContaining({
        type: 'thinking',
        text: 'Reviewing whether auto mode should keep going.',
      }),
      expect.objectContaining({
        type: 'tool_use',
        tool: 'conversation_auto_control',
        input: { action: 'stop', reason: 'done' },
        output: 'Stopped auto mode: done.',
      }),
      expect.objectContaining({
        type: 'user',
        text: 'Second visible user message.',
      }),
      expect.objectContaining({
        type: 'text',
        text: 'Second visible assistant reply.',
      }),
    ]);
  });

  it('keeps assistant replies visible when hidden prompt context precedes the turn', () => {
    const blocks = buildDisplayBlocksFromEntries([
      {
        id: 'user-1',
        timestamp: '2026-03-12T16:00:00.000Z',
        message: {
          role: 'user',
          content: [{ type: 'text', text: 'Use the referenced project context.' }],
        },
      },
      {
        id: 'context-1',
        parentId: 'user-1',
        timestamp: '2026-03-12T16:00:01.000Z',
        message: {
          role: 'custom',
          customType: 'referenced_context',
          display: false,
          content: [{ type: 'text', text: 'Referenced project: @foo' }],
        },
      },
      {
        id: 'assistant-1',
        parentId: 'context-1',
        timestamp: '2026-03-12T16:00:02.000Z',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'Using the referenced project context now.' }],
        },
      },
    ]);

    expect(blocks).toEqual([
      expect.objectContaining({
        type: 'user',
        text: 'Use the referenced project context.',
      }),
      expect.objectContaining({
        type: 'text',
        text: 'Using the referenced project context now.',
      }),
    ]);
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

  it('records parent session ids and source run ids for nested session lineage', () => {
    const sessionsDir = createTempSessionsDir();
    configureSessionEnv(sessionsDir);

    const parentSessionFile = writeSessionFile({
      sessionsDir,
      sessionId: 'parent-session',
      title: 'Parent session',
      assistantTexts: ['Parent reply'],
    });

    writeSessionFile({
      sessionsDir,
      cwdSlug: '__runs/run-subagent-123',
      sessionId: 'child-session',
      title: 'Child session',
      assistantTexts: ['Child reply'],
      parentSession: parentSessionFile,
    });

    expect(listSessions()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'child-session',
        parentSessionFile,
        parentSessionId: 'parent-session',
        sourceRunId: 'run-subagent-123',
      }),
    ]));
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

  it('surfaces Codex compaction metadata on persisted compaction summaries', () => {
    const sessionsDir = createTempSessionsDir();
    configureSessionEnv(sessionsDir);

    const dir = join(sessionsDir, '--tmp-project--');
    mkdirSync(dir, { recursive: true });
    const filePath = join(dir, '2026-03-11T13-00-00-000Z_session-codex-compact.jsonl');
    writeFileSync(filePath, [
      JSON.stringify({ type: 'session', version: 3, id: 'session-codex-compact', timestamp: '2026-03-11T13:00:00.000Z', cwd: '/tmp/project' }),
      JSON.stringify({ type: 'model_change', id: 'session-codex-compact-model', parentId: null, timestamp: '2026-03-11T13:00:00.000Z', modelId: 'gpt-5.4' }),
      JSON.stringify({
        type: 'compaction',
        id: 'session-codex-compact-compaction-1',
        parentId: null,
        timestamp: '2026-03-11T13:00:01.000Z',
        summary: '## Goal\nKeep only the latest summary.',
        firstKeptEntryId: 'session-codex-compact-user-1',
        tokensBefore: 1234,
        details: {
          nativeCompaction: {
            version: 1,
            provider: 'openai-responses-compact',
            modelKey: 'openai-codex:openai-codex-responses:gpt-5.4',
            replacementHistory: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Prompt after compaction' }] }],
          },
        },
      }),
      JSON.stringify({
        type: 'message',
        id: 'session-codex-compact-user-1',
        parentId: 'session-codex-compact-compaction-1',
        timestamp: '2026-03-11T13:00:02.000Z',
        message: { role: 'user', content: 'Continue after compaction' },
      }),
    ].join('\n') + '\n');

    const detail = readSessionBlocks('session-codex-compact');
    expect(detail?.blocks).toEqual([
      {
        type: 'summary',
        id: 'session-codex-compact-compaction-1',
        ts: '2026-03-11T13:00:01.000Z',
        kind: 'compaction',
        title: 'Compaction summary',
        text: '## Goal\nKeep only the latest summary.',
        detail: 'This used Codex compaction under the hood. Pi kept the text summary for display and portability.',
      },
      {
        type: 'user',
        id: 'session-codex-compact-user-1',
        ts: '2026-03-11T13:00:02.000Z',
        text: 'Continue after compaction',
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

  it('renders bash execution messages as bash tool blocks', () => {
    const blocks = buildDisplayBlocksFromEntries([
      {
        id: 'bash-1',
        timestamp: '2026-03-12T16:02:00.000Z',
        message: {
          role: 'bashExecution',
          command: 'git status --short',
          output: ' M src/index.ts',
          exitCode: 0,
          excludeFromContext: true,
        },
      },
    ]);

    expect(blocks).toEqual([
      expect.objectContaining({
        type: 'tool_use',
        tool: 'bash',
        input: { command: 'git status --short' },
        output: ' M src/index.ts',
        details: expect.objectContaining({
          exitCode: 0,
          excludeFromContext: true,
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

import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'fs';
import { rm } from 'fs/promises';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import { getDurableSessionsDir } from './runtime/paths.js';
import { listStoredSessions } from './session-meta.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function writeFile(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

describe('listStoredSessions', () => {
  const originalEnv = process.env;

  afterEach(() => {
    process.env = originalEnv;
  });

  it('reads session metadata from jsonl files newest-first by last activity', () => {
    const sessionsDir = createTempDir('personal-agent-session-meta-');

    writeFile(
      join(sessionsDir, '--Users-patrick-project', '2026-03-12T12-00-00-000Z_a.jsonl'),
      [
        JSON.stringify({ type: 'session', id: 'conv-older', timestamp: '2026-03-12T12:00:00.000Z', cwd: '/Users/patrick/project' }),
        JSON.stringify({ type: 'model_change', modelId: 'gpt-5.4' }),
        JSON.stringify({
          type: 'message',
          timestamp: '2026-03-12T12:01:00.000Z',
          message: { role: 'user', content: [{ type: 'text', text: 'Older conversation' }] },
        }),
      ].join('\n') + '\n',
    );

    writeFile(
      join(sessionsDir, '--Users-patrick-project', '2026-03-12T12-05-00-000Z_b.jsonl'),
      [
        JSON.stringify({ type: 'session', id: 'conv-newer', timestamp: '2026-03-12T12:05:00.000Z', cwd: '/Users/patrick/project' }),
        JSON.stringify({
          type: 'message',
          timestamp: '2026-03-12T12:06:00.000Z',
          message: { role: 'user', content: [{ type: 'text', text: 'Newer conversation title' }] },
        }),
        JSON.stringify({
          type: 'message',
          timestamp: '2026-03-12T12:07:00.000Z',
          message: { role: 'assistant', content: [{ type: 'text', text: 'Done.' }] },
        }),
      ].join('\n') + '\n',
    );

    expect(listStoredSessions({ sessionsDir })).toEqual([
      {
        id: 'conv-newer',
        file: join(sessionsDir, '--Users-patrick-project', '2026-03-12T12-05-00-000Z_b.jsonl'),
        timestamp: '2026-03-12T12:05:00.000Z',
        cwd: '/Users/patrick/project',
        cwdSlug: '--Users-patrick-project',
        model: 'unknown',
        title: 'Newer conversation title',
        messageCount: 2,
        lastActivityAt: '2026-03-12T12:07:00.000Z',
      },
      {
        id: 'conv-older',
        file: join(sessionsDir, '--Users-patrick-project', '2026-03-12T12-00-00-000Z_a.jsonl'),
        timestamp: '2026-03-12T12:00:00.000Z',
        cwd: '/Users/patrick/project',
        cwdSlug: '--Users-patrick-project',
        model: 'gpt-5.4',
        title: 'Older conversation',
        messageCount: 1,
        lastActivityAt: '2026-03-12T12:01:00.000Z',
      },
    ]);
  });

  it('prefers persisted session names over the first user message fallback', () => {
    const sessionsDir = createTempDir('personal-agent-session-meta-');

    writeFile(
      join(sessionsDir, '--Users-patrick-project', '2026-03-12T12-08-00-000Z_named.jsonl'),
      [
        JSON.stringify({ type: 'session', id: 'conv-named', timestamp: '2026-03-12T12:08:00.000Z', cwd: '/Users/patrick/project' }),
        JSON.stringify({
          type: 'message',
          timestamp: '2026-03-12T12:08:01.000Z',
          message: { role: 'user', content: [{ type: 'text', text: 'Fallback first message title' }] },
        }),
        JSON.stringify({
          type: 'message',
          timestamp: '2026-03-12T12:08:02.000Z',
          message: { role: 'assistant', content: [{ type: 'text', text: 'Done.' }] },
        }),
        JSON.stringify({ type: 'session_info', name: 'Generated session title' }),
      ].join('\n') + '\n',
    );

    expect(listStoredSessions({ sessionsDir })[0]).toEqual(
      expect.objectContaining({
        id: 'conv-named',
        title: 'Generated session title',
        messageCount: 2,
      }),
    );
  });

  it('defaults to the synced durable sessions directory for the active state root', () => {
    const stateRoot = createTempDir('personal-agent-session-meta-state-');
    process.env = {
      ...originalEnv,
      PERSONAL_AGENT_STATE_ROOT: stateRoot,
    };

    const sessionsDir = getDurableSessionsDir(stateRoot);
    writeFile(
      join(sessionsDir, '--Users-patrick-project', '2026-03-12T12-09-00-000Z_synced.jsonl'),
      [
        JSON.stringify({ type: 'session', id: 'conv-synced', timestamp: '2026-03-12T12:09:00.000Z', cwd: '/Users/patrick/project' }),
        JSON.stringify({
          type: 'message',
          timestamp: '2026-03-12T12:09:01.000Z',
          message: { role: 'user', content: [{ type: 'text', text: 'Loaded from synced root' }] },
        }),
      ].join('\n') + '\n',
    );

    expect(listStoredSessions()[0]).toEqual(
      expect.objectContaining({
        id: 'conv-synced',
        file: join(sessionsDir, '--Users-patrick-project', '2026-03-12T12-09-00-000Z_synced.jsonl'),
        title: 'Loaded from synced root',
      }),
    );
  });

  it('falls back to slug-derived cwd, file mtimes, and string user content', () => {
    const sessionsDir = createTempDir('personal-agent-session-meta-');
    const filePath = join(sessionsDir, '--Users-patrick-project--', '2026-03-12T12-10-00-000Z_fallback.jsonl');

    writeFile(
      filePath,
      [
        'not json',
        JSON.stringify({ type: 'session', id: 'conv-fallback', timestamp: 'not-a-date' }),
        JSON.stringify({ type: 'model_change' }),
        JSON.stringify({ type: 'message', timestamp: 'still-not-a-date', message: { role: 'user', content: 'Fallback\nstring title' } }),
      ].join('\n') + '\n',
    );

    const fallbackTimestamp = new Date('2026-03-12T12:10:30.000Z');
    utimesSync(filePath, fallbackTimestamp, fallbackTimestamp);

    expect(listStoredSessions({ sessionsDir })[0]).toEqual(
      expect.objectContaining({
        id: 'conv-fallback',
        cwd: 'Users/patrick/project',
        cwdSlug: '--Users-patrick-project--',
        model: 'unknown',
        title: 'Fallback string title',
        timestamp: fallbackTimestamp.toISOString(),
        lastActivityAt: fallbackTimestamp.toISOString(),
      }),
    );
  });

  it('falls back to image attachment titles when the stored session name is blank', () => {
    const sessionsDir = createTempDir('personal-agent-session-meta-');

    writeFile(
      join(sessionsDir, '--Users-patrick-project', '2026-03-12T12-11-00-000Z_images.jsonl'),
      [
        JSON.stringify({ type: 'session', id: 'conv-images', timestamp: '2026-03-12T12:11:00.000Z', cwd: '/Users/patrick/project' }),
        JSON.stringify({
          type: 'message',
          timestamp: '2026-03-12T12:11:01.000Z',
          message: {
            role: 'user',
            content: [{ type: 'image' }, { type: 'image' }],
          },
        }),
        JSON.stringify({ type: 'session_info', name: '   ' }),
      ].join('\n') + '\n',
    );

    expect(listStoredSessions({ sessionsDir })[0]).toEqual(
      expect.objectContaining({
        id: 'conv-images',
        title: '(2 image attachments)',
      }),
    );
  });

  it('sorts root-level session files by id when last activity ties and skips files without a session record', () => {
    const sessionsDir = createTempDir('personal-agent-session-meta-');

    writeFile(
      join(sessionsDir, '2026-03-12T12-12-00-000Z_a.jsonl'),
      [
        JSON.stringify({ type: 'session', id: 'conv-a', timestamp: '2026-03-12T12:12:00.000Z', cwd: '/Users/patrick/project-a' }),
        JSON.stringify({
          type: 'message',
          timestamp: '2026-03-12T12:15:00.000Z',
          message: { role: 'user', content: [{ type: 'text', text: 'Alpha' }] },
        }),
      ].join('\n') + '\n',
    );

    writeFile(
      join(sessionsDir, '2026-03-12T12-12-00-000Z_b.jsonl'),
      [
        JSON.stringify({ type: 'session', id: 'conv-b', timestamp: '2026-03-12T12:12:00.000Z', cwd: '/Users/patrick/project-b' }),
        JSON.stringify({
          type: 'message',
          timestamp: '2026-03-12T12:15:00.000Z',
          message: { role: 'user', content: [{ type: 'text', text: 'Beta' }] },
        }),
      ].join('\n') + '\n',
    );

    writeFile(
      join(sessionsDir, '2026-03-12T12-12-00-000Z_ignored.jsonl'),
      [
        JSON.stringify({
          type: 'message',
          timestamp: '2026-03-12T12:15:00.000Z',
          message: { role: 'user', content: [{ type: 'text', text: 'Ignored' }] },
        }),
      ].join('\n') + '\n',
    );

    expect(listStoredSessions({ sessionsDir }).map((session) => session.id)).toEqual(['conv-b', 'conv-a']);
  });
});

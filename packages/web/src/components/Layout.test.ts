import { describe, expect, it } from 'vitest';
import type { SessionMeta } from '../shared/types';
import { readStoredPanelWidth, resolveActiveWorkspaceCwd } from './Layout';

function createSession(overrides: Partial<SessionMeta>): SessionMeta {
  return {
    id: 'conversation-1',
    file: '/tmp/conversation-1.jsonl',
    timestamp: '2026-04-01T00:00:00.000Z',
    cwd: '/tmp/worktree',
    cwdSlug: 'worktree',
    model: 'openai/gpt-5.4',
    title: 'Conversation 1',
    messageCount: 1,
    ...overrides,
  };
}

describe('Layout workspace selection', () => {
  it('uses only fully local conversations for the workbench workspace', () => {
    expect(resolveActiveWorkspaceCwd([
      createSession({ id: 'local', cwd: '/tmp/local' }),
      createSession({ id: 'remote-host-only', cwd: '/tmp/remote-host', remoteHostId: 'bender' }),
      createSession({ id: 'remote-conversation-only', cwd: '/tmp/remote-conversation', remoteConversationId: 'remote-1' }),
    ], 'local')).toBe('/tmp/local');

    expect(resolveActiveWorkspaceCwd([
      createSession({ id: 'remote-host-only', cwd: '/tmp/remote-host', remoteHostId: 'bender' }),
    ], 'remote-host-only')).toBeNull();

    expect(resolveActiveWorkspaceCwd([
      createSession({ id: 'remote-conversation-only', cwd: '/tmp/remote-conversation', remoteConversationId: 'remote-1' }),
    ], 'remote-conversation-only')).toBeNull();
  });
});

describe('Layout panel sizing', () => {
  it('ignores malformed stored panel widths instead of partially parsing them', () => {
    const storage = new Map<string, string>();
    const localStorage = {
      getItem: (key: string) => storage.get(key) ?? null,
    } as Storage;
    storage.set('panel-width', '320px');

    expect(readStoredPanelWidth('panel-width', 280, 180, localStorage)).toBe(280);

    storage.set('panel-width', String(Number.MAX_SAFE_INTEGER + 1));
    expect(readStoredPanelWidth('panel-width', 280, 180, localStorage)).toBe(280);
  });
});

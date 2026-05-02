import { describe, expect, it } from 'vitest';

import type { SessionMeta } from '../shared/types';
import {
  readStoredPanelWidth,
  readStoredWorkbenchExplorerOpen,
  resolveActiveWorkspaceCwd,
  shouldResetWorkbenchRunsOnConversationChange,
  shouldShowConversationRunsTab,
} from './Layout';

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
    expect(
      resolveActiveWorkspaceCwd(
        [
          createSession({ id: 'local', cwd: '/tmp/local' }),
          createSession({ id: 'remote-host-only', cwd: '/tmp/remote-host', remoteHostId: 'bender' }),
          createSession({ id: 'remote-conversation-only', cwd: '/tmp/remote-conversation', remoteConversationId: 'remote-1' }),
        ],
        'local',
      ),
    ).toBe('/tmp/local');

    expect(
      resolveActiveWorkspaceCwd(
        [createSession({ id: 'remote-host-only', cwd: '/tmp/remote-host', remoteHostId: 'bender' })],
        'remote-host-only',
      ),
    ).toBeNull();

    expect(
      resolveActiveWorkspaceCwd(
        [createSession({ id: 'remote-conversation-only', cwd: '/tmp/remote-conversation', remoteConversationId: 'remote-1' })],
        'remote-conversation-only',
      ),
    ).toBeNull();
  });
});

describe('Layout workbench rail state', () => {
  it('defaults the workbench sidebar open and restores an explicit collapsed state', () => {
    const storage = new Map<string, string>();
    const localStorage = {
      getItem: (key: string) => storage.get(key) ?? null,
    } as Storage;

    expect(readStoredWorkbenchExplorerOpen(localStorage)).toBe(true);

    storage.set('pa:workbench-explorer-open', 'false');
    expect(readStoredWorkbenchExplorerOpen(localStorage)).toBe(false);

    storage.set('pa:workbench-explorer-open', 'true');
    expect(readStoredWorkbenchExplorerOpen(localStorage)).toBe(true);
  });

  it('only shows the runs tab when the conversation has runs', () => {
    expect(shouldShowConversationRunsTab({ runCount: 0 })).toBe(false);
    expect(shouldShowConversationRunsTab({ runCount: 1 })).toBe(true);
    expect(shouldShowConversationRunsTab({ runCount: 0, activeRunId: 'run-1', activeRunConnected: false, runsLoaded: false })).toBe(true);
    expect(shouldShowConversationRunsTab({ runCount: 0, activeRunId: 'run-1', activeRunConnected: false, runsLoaded: true })).toBe(false);
  });

  it('resets runs mode when switching conversations', () => {
    expect(
      shouldResetWorkbenchRunsOnConversationChange({
        previousConversationId: 'conv-a',
        activeConversationId: 'conv-b',
        activeTool: 'runs',
        activeRunId: null,
      }),
    ).toBe(true);
    expect(
      shouldResetWorkbenchRunsOnConversationChange({
        previousConversationId: 'conv-a',
        activeConversationId: 'conv-a',
        activeTool: 'runs',
        activeRunId: 'run-1',
      }),
    ).toBe(false);
    expect(
      shouldResetWorkbenchRunsOnConversationChange({
        previousConversationId: 'conv-a',
        activeConversationId: 'conv-b',
        activeTool: 'knowledge',
        activeRunId: null,
      }),
    ).toBe(false);
    expect(
      shouldResetWorkbenchRunsOnConversationChange({
        previousConversationId: 'conv-a',
        activeConversationId: 'conv-b',
        activeTool: 'knowledge',
        activeRunId: 'run-1',
      }),
    ).toBe(true);
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

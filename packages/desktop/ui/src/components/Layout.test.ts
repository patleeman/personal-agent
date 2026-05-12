import { describe, expect, it } from 'vitest';

import type { SessionMeta } from '../shared/types';
import {
  clearWorkbenchOnlySearchParamsForCompact,
  isDiffsRailMode,
  readStoredPanelWidth,
  readStoredWorkbenchExplorerOpen,
  resolveActiveExtensionWorkbenchSurface,
  resolveActiveWorkspaceCwd,
  resolveDefaultDiffCheckpointId,
  resolveWorkbenchRailMode,
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
  it('uses the active conversation cwd for the workbench workspace', () => {
    expect(resolveActiveWorkspaceCwd([createSession({ id: 'local', cwd: '/tmp/local' })], 'local')).toBe('/tmp/local');
    expect(resolveActiveWorkspaceCwd([createSession({ id: 'other', cwd: '/tmp/other' })], 'missing')).toBeNull();
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

  it('routes built-in rail actions through native extension surfaces when registered', () => {
    expect(resolveWorkbenchRailMode('runs', null)).toBe('runs');
    expect(resolveWorkbenchRailMode('runs', { extensionId: 'system-runs', id: 'runs-tool' } as never)).toBe(
      'extension:system-runs:runs-tool',
    );
  });

  it('resolves built-in file rail detail views without extension mode state', () => {
    expect(
      resolveActiveExtensionWorkbenchSurface({
        activeWorkbenchTool: 'files',
        extensionRightToolPanels: [{ extensionId: 'system-files', id: 'files-tool', detailView: 'files-workbench' } as never],
        extensionWorkbenchSurfaces: [{ extensionId: 'system-files', id: 'files-workbench' } as never],
      }),
    ).toEqual({ extensionId: 'system-files', id: 'files-workbench' });
  });

  it('recognizes extension-backed diffs as diffs rail mode', () => {
    expect(isDiffsRailMode('diffs')).toBe(true);
    expect(isDiffsRailMode('extension:system-diffs:conversation-diffs')).toBe(true);
    expect(isDiffsRailMode('extension:system-files:file-explorer')).toBe(false);
  });

  it('defaults the diffs rail to uncommitted changes when present', () => {
    expect(
      resolveDefaultDiffCheckpointId({
        activeCheckpointId: 'saved-checkpoint',
        firstCheckpointId: 'newest-checkpoint',
        hasUncommittedDiff: true,
      }),
    ).toBe('__uncommitted__');
    expect(
      resolveDefaultDiffCheckpointId({ activeCheckpointId: null, firstCheckpointId: 'newest-checkpoint', hasUncommittedDiff: false }),
    ).toBe('newest-checkpoint');
  });

  it('clears workbench-only diff and run params when switching to compact mode', () => {
    expect(clearWorkbenchOnlySearchParamsForCompact('checkpoint=abc123&run=run-1&file=notes%2Ftodo.md&artifact=artifact-1')).toBe(
      'file=notes%2Ftodo.md&artifact=artifact-1',
    );
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

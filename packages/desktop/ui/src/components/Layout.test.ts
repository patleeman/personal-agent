import { describe, expect, it } from 'vitest';

import type { SessionMeta } from '../shared/types';
import {
  clearWorkbenchOnlySearchParamsForCompact,
  isArtifactsRailMode,
  isDiffsRailMode,
  isRunsRailMode,
  readStoredPanelWidth,
  readStoredWorkbenchExplorerOpen,
  resolveActiveExtensionWorkbenchSurface,
  resolveActiveWorkspaceCwd,
  resolveDefaultDiffCheckpointId,
  resolveWorkbenchRailMode,
  shouldResetEmptyArtifactsRail,
  shouldResetEmptyRunsRail,
  shouldResetWorkbenchRunsOnConversationChange,
  shouldShowConversationRunsTab,
} from './Layout';
import { shouldRenderExtensionToolPanelInWorkbenchNav } from './workbenchNav';

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

  it('keeps extension-backed empty workbench rails active', () => {
    expect(shouldResetEmptyRunsRail({ activeTool: 'runs', showRunsTab: false, hasRunsExtensionSurface: true })).toBe(false);
    expect(shouldResetEmptyRunsRail({ activeTool: 'runs', showRunsTab: false, hasRunsExtensionSurface: false })).toBe(true);
    expect(
      shouldResetEmptyArtifactsRail({
        activeTool: 'artifacts',
        artifactsLoading: false,
        artifactCount: 0,
        hasArtifactsExtensionSurface: true,
      }),
    ).toBe(false);
    expect(
      shouldResetEmptyArtifactsRail({
        activeTool: 'artifacts',
        artifactsLoading: false,
        artifactCount: 0,
        hasArtifactsExtensionSurface: false,
      }),
    ).toBe(true);
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

  it('normalizes system extension rail actions to stable built-in modes', () => {
    expect(resolveWorkbenchRailMode('runs', null)).toBe('runs');
    expect(resolveWorkbenchRailMode('runs', { extensionId: 'system-runs', id: 'runs-tool' } as never)).toBe('runs');
    expect(resolveWorkbenchRailMode('artifacts', { extensionId: 'system-artifacts', id: 'artifacts-tool' } as never)).toBe('artifacts');
  });

  it('keeps system artifact panels in the workbench nav', () => {
    expect(shouldRenderExtensionToolPanelInWorkbenchNav('system-files')).toBe(false);
    expect(shouldRenderExtensionToolPanelInWorkbenchNav('system-artifacts')).toBe(true);
  });

  it('resolves built-in slot detail views without extension mode state', () => {
    expect(
      resolveActiveExtensionWorkbenchSurface({
        activeWorkbenchTool: 'files',
        extensionRightToolPanels: [{ extensionId: 'system-files', id: 'files-tool', detailView: 'files-workbench' } as never],
        extensionWorkbenchSurfaces: [{ extensionId: 'system-files', id: 'files-workbench' } as never],
      }),
    ).toEqual({ extensionId: 'system-files', id: 'files-workbench' });

    expect(
      resolveActiveExtensionWorkbenchSurface({
        activeWorkbenchTool: 'browser',
        extensionRightToolPanels: [
          { extensionId: 'system-browser', id: 'browser-tool', detailView: 'browser-workbench', toolSlot: 'browser' } as never,
        ],
        extensionWorkbenchSurfaces: [{ extensionId: 'system-browser', id: 'browser-workbench' } as never],
      }),
    ).toEqual({ extensionId: 'system-browser', id: 'browser-workbench' });
  });

  it('recognizes extension-backed diffs as diffs rail mode', () => {
    expect(isDiffsRailMode('diffs')).toBe(true);
    expect(isDiffsRailMode('extension:system-diffs:conversation-diffs')).toBe(true);
    expect(isDiffsRailMode('extension:system-files:file-explorer')).toBe(false);
  });

  it('recognizes extension-backed artifacts as artifacts rail mode', () => {
    expect(isArtifactsRailMode('artifacts')).toBe(true);
    expect(isArtifactsRailMode('extension:system-artifacts:conversation-artifacts')).toBe(true);
    expect(isArtifactsRailMode('extension:system-files:file-explorer')).toBe(false);
  });

  it('recognizes extension-backed runs as runs rail mode', () => {
    expect(isRunsRailMode('runs')).toBe(true);
    expect(isRunsRailMode('extension:system-runs:conversation-runs')).toBe(true);
    expect(isRunsRailMode('extension:system-files:file-explorer')).toBe(false);
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

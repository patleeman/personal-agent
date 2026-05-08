import type { KnowledgeBaseState } from '@personal-agent/extensions/knowledge';
import { describe, expect, it } from 'vitest';

import { getKnowledgeBaseSyncPresentation } from './knowledgeBaseSyncStatus';

// ── knowledgeBaseSyncStatus — sync status presentation ─────────────────────

describe('getKnowledgeBaseSyncPresentation', () => {
  it('returns loading state for null input', () => {
    const result = getKnowledgeBaseSyncPresentation(null);
    expect(result.text).toBe('Loading sync status…');
    expect(result.pulse).toBe(true);
  });

  it('returns loading state for undefined input', () => {
    const result = getKnowledgeBaseSyncPresentation(undefined);
    expect(result.text).toBe('Loading sync status…');
  });

  it('shows managed sync off when not configured', () => {
    const state = { configured: false } as KnowledgeBaseState;
    const result = getKnowledgeBaseSyncPresentation(state);
    expect(result.text).toBe('Managed sync off');
    expect(result.pulse).toBe(false);
  });

  it('shows syncing state', () => {
    const state = { configured: true, syncStatus: 'syncing' } as KnowledgeBaseState;
    const result = getKnowledgeBaseSyncPresentation(state);
    expect(result.text).toBe('Syncing…');
    expect(result.pulse).toBe(true);
  });

  it('shows sync error with message', () => {
    const state = { configured: true, syncStatus: 'error', lastError: 'Auth failed' } as KnowledgeBaseState;
    const result = getKnowledgeBaseSyncPresentation(state);
    expect(result.text).toBe('Sync failed · Auth failed');
    expect(result.toneClass).toBe('text-danger');
  });

  it('shows sync error without message', () => {
    const state = { configured: true, syncStatus: 'error' } as KnowledgeBaseState;
    const result = getKnowledgeBaseSyncPresentation(state);
    expect(result.text).toBe('Sync failed');
  });

  it('shows pending sync with local changes', () => {
    const state = {
      configured: true,
      syncStatus: 'idle',
      gitStatus: { localChangeCount: 3, aheadCount: 0, behindCount: 0 },
    } as KnowledgeBaseState;
    const result = getKnowledgeBaseSyncPresentation(state);
    expect(result.text).toContain('Pending sync');
    expect(result.text).toContain('3 local changes');
  });

  it('shows push pending with local commits', () => {
    const state = {
      configured: true,
      syncStatus: 'idle',
      gitStatus: { localChangeCount: 0, aheadCount: 5, behindCount: 0 },
    } as KnowledgeBaseState;
    const result = getKnowledgeBaseSyncPresentation(state);
    expect(result.text).toContain('Push pending');
    expect(result.text).toContain('5 local commits');
  });

  it('shows diverged state', () => {
    const state = {
      configured: true,
      syncStatus: 'idle',
      gitStatus: { localChangeCount: 0, aheadCount: 2, behindCount: 3 },
    } as KnowledgeBaseState;
    const result = getKnowledgeBaseSyncPresentation(state);
    expect(result.text).toContain('Diverged');
    expect(result.text).toContain('2 local commits');
    expect(result.text).toContain('3 remote commits');
  });

  it('shows remote updates when behind', () => {
    const state = {
      configured: true,
      syncStatus: 'idle',
      gitStatus: { localChangeCount: 0, aheadCount: 0, behindCount: 7 },
    } as KnowledgeBaseState;
    const result = getKnowledgeBaseSyncPresentation(state);
    expect(result.text).toContain('Remote updates');
    expect(result.text).toContain('7 remote commits');
  });

  it('shows in sync with no git status issues', () => {
    const state = { configured: true, syncStatus: 'idle', lastSyncAt: '2026-05-01T12:00:00.000Z' } as KnowledgeBaseState;
    const result = getKnowledgeBaseSyncPresentation(state);
    expect(result.text).toBe('In sync');
  });

  it('includes last synced time when requested', () => {
    const state = { configured: true, syncStatus: 'idle', lastSyncAt: '2026-05-01T12:00:00.000Z' } as KnowledgeBaseState;
    const result = getKnowledgeBaseSyncPresentation(state, { includeLastSyncAt: true });
    expect(result.text).toContain('Last synced');
  });
});

import { describe, expect, it, vi } from 'vitest';

// Mock extension module imports that aren't available in the test environment.
// The test only imports non-React helpers from MessageBlocks.
vi.mock('../extensions/useExtensionRegistry', () => ({
  useExtensionRegistry: () => ({ messageActions: [] }),
}));
vi.mock('../extensions/nativePaClient', () => ({
  createNativeExtensionClient: () => ({ extension: { invoke: async () => {} } }),
}));
vi.mock('../client/apiBase', () => ({}));

import { resolveCompactionSummaryDetail, resolveCompactionSummaryLabel } from './MessageBlocks.js';

describe('MessageBlocks summary helpers', () => {
  it('normalizes default compaction labels', () => {
    expect(resolveCompactionSummaryLabel(undefined)).toBe('Context compacted');
    expect(resolveCompactionSummaryLabel('Compaction summary')).toBe('Context compacted');
    expect(resolveCompactionSummaryLabel('Manual compaction')).toBe('Manual compaction');
  });

  it('describes known compaction summary kinds', () => {
    expect(resolveCompactionSummaryDetail('Manual compaction')).toContain('explicitly summarized');
    expect(resolveCompactionSummaryDetail('Proactive compaction')).toContain('context window was getting full');
    expect(resolveCompactionSummaryDetail('Overflow recovery compaction')).toContain('context overflow');
  });

  it('appends extra detail when present', () => {
    expect(resolveCompactionSummaryDetail('Manual compaction', 'Extra note.')).toBe(
      'You explicitly summarized older turns to shrink the active context window. Extra note.',
    );
  });
});

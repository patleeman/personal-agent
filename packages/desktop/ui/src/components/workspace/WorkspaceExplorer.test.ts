import { describe, expect, it } from 'vitest';

import { formatWorkspaceEntrySize } from './WorkspaceExplorer.js';

describe('formatWorkspaceEntrySize', () => {
  it('formats normal file sizes', () => {
    expect(formatWorkspaceEntrySize(42)).toBe('42 B');
    expect(formatWorkspaceEntrySize(2048)).toBe('2 KB');
    expect(formatWorkspaceEntrySize(1_572_864)).toBe('1.5 MB');
  });

  it('omits unsafe file sizes', () => {
    expect(formatWorkspaceEntrySize(Number.MAX_SAFE_INTEGER + 1)).toBe('');
    expect(formatWorkspaceEntrySize(1.5)).toBe('');
  });
});

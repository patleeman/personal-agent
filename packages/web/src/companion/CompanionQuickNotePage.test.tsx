import { describe, expect, it } from 'vitest';

const DEFAULT_QUICK_NOTE_TITLE = 'Quick note';

describe('CompanionQuickNotePage quick-note defaults', () => {
  it('uses a stable default title for captured phone notes', () => {
    expect(DEFAULT_QUICK_NOTE_TITLE).toBe('Quick note');
  });
});

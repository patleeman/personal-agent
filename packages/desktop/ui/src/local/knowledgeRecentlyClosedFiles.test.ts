import { describe, expect, it } from 'vitest';

import { recordRecentlyClosedFileId } from './knowledgeRecentlyClosedFiles';

describe('knowledgeRecentlyClosedFiles', () => {
  it('defaults malformed recently closed file limits instead of letting slice truncate them', () => {
    const ids = Array.from({ length: 3 }, (_, index) => `note-${index}.md`);
    expect(recordRecentlyClosedFileId(ids, 'latest.md', 1.5)).toHaveLength(4);
  });

  it('caps excessive recently closed file limits', () => {
    const ids = Array.from({ length: 30 }, (_, index) => `note-${index}.md`);
    expect(recordRecentlyClosedFileId(ids, 'latest.md', 5000)).toHaveLength(20);
  });
});

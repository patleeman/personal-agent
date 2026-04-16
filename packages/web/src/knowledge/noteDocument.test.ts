import { describe, expect, it } from 'vitest';
import { readEditableNoteBody, stripMarkdownFrontmatter, stripManagedNoteHeading } from './noteDocument';

describe('noteDocument helpers', () => {
  it('strips yaml frontmatter from note content', () => {
    expect(stripMarkdownFrontmatter('---\ntitle: Test\n---\n\n# Test\n\nBody')).toBe('# Test\n\nBody');
  });

  it('removes the managed leading heading when it matches the note title', () => {
    expect(stripManagedNoteHeading('# Test Note\n\nBody', 'Test Note')).toBe('Body');
    expect(readEditableNoteBody('---\ntitle: Test Note\n---\n\n# Test Note\n\nBody', 'Test Note')).toBe('Body');
  });

  it('keeps the markdown body intact when the first heading is different', () => {
    expect(stripManagedNoteHeading('# Other heading\n\nBody', 'Test Note')).toBe('# Other heading\n\nBody');
  });
});

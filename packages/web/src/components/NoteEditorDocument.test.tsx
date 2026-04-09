import { describe, expect, it } from 'vitest';
import { readEditableNoteBody } from '../noteDocument';

describe('note editor document helpers', () => {
  it('returns the body without frontmatter or the managed heading', () => {
    expect(readEditableNoteBody('---\ntitle: Example\n---\n\n# Example\n\nBody', 'Example')).toBe('Body');
  });

  it('keeps body content when the leading heading is not the managed note title', () => {
    expect(readEditableNoteBody('---\ntitle: Example\n---\n\n# Something else\n\nBody', 'Example')).toBe('# Something else\n\nBody');
  });
});

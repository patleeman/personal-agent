import { describe, expect, it } from 'vitest';
import { stripMarkdownFrontmatter } from '../knowledge/noteDocument';

describe('legacy fields block markdown', () => {
  it('preserves unsupported :::fields blocks in the editable note body', () => {
    const content = '---\ntitle: Durable note\n---\n\n:::fields\nsummary: Durable note\nstatus: active\n:::';

    expect(stripMarkdownFrontmatter(content)).toBe(':::fields\nsummary: Durable note\nstatus: active\n:::');
  });
});

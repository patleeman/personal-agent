import { describe, expect, it } from 'vitest';

import { parseSkillBlock } from './skillBlock';

// ── skillBlock — parsing <skill> tags from text ────────────────────────────

describe('parseSkillBlock', () => {
  it('returns null for non-matching text', () => {
    expect(parseSkillBlock('just some text')).toBeNull();
    expect(parseSkillBlock('')).toBeNull();
    expect(parseSkillBlock('<skill name="test">content</skill>')).toBeNull(); // missing location
  });

  it('parses a minimal skill block', () => {
    const result = parseSkillBlock('<skill name="my-skill" location="path/to/skill.md">\ncontent\n</skill>');
    expect(result).not.toBeNull();
    expect(result!.name).toBe('my-skill');
    expect(result!.location).toBe('path/to/skill.md');
    expect(result!.content).toBe('content');
    expect(result!.userMessage).toBeUndefined();
  });

  it('parses a skill block with multi-line content', () => {
    const text = '<skill name="test-skill" location="skills/test/SKILL.md">\nline 1\nline 2\nline 3\n</skill>';
    const result = parseSkillBlock(text);
    expect(result).not.toBeNull();
    expect(result!.name).toBe('test-skill');
    expect(result!.content).toBe('line 1\nline 2\nline 3');
  });

  it('parses a skill block with a user message after the closing tag', () => {
    const text = '<skill name="greeter" location="skills/greet/SKILL.md">\nHello world\n</skill>\n\nPlease use this skill.';
    const result = parseSkillBlock(text);
    expect(result).not.toBeNull();
    expect(result!.name).toBe('greeter');
    expect(result!.content).toBe('Hello world');
    expect(result!.userMessage).toBe('Please use this skill.');
  });

  it('trims the user message', () => {
    const text = '<skill name="x" location="y.md">\nz\n</skill>\n\n   trimmed   ';
    const result = parseSkillBlock(text);
    expect(result?.userMessage).toBe('trimmed');
  });
});

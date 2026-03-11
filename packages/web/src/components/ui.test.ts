import { describe, expect, it } from 'vitest';
import { cx, pillToneClass } from './ui';

describe('ui helpers', () => {
  it('joins only truthy class parts', () => {
    expect(cx('base', false && 'hidden', undefined, 'active')).toBe('base active');
  });

  it('returns the shared class for each pill tone', () => {
    expect(pillToneClass('muted')).toBe('ui-pill-muted');
    expect(pillToneClass('accent')).toBe('ui-pill-accent');
    expect(pillToneClass('solidAccent')).toBe('ui-pill-solid-accent');
  });
});

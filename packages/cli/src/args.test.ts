import { describe, expect, it } from 'vitest';
import { hasOption } from './args.js';

describe('hasOption', () => {
  it('returns true only when option is present exactly', () => {
    expect(hasOption(['--json', '--plain'], '--json')).toBe(true);
    expect(hasOption(['--json'], '--plain')).toBe(false);
  });
});

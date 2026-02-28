import { describe, it, expect } from 'vitest';
import { resourcesHello } from './index.js';

describe('resources', () => {
  it('should return resources message', () => {
    expect(resourcesHello()).toMatch(/Resources using schema \d+\.\d+\.\d+/);
  });
});

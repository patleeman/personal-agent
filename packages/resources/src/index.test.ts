import { describe, it, expect } from 'vitest';
import { resourcesHello } from './index.js';

describe('resources', () => {
  it('should return resources message', () => {
    expect(resourcesHello()).toBe('Hello from core - resources');
  });
});

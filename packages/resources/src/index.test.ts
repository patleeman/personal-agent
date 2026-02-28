import { describe, it, expect } from 'vitest';
import { resourcesHello } from './index';

describe('resources', () => {
  it('should return resources message', () => {
    expect(resourcesHello()).toBe('Hello from core - resources');
  });
});

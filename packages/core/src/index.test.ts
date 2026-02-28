import { describe, it, expect } from 'vitest';
import { hello } from './index';

describe('core', () => {
  it('should return hello message', () => {
    expect(hello()).toBe('Hello from core');
  });
});

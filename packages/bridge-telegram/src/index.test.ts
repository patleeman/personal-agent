import { describe, it, expect } from 'vitest';
import { telegramHello } from './index';

describe('bridge-telegram', () => {
  it('should return telegram message', () => {
    expect(telegramHello()).toBe('Hello from core - telegram bridge');
  });
});

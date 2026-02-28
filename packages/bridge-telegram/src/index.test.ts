import { describe, it, expect } from 'vitest';
import { telegramHello } from './index.js';

describe('bridge-telegram', () => {
  it('should return telegram message', () => {
    expect(telegramHello()).toMatch(/Telegram bridge using schema \d+\.\d+\.\d+/);
  });
});

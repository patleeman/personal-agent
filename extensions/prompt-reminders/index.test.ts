import { describe, expect, it, vi } from 'vitest';
import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import promptRemindersExtension from './index';

describe('prompt reminders extension', () => {
  it('does not register keyword-specific prompt reminders', () => {
    const api = {
      on: vi.fn(),
    };

    promptRemindersExtension(api as unknown as ExtensionAPI);

    expect(api.on).not.toHaveBeenCalled();
  });
});

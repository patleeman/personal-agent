import { describe, expect, it } from 'vitest';

import { createConversationAutoModeAgentExtension } from './backend.js';

describe('system-goal-mode extension', () => {
  it('creates the extension factory', () => {
    const factory = createConversationAutoModeAgentExtension();
    expect(factory).toBeInstanceOf(Function);
  });
});

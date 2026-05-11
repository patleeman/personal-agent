import { describe, expect, it } from 'vitest';

import { parsePendingOperation } from './web-live-conversations.js';

describe('web live conversation runs', () => {
  it('ignores pending operations with malformed enqueue timestamps', () => {
    expect(
      parsePendingOperation({
        type: 'prompt',
        text: 'Continue',
        enqueuedAt: 'not-a-date',
      }),
    ).toBeUndefined();
  });
});

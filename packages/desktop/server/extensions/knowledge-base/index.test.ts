import { describe, expect, it } from 'vitest';

import knowledgeBaseExtension from './index';

describe('knowledge base extension', () => {
  it('is a no-op that does not register handlers', () => {
    let handlerCount = 0;

    const pi = {
      on: () => {
        handlerCount++;
      },
    };

    knowledgeBaseExtension(pi as never);

    // The extension should not register any event handlers
    expect(handlerCount).toBe(0);
  });
});

import { describe, expect, it } from 'vitest';

import daemonRunOrchestrationPromptExtension from './index';

describe('daemon run orchestration prompt extension', () => {
  it('is a no-op that does not register handlers', () => {
    let handlerCount = 0;

    const pi = {
      on: () => {
        handlerCount++;
      },
    };

    daemonRunOrchestrationPromptExtension(pi as never);

    expect(handlerCount).toBe(0);
  });
});

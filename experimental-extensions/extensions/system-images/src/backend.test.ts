import { describe, expect, it, vi } from 'vitest';

const mockExecute = vi.fn();

vi.mock('./imageTool.js', () => ({
  createImageAgentExtension: () => (pi: { registerTool: (t: unknown) => void }) => {
    pi.registerTool({ execute: mockExecute });
  },
}));

import { image } from './backend.js';

function createCtx(overrides?: Record<string, unknown>) {
  return {
    agentToolContext: { sessionStuff: true },
    ...overrides,
  };
}

describe('system-images backend', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('delegates to the registered image tool and wraps result', async () => {
    mockExecute.mockResolvedValue({
      content: [{ type: 'text', text: 'Generated image prompt: a cat' }],
    });

    const result = await image({ prompt: 'a cat' }, createCtx());
    expect(result.text).toBe('Generated image prompt: a cat');
  });

  it('handles result with no content array', async () => {
    mockExecute.mockResolvedValue({ details: { status: 'done' } });

    const result = await image({}, createCtx());
    expect(result.text).toContain('"status"');
  });

  it('unwraps manifest tool agent context before delegating', async () => {
    mockExecute.mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] });
    const wrappedAgentContext = { toolContext: { modelRegistry: { find: vi.fn() } }, onUpdate: vi.fn() };

    await image({ prompt: 'a cat' }, createCtx({ agentToolContext: wrappedAgentContext }));

    expect(mockExecute).toHaveBeenCalledWith(
      'extension-backend-image',
      { prompt: 'a cat' },
      undefined,
      undefined,
      wrappedAgentContext.toolContext,
    );
  });

  it('throws when agentToolContext is missing', async () => {
    await expect(image({}, createCtx({ agentToolContext: undefined }))).rejects.toThrow('Image tools require an active agent tool context');
  });

  it('propagates tool execution errors', async () => {
    mockExecute.mockRejectedValue(new Error('Tool execution failed'));

    await expect(image({ prompt: 'test' }, createCtx())).rejects.toThrow('Tool execution failed');
  });

  it('extracts detail from complex result objects', async () => {
    mockExecute.mockResolvedValue({ content: [], details: { imageId: 'img_xxx' } });

    const result = await image({ prompt: 'test' }, createCtx());
    expect(result.details).toEqual({ imageId: 'img_xxx' });
  });
});

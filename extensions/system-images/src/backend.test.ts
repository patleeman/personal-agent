import { describe, expect, it, vi } from 'vitest';

const mockExecute = vi.fn();

vi.mock('./imageTool.js', () => ({
  createImageAgentExtension: () => (pi: { registerTool: (t: unknown) => void }) => {
    pi.registerTool({ execute: mockExecute });
  },
}));

vi.mock('./probeImageTool.js', () => ({
  createImageProbeAgentExtension: () => (pi: { registerTool: (t: unknown) => void }) => {
    pi.registerTool({ execute: mockExecute });
  },
}));

import { image, probeImage } from './backend.js';

function createCtx(overrides?: Record<string, unknown>) {
  return {
    agentToolContext: { sessionStuff: true },
    toolContext: { preferredVisionModel: 'provider/gpt-4-vision' },
    ...overrides,
  };
}

describe('system-images backend', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('image handler', () => {
    it('delegates to the registered tool and wraps result', async () => {
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

    it('throws when agentToolContext is missing', async () => {
      await expect(image({}, createCtx({ agentToolContext: undefined }))).rejects.toThrow(
        'Image tools require an active agent tool context',
      );
    });
  });

  describe('probeImage handler', () => {
    it('delegates to the registered probe tool and wraps result', async () => {
      mockExecute.mockResolvedValue({
        content: [{ type: 'text', text: 'The image shows a dashboard with three panels' }],
      });

      const result = await probeImage({ imageIds: ['img_a1b2c3d4e5f6'], question: 'What is in this image?' }, createCtx());
      expect(result.text).toBe('The image shows a dashboard with three panels');
    });

    it('handles result with isError flag', async () => {
      mockExecute.mockResolvedValue({
        content: [{ type: 'text', text: 'Error: rate limited' }],
        isError: true,
      });

      const result = await probeImage({ imageIds: ['img_a1b2c3d4e5f6'], question: 'Describe' }, createCtx());
      expect(result.text).toBe('Error: rate limited');
      expect(result.isError).toBe(true);
    });

    it('throws when toolContext.preferredVisionModel is missing', async () => {
      await expect(probeImage({ imageIds: ['img_a1b2c3d4e5f6'], question: '?' }, createCtx({ toolContext: {} }))).rejects.toThrow(
        'Probe image requires a configured preferred vision model',
      );
    });

    it('throws when preferredVisionModel is empty string', async () => {
      await expect(
        probeImage({ imageIds: ['img_a1b2c3d4e5f6'], question: '?' }, createCtx({ toolContext: { preferredVisionModel: '   ' } })),
      ).rejects.toThrow('Probe image requires a configured preferred vision model');
    });

    it('throws when agentToolContext is missing', async () => {
      await expect(
        probeImage({ imageIds: ['img_a1b2c3d4e5f6'], question: '?' }, createCtx({ agentToolContext: undefined })),
      ).rejects.toThrow('Image tools require an active agent tool context');
    });
  });

  describe('error propagation', () => {
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
});

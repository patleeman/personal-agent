import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createAgentSessionMock, getImageProbeAttachmentsMock, getImageProbeAttachmentsByIdMock } = vi.hoisted(() => ({
  createAgentSessionMock: vi.fn(),
  getImageProbeAttachmentsMock: vi.fn(),
  getImageProbeAttachmentsByIdMock: vi.fn(),
}));

vi.mock('@mariozechner/pi-coding-agent', () => ({
  AuthStorage: {
    create: vi.fn((path: string) => ({ path })),
  },
  createAgentSession: createAgentSessionMock,
  SessionManager: {
    inMemory: vi.fn((cwd: string) => ({ cwd })),
  },
}));

vi.mock('./imageProbeAttachmentStore.js', () => ({
  getImageProbeAttachments: getImageProbeAttachmentsMock,
  getImageProbeAttachmentsById: getImageProbeAttachmentsByIdMock,
}));

import { createImageProbeAgentExtension } from './imageProbeAgentExtension.js';

type RegisteredTool = Parameters<Parameters<typeof createImageProbeAgentExtension>[0]>[0] extends never
  ? never
  : Parameters<Parameters<typeof createImageProbeAgentExtension>[0]>[0];

function registerTool(options: { preferredVisionModel?: string } = {}) {
  let tool: RegisteredTool | null = null;
  createImageProbeAgentExtension({ getPreferredVisionModel: () => options.preferredVisionModel ?? 'openai/gpt-4o' })({
    registerTool: (registeredTool: RegisteredTool) => {
      tool = registeredTool;
    },
  } as never);
  if (!tool) throw new Error('tool was not registered');
  return tool;
}

const image = {
  type: 'image' as const,
  id: 'img_abc123abc123',
  data: 'aGVsbG8=',
  mimeType: 'image/png',
  name: 'screen.png',
  path: '/tmp/screen.png',
  sizeBytes: 5,
};

describe('image probe agent extension', () => {
  beforeEach(() => {
    createAgentSessionMock.mockReset();
    getImageProbeAttachmentsMock.mockReset();
    getImageProbeAttachmentsByIdMock.mockReset();
    getImageProbeAttachmentsMock.mockReturnValue([image]);
    getImageProbeAttachmentsByIdMock.mockReturnValue([image]);
  });

  it('runs the configured vision model with selected image IDs and guide-dog prompt guidance', async () => {
    let listener: ((event: { type: string; message: { role: string; content: unknown } }) => void) | null = null;
    const session = {
      subscribe: vi.fn((nextListener) => {
        listener = nextListener;
        return vi.fn();
      }),
      prompt: vi.fn(async () => {
        listener?.({
          type: 'message_end',
          message: { role: 'assistant', content: [{ type: 'text', text: 'The screenshot shows an error.' }] },
        });
      }),
      dispose: vi.fn(),
    };
    createAgentSessionMock.mockResolvedValue({ session });
    const tool = registerTool();

    const result = await tool.execute(
      'tool-1',
      { imageIds: ['img_abc123abc123'], question: 'What error is visible?' },
      undefined,
      undefined,
      {
        cwd: '/repo',
        sessionManager: { getSessionId: () => 'session-1' },
        modelRegistry: {
          getAvailable: () => [
            { provider: 'openai', id: 'gpt-4o', input: ['text', 'image'] },
            { provider: 'local', id: 'text-only', input: ['text'] },
          ],
        },
      } as never,
    );

    expect(createAgentSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        authStorage: expect.objectContaining({ path: expect.stringContaining('auth.json') }),
        model: { provider: 'openai', id: 'gpt-4o', input: ['text', 'image'] },
      }),
    );
    expect(session.prompt).toHaveBeenCalledWith(expect.stringContaining('Act as its eyes'), {
      images: [{ type: 'image', data: 'aGVsbG8=', mimeType: 'image/png' }],
    });
    expect(session.prompt).toHaveBeenCalledWith(expect.stringContaining('Fully describe the relevant visual parts'), expect.any(Object));
    expect(session.prompt).toHaveBeenCalledWith(expect.stringContaining('img_abc123abc123: screen.png (image/png)'), expect.any(Object));
    expect(result.content).toEqual([{ type: 'text', text: 'The screenshot shows an error.' }]);
    expect(result.details).toMatchObject({ imageIds: ['img_abc123abc123'], model: 'gpt-4o', provider: 'openai' });
  });

  it('rejects unknown image IDs', async () => {
    getImageProbeAttachmentsByIdMock.mockReturnValue([]);
    const tool = registerTool();

    await expect(
      tool.execute('tool-1', { imageIds: ['img_missing12345'], question: 'What is visible?' }, undefined, undefined, {
        cwd: '/repo',
        sessionManager: { getSessionId: () => 'session-1' },
        modelRegistry: { getAvailable: () => [] },
      } as never),
    ).rejects.toThrow('None of the requested image IDs are available');
  });

  it('requires the configured model to be available and image-capable', async () => {
    const tool = registerTool({ preferredVisionModel: 'local/text-only' });

    await expect(
      tool.execute('tool-1', { imageIds: ['img_abc123abc123'], question: 'What is visible?' }, undefined, undefined, {
        cwd: '/repo',
        sessionManager: { getSessionId: () => 'session-1' },
        modelRegistry: { getAvailable: () => [{ provider: 'local', id: 'text-only', input: ['text'] }] },
      } as never),
    ).rejects.toThrow('Configured vision model is not available or does not accept images');
  });

  it('returns classified, user-actionable failures from the vision subagent', async () => {
    const session = {
      subscribe: vi.fn(() => vi.fn()),
      prompt: vi.fn(async () => {
        throw new Error('402 insufficient credits');
      }),
      dispose: vi.fn(),
    };
    createAgentSessionMock.mockResolvedValue({ session });
    const tool = registerTool();

    const result = await tool.execute('tool-1', { imageIds: ['img_abc123abc123'], question: 'What is visible?' }, undefined, undefined, {
      cwd: '/repo',
      sessionManager: { getSessionId: () => 'session-1' },
      modelRegistry: { getAvailable: () => [{ provider: 'openai', id: 'gpt-4o', input: ['text', 'image'] }] },
    } as never);

    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({
      type: 'text',
      text: expect.stringContaining('billing or credit problem'),
    });
    expect(session.dispose).toHaveBeenCalled();
  });

  it('returns classified failures when the vision subagent records an assistant error message', async () => {
    const session = {
      messages: [
        {
          role: 'assistant',
          content: [],
          stopReason: 'error',
          errorMessage: '404 model: old-vision-model',
        },
      ],
      subscribe: vi.fn(() => vi.fn()),
      prompt: vi.fn(async () => {}),
      dispose: vi.fn(),
    };
    createAgentSessionMock.mockResolvedValue({ session });
    const tool = registerTool({ preferredVisionModel: 'anthropic/old-vision-model' });

    const result = await tool.execute('tool-1', { imageIds: ['img_abc123abc123'], question: 'What is visible?' }, undefined, undefined, {
      cwd: '/repo',
      sessionManager: { getSessionId: () => 'session-1' },
      modelRegistry: { getAvailable: () => [{ provider: 'anthropic', id: 'old-vision-model', input: ['text', 'image'] }] },
    } as never);

    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({
      type: 'text',
      text: expect.stringContaining('failed while analyzing the image'),
    });
  });
});

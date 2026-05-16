import { describe, expect, it, vi } from 'vitest';

const { runAgentTaskMock, getImageProbeAttachmentsMock, getImageProbeAttachmentsByIdMock } = vi.hoisted(() => ({
  runAgentTaskMock: vi.fn(),
  getImageProbeAttachmentsMock: vi.fn(),
  getImageProbeAttachmentsByIdMock: vi.fn(),
}));

vi.mock('@personal-agent/extensions/backend/agent', () => ({ runAgentTask: runAgentTaskMock }));
vi.mock('@personal-agent/extensions/backend/images', () => ({
  getImageProbeAttachments: getImageProbeAttachmentsMock,
  getImageProbeAttachmentsById: getImageProbeAttachmentsByIdMock,
}));

import { probeImage } from './backend.js';

const attachment = {
  id: 'img_a1b2c3d4e5f6',
  type: 'image',
  data: 'abc123',
  mimeType: 'image/png',
  name: 'screenshot.png',
  path: '/tmp/screenshot.png',
  sizeBytes: 3,
};

function createCtx(overrides?: Record<string, unknown>) {
  return {
    toolContext: { preferredVisionModel: 'provider/gpt-4-vision', sessionId: 'session-1', cwd: '/tmp' },
    ...overrides,
  } as never;
}

describe('system-image-probe backend', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('runs a host-owned agent task for selected image attachments', async () => {
    getImageProbeAttachmentsMock.mockReturnValue([attachment]);
    getImageProbeAttachmentsByIdMock.mockReturnValue([attachment]);
    runAgentTaskMock.mockResolvedValue({ text: 'The image shows a dashboard', model: 'gpt-4-vision', provider: 'provider' });

    const result = await probeImage({ imageIds: ['img_a1b2c3d4e5f6'], question: 'What is in this image?' }, createCtx());

    expect(result.text).toBe('The image shows a dashboard');
    expect(runAgentTaskMock).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: '/tmp',
        modelRef: 'provider/gpt-4-vision',
        tools: 'none',
        images: [{ type: 'image', data: 'abc123', mimeType: 'image/png' }],
      }),
      expect.anything(),
    );
  });

  it('returns classified errors from the host agent task', async () => {
    getImageProbeAttachmentsMock.mockReturnValue([attachment]);
    getImageProbeAttachmentsByIdMock.mockReturnValue([attachment]);
    runAgentTaskMock.mockRejectedValue(new Error('model does not accept images'));

    const result = await probeImage({ imageIds: ['img_a1b2c3d4e5f6'], question: 'Describe' }, createCtx());

    expect(result.isError).toBe(true);
    expect(result.text).toContain('does not appear to support this image request');
  });

  it('throws when preferredVisionModel is missing', async () => {
    await expect(
      probeImage({ imageIds: ['img_a1b2c3d4e5f6'], question: '?' }, createCtx({ toolContext: { sessionId: 'session-1' } })),
    ).rejects.toThrow('Probe image requires a configured preferred vision model');
  });

  it('throws for duplicate image ids before probing attachments', async () => {
    await expect(probeImage({ imageIds: ['img_a1b2c3d4e5f6', 'img_a1b2c3d4e5f6'], question: '?' }, createCtx())).rejects.toThrow(
      'Duplicate image ID: img_a1b2c3d4e5f6',
    );
    expect(getImageProbeAttachmentsMock).not.toHaveBeenCalled();
    expect(getImageProbeAttachmentsByIdMock).not.toHaveBeenCalled();
  });

  it('throws for unknown image ids', async () => {
    getImageProbeAttachmentsMock.mockReturnValue([attachment]);
    getImageProbeAttachmentsByIdMock.mockReturnValue([]);

    await expect(probeImage({ imageIds: ['img_a1b2c3d4e5f6'], question: '?' }, createCtx())).rejects.toThrow(
      'None of the requested image IDs are available',
    );
  });
});

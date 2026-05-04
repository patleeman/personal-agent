import { beforeEach, describe, expect, it, vi } from 'vitest';

const { rememberImageProbeAttachmentsMock, readSavedModelPreferencesMock } = vi.hoisted(() => ({
  rememberImageProbeAttachmentsMock: vi.fn(),
  readSavedModelPreferencesMock: vi.fn(() => ({ currentVisionModel: 'openai/gpt-4o' })),
}));

vi.mock('../extensions/imageProbeAttachmentStore.js', () => ({
  rememberImageProbeAttachments: rememberImageProbeAttachmentsMock,
}));

vi.mock('../models/modelPreferences.js', () => ({
  readSavedModelPreferences: readSavedModelPreferencesMock,
}));

vi.mock('../ui/settingsPersistence.js', () => ({
  DEFAULT_RUNTIME_SETTINGS_FILE: '/runtime/settings.json',
}));

import { runPromptOnLiveEntry } from './liveSessionPromptOps.js';

function createEntry(model: unknown) {
  return {
    sessionId: 'session-1',
    session: {
      model,
      prompt: vi.fn(async () => undefined),
      steer: vi.fn(async () => undefined),
      followUp: vi.fn(async () => undefined),
    },
  };
}

const callbacks = {
  repairLiveSessionTranscriptTail: vi.fn(),
  broadcastQueueState: vi.fn(),
};

describe('runPromptOnLiveEntry image probing', () => {
  beforeEach(() => {
    rememberImageProbeAttachmentsMock.mockReset();
    rememberImageProbeAttachmentsMock.mockImplementation((_sessionId, images) =>
      images.map((image: { name?: string; mimeType: string }, index: number) => ({
        ...image,
        id: `img_00000000000${index}`,
        path: `/tmp/image-${index}.png`,
        sizeBytes: 5,
      })),
    );
    readSavedModelPreferencesMock.mockReset();
    readSavedModelPreferencesMock.mockReturnValue({ currentVisionModel: 'openai/gpt-4o' });
    callbacks.repairLiveSessionTranscriptTail.mockReset();
    callbacks.broadcastQueueState.mockReset();
  });

  it('routes image prompts through probe_image guidance for text-only models', async () => {
    const entry = createEntry({ id: 'text-model', input: ['text'] });
    const images = [{ type: 'image' as const, data: 'aGVsbG8=', mimeType: 'image/png', name: 'screen.png' }];

    await runPromptOnLiveEntry(entry, 'What is wrong here?', undefined, images, callbacks);

    expect(rememberImageProbeAttachmentsMock).toHaveBeenCalledWith('session-1', images);
    expect(entry.session.prompt).toHaveBeenCalledTimes(1);
    expect(entry.session.prompt).toHaveBeenCalledWith(expect.stringContaining('Use the probe_image tool with explicit imageIds'));
    expect(entry.session.prompt).toHaveBeenCalledWith(expect.stringContaining('img_000000000000: screen.png (image/png)'));
  });

  it('asks for vision model configuration when text-only models receive images without a preferred vision model', async () => {
    readSavedModelPreferencesMock.mockReturnValue({ currentVisionModel: '' });
    const entry = createEntry({ id: 'text-model', input: ['text'] });
    const images = [{ type: 'image' as const, data: 'aGVsbG8=', mimeType: 'image/png', name: 'screen.png' }];

    await runPromptOnLiveEntry(entry, 'What is wrong here?', undefined, images, callbacks);

    expect(rememberImageProbeAttachmentsMock).toHaveBeenCalledWith('session-1', images);
    expect(entry.session.prompt).toHaveBeenCalledWith(expect.stringContaining('No preferred vision model is configured'));
  });

  it('passes images directly to image-capable models', async () => {
    const entry = createEntry({ id: 'vision-model', input: ['text', 'image'] });
    const images = [{ type: 'image' as const, data: 'aGVsbG8=', mimeType: 'image/png', name: 'screen.png' }];

    await runPromptOnLiveEntry(entry, 'What is wrong here?', undefined, images, callbacks);

    expect(rememberImageProbeAttachmentsMock).not.toHaveBeenCalled();
    expect(entry.session.prompt).toHaveBeenCalledWith('What is wrong here?', { images });
  });
});

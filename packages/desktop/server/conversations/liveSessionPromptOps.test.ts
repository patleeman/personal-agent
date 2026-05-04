import { beforeEach, describe, expect, it, vi } from 'vitest';

const { rememberImageProbeAttachmentsMock } = vi.hoisted(() => ({
  rememberImageProbeAttachmentsMock: vi.fn(),
}));

vi.mock('../extensions/imageProbeAttachmentStore.js', () => ({
  rememberImageProbeAttachments: rememberImageProbeAttachmentsMock,
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
    callbacks.repairLiveSessionTranscriptTail.mockReset();
    callbacks.broadcastQueueState.mockReset();
  });

  it('routes image prompts through probe_image guidance for text-only models', async () => {
    const entry = createEntry({ id: 'text-model', input: ['text'] });
    const images = [{ type: 'image' as const, data: 'aGVsbG8=', mimeType: 'image/png', name: 'screen.png' }];

    await runPromptOnLiveEntry(entry, 'What is wrong here?', undefined, images, callbacks);

    expect(rememberImageProbeAttachmentsMock).toHaveBeenCalledWith('session-1', images);
    expect(entry.session.prompt).toHaveBeenCalledTimes(1);
    expect(entry.session.prompt).toHaveBeenCalledWith(
      expect.stringContaining('Use the probe_image tool to inspect the latest attached image(s)'),
    );
  });

  it('passes images directly to image-capable models', async () => {
    const entry = createEntry({ id: 'vision-model', input: ['text', 'image'] });
    const images = [{ type: 'image' as const, data: 'aGVsbG8=', mimeType: 'image/png', name: 'screen.png' }];

    await runPromptOnLiveEntry(entry, 'What is wrong here?', undefined, images, callbacks);

    expect(rememberImageProbeAttachmentsMock).not.toHaveBeenCalled();
    expect(entry.session.prompt).toHaveBeenCalledWith('What is wrong here?', { images });
  });
});

import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { createAgentSessionMock, readSavedModelPreferencesMock } = vi.hoisted(() => ({
  createAgentSessionMock: vi.fn(),
  readSavedModelPreferencesMock: vi.fn(() => ({ currentVisionModel: 'openai/gpt-4o' })),
}));

vi.mock('@earendil-works/pi-coding-agent', async () => {
  const actual = await vi.importActual<typeof import('@earendil-works/pi-coding-agent')>('@earendil-works/pi-coding-agent');
  return {
    ...actual,
    createAgentSession: createAgentSessionMock,
    SessionManager: {
      ...actual.SessionManager,
      inMemory: vi.fn((cwd: string) => ({ cwd })),
    },
  };
});

vi.mock('../models/modelPreferences.js', () => ({
  readSavedModelPreferences: readSavedModelPreferencesMock,
}));

vi.mock('../ui/settingsPersistence.js', () => ({
  DEFAULT_RUNTIME_SETTINGS_FILE: '/runtime/settings.json',
}));

import { createImageProbeAgentExtension } from '../../../../experimental-extensions/extensions/system-images/src/probeImageTool.js';
import { clearImageProbeAttachmentCacheForTests } from '../extensions/imageProbeAttachmentStore.js';
import { runPromptOnLiveEntry } from './liveSessionPromptOps.js';

const tempDirs: string[] = [];
const originalStateRoot = process.env.PERSONAL_AGENT_STATE_ROOT;

type RegisteredTool = Parameters<Parameters<typeof createImageProbeAgentExtension>[0]>[0] extends never
  ? never
  : Parameters<Parameters<typeof createImageProbeAgentExtension>[0]>[0];

beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), 'pa-live-image-probe-e2e-'));
  tempDirs.push(dir);
  process.env.PERSONAL_AGENT_STATE_ROOT = dir;
  createAgentSessionMock.mockReset();
  readSavedModelPreferencesMock.mockReset();
  readSavedModelPreferencesMock.mockReturnValue({ currentVisionModel: 'openai/gpt-4o' });
  clearImageProbeAttachmentCacheForTests();
});

afterEach(async () => {
  clearImageProbeAttachmentCacheForTests();
  if (originalStateRoot === undefined) {
    delete process.env.PERSONAL_AGENT_STATE_ROOT;
  } else {
    process.env.PERSONAL_AGENT_STATE_ROOT = originalStateRoot;
  }
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('text-only live session image probing flow', () => {
  it('stores text-only prompt images, exposes stable IDs, and sends selected bytes to the vision subagent', async () => {
    const originalImageData = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from('fake-image-pixels'),
    ]).toString('base64');
    const entry = {
      sessionId: 'session-e2e',
      session: {
        model: { provider: 'local', id: 'text-only', input: ['text'] },
        prompt: vi.fn(async () => undefined),
        steer: vi.fn(async () => undefined),
        followUp: vi.fn(async () => undefined),
      },
    };

    await runPromptOnLiveEntry(
      entry as never,
      'What does this screenshot show?',
      undefined,
      [{ type: 'image', data: originalImageData, mimeType: 'image/png', name: 'screen.png' }],
      {
        repairLiveSessionTranscriptTail: vi.fn(),
        broadcastQueueState: vi.fn(),
      },
    );

    const promptText = entry.session.prompt.mock.calls[0]?.[0] as string;
    const imageId = promptText.match(/img_[a-f0-9]{12}/)?.[0];
    expect(imageId).toBeTruthy();
    expect(promptText).toContain(`- ${imageId}: screen.png (image/png)`);
    expect(entry.session.prompt).toHaveBeenCalledWith(expect.any(String));

    let listener: ((event: { type: string; message: { role: string; content: unknown } }) => void) | null = null;
    const visionSession = {
      subscribe: vi.fn((nextListener) => {
        listener = nextListener;
        return vi.fn();
      }),
      prompt: vi.fn(async () => {
        listener?.({
          type: 'message_end',
          message: { role: 'assistant', content: [{ type: 'text', text: 'It shows a fake screenshot.' }] },
        });
      }),
      dispose: vi.fn(),
    };
    createAgentSessionMock.mockResolvedValue({ session: visionSession });

    let tool: RegisteredTool | null = null;
    createImageProbeAgentExtension({ getPreferredVisionModel: () => 'openai/gpt-4o' })({
      registerTool: (registeredTool: RegisteredTool) => {
        tool = registeredTool;
      },
    } as never);

    const result = await tool!.execute(
      'tool-1',
      { imageIds: [imageId!], question: 'What does this screenshot show?' },
      undefined,
      undefined,
      {
        cwd: '/repo',
        sessionManager: { getSessionId: () => 'session-e2e' },
        modelRegistry: { getAvailable: () => [{ provider: 'openai', id: 'gpt-4o', input: ['text', 'image'] }] },
      } as never,
    );

    expect(visionSession.prompt).toHaveBeenCalledWith(expect.stringContaining(`${imageId}: screen.png (image/png)`), {
      images: [{ type: 'image', data: originalImageData, mimeType: 'image/png' }],
    });
    expect(result.content).toEqual([{ type: 'text', text: 'It shows a fake screenshot.' }]);
    expect(result.details).toMatchObject({ imageIds: [imageId], model: 'gpt-4o', provider: 'openai' });
  });
});

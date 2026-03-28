import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  parseDistillConversationMemoryRunArgs,
  runDistillConversationMemoryCli,
} from './distillConversationMemoryRun.js';

function encodePayload(payload: unknown): string {
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

describe('distillConversationMemoryRun', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  it('parses required args and normalizes optional payload fields', () => {
    expect(parseDistillConversationMemoryRunArgs([
      '--port',
      '4321',
      '--profile',
      ' assistant ',
      '--payload',
      encodePayload({
        conversationId: ' conv-123 ',
        anchorMessageId: ' anchor-1 ',
        checkpointId: ' checkpoint-1 ',
        title: ' Distilled note ',
        summary: ' Useful summary ',
        tags: [' alpha ', '', 'beta', 123],
        mode: 'auto',
        trigger: 'turn_end',
        emitActivity: false,
      }),
    ])).toEqual({
      port: 4321,
      profile: 'assistant',
      payload: {
        conversationId: 'conv-123',
        anchorMessageId: 'anchor-1',
        checkpointId: 'checkpoint-1',
        title: 'Distilled note',
        summary: 'Useful summary',
        tags: ['alpha', 'beta'],
        mode: 'auto',
        trigger: 'turn_end',
        emitActivity: false,
      },
    });
  });

  it('posts the distillation request and reports success', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      disposition: 'created',
      memory: {
        id: 'memory-1',
        title: 'Distilled note',
      },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));

    await expect(runDistillConversationMemoryCli([
      '--port',
      '4321',
      '--profile',
      'assistant',
      '--payload',
      encodePayload({
        conversationId: 'conv-123',
        title: 'Distilled note',
        mode: 'manual',
        emitActivity: false,
      }),
    ], { fetchImpl })).resolves.toBe(0);

    expect(fetchImpl).toHaveBeenCalledWith(
      'http://127.0.0.1:4321/api/conversations/conv-123/notes/distill-now',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          Origin: 'http://127.0.0.1:4321',
        }),
      }),
    );

    expect(fetchImpl.mock.calls[0]?.[1]?.body).toBe(JSON.stringify({
      profile: 'assistant',
      title: 'Distilled note',
      summary: undefined,
      anchorMessageId: undefined,
      checkpointId: undefined,
      tags: undefined,
      mode: 'manual',
      trigger: undefined,
      emitActivity: false,
    }));
    expect(consoleLogSpy).toHaveBeenCalledWith('distill completed disposition=created noteId=memory-1 title=Distilled note');
  });

  it('fails when the distillation request returns an error', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response('boom', {
      status: 500,
      headers: { 'Content-Type': 'text/plain' },
    }));

    await expect(runDistillConversationMemoryCli([
      '--port',
      '4321',
      '--profile',
      'assistant',
      '--payload',
      encodePayload({ conversationId: 'conv-123' }),
    ], { fetchImpl })).rejects.toThrow('Distillation request failed (500): boom');
  });
});

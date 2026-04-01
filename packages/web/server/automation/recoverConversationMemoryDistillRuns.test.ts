import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  parseRecoverConversationMemoryDistillRunsArgs,
  runRecoverConversationMemoryDistillRunsCli,
} from './recoverConversationMemoryDistillRuns.js';

describe('recoverConversationMemoryDistillRuns', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  it('parses required args and repeated run ids', () => {
    expect(parseRecoverConversationMemoryDistillRunsArgs([
      '--port',
      '4321',
      '--profile',
      'datadog',
      '--run-id',
      'run-1',
      '--run-id',
      'run-2',
      '--run-id',
      'run-1',
    ])).toEqual({
      port: 4321,
      profile: 'datadog',
      runIds: ['run-1', 'run-2'],
    });
  });

  it('recovers each run in order and accepts already-completed runs', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        resolved: 'recovered',
        conversationId: 'conv-1',
        memoryId: 'note-1',
        referencePath: 'references/one.md',
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        resolved: 'already-completed',
        conversationId: 'conv-2',
        memoryId: 'note-2',
        referencePath: 'references/two.md',
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));

    await expect(runRecoverConversationMemoryDistillRunsCli([
      '--port',
      '4321',
      '--profile',
      'datadog',
      '--run-id',
      'run-1',
      '--run-id',
      'run-2',
    ], { fetchImpl })).resolves.toBe(0);

    expect(fetchImpl).toHaveBeenNthCalledWith(1, 'http://127.0.0.1:4321/api/runs/run-1/node-distill/recover-now', expect.objectContaining({
      method: 'POST',
    }));
    expect(fetchImpl).toHaveBeenNthCalledWith(2, 'http://127.0.0.1:4321/api/runs/run-2/node-distill/recover-now', expect.objectContaining({
      method: 'POST',
    }));
  });

  it('fails the batch when any recovery request fails', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        resolved: 'recovered',
        conversationId: 'conv-1',
        memoryId: 'note-1',
        referencePath: 'references/one.md',
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response('boom', {
        status: 500,
        headers: { 'Content-Type': 'text/plain' },
      }));

    await expect(runRecoverConversationMemoryDistillRunsCli([
      '--port',
      '4321',
      '--profile',
      'datadog',
      '--run-id',
      'run-1',
      '--run-id',
      'run-2',
    ], { fetchImpl })).rejects.toThrow('Failed to recover 1 of 2 node distillation runs.');
  });
});

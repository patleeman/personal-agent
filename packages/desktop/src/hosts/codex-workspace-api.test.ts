import { Buffer } from 'node:buffer';
import { describe, expect, it, vi } from 'vitest';
import type { CodexThread } from '@personal-agent/core';
import type { DesktopApiStreamEvent } from './types.js';
import { CodexWorkspaceApiAdapter } from './codex-workspace-api.js';

function createThread(id: string): CodexThread {
  return {
    id,
    forkedFromId: null,
    preview: '',
    ephemeral: false,
    modelProvider: 'openai-codex',
    createdAt: 1,
    updatedAt: 1,
    status: { type: 'idle' },
    path: `/sessions/${id}.jsonl`,
    cwd: '/repo',
    cliVersion: '0.0.1',
    source: 'desktop',
    agentNickname: null,
    agentRole: null,
    gitInfo: null,
    name: 'Remote thread',
    turns: [],
  };
}

function parseJsonBody(response: { body: Uint8Array }): unknown {
  return JSON.parse(Buffer.from(response.body).toString('utf-8'));
}

describe('CodexWorkspaceApiAdapter', () => {
  it('accepts image-only prompts and forwards images to turn/start', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce({ turn: { id: 'turn-1' } });
    const subscribeNotifications = vi.fn().mockReturnValue(() => undefined);

    const adapter = new CodexWorkspaceApiAdapter({
      request,
      subscribeNotifications,
    } as never);

    const response = await adapter.dispatchApiRequest({
      method: 'POST',
      path: '/api/live-sessions/thread-1/prompt',
      body: {
        images: [{ data: 'abc123', mimeType: 'image/png', name: 'screen.png' }],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(parseJsonBody(response)).toMatchObject({ ok: true, accepted: true, delivery: 'started' });
    expect(request).toHaveBeenCalledWith('turn/start', {
      threadId: 'thread-1',
      input: [],
      images: [{ data: 'abc123', mimeType: 'image/png', name: 'screen.png' }],
    });
  });

  it('rejects empty prompts with the same validation message used by local sessions', async () => {
    const request = vi.fn();
    const adapter = new CodexWorkspaceApiAdapter({
      request,
      subscribeNotifications: vi.fn().mockReturnValue(() => undefined),
    } as never);

    const response = await adapter.dispatchApiRequest({
      method: 'POST',
      path: '/api/live-sessions/thread-1/prompt',
      body: {},
    });

    expect(response.statusCode).toBe(400);
    expect(parseJsonBody(response)).toEqual({ error: 'text, images, or attachmentRefs required' });
    expect(request).not.toHaveBeenCalled();
  });

  it('supports /bash on remote live sessions and emits tool events to active stream subscribers', async () => {
    const thread = createThread('thread-1');
    const notifications = new Set<(event: { method?: string; params?: unknown }) => void>();
    const request = vi.fn((method: string) => {
      if (method === 'thread/read') {
        return Promise.resolve({ thread });
      }
      if (method === 'thread/loaded/list') {
        return Promise.resolve({ data: ['thread-1'] });
      }
      if (method === 'model/list') {
        return Promise.resolve({ data: [{ model: 'gpt-5.4', isDefault: true }] });
      }
      if (method === 'thread/resume') {
        return Promise.resolve({});
      }
      if (method === 'command/exec') {
        return Promise.resolve({ exitCode: 0, stdout: 'ok\n', stderr: '' });
      }
      throw new Error(`Unexpected method: ${method}`);
    });
    const subscribeNotifications = vi.fn((listener: (event: { method?: string; params?: unknown }) => void) => {
      notifications.add(listener);
      return () => notifications.delete(listener);
    });

    const adapter = new CodexWorkspaceApiAdapter({
      request,
      subscribeNotifications,
    } as never);

    const streamEvents: DesktopApiStreamEvent[] = [];
    const unsubscribe = await adapter.subscribeApiStream('/api/live-sessions/thread-1/events', (event) => {
      streamEvents.push(event);
    });

    const response = await adapter.dispatchApiRequest({
      method: 'POST',
      path: '/api/live-sessions/thread-1/bash',
      body: { command: 'echo ok' },
    });

    unsubscribe();

    expect(response.statusCode).toBe(200);
    expect(parseJsonBody(response)).toEqual({
      ok: true,
      result: {
        output: 'ok\n',
        exitCode: 0,
      },
    });

    expect(request).toHaveBeenCalledWith('command/exec', {
      command: ['/usr/bin/env', 'bash', '-lc', 'echo ok'],
      cwd: '/repo',
    });

    const streamedPayloads = streamEvents
      .filter((event) => event.type === 'message' && typeof event.data === 'string')
      .map((event) => JSON.parse((event as { data: string }).data) as { type?: string; toolName?: string; output?: string });

    expect(streamedPayloads).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'tool_start', toolName: 'bash' }),
      expect.objectContaining({ type: 'tool_end', toolName: 'bash', output: 'ok\n' }),
    ]));
  });
});

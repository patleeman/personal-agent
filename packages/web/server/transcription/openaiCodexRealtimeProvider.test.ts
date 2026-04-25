import { describe, expect, it } from 'vitest';
import { testExports } from './openaiCodexRealtimeProvider.js';

describe('OpenAI Codex realtime transcription provider helpers', () => {
  it('resolves the ChatGPT Codex realtime websocket URL', () => {
    expect(testExports.resolveCodexRealtimeWebSocketUrl(undefined)).toBe('wss://chatgpt.com/backend-api/codex?model=gpt-realtime-1.5');
    expect(testExports.resolveCodexRealtimeWebSocketUrl('https://chatgpt.com/backend-api')).toBe('wss://chatgpt.com/backend-api/codex?model=gpt-realtime-1.5');
    expect(testExports.resolveCodexRealtimeWebSocketUrl('https://chatgpt.com/backend-api/codex')).toBe('wss://chatgpt.com/backend-api/codex?model=gpt-realtime-1.5');
    expect(testExports.resolveCodexRealtimeWebSocketUrl('wss://example.test/custom/realtime')).toBe('wss://example.test/custom/realtime?model=gpt-realtime-1.5');
    expect(testExports.resolveCodexRealtimeWebSocketUrl('wss://example.test/custom/realtime?model=custom-realtime')).toBe('wss://example.test/custom/realtime?model=custom-realtime');
  });

  it('builds websocket headers that match the Codex realtime handshake shape', () => {
    const headers = testExports.buildCodexRealtimeHeaders({
      apiKey: 'test-token',
      sessionId: 'session-123',
      headers: { originator: 'custom-originator' },
    });

    expect(headers).toMatchObject({
      authorization: 'Bearer test-token',
      originator: 'codex_cli_rs',
      'x-session-id': 'session-123',
    });
    expect(headers).not.toHaveProperty('openai-beta');
  });

  it('builds the transcription session update payload', () => {
    expect(testExports.createSessionUpdate('gpt-4o-mini-transcribe')).toEqual({
      type: 'session.update',
      session: {
        type: 'transcription',
        audio: {
          input: {
            format: { type: 'audio/pcm', rate: 24000 },
            transcription: { model: 'gpt-4o-mini-transcribe' },
          },
        },
      },
    });
  });

  it('normalizes transcript deltas and completion events', () => {
    expect(testExports.parseRealtimeTranscriptEvent({
      type: 'conversation.item.input_audio_transcription.delta',
      delta: 'hello',
    })).toEqual({ type: 'delta', delta: 'hello' });

    expect(testExports.parseRealtimeTranscriptEvent({
      type: 'conversation.item.input_audio_transcription.completed',
      transcript: 'hello world',
    })).toMatchObject({
      type: 'done',
      text: 'hello world',
      result: { text: 'hello world', provider: 'openai-codex-realtime' },
    });
  });
});

import { describe, expect, it, vi } from 'vitest';
import { OpenAITranscriptionProvider, testExports } from './openaiApiProvider.js';

function createModelRegistry(apiKey = 'sk-test') {
  return {
    find: vi.fn((_provider: string, modelId: string) => ({
      id: modelId,
      name: modelId,
      provider: 'openai',
      api: 'openai-responses',
      baseUrl: 'https://api.openai.com/v1',
      input: ['text'],
    })),
    getApiKeyAndHeaders: vi.fn(async () => ({ ok: true as const, apiKey })),
  };
}

describe('OpenAI transcription provider', () => {
  it('parses verbose transcription responses', () => {
    expect(testExports.parseOpenAITranscriptionResponse({
      text: ' hello world ',
      duration: 1.234,
      segments: [{ text: ' hello ', start: 0, end: 0.5 }, { text: '' }],
    })).toEqual({
      text: 'hello world',
      durationMs: 1234,
      segments: [{ text: 'hello', startMs: 0, endMs: 500 }],
    });
  });

  it('posts audio to OpenAI audio transcriptions', async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request) => new Response(JSON.stringify({ text: 'dictated text' }), {
      status: 200,
      statusText: 'OK',
    }));
    const provider = new OpenAITranscriptionProvider({
      modelRegistry: createModelRegistry(),
      model: 'gpt-4o-mini-transcribe',
      fetch: fetchMock as typeof fetch,
    });

    const result = await provider.transcribeFile({
      data: Buffer.from('audio'),
      mimeType: 'audio/webm',
      fileName: 'dictation.webm',
    });

    expect(result).toMatchObject({ text: 'dictated text', provider: 'openai-api', model: 'gpt-4o-mini-transcribe' });
    expect(fetchMock).toHaveBeenCalledWith('https://api.openai.com/v1/audio/transcriptions', expect.objectContaining({
      method: 'POST',
      headers: expect.any(Headers),
      body: expect.any(FormData),
    }));
    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Headers;
    expect(headers.get('Authorization')).toBe('Bearer sk-test');
  });
});

import { describe, expect, it } from 'vitest';
import { testExports } from './openaiCodexRealtimeProvider.js';

describe('OpenAI Codex transcription provider helpers', () => {
  it('resolves the ChatGPT Codex transcribe URL', () => {
    expect(testExports.resolveCodexTranscribeUrl(undefined)).toBe('https://chatgpt.com/backend-api/transcribe');
    expect(testExports.resolveCodexTranscribeUrl('https://chatgpt.com/backend-api')).toBe('https://chatgpt.com/backend-api/transcribe');
    expect(testExports.resolveCodexTranscribeUrl('https://chatgpt.com/backend-api/codex')).toBe('https://chatgpt.com/backend-api/transcribe');
    expect(testExports.resolveCodexTranscribeUrl('https://example.test/custom')).toBe('https://example.test/custom/transcribe');
    expect(testExports.resolveCodexTranscribeUrl('https://example.test/custom/transcribe')).toBe('https://example.test/custom/transcribe');
  });

  it('builds headers that match the Codex transcribe request shape', () => {
    const headers = testExports.buildCodexTranscribeHeaders({
      apiKey: 'test-token',
      headers: { originator: 'custom-originator' },
    });

    expect(headers).toMatchObject({
      authorization: 'Bearer test-token',
      originator: 'codex_cli_rs',
    });
    expect(headers).not.toHaveProperty('openai-beta');
    expect(headers).not.toHaveProperty('content-type');
  });

  it('parses transcribe responses', () => {
    expect(testExports.parseTranscribeResponse({ text: 'hello world' })).toBe('hello world');
    expect(testExports.parseTranscribeResponse({ transcript: 'hello world' })).toBe('hello world');
    expect(testExports.parseTranscribeResponse({ transcription: 'hello world' })).toBe('hello world');
    expect(testExports.parseTranscribeResponse({ segments: [{ text: 'hello' }, { text: 'world' }] })).toBe('hello world');
    expect(testExports.parseTranscribeResponse({})).toBe('');
    expect(testExports.parseTranscribeResponse(null)).toBe('');
  });
});

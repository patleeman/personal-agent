import { describe, expect, it } from 'vitest';

import { testExports } from './transcription.js';

const { extractTranscriptText, buildMultipartBody } = testExports;

// ── transcription — helper functions ──────────────────────────────────────

describe('buildMultipartBody', () => {
  it('builds a multipart body with audio data', () => {
    const result = buildMultipartBody({
      dataBase64: Buffer.from('fake audio data').toString('base64'),
      mimeType: 'audio/webm',
      fileName: 'test.webm',
    });

    expect(result.contentType).toContain('multipart/form-data');
    expect(result.body.length).toBeGreaterThan(0);
    expect(result.body.toString()).toContain('audio/webm');
    expect(result.body.toString()).toContain('test.webm');
  });

  it('includes language when provided', () => {
    const result = buildMultipartBody({
      dataBase64: Buffer.from('data').toString('base64'),
      language: 'en',
    });

    const bodyText = result.body.toString();
    expect(bodyText).toContain('language');
    expect(bodyText).toContain('en');
  });
});

describe('extractTranscriptText', () => {
  it('returns a plain string as-is', () => {
    expect(extractTranscriptText('hello world')).toBe('hello world');
  });

  it('extracts text from nested object', () => {
    const input = { text: 'hello world', confidence: 0.95 };
    expect(extractTranscriptText(input)).toBe('hello world');
  });

  it('extracts transcript field when text is absent', () => {
    const input = { transcript: 'spoken text' };
    expect(extractTranscriptText(input)).toBe('spoken text');
  });

  it('extracts transcription field', () => {
    const input = { transcription: 'more spoken text' };
    expect(extractTranscriptText(input)).toBe('more spoken text');
  });

  it('extracts from segments array', () => {
    const input = { segments: [{ text: 'first' }, { text: 'second' }] };
    expect(extractTranscriptText(input)).toBe('first second');
  });

  it('extracts from items array', () => {
    const input = { items: ['word1', 'word2'] };
    expect(extractTranscriptText(input)).toBe('word1 word2');
  });

  it('returns empty string for null', () => {
    expect(extractTranscriptText(null)).toBe('');
  });

  it('returns empty string for undefined', () => {
    expect(extractTranscriptText(undefined)).toBe('');
  });

  it('returns empty string for number', () => {
    expect(extractTranscriptText(42)).toBe('');
  });

  it('joins array of strings with spaces', () => {
    expect(extractTranscriptText(['hello', 'world'])).toBe('hello world');
  });

  it('prefers text over results field', () => {
    const input = { text: 'primary', results: [{ transcript: 'secondary' }] };
    expect(extractTranscriptText(input)).toBe('primary');
  });
});

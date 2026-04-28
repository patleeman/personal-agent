import { describe, expect, it } from 'vitest';
import {
  createModelEditorDraft,
  createProviderEditorDraft,
  formatJsonObject,
  parseOptionalFiniteNumber,
  parseOptionalJsonObject,
  parseOptionalNonNegativeNumber,
  parseOptionalPositiveInteger,
  parseOptionalStringRecord,
} from './modelProviderEditorDrafts.js';

describe('modelProviderEditorDrafts', () => {
  it('creates editable provider drafts from persisted config', () => {
    expect(createProviderEditorDraft({
      id: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      api: 'openai-responses',
      apiKey: 'env:OPENAI_API_KEY',
      authHeader: true,
      headers: { 'x-test': '1' },
      compat: { foo: true },
      modelOverrides: { 'gpt-5': { contextWindow: 400000 } },
      models: [],
    })).toMatchObject({
      id: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      api: 'openai-responses',
      apiKey: 'env:OPENAI_API_KEY',
      authHeader: true,
      headersText: '{\n  "x-test": "1"\n}',
      compatText: '{\n  "foo": true\n}',
      modelOverridesText: '{\n  "gpt-5": {\n    "contextWindow": 400000\n  }\n}',
    });
  });

  it('creates editable model drafts with practical defaults', () => {
    expect(createModelEditorDraft(null)).toMatchObject({
      id: '',
      contextWindow: '128000',
      maxTokens: '16384',
      costInput: '0',
      acceptsImages: false,
    });

    expect(createModelEditorDraft({
      id: 'gpt-5',
      name: 'GPT-5',
      reasoning: true,
      input: ['text', 'image'],
      contextWindow: 400000,
      maxTokens: 32000,
      cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 0.5 },
    })).toMatchObject({
      id: 'gpt-5',
      name: 'GPT-5',
      reasoning: true,
      acceptsImages: true,
      contextWindow: '400000',
      maxTokens: '32000',
      costInput: '1',
      costOutput: '2',
      costCacheRead: '0.1',
      costCacheWrite: '0.5',
    });
  });

  it('parses optional config fields with clear errors', () => {
    expect(formatJsonObject(undefined)).toBe('');
    expect(parseOptionalJsonObject('', 'Compat')).toBeUndefined();
    expect(parseOptionalJsonObject('{"a":1}', 'Compat')).toEqual({ a: 1 });
    expect(parseOptionalStringRecord('{"x":"y"}', 'Headers')).toEqual({ x: 'y' });
    expect(parseOptionalFiniteNumber('42', 'Context window')).toBe(42);
    expect(parseOptionalPositiveInteger('42', 'Context window')).toBe(42);
    expect(parseOptionalNonNegativeNumber('0.25', 'Input cost')).toBe(0.25);

    expect(() => parseOptionalJsonObject('[]', 'Compat')).toThrow('Compat must be a JSON object.');
    expect(() => parseOptionalStringRecord('{"x":1}', 'Headers')).toThrow('Headers values must all be strings.');
    expect(() => parseOptionalFiniteNumber('nope', 'Context window')).toThrow('Context window must be a valid number.');
    expect(() => parseOptionalPositiveInteger('42.5', 'Context window')).toThrow('Context window must be a positive integer.');
    expect(() => parseOptionalNonNegativeNumber('-1', 'Input cost')).toThrow('Input cost must be a non-negative number.');
  });
});

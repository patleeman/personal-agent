import { describe, expect, it } from 'vitest';

import { StaticTranscriptionProviderRegistry } from './registry.js';
import type { TranscriptionProvider, TranscriptionProviderId } from './types.js';

function mockProvider(id: TranscriptionProviderId, name: string): TranscriptionProvider {
  return { id, name, transcribe: async () => '', dispose: async () => {} } as TranscriptionProvider;
}

describe('StaticTranscriptionProviderRegistry', () => {
  it('lists all registered providers', () => {
    const p1 = mockProvider('whisper-local', 'Local Whisper');
    const p2 = mockProvider('whisper-cloud', 'Cloud Whisper');
    const registry = new StaticTranscriptionProviderRegistry([p1, p2]);
    expect(registry.list()).toHaveLength(2);
    expect(registry.list()).toContain(p1);
    expect(registry.list()).toContain(p2);
  });

  it('gets a provider by id', () => {
    const p = mockProvider('whisper-local', 'Local Whisper');
    const registry = new StaticTranscriptionProviderRegistry([p]);
    expect(registry.get('whisper-local')).toBe(p);
  });

  it('returns undefined for unknown provider', () => {
    const registry = new StaticTranscriptionProviderRegistry([]);
    expect(registry.get('nonexistent' as any)).toBeUndefined();
  });

  describe('require', () => {
    it('returns provider when found', () => {
      const p = mockProvider('whisper-local', 'Local');
      const registry = new StaticTranscriptionProviderRegistry([p]);
      expect(registry.require('whisper-local')).toBe(p);
    });

    it('throws when provider id is null', () => {
      const registry = new StaticTranscriptionProviderRegistry([]);
      expect(() => registry.require(null)).toThrow('Choose a transcription provider');
    });

    it('throws when provider id is undefined', () => {
      const registry = new StaticTranscriptionProviderRegistry([]);
      expect(() => registry.require(undefined)).toThrow('Choose a transcription provider');
    });

    it('throws when provider not found', () => {
      const registry = new StaticTranscriptionProviderRegistry([]);
      expect(() => registry.require('missing' as any)).toThrow('Unsupported transcription provider');
    });
  });
});

import type { TranscriptionProvider, TranscriptionProviderId, TranscriptionProviderRegistry } from './types.js';

export class StaticTranscriptionProviderRegistry implements TranscriptionProviderRegistry {
  private readonly providers = new Map<TranscriptionProviderId, TranscriptionProvider>();

  constructor(providers: TranscriptionProvider[]) {
    for (const provider of providers) {
      this.providers.set(provider.id, provider);
    }
  }

  get(providerId: TranscriptionProviderId): TranscriptionProvider | undefined {
    return this.providers.get(providerId);
  }

  list(): TranscriptionProvider[] {
    return [...this.providers.values()];
  }

  require(providerId: TranscriptionProviderId | null | undefined): TranscriptionProvider {
    if (!providerId) {
      throw new Error('Choose a transcription provider in Settings before using dictation.');
    }

    const provider = this.providers.get(providerId);
    if (!provider) {
      throw new Error(`Unsupported transcription provider: ${providerId}`);
    }

    return provider;
  }
}

export class PlannedTranscriptionProvider implements TranscriptionProvider {
  constructor(
    readonly id: TranscriptionProviderId,
    readonly label: string,
    readonly transports: Array<'stream' | 'file'>,
  ) {}

  async isAvailable(): Promise<boolean> {
    return false;
  }

  async transcribeFile(): Promise<never> {
    throw new Error(`${this.label} transcription is planned but not implemented.`);
  }

  stream(): AsyncIterable<never> {
    throw new Error(`${this.label} transcription is planned but not implemented.`);
  }
}

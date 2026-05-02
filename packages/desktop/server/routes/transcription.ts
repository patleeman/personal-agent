import type { Express } from 'express';

import {
  buildTranscriptionSettingsState,
  createTranscriptionProviderRegistry,
  isTranscriptionProviderId,
  readTranscriptionSettings,
  writeTranscriptionSettings,
} from '../transcription/index.js';
import { persistSettingsWrite } from '../ui/settingsPersistence.js';
import type { ServerRouteContext } from './context.js';

function readOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

export function readRequiredBase64(value: unknown, label: string): Buffer {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} is required.`);
  }
  const normalized = value.trim();
  if (normalized.length % 4 === 1 || !/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)) {
    throw new Error(`${label} must contain valid base64 data.`);
  }
  const decoded = Buffer.from(normalized, 'base64');
  if (decoded.length === 0) {
    throw new Error(`${label} must decode to non-empty data.`);
  }
  return decoded;
}

function isTranscriptionClientInputError(message: string): boolean {
  return (
    message.endsWith(' is required.') ||
    message.endsWith(' must contain valid base64 data.') ||
    message.endsWith(' must decode to non-empty data.')
  );
}

function isTranscriptionProviderClientError(message: string): boolean {
  return (
    message.includes('Choose a transcription provider') ||
    message.includes('Unsupported transcription provider') ||
    message.endsWith(' does not support model installation.') ||
    message.endsWith(' does not expose model status.') ||
    message.endsWith(' is not implemented yet.')
  );
}

export function registerTranscriptionRoutes(
  router: Pick<Express, 'get' | 'patch' | 'post'>,
  context: Pick<ServerRouteContext, 'getSettingsFile' | 'getAuthFile'>,
): void {
  router.get('/api/transcription/settings', (_req, res) => {
    try {
      res.json(buildTranscriptionSettingsState(context.getSettingsFile()));
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.patch('/api/transcription/settings', (req, res) => {
    try {
      const body = req.body as { provider?: unknown; model?: unknown };
      const update: Parameters<typeof writeTranscriptionSettings>[1] = {};

      if ('provider' in body) {
        if (body.provider !== null && !isTranscriptionProviderId(body.provider)) {
          res.status(400).json({ error: 'provider must be local-whisper or null' });
          return;
        }
        update.provider = body.provider;
      }

      if ('model' in body) {
        const model = readOptionalString(body.model);
        if (!model) {
          res.status(400).json({ error: 'model must be a non-empty string' });
          return;
        }
        update.model = model;
      }

      persistSettingsWrite((settingsFile) => writeTranscriptionSettings(settingsFile, update), {
        runtimeSettingsFile: context.getSettingsFile(),
      });
      res.json(buildTranscriptionSettingsState(context.getSettingsFile()));
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.post('/api/transcription/transcribe-file', async (req, res) => {
    try {
      const settings = readTranscriptionSettings(context.getSettingsFile());
      const registry = createTranscriptionProviderRegistry({ authFile: context.getAuthFile(), settings });
      const provider = registry.require(settings.provider);
      if (!provider.transcribeFile) {
        res.status(400).json({ error: `${provider.label} does not support file transcription.` });
        return;
      }

      const body = req.body as { dataBase64?: unknown; mimeType?: unknown; fileName?: unknown; language?: unknown };
      const result = await provider.transcribeFile(
        {
          data: readRequiredBase64(body.dataBase64, 'dataBase64'),
          mimeType: readOptionalString(body.mimeType) ?? 'audio/pcm',
          fileName: readOptionalString(body.fileName),
        },
        {
          language: readOptionalString(body.language),
        },
      );
      res.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res
        .status(message.includes('Choose a transcription provider') || isTranscriptionClientInputError(message) ? 400 : 500)
        .json({ error: message });
    }
  });

  router.post('/api/transcription/install-model', async (req, res) => {
    try {
      const settings = readTranscriptionSettings(context.getSettingsFile());
      const body = req.body as { provider?: unknown; model?: unknown };

      const providerOverride = 'provider' in body ? body.provider : settings.provider;
      if (providerOverride !== null && providerOverride !== undefined && !isTranscriptionProviderId(providerOverride)) {
        res.status(400).json({ error: 'provider must be local-whisper or null' });
        return;
      }
      const providerId = providerOverride ?? null;

      const model = 'model' in body ? readOptionalString(body.model) : settings.model;
      if (!model) {
        res.status(400).json({ error: 'model must be a non-empty string' });
        return;
      }

      const registry = createTranscriptionProviderRegistry({
        authFile: context.getAuthFile(),
        settings: {
          ...settings,
          provider: providerId,
          model,
        },
      });
      const selectedProvider = registry.require(providerId);
      if (!selectedProvider.installModel) {
        res.status(400).json({ error: `${selectedProvider.label} does not support model installation.` });
        return;
      }

      res.json(await selectedProvider.installModel());
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(isTranscriptionProviderClientError(message) ? 400 : 500).json({ error: message });
    }
  });

  router.post('/api/transcription/model-status', async (req, res) => {
    try {
      const settings = readTranscriptionSettings(context.getSettingsFile());
      const body = req.body as { provider?: unknown; model?: unknown };

      const providerOverride = 'provider' in body ? body.provider : settings.provider;
      if (providerOverride !== null && providerOverride !== undefined && !isTranscriptionProviderId(providerOverride)) {
        res.status(400).json({ error: 'provider must be local-whisper or null' });
        return;
      }
      const providerId = providerOverride ?? null;

      const model = 'model' in body ? readOptionalString(body.model) : settings.model;
      if (!model) {
        res.status(400).json({ error: 'model must be a non-empty string' });
        return;
      }

      const registry = createTranscriptionProviderRegistry({
        authFile: context.getAuthFile(),
        settings: {
          ...settings,
          provider: providerId,
          model,
        },
      });
      const selectedProvider = registry.require(providerId);
      if (!selectedProvider.getModelStatus) {
        res.status(400).json({ error: `${selectedProvider.label} does not expose model status.` });
        return;
      }

      res.json(await selectedProvider.getModelStatus());
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(isTranscriptionProviderClientError(message) ? 400 : 500).json({ error: message });
    }
  });
}

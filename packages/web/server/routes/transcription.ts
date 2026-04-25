import type { Express } from 'express';
import type { ServerRouteContext } from './context.js';
import {
  buildTranscriptionSettingsState,
  createTranscriptionProviderRegistry,
  isTranscriptionProviderId,
  readTranscriptionSettings,
  writeTranscriptionSettings,
} from '../transcription/index.js';
import { persistSettingsWrite } from '../ui/settingsPersistence.js';

function readOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function readRequiredBase64(value: unknown, label: string): Buffer {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} is required.`);
  }
  return Buffer.from(value, 'base64');
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
          res.status(400).json({ error: 'provider must be one of openai-codex-realtime, openai-api, whisperkit-local, or null' });
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

      persistSettingsWrite(
        (settingsFile) => writeTranscriptionSettings(settingsFile, update),
        { runtimeSettingsFile: context.getSettingsFile() },
      );
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
      const result = await provider.transcribeFile({
        data: readRequiredBase64(body.dataBase64, 'dataBase64'),
        mimeType: readOptionalString(body.mimeType) ?? 'audio/pcm',
        fileName: readOptionalString(body.fileName),
      }, {
        language: readOptionalString(body.language),
      });
      res.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(message.includes('Choose a transcription provider') ? 400 : 500).json({ error: message });
    }
  });
}

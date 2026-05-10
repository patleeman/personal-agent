import type { Express } from 'express';

import { logError } from '../middleware/index.js';
import { deleteSecret, listSecretStatuses, readSecretBackendId, setSecret } from '../secrets/secretStore.js';
import type { ServerRouteContext } from './context.js';

function readRequiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${label} is required`);
  return value.trim();
}

export function registerSecretRoutes(
  router: Pick<Express, 'get' | 'put' | 'delete'>,
  context: Pick<ServerRouteContext, 'getStateRoot'>,
): void {
  router.get('/api/secrets', (_req, res) => {
    try {
      const stateRoot = context.getStateRoot();
      res.json({ backend: readSecretBackendId(stateRoot), secrets: listSecretStatuses(stateRoot) });
    } catch (err) {
      logError('secrets read error', { message: err instanceof Error ? err.message : String(err) });
      res.status(500).json({ error: String(err) });
    }
  });

  router.put('/api/secrets/:extensionId/:secretId', (req, res) => {
    try {
      const params = req.params as { extensionId?: unknown; secretId?: unknown };
      const body = req.body as { value?: unknown } | undefined;
      const extensionId = readRequiredString(params.extensionId, 'extensionId');
      const secretId = readRequiredString(params.secretId, 'secretId');
      const value = readRequiredString(body?.value, 'value');
      const stateRoot = context.getStateRoot();
      res.json({ backend: readSecretBackendId(stateRoot), secrets: setSecret(extensionId, secretId, value, stateRoot) });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logError('secret write error', { message });
      res.status(500).json({ error: message });
    }
  });

  router.delete('/api/secrets/:extensionId/:secretId', (req, res) => {
    try {
      const params = req.params as { extensionId?: unknown; secretId?: unknown };
      const extensionId = readRequiredString(params.extensionId, 'extensionId');
      const secretId = readRequiredString(params.secretId, 'secretId');
      const stateRoot = context.getStateRoot();
      res.json({ backend: readSecretBackendId(stateRoot), secrets: deleteSecret(extensionId, secretId, stateRoot) });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logError('secret delete error', { message });
      res.status(500).json({ error: message });
    }
  });
}

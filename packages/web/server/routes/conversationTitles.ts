/**
 * Conversation title preferences routes
 */

import type { Express } from 'express';
import {
  readSavedConversationTitlePreferences,
  writeSavedConversationTitlePreferences,
} from '../ui/conversationTitlePreferences.js';
import { persistSettingsWrite } from '../ui/settingsPersistence.js';
import { logError } from '../middleware/index.js';

let SETTINGS_FILE: string = '';

export function setConversationTitlesRoutesGetters(
  settingsFile: string,
): void {
  SETTINGS_FILE = settingsFile;
}

export function registerConversationTitlesRoutes(router: Pick<Express, 'get' | 'patch'>): void {
  router.get('/api/conversation-titles/settings', (_req, res) => {
    try {
      res.json(readSavedConversationTitlePreferences(SETTINGS_FILE));
    } catch (err) {
      logError('request handler error', {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      res.status(500).json({ error: String(err) });
    }
  });

  router.patch('/api/conversation-titles/settings', (req, res) => {
    try {
      const { enabled, model } = req.body as { enabled?: boolean; model?: string | null };
      if (typeof enabled !== 'boolean' && typeof model !== 'string' && model !== null) {
        res.status(400).json({ error: 'enabled or model required' });
        return;
      }
      const saved = persistSettingsWrite(
        (settingsFile) => writeSavedConversationTitlePreferences({ enabled, model }, settingsFile),
        { runtimeSettingsFile: SETTINGS_FILE },
      );
      res.json(saved);
    } catch (err) {
      logError('request handler error', {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      res.status(500).json({ error: String(err) });
    }
  });
}

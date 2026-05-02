/**
 * Run operations routes (app)
 *
 * Attention management and remote transcript access.
 */

import type { Express } from 'express';
import {
  DurableRunCapabilityInputError,
  markDurableRunAttentionCapability,
} from '../automation/durableRunCapability.js';
import { logError } from '../middleware/index.js';

export function registerRunsOpsRoutes(router: Pick<Express, 'get' | 'post' | 'patch'>): void {
  router.patch('/api/runs/:id/attention', async (req, res) => {
    try {
      const { read } = req.body as { read?: boolean };
      res.json(await markDurableRunAttentionCapability({
        runId: req.params.id,
        read,
      }));
    } catch (err) {
      if (err instanceof DurableRunCapabilityInputError) {
        res.status(400).json({ error: err.message });
        return;
      }

      if (err instanceof Error && err.message === 'Run not found') {
        res.status(404).json({ error: err.message });
        return;
      }

      logError('request handler error', { message: err instanceof Error ? err.message : String(err), stack: err instanceof Error ? err.stack : undefined });
      res.status(500).json({ error: String(err) });
    }
  });
}

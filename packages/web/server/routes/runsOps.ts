/**
 * Run operations routes (app)
 *
 * Attention management and remote transcript access.
 */

import type { Express } from 'express';
import { clearDurableRunsListCache, getDurableRun } from '../automation/durableRuns.js';
import { getDurableRunAttentionSignature } from '../automation/durableRunAttention.js';
import { markDurableRunAttentionRead, markDurableRunAttentionUnread } from '@personal-agent/core';
import { invalidateAppTopics, logError } from '../middleware/index.js';

export function registerRunsOpsRoutes(router: Pick<Express, 'get' | 'post' | 'patch'>): void {
  router.patch('/api/runs/:id/attention', async (req, res) => {
    try {
      const { read } = req.body as { read?: boolean };
      const result = await getDurableRun(req.params.id);
      if (!result) { res.status(404).json({ error: 'Run not found' }); return; }
      const attentionSignature = getDurableRunAttentionSignature(result.run);
      if (read === false) {
        markDurableRunAttentionUnread({ runId: req.params.id });
      } else if (attentionSignature) {
        markDurableRunAttentionRead({ runId: req.params.id, attentionSignature });
      }
      clearDurableRunsListCache();
      invalidateAppTopics('runs');
      res.json({ ok: true });
    } catch (err) {
      logError('request handler error', { message: err instanceof Error ? err.message : String(err), stack: err instanceof Error ? err.stack : undefined });
      res.status(500).json({ error: String(err) });
    }
  });
}

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
import { buildRemoteExecutionTranscriptResponse } from '../workspace/remoteExecution.js';

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

  router.get('/api/runs/:id/remote-transcript', async (req, res) => {
    try {
      const result = await getDurableRun(req.params.id);
      if (!result) { res.status(404).json({ error: 'Run not found' }); return; }
      const transcript = buildRemoteExecutionTranscriptResponse(result.run);
      res.setHeader('Content-Type', transcript.contentType);
      res.setHeader('Content-Disposition', transcript.contentDisposition);
      res.send(transcript.content);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status = message.includes('missing') ? 404 : 409;
      res.status(status).json({ error: message });
    }
  });
}

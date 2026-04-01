/**
 * Run operations routes (app)
 *
 * Attention management, node distillation retry/recover, and remote transcript.
 */

import type { Express } from 'express';
import { getDurableRun, clearDurableRunsListCache } from '../durableRuns.js';
import { getDurableRunAttentionSignature } from '../durableRunAttention.js';
import { markDurableRunAttentionRead, markDurableRunAttentionUnread } from '@personal-agent/core';
import { readRemoteExecutionRunConversationId } from '../remoteExecution.js';
import { resolveConversationSessionFile, getCurrentProfile, listConversationSessionsSnapshot } from '../services/conversationService.js';
import {
  CONVERSATION_MEMORY_DISTILL_RECOVERY_TITLE_PREFIX,
  readConversationMemoryMaintenanceState,
  markConversationMemoryMaintenanceRunFailed,
  markConversationMemoryMaintenanceRunStarted,
  readConversationCheckpointSnapshotFromState,
} from '../conversationMemoryMaintenance.js';
import { writeConversationMemoryDistillFailureActivity } from '../conversationMemoryActivity.js';
import { appendVisibleCustomMessage, createSessionFromExisting, renameSession, queuePromptContext } from '../liveSessions.js';
import { getConversationProjectLink, setConversationProjectLinks } from '@personal-agent/core';
import { invalidateAppTopics, logError } from '../middleware/index.js';
import { buildRemoteExecutionTranscriptResponse } from '../remoteExecution.js';
import { SessionManager } from '@mariozechner/pi-coding-agent';

async function getDistillSupport() {
  const idx = await import('../index.js');
  return {
    readConversationMemoryDistillRunInputFromRun: idx.readConversationMemoryDistillRunInputFromRun,
    readConversationMemoryDistillRunState: idx.readConversationMemoryDistillRunState,
    startConversationMemoryDistillRun: idx.startConversationMemoryDistillRun,
    distillConversationMemoryNow: idx.distillConversationMemoryNow,
    formatConversationMemoryCheckpointAnchor: idx.formatConversationMemoryCheckpointAnchor,
    buildConversationMemoryDistillRecoveryVisibleMessage: idx.buildConversationMemoryDistillRecoveryVisibleMessage,
    buildConversationMemoryDistillRecoveryHiddenContext: idx.buildConversationMemoryDistillRecoveryHiddenContext,
    startConversationMemoryDistillBatchRecoveryRun: idx.startConversationMemoryDistillBatchRecoveryRun,
    listMemoryWorkItems: idx.listMemoryWorkItems,
    buildLiveSessionResourceOptions: idx.buildLiveSessionResourceOptions,
    buildLiveSessionExtensionFactories: idx.buildLiveSessionExtensionFactories,
  };
}

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

  router.post('/api/runs/:id/node-distill/retry', async (req, res) => {
    try {
      const distill = await getDistillSupport();
      const profile = getCurrentProfile();
      const detail = await getDurableRun(req.params.id);
      if (!detail) { res.status(404).json({ error: 'Run not found' }); return; }
      const run = detail.run;
      const distillInput = distill.readConversationMemoryDistillRunInputFromRun(run, profile);
      if (!distillInput) { res.status(409).json({ error: 'This run is not a node distillation run.' }); return; }
      if (run.status?.status !== 'failed' && run.status?.status !== 'interrupted') { res.status(409).json({ error: 'Only failed or interrupted node distillation runs can be retried.' }); return; }
      const existing = await distill.readConversationMemoryDistillRunState(distillInput.conversationId);
      if (existing.running) { res.status(409).json({ error: 'A node distillation is already running for this conversation.' }); return; }
      const result = await distill.startConversationMemoryDistillRun({
        conversationId: distillInput.conversationId,
        profile,
        checkpointId: distillInput.checkpointId,
        mode: distillInput.mode,
        trigger: distillInput.trigger,
        title: distillInput.title,
        summary: distillInput.summary,
        emitActivity: distillInput.emitActivity,
      });
      if (!result.accepted || !result.runId) {
        const error = result.reason ?? 'Could not retry conversation node distillation.';
        markConversationMemoryMaintenanceRunFailed({ profile, conversationId: distillInput.conversationId, checkpointId: distillInput.checkpointId, error });
        if (distillInput.emitActivity) {
          try {
            writeConversationMemoryDistillFailureActivity({
              profile,
              conversationId: distillInput.conversationId,
              error,
              relatedProjectIds: getConversationProjectLink({ profile, conversationId: distillInput.conversationId })?.relatedProjectIds ?? [],
            });
          } catch {
            // ignore
          }
        }
        res.status(500).json({ error });
        return;
      }
      markConversationMemoryMaintenanceRunStarted({ profile, conversationId: distillInput.conversationId, checkpointId: distillInput.checkpointId, runId: result.runId });
      invalidateAppTopics('runs');
      res.status(202).json({ accepted: true, conversationId: distillInput.conversationId, runId: result.runId, status: 'queued' });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status = message.includes('not found')
        ? 404
        : message.includes('already running') || message.includes('not a node distillation run') || message.includes('Only failed or interrupted')
          ? 409
          : 500;
      res.status(status).json({ error: message });
    }
  });

  router.post('/api/runs/:id/node-distill/recover-now', async (req, res) => {
    const requestedProfile = typeof req.body?.profile === 'string' && req.body.profile.trim().length > 0
      ? req.body.profile.trim()
      : getCurrentProfile();

    try {
      const distill = await getDistillSupport();
      const profile = requestedProfile;
      const detail = await getDurableRun(req.params.id);
      if (!detail) { res.status(404).json({ error: 'Run not found' }); return; }
      const run = detail.run;
      const distillInput = distill.readConversationMemoryDistillRunInputFromRun(run, profile);
      if (!distillInput) { res.status(409).json({ error: 'This run is not a node distillation run.' }); return; }
      const maintenanceState = readConversationMemoryMaintenanceState({ profile, conversationId: distillInput.conversationId });
      if (maintenanceState?.lastCompletedCheckpointId === distillInput.checkpointId && maintenanceState.status !== 'failed') {
        res.json({ ok: true, runId: run.runId, conversationId: distillInput.conversationId, resolved: 'already-completed', ...(maintenanceState.promotedMemoryId ? { memoryId: maintenanceState.promotedMemoryId } : {}), ...(maintenanceState.promotedReferencePath ? { referencePath: maintenanceState.promotedReferencePath } : {}) });
        return;
      }
      if (run.status?.status !== 'failed' && run.status?.status !== 'interrupted') { res.status(409).json({ error: 'Only failed or interrupted node distillation runs can be recovered automatically.' }); return; }
      const existing = await distill.readConversationMemoryDistillRunState(distillInput.conversationId);
      if (existing.running) { res.status(409).json({ error: 'A node distillation is already running for this conversation.' }); return; }
      const recovered = await distill.distillConversationMemoryNow({
        conversationId: distillInput.conversationId,
        profile,
        checkpointId: distillInput.checkpointId,
        title: distillInput.title,
        summary: distillInput.summary,
        mode: distillInput.mode,
        trigger: distillInput.trigger,
        emitActivity: distillInput.emitActivity,
      });
      invalidateAppTopics('projects', 'sessions', 'runs');
      res.json({ ok: true, runId: run.runId, conversationId: distillInput.conversationId, resolved: 'recovered', memoryId: recovered.memory.id, referencePath: recovered.reference.relativePath, disposition: recovered.disposition, ...(recovered.activityId ? { activityId: recovered.activityId } : {}) });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      try {
        const detail = await getDurableRun(req.params.id);
        const run = detail?.run;
        const distillInput = run ? (await getDistillSupport()).readConversationMemoryDistillRunInputFromRun(run, requestedProfile) : null;
        if (distillInput) {
          markConversationMemoryMaintenanceRunFailed({ profile: requestedProfile, conversationId: distillInput.conversationId, checkpointId: distillInput.checkpointId, error: message });
          if (distillInput.emitActivity) {
            try {
              writeConversationMemoryDistillFailureActivity({
                profile: requestedProfile,
                conversationId: distillInput.conversationId,
                error: message,
                relatedProjectIds: getConversationProjectLink({ profile: requestedProfile, conversationId: distillInput.conversationId })?.relatedProjectIds ?? [],
              });
            } catch {
              // ignore
            }
          }
        }
      } catch {
        // Ignore maintenance state write errors in failure path.
      }

      const status = message.includes('not found')
        ? 404
        : message.includes('already running') || message.includes('not a node distillation run') || message.includes('Only failed or interrupted')
          ? 409
          : message.includes('Invalid') || message.includes('required') || message.includes('Unable to resolve') || message.includes('empty conversation')
            ? 400
            : 500;
      res.status(status).json({ error: message });
    }
  });

  router.post('/api/runs/:id/node-distill/recover', async (req, res) => {
    try {
      const distill = await getDistillSupport();
      const profile = getCurrentProfile();
      const detail = await getDurableRun(req.params.id);
      if (!detail) { res.status(404).json({ error: 'Run not found' }); return; }
      const run = detail.run;
      const distillInput = distill.readConversationMemoryDistillRunInputFromRun(run, profile);
      if (!distillInput) { res.status(409).json({ error: 'This run is not a node distillation run.' }); return; }
      if (run.status?.status !== 'failed' && run.status?.status !== 'interrupted') { res.status(409).json({ error: 'Only failed or interrupted node distillation runs can be recovered in a conversation.' }); return; }
      const maintenanceState = readConversationMemoryMaintenanceState({ profile, conversationId: distillInput.conversationId });
      const sessionFile = resolveConversationSessionFile(distillInput.conversationId)
        ?? maintenanceState?.latestSessionFile
        ?? run.manifest?.source?.filePath;
      if (!sessionFile || !sessionFile.trim() || !(await import('node:fs')).existsSync(sessionFile)) { res.status(404).json({ error: 'Conversation not found for this node distillation run.' }); return; }
      const sourceSession = listConversationSessionsSnapshot().find((session) => session.id === distillInput.conversationId);
      const cwd = sourceSession?.cwd
        ?? maintenanceState?.latestCwd
        ?? SessionManager.open(sessionFile).getCwd();
      const { buildLiveSessionResourceOptions, buildLiveSessionExtensionFactories, buildConversationMemoryDistillRecoveryVisibleMessage, buildConversationMemoryDistillRecoveryHiddenContext, formatConversationMemoryCheckpointAnchor } = distill;
      const created = await createSessionFromExisting(sessionFile, cwd, {
        ...buildLiveSessionResourceOptions(),
        extensionFactories: buildLiveSessionExtensionFactories(),
      });
      const sourceLabel = sourceSession?.title ?? maintenanceState?.latestConversationTitle ?? distillInput.conversationId;
      renameSession(created.id, `${CONVERSATION_MEMORY_DISTILL_RECOVERY_TITLE_PREFIX} ${sourceLabel}`);
      const relatedProjectIds = getConversationProjectLink({ profile, conversationId: distillInput.conversationId })?.relatedProjectIds ?? [];
      if (relatedProjectIds.length > 0) { setConversationProjectLinks({ profile, conversationId: created.id, relatedProjectIds }); }
      let checkpointSnapshot: ReturnType<typeof readConversationCheckpointSnapshotFromState> | null = null;
      try {
        checkpointSnapshot = readConversationCheckpointSnapshotFromState({ profile, conversationId: distillInput.conversationId, checkpointId: distillInput.checkpointId });
      } catch {
        checkpointSnapshot = null;
      }
      const anchorLabel = formatConversationMemoryCheckpointAnchor(checkpointSnapshot);
      const errorMessage = run.status?.lastError;
      await appendVisibleCustomMessage(
        created.id,
        'memory_distill_recovery',
        buildConversationMemoryDistillRecoveryVisibleMessage({
          runId: run.runId,
          status: run.status?.status ?? 'unknown',
          sourceConversationId: distillInput.conversationId,
          sourceConversationTitle: sourceSession?.title ?? maintenanceState?.latestConversationTitle,
          checkpointId: distillInput.checkpointId,
          anchorLabel,
          error: errorMessage,
        }),
        {
          runId: run.runId,
          status: run.status?.status ?? 'unknown',
          sourceConversationId: distillInput.conversationId,
          checkpointId: distillInput.checkpointId,
          ...(anchorLabel ? { anchor: anchorLabel } : {}),
        },
      );
      await queuePromptContext(
        created.id,
        'memory_distill_recovery',
        buildConversationMemoryDistillRecoveryHiddenContext({
          runId: run.runId,
          status: run.status?.status ?? 'unknown',
          sourceConversationId: distillInput.conversationId,
          sourceConversationTitle: sourceSession?.title ?? maintenanceState?.latestConversationTitle,
          checkpointId: distillInput.checkpointId,
          anchorLabel,
          title: distillInput.title,
          summary: distillInput.summary,
          error: errorMessage,
        }),
      );
      invalidateAppTopics('projects', 'sessions', 'runs');
      res.status(201).json({ ok: true, runId: run.runId, conversationId: created.id, sessionFile: created.sessionFile, cwd });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status = message.includes('not found')
        ? 404
        : message.includes('not a node distillation run') || message.includes('Only failed or interrupted')
          ? 409
          : 500;
      res.status(status).json({ error: message });
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

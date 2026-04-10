import type { Express } from 'express';
import type { ServerRouteContext } from './context.js';
import {
  setConversationServiceContext,
  handleCompanionConversationListRequest,
  readConversationSessionMeta,
  readConversationSessionSignature,
  readSessionDetailForRoute,
  resolveConversationSessionFile,
  publishConversationSessionMetaChanged,
  parseTailBlocksQuery,
  listConversationSessionsSnapshot,
  toggleConversationAttention,
  readConversationModelPreferenceStateById,
} from '../conversations/conversationService.js';
import {
  readConversationAttachmentDownload,
} from '@personal-agent/core';
import {
  cancelDeferredResumeForSessionFile,
  fireDeferredResumeNowForSessionFile,
  listDeferredResumesForSessionFile,
  scheduleDeferredResumeForSessionFile,
} from '../automation/deferredResumes.js';
import {
  isLive as isLocalLive,
  updateLiveSessionModelPreferences,
  LiveSessionControlError,
  getAvailableModelObjects,
} from '../conversations/liveSessions.js';
import {
  ensureRequestControlsLocalLiveConversation,
} from './liveSessions.js';
import { SessionManager } from '@mariozechner/pi-coding-agent';
import {
  DEFAULT_RUNTIME_SETTINGS_FILE as SETTINGS_FILE,
} from '../ui/settingsPersistence.js';
import {
  applyConversationModelPreferencesToSessionManager,
} from '../conversations/conversationModelPreferences.js';
import { readSavedModelPreferences } from '../models/modelPreferences.js';
import {
  buildAppendOnlySessionDetailResponse,
  readSessionBlock,
  readSessionImageAsset,
  readSessionSearchText,
} from '../conversations/sessions.js';
import { buildContentDispositionHeader } from '../shared/httpHeaders.js';
import {
  logError,
  logSlowConversationPerf,
  setServerTimingHeaders,
  invalidateAppTopics,
} from '../middleware/index.js';
import {
  ConversationAssetCapabilityInputError,
  ConversationAssetCapabilityNotFoundError,
  createConversationAttachmentCapability,
  deleteConversationArtifactCapability,
  deleteConversationAttachmentCapability,
  readConversationArtifactCapability,
  readConversationArtifactsCapability,
  readConversationAttachmentCapability,
  readConversationAttachmentsCapability,
  updateConversationAttachmentCapability,
} from '../conversations/conversationAssetsCapability.js';

let getCurrentProfileFn: () => string = () => {
  throw new Error('getCurrentProfile not initialized for conversation routes');
};

let flushLiveDeferredResumesFn: () => Promise<void> = async () => {};

function initializeConversationRoutesContext(
  context: Pick<ServerRouteContext, 'getCurrentProfile' | 'getRepoRoot' | 'getSavedWebUiPreferences' | 'flushLiveDeferredResumes'>,
): void {
  getCurrentProfileFn = context.getCurrentProfile;
  flushLiveDeferredResumesFn = context.flushLiveDeferredResumes;

  setConversationServiceContext({
    getCurrentProfile: context.getCurrentProfile,
    getRepoRoot: context.getRepoRoot,
    getSavedWebUiPreferences: context.getSavedWebUiPreferences,
  });
}

function parseNonNegativeIntegerQuery(rawValue: unknown): number | undefined {
  const candidate = Array.isArray(rawValue) ? rawValue[0] : rawValue;
  const parsed = typeof candidate === 'string'
    ? Number.parseInt(candidate, 10)
    : typeof candidate === 'number'
      ? candidate
      : undefined;

  return Number.isInteger(parsed) && (parsed as number) >= 0
    ? parsed as number
    : undefined;
}

function parseTrimmedQueryString(rawValue: unknown): string | undefined {
  const candidate = Array.isArray(rawValue) ? rawValue[0] : rawValue;
  if (typeof candidate !== 'string') {
    return undefined;
  }

  const normalized = candidate.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function writeConversationAssetCapabilityError(
  res: { status(code: number): { json(value: unknown): void } },
  err: unknown,
  options?: { notFoundMessage?: string },
): boolean {
  if (err instanceof ConversationAssetCapabilityInputError) {
    res.status(400).json({ error: err.message });
    return true;
  }

  if (err instanceof ConversationAssetCapabilityNotFoundError) {
    res.status(404).json({ error: options?.notFoundMessage ?? err.message });
    return true;
  }

  return false;
}

function registerConversationReadRoutes(router: Pick<Express, 'get'>): void {
  router.get('/api/sessions/:id/meta', (req, res) => {
    try {
      const session = readConversationSessionMeta(req.params.id);
      if (!session) {
        res.status(404).json({ error: 'Session not found' });
        return;
      }

      res.json(session);
    } catch (err) {
      logError('request handler error', {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      res.status(500).json({ error: String(err) });
    }
  });

  router.get('/api/sessions/:id', async (req, res) => {
    const startedAt = process.hrtime.bigint();

    try {
      const tailBlocks = parseTailBlocksQuery(req.query.tailBlocks);
      const rawKnownSessionSignature = Array.isArray(req.query.knownSessionSignature)
        ? req.query.knownSessionSignature[0]
        : req.query.knownSessionSignature;
      const knownSessionSignature = typeof rawKnownSessionSignature === 'string' && rawKnownSessionSignature.trim().length > 0
        ? rawKnownSessionSignature.trim()
        : undefined;
      const knownBlockOffset = parseNonNegativeIntegerQuery(req.query.knownBlockOffset);
      const knownTotalBlocks = parseNonNegativeIntegerQuery(req.query.knownTotalBlocks);
      const knownLastBlockId = parseTrimmedQueryString(req.query.knownLastBlockId);
      const currentSessionSignature = readConversationSessionSignature(req.params.id);
      if (knownSessionSignature && currentSessionSignature && knownSessionSignature === currentSessionSignature) {
        const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
        setServerTimingHeaders(res, [
          { name: 'remote_sync', durationMs: 0, description: 'deferred' },
          { name: 'session_read', durationMs: 0, description: 'reuse/signature' },
          { name: 'total', durationMs },
        ], {
          route: 'session-detail',
          conversationId: req.params.id,
          ...(tailBlocks ? { tailBlocks } : {}),
          remoteMirror: { status: 'deferred', durationMs: 0 },
          sessionRead: null,
          durationMs,
        });

        res.json({
          unchanged: true,
          sessionId: req.params.id,
          signature: currentSessionSignature,
        });
        return;
      }

      const { sessionRead, remoteMirror } = await readSessionDetailForRoute({
        conversationId: req.params.id,
        profile: getCurrentProfileFn(),
        tailBlocks,
      });
      if (!sessionRead.detail) { res.status(404).json({ error: 'Session not found' }); return; }

      const appendOnly = knownSessionSignature && sessionRead.detail.signature && knownSessionSignature !== sessionRead.detail.signature
        ? buildAppendOnlySessionDetailResponse({
            detail: sessionRead.detail,
            knownBlockOffset,
            knownTotalBlocks,
            knownLastBlockId,
          })
        : null;
      if (appendOnly) {
        const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
        setServerTimingHeaders(res, [
          { name: 'remote_sync', durationMs: remoteMirror.durationMs, description: remoteMirror.status },
          { name: 'session_read', durationMs: sessionRead.telemetry?.durationMs ?? 0, description: sessionRead.telemetry ? `${sessionRead.telemetry.cache}/${sessionRead.telemetry.loader}` : 'unknown' },
          { name: 'total', durationMs },
        ], {
          route: 'session-detail',
          conversationId: req.params.id,
          ...(tailBlocks ? { tailBlocks } : {}),
          remoteMirror,
          sessionRead: sessionRead.telemetry,
          result: 'append-only',
          durationMs,
        });

        res.json(appendOnly);
        return;
      }

      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      setServerTimingHeaders(res, [
        { name: 'remote_sync', durationMs: remoteMirror.durationMs, description: remoteMirror.status },
        { name: 'session_read', durationMs: sessionRead.telemetry?.durationMs ?? 0, description: sessionRead.telemetry ? `${sessionRead.telemetry.cache}/${sessionRead.telemetry.loader}` : 'unknown' },
        { name: 'total', durationMs },
      ], {
        route: 'session-detail',
        conversationId: req.params.id,
        ...(tailBlocks ? { tailBlocks } : {}),
        remoteMirror,
        sessionRead: sessionRead.telemetry,
        durationMs,
      });
      logSlowConversationPerf('session detail request', {
        conversationId: req.params.id,
        durationMs,
        ...(tailBlocks ? { tailBlocks } : {}),
        remoteMirrorStatus: remoteMirror.status,
        sessionReadCache: sessionRead.telemetry?.cache,
        sessionReadLoader: sessionRead.telemetry?.loader,
        sessionReadDurationMs: sessionRead.telemetry?.durationMs,
      });

      res.json(sessionRead.detail);
    } catch (err) {
      logError('request handler error', {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      res.status(500).json({ error: String(err) });
    }
  });

  router.get('/api/sessions/:id/blocks/:blockId/image', (req, res) => {
    try {
      const asset = readSessionImageAsset(req.params.id, req.params.blockId);
      if (!asset) { res.status(404).json({ error: 'Session image not found' }); return; }
      if (asset.fileName) {
        res.setHeader('Content-Disposition', buildContentDispositionHeader('inline', asset.fileName));
      }
      res.setHeader('Cache-Control', 'private, max-age=3600');
      res.type(asset.mimeType);
      res.send(asset.data);
    } catch (err) {
      logError('request handler error', {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      res.status(500).json({ error: String(err) });
    }
  });

  router.get('/api/sessions/:id/blocks/:blockId/images/:imageIndex', (req, res) => {
    try {
      const imageIndex = Number.parseInt(req.params.imageIndex, 10);
      const asset = readSessionImageAsset(req.params.id, req.params.blockId, imageIndex);
      if (!asset) { res.status(404).json({ error: 'Session image not found' }); return; }
      if (asset.fileName) {
        res.setHeader('Content-Disposition', buildContentDispositionHeader('inline', asset.fileName));
      }
      res.setHeader('Cache-Control', 'private, max-age=3600');
      res.type(asset.mimeType);
      res.send(asset.data);
    } catch (err) {
      logError('request handler error', {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      res.status(500).json({ error: String(err) });
    }
  });

  router.get('/api/sessions/:id/blocks/:blockId', (req, res) => {
    try {
      const result = readSessionBlock(req.params.id, req.params.blockId);
      if (!result) { res.status(404).json({ error: 'Session block not found' }); return; }
      res.json(result);
    } catch (err) {
      logError('request handler error', {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      res.status(500).json({ error: String(err) });
    }
  });
}

export function registerConversationRoutes(
  router: Pick<Express, 'get' | 'post' | 'patch' | 'delete'>,
  context: Pick<ServerRouteContext, 'getCurrentProfile' | 'getRepoRoot' | 'getSavedWebUiPreferences' | 'flushLiveDeferredResumes'>,
): void {
  initializeConversationRoutesContext(context);
  router.get('/api/sessions', (_req, res) => {
    try {
      res.json(listConversationSessionsSnapshot());
    } catch (err) {
      logError('request handler error', {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      res.status(500).json({ error: String(err) });
    }
  });

  registerConversationReadRoutes(router);

  router.post('/api/sessions/search-index', (req, res) => {
    try {
      const rawSessionIds: unknown[] = Array.isArray(req.body?.sessionIds) ? req.body.sessionIds as unknown[] : [];
      const sessionIds = rawSessionIds
        .filter((value: unknown): value is string => typeof value === 'string')
        .map((value: string) => value.trim())
        .filter((value: string) => value.length > 0);

      if (sessionIds.length === 0) {
        res.json({ index: {} as Record<string, string> });
        return;
      }

      const index: Record<string, string> = {};
      for (const sessionId of sessionIds) {
        const searchText = readSessionSearchText(sessionId);
        index[sessionId] = typeof searchText === 'string' ? searchText : '';
      }

      res.json({ index });
    } catch (err) {
      logError('request handler error', {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      res.status(500).json({ error: String(err) });
    }
  });

  router.get('/api/conversations/:id/deferred-resumes', (req, res) => {
    try {
      const sessionFile = resolveConversationSessionFile(req.params.id);
      if (!sessionFile) {
        res.status(404).json({ error: 'Conversation not found' });
        return;
      }

      res.json({
        conversationId: req.params.id,
        resumes: listDeferredResumesForSessionFile(sessionFile),
      });
    } catch (err) {
      logError('request handler error', {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      res.status(500).json({ error: String(err) });
    }
  });

  router.post('/api/conversations/:id/deferred-resumes', async (req, res) => {
    try {
      const sessionFile = resolveConversationSessionFile(req.params.id);
      if (!sessionFile) {
        res.status(404).json({ error: 'Conversation not found' });
        return;
      }

      const { delay, prompt } = req.body as { delay?: string; prompt?: string };
      if (!delay || delay.trim().length === 0) {
        res.status(400).json({ error: 'delay is required' });
        return;
      }

      const resumeRecord = await scheduleDeferredResumeForSessionFile({
        sessionFile,
        delay,
        prompt,
      });

      publishConversationSessionMetaChanged(req.params.id);
      res.json({
        conversationId: req.params.id,
        resume: resumeRecord,
        resumes: listDeferredResumesForSessionFile(sessionFile),
      });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  router.delete('/api/conversations/:id/deferred-resumes/:resumeId', async (req, res) => {
    try {
      const sessionFile = resolveConversationSessionFile(req.params.id);
      if (!sessionFile) {
        res.status(404).json({ error: 'Conversation not found' });
        return;
      }

      await cancelDeferredResumeForSessionFile({
        sessionFile,
        id: req.params.resumeId,
      });

      publishConversationSessionMetaChanged(req.params.id);
      res.json({
        conversationId: req.params.id,
        cancelledId: req.params.resumeId,
        resumes: listDeferredResumesForSessionFile(sessionFile),
      });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  router.post('/api/conversations/:id/deferred-resumes/:resumeId/fire', async (req, res) => {
    try {
      const sessionFile = resolveConversationSessionFile(req.params.id);
      if (!sessionFile) {
        res.status(404).json({ error: 'Conversation not found' });
        return;
      }

      const resume = await fireDeferredResumeNowForSessionFile({
        sessionFile,
        id: req.params.resumeId,
      });

      await flushLiveDeferredResumesFn();
      publishConversationSessionMetaChanged(req.params.id);
      res.json({
        conversationId: req.params.id,
        resume,
        resumes: listDeferredResumesForSessionFile(sessionFile),
      });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  router.get('/api/conversations/:id/artifacts', (req, res) => {
    try {
      res.json(readConversationArtifactsCapability(getCurrentProfileFn(), req.params.id));
    } catch (err) {
      logError('request handler error', {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      if (writeConversationAssetCapabilityError(res, err)) {
        return;
      }
      res.status(500).json({ error: String(err) });
    }
  });

  router.get('/api/conversations/:id/artifacts/:artifactId', (req, res) => {
    try {
      res.json(readConversationArtifactCapability(getCurrentProfileFn(), {
        conversationId: req.params.id,
        artifactId: req.params.artifactId,
      }));
    } catch (err) {
      logError('request handler error', {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      if (writeConversationAssetCapabilityError(res, err)) {
        return;
      }
      res.status(500).json({ error: String(err) });
    }
  });

  router.delete('/api/conversations/:id/artifacts/:artifactId', (req, res) => {
    try {
      res.json(deleteConversationArtifactCapability(getCurrentProfileFn(), {
        conversationId: req.params.id,
        artifactId: req.params.artifactId,
      }));
    } catch (err) {
      logError('request handler error', {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      if (writeConversationAssetCapabilityError(res, err)) {
        return;
      }
      res.status(500).json({ error: String(err) });
    }
  });

  router.get('/api/conversations/:id/attachments', (req, res) => {
    try {
      res.json(readConversationAttachmentsCapability(getCurrentProfileFn(), req.params.id));
    } catch (err) {
      logError('request handler error', {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      if (writeConversationAssetCapabilityError(res, err)) {
        return;
      }
      res.status(500).json({ error: String(err) });
    }
  });

  router.get('/api/conversations/:id/attachments/:attachmentId', (req, res) => {
    try {
      res.json(readConversationAttachmentCapability(getCurrentProfileFn(), {
        conversationId: req.params.id,
        attachmentId: req.params.attachmentId,
      }));
    } catch (err) {
      logError('request handler error', {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      if (writeConversationAssetCapabilityError(res, err)) {
        return;
      }
      res.status(500).json({ error: String(err) });
    }
  });

  router.post('/api/conversations/:id/attachments', (req, res) => {
    try {
      const body = req.body as {
        kind?: 'excalidraw';
        title?: string;
        sourceData?: string;
        sourceName?: string;
        sourceMimeType?: string;
        previewData?: string;
        previewName?: string;
        previewMimeType?: string;
        note?: string;
      };

      res.json(createConversationAttachmentCapability(getCurrentProfileFn(), {
        conversationId: req.params.id,
        ...body,
      }));
    } catch (err) {
      logError('request handler error', {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      if (writeConversationAssetCapabilityError(res, err)) {
        return;
      }
      res.status(500).json({ error: String(err) });
    }
  });

  router.patch('/api/conversations/:id/attachments/:attachmentId', (req, res) => {
    try {
      const body = req.body as {
        title?: string;
        sourceData?: string;
        sourceName?: string;
        sourceMimeType?: string;
        previewData?: string;
        previewName?: string;
        previewMimeType?: string;
        note?: string;
      };

      res.json(updateConversationAttachmentCapability(getCurrentProfileFn(), {
        conversationId: req.params.id,
        attachmentId: req.params.attachmentId,
        ...body,
      }));
    } catch (err) {
      logError('request handler error', {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      if (writeConversationAssetCapabilityError(res, err)) {
        return;
      }
      res.status(500).json({ error: String(err) });
    }
  });

  router.delete('/api/conversations/:id/attachments/:attachmentId', (req, res) => {
    try {
      res.json(deleteConversationAttachmentCapability(getCurrentProfileFn(), {
        conversationId: req.params.id,
        attachmentId: req.params.attachmentId,
      }));
    } catch (err) {
      logError('request handler error', {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      if (writeConversationAssetCapabilityError(res, err)) {
        return;
      }
      res.status(500).json({ error: String(err) });
    }
  });

  router.get('/api/conversations/:id/attachments/:attachmentId/download/:asset', (req, res) => {
    try {
      const profile = getCurrentProfileFn();
      const asset = req.params.asset === 'source' ? 'source' : req.params.asset === 'preview' ? 'preview' : null;
      if (!asset) {
        res.status(400).json({ error: 'asset must be "source" or "preview"' });
        return;
      }

      const revisionQuery = typeof req.query.revision === 'string'
        ? Number.parseInt(req.query.revision, 10)
        : undefined;

      if (req.query.revision !== undefined && (!Number.isInteger(revisionQuery) || (revisionQuery as number) <= 0)) {
        res.status(400).json({ error: 'revision must be a positive integer when provided.' });
        return;
      }

      const download = readConversationAttachmentDownload({
        profile,
        conversationId: req.params.id,
        attachmentId: req.params.attachmentId,
        asset,
        ...(revisionQuery ? { revision: revisionQuery } : {}),
      });

      res.setHeader('Content-Type', download.mimeType);
      res.setHeader('Content-Disposition', buildContentDispositionHeader(
        asset === 'preview' ? 'inline' : 'attachment',
        download.fileName,
      ));
      res.sendFile(download.filePath);
    } catch (err) {
      logError('request handler error', {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });

      const message = err instanceof Error ? err.message : String(err);
      if (message.toLowerCase().includes('not found')) {
        res.status(404).json({ error: message });
        return;
      }

      res.status(500).json({ error: message });
    }
  });

  router.patch('/api/conversations/:id/attention', (req, res) => {
    try {
      const { read } = req.body as { read?: boolean };
      const updated = toggleConversationAttention({
        profile: getCurrentProfileFn(),
        conversationId: req.params.id,
        read,
      });

      if (!updated) {
        res.status(404).json({ error: 'Conversation not found' });
        return;
      }

      invalidateAppTopics('sessions');
      res.json({ ok: true });
    } catch (err) {
      logError('request handler error', {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      res.status(500).json({ error: String(err) });
    }
  });

  const readConversationPlanState = (conversationId: string, body?: { enabled?: boolean; items?: unknown }) => ({
    conversationId,
    enabled: body?.enabled === true,
    items: Array.isArray(body?.items) ? body.items : [],
  });

  router.get('/api/conversations/:id/plan', (req, res) => {
    res.json(readConversationPlanState(req.params.id));
  });

  router.patch('/api/conversations/:id/plan', (req, res) => {
    res.json(readConversationPlanState(req.params.id, req.body as { enabled?: boolean; items?: unknown }));
  });

  router.post('/api/conversations/:id/plan/items/:itemId/reset', (req, res) => {
    res.json(readConversationPlanState(req.params.id));
  });

  router.post('/api/conversations/:id/plan/items/:itemId/status', (req, res) => {
    res.json(readConversationPlanState(req.params.id));
  });
}

export function registerCompanionConversationRoutes(
  router: Pick<Express, 'get' | 'post' | 'patch'>,
  context: Pick<ServerRouteContext, 'getCurrentProfile' | 'getRepoRoot' | 'getSavedWebUiPreferences' | 'flushLiveDeferredResumes'>,
): void {
  initializeConversationRoutesContext(context);
  router.get('/api/companion/conversations', handleCompanionConversationListRequest);
  registerConversationReadRoutes(router);
  router.get('/api/conversations/:id/artifacts', (req, res) => {
    try {
      res.json(readConversationArtifactsCapability(getCurrentProfileFn(), req.params.id).artifacts);
    } catch (err) {
      logError('request handler error', { message: err instanceof Error ? err.message : String(err), stack: err instanceof Error ? err.stack : undefined });
      if (writeConversationAssetCapabilityError(res, err, { notFoundMessage: 'Not found' })) { return; }
      res.status(500).json({ error: String(err) });
    }
  });
  router.get('/api/conversations/:id/artifacts/:artifactId', (req, res) => {
    try {
      res.json(readConversationArtifactCapability(getCurrentProfileFn(), {
        conversationId: req.params.id,
        artifactId: req.params.artifactId,
      }).artifact);
    } catch (err) {
      logError('request handler error', { message: err instanceof Error ? err.message : String(err), stack: err instanceof Error ? err.stack : undefined });
      if (writeConversationAssetCapabilityError(res, err, { notFoundMessage: 'Not found' })) { return; }
      res.status(500).json({ error: String(err) });
    }
  });

  // ── Model preferences ────────────────────────────────────────────────────
  router.get('/api/conversations/:id/model-preferences', async (req, res) => {
    try {
      const state = await readConversationModelPreferenceStateById(req.params.id);
      if (!state) { res.status(404).json({ error: 'Conversation not found' }); return; }
      res.json(state);
    } catch (err) {
      logError('request handler error', {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.patch('/api/conversations/:id/model-preferences', async (req, res) => {
    try {
      const { model, thinkingLevel } = req.body as {
        model?: string | null;
        thinkingLevel?: string | null;
        surfaceId?: string;
      };
      if (model === undefined && thinkingLevel === undefined) {
        res.status(400).json({ error: 'model or thinkingLevel required' });
        return;
      }
      if ((model !== undefined && model !== null && typeof model !== 'string')
        || (thinkingLevel !== undefined && thinkingLevel !== null && typeof thinkingLevel !== 'string')) {
        res.status(400).json({ error: 'model and thinkingLevel must be strings or null' });
        return;
      }
      const input: { model?: string | null; thinkingLevel?: string | null } = {
        ...(model !== undefined ? { model } : {}),
        ...(thinkingLevel !== undefined ? { thinkingLevel } : {}),
      };
      if (isLocalLive(req.params.id)) {
        ensureRequestControlsLocalLiveConversation(req.params.id, req.body);
        const availableModels = getAvailableModelObjects();
        const state = await updateLiveSessionModelPreferences(req.params.id, input, availableModels);
        res.json(state);
        return;
      }
      const sessionFile = resolveConversationSessionFile(req.params.id);
      if (!sessionFile) { res.status(404).json({ error: 'Conversation not found' }); return; }
      const sessionManager = SessionManager.open(sessionFile);
      const availableModels = getAvailableModelObjects();
      const state = applyConversationModelPreferencesToSessionManager(
        sessionManager,
        input,
        readSavedModelPreferences(SETTINGS_FILE, availableModels),
        availableModels,
      );
      publishConversationSessionMetaChanged(req.params.id);
      res.json(state);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (err instanceof LiveSessionControlError) { res.status(409).json({ error: message }); return; }
      if (message === 'surfaceId is required for local live conversation control.') { res.status(400).json({ error: message }); return; }
      const status = message === 'model required' || message.startsWith('Unknown model:') ? 400 : 500;
      res.status(status).json({ error: message });
    }
  });

  const readConversationPlanState = (conversationId: string, body?: { enabled?: boolean; items?: unknown }) => ({
    conversationId,
    enabled: body?.enabled === true,
    items: Array.isArray(body?.items) ? body.items : [],
  });

  router.get('/api/conversations/:id/plan', (req, res) => {
    res.json(readConversationPlanState(req.params.id));
  });

  router.patch('/api/conversations/:id/plan', (req, res) => {
    res.json(readConversationPlanState(req.params.id, req.body as { enabled?: boolean; items?: unknown }));
  });

  router.post('/api/conversations/:id/plan/items/:itemId/reset', (req, res) => {
    res.json(readConversationPlanState(req.params.id));
  });

  router.post('/api/conversations/:id/plan/items/:itemId/status', (req, res) => {
    res.json(readConversationPlanState(req.params.id));
  });
}

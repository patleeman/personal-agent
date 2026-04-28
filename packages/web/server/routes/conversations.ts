import type { Express } from 'express';
import type { ServerRouteContext } from './context.js';
import {
  setConversationServiceContext,
  readConversationSessionSignature,
  readSessionDetailForRoute,
  parseTailBlocksQuery,
  publishConversationSessionMetaChanged,
  toggleConversationAttention,
} from '../conversations/conversationService.js';
import {
  ConversationDeferredResumeCapabilityNotFoundError,
  cancelConversationDeferredResumeCapability,
  fireConversationDeferredResumeCapability,
  readConversationDeferredResumesCapability,
  scheduleConversationDeferredResumeCapability,
} from '../conversations/conversationDeferredResumeCapability.js';
import {
  buildAppendOnlySessionDetailResponse,
  readSessionBlock,
  readSessionImageAsset,
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
  readConversationArtifactCapability,
  readConversationArtifactsCapability,
  readConversationAttachmentCapability,
  readConversationAttachmentDownloadCapability,
  readConversationAttachmentsCapability,
  createConversationCommitCheckpointCommentCapability,
  readConversationCheckpointReviewContextCapability,
  readConversationCheckpointStructuralDiffCapability,
  readConversationCommitCheckpointCapability,
  readConversationCommitCheckpointsCapability,
  updateConversationAttachmentCapability,
} from '../conversations/conversationAssetsCapability.js';
import {
  readConversationSessionMetaCapability,
  readConversationSessionSearchIndexCapability,
  readConversationSessionsCapability,
} from '../conversations/conversationSessionCapability.js';
import {
  ConversationInspectCapabilityInputError,
  searchConversationInspectSessions,
} from '../conversations/conversationInspectCapability.js';
import {
  readConversationSummaryIndexCapability,
  startConversationSummaryBackfillLoop,
} from '../conversations/conversationSummaries.js';
import {
  readConversationContextDocs,
  writeConversationContextDocs,
} from '../conversations/conversationContextDocs.js';

let getCurrentProfileFn: () => string = () => {
  throw new Error('getCurrentProfile not initialized for conversation routes');
};

let getRepoRootFn: () => string = () => {
  throw new Error('getRepoRoot not initialized for conversation routes');
};

let flushLiveDeferredResumesFn: () => Promise<void> = async () => {};

function initializeConversationRoutesContext(
  context: Pick<ServerRouteContext, 'getCurrentProfile' | 'getRepoRoot' | 'getSavedUiPreferences' | 'flushLiveDeferredResumes'>,
): void {
  getCurrentProfileFn = context.getCurrentProfile;
  getRepoRootFn = context.getRepoRoot;
  flushLiveDeferredResumesFn = context.flushLiveDeferredResumes;

  setConversationServiceContext({
    getCurrentProfile: context.getCurrentProfile,
    getRepoRoot: context.getRepoRoot,
    getSavedUiPreferences: context.getSavedUiPreferences,
  });
}

function parseNonNegativeIntegerQuery(rawValue: unknown): number | undefined {
  const candidate = Array.isArray(rawValue) ? rawValue[0] : rawValue;
  const parsed = typeof candidate === 'number'
    ? candidate
    : typeof candidate === 'string' && /^\d+$/.test(candidate.trim())
      ? Number.parseInt(candidate.trim(), 10)
      : undefined;

  return Number.isInteger(parsed) && (parsed as number) >= 0
    ? parsed as number
    : undefined;
}

function parseNonNegativeIntegerPath(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    return null;
  }
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function parsePositiveIntegerQuery(rawValue: unknown): number | undefined {
  const candidate = Array.isArray(rawValue) ? rawValue[0] : rawValue;
  if (typeof candidate === 'number') {
    return Number.isInteger(candidate) && candidate > 0 ? candidate : Number.NaN;
  }
  if (typeof candidate !== 'string') {
    return undefined;
  }
  const trimmed = candidate.trim();
  if (!/^\d+$/.test(trimmed)) {
    return Number.NaN;
  }
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : Number.NaN;
}

function parseTrimmedQueryString(rawValue: unknown): string | undefined {
  const candidate = Array.isArray(rawValue) ? rawValue[0] : rawValue;
  if (typeof candidate !== 'string') {
    return undefined;
  }

  const normalized = candidate.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function writeConversationDeferredResumeCapabilityError(
  res: { status(code: number): { json(value: unknown): void } },
  err: unknown,
): boolean {
  if (err instanceof ConversationDeferredResumeCapabilityNotFoundError) {
    res.status(404).json({ error: err.message });
    return true;
  }

  return false;
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
      const session = readConversationSessionMetaCapability(req.params.id);
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
      const imageIndex = parseNonNegativeIntegerPath(req.params.imageIndex);
      if (imageIndex === null) {
        res.status(400).json({ error: 'imageIndex must be a non-negative integer' });
        return;
      }
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
  context: Pick<ServerRouteContext, 'getCurrentProfile' | 'getRepoRoot' | 'getSavedUiPreferences' | 'flushLiveDeferredResumes'>,
): void {
  initializeConversationRoutesContext(context);
  startConversationSummaryBackfillLoop({
    listSessions: readConversationSessionsCapability,
  });
  router.get('/api/sessions', (_req, res) => {
    try {
      res.json(readConversationSessionsCapability());
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
      res.json(readConversationSessionSearchIndexCapability(req.body as { sessionIds?: unknown }));
    } catch (err) {
      logError('request handler error', {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      res.status(500).json({ error: String(err) });
    }
  });

  router.post('/api/sessions/search', (req, res) => {
    try {
      const body = req.body as { query?: unknown; limit?: unknown };
      res.json(searchConversationInspectSessions({
        query: body.query,
        limit: body.limit,
        scope: 'all',
        searchMode: 'allTerms',
        maxSnippetCharacters: 220,
        stopAfterLimit: true,
      }));
    } catch (err) {
      if (err instanceof ConversationInspectCapabilityInputError) {
        res.status(400).json({ error: err.message });
        return;
      }

      logError('request handler error', {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      res.status(500).json({ error: String(err) });
    }
  });

  router.post('/api/conversation-summaries', (req, res) => {
    try {
      res.json(readConversationSummaryIndexCapability(req.body as { sessionIds?: unknown }));
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
      res.json(readConversationDeferredResumesCapability(req.params.id));
    } catch (err) {
      logError('request handler error', {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      if (writeConversationDeferredResumeCapabilityError(res, err)) {
        return;
      }
      res.status(500).json({ error: String(err) });
    }
  });

  router.post('/api/conversations/:id/deferred-resumes', async (req, res) => {
    try {
      const { delay, prompt, behavior } = req.body as { delay?: string; prompt?: string; behavior?: 'steer' | 'followUp' };
      res.json(await scheduleConversationDeferredResumeCapability({
        conversationId: req.params.id,
        delay,
        prompt,
        behavior,
      }));
    } catch (err) {
      if (writeConversationDeferredResumeCapabilityError(res, err)) {
        return;
      }
      res.status(400).json({ error: (err as Error).message });
    }
  });

  router.delete('/api/conversations/:id/deferred-resumes/:resumeId', async (req, res) => {
    try {
      res.json(await cancelConversationDeferredResumeCapability({
        conversationId: req.params.id,
        resumeId: req.params.resumeId,
      }));
    } catch (err) {
      if (writeConversationDeferredResumeCapabilityError(res, err)) {
        return;
      }
      res.status(400).json({ error: (err as Error).message });
    }
  });

  router.post('/api/conversations/:id/deferred-resumes/:resumeId/fire', async (req, res) => {
    try {
      res.json(await fireConversationDeferredResumeCapability({
        conversationId: req.params.id,
        resumeId: req.params.resumeId,
        flushLiveDeferredResumes: flushLiveDeferredResumesFn,
      }));
    } catch (err) {
      if (writeConversationDeferredResumeCapabilityError(res, err)) {
        return;
      }
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

  router.get('/api/conversations/:id/checkpoints', (req, res) => {
    try {
      res.json(readConversationCommitCheckpointsCapability(getCurrentProfileFn(), req.params.id));
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

  router.get('/api/conversations/:id/checkpoints/:checkpointId', (req, res) => {
    try {
      res.json(readConversationCommitCheckpointCapability(getCurrentProfileFn(), {
        conversationId: req.params.id,
        checkpointId: req.params.checkpointId,
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

  router.get('/api/conversations/:id/checkpoints/:checkpointId/review-context', async (req, res) => {
    try {
      res.json(await readConversationCheckpointReviewContextCapability(getCurrentProfileFn(), {
        conversationId: req.params.id,
        checkpointId: req.params.checkpointId,
      }, {
        repoRoot: getRepoRootFn(),
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

  router.get('/api/conversations/:id/checkpoints/:checkpointId/structural-diff', (req, res) => {
    try {
      res.json(readConversationCheckpointStructuralDiffCapability(getCurrentProfileFn(), {
        conversationId: req.params.id,
        checkpointId: req.params.checkpointId,
        filePath: parseTrimmedQueryString(req.query.path) ?? '',
        display: req.query.display === 'side-by-side' ? 'side-by-side' : 'inline',
      }, {
        repoRoot: getRepoRootFn(),
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

  router.post('/api/conversations/:id/checkpoints/:checkpointId/comments', (req, res) => {
    try {
      res.json(createConversationCommitCheckpointCommentCapability(getCurrentProfileFn(), {
        conversationId: req.params.id,
        checkpointId: req.params.checkpointId,
        body: req.body?.body,
        filePath: req.body?.filePath,
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

  router.get('/api/conversations/:id/attachments/:attachmentId/download/:asset', (req, res) => {
    try {
      const revisionQuery = parsePositiveIntegerQuery(req.query.revision);
      const asset = req.params.asset === 'source' || req.params.asset === 'preview'
        ? req.params.asset
        : 'invalid';

      const download = readConversationAttachmentDownloadCapability(getCurrentProfileFn(), {
        conversationId: req.params.id,
        attachmentId: req.params.attachmentId,
        asset,
        ...(req.query.revision !== undefined ? { revision: revisionQuery } : {}),
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
      if (writeConversationAssetCapabilityError(res, err)) {
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  router.get('/api/conversations/:id/context-docs', (req, res) => {
    try {
      res.json({
        conversationId: req.params.id,
        attachedContextDocs: readConversationContextDocs(req.params.id),
      });
    } catch (err) {
      logError('request handler error', {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      res.status(500).json({ error: String(err) });
    }
  });

  router.patch('/api/conversations/:id/context-docs', (req, res) => {
    try {
      const body = req.body as { docs?: unknown };
      const attachedContextDocs = writeConversationContextDocs({
        conversationId: req.params.id,
        attachedContextDocs: body.docs,
      });
      publishConversationSessionMetaChanged(req.params.id);
      res.json({
        conversationId: req.params.id,
        attachedContextDocs,
      });
    } catch (err) {
      logError('request handler error', {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
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

}



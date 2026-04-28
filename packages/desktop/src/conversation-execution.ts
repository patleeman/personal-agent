import { Buffer } from 'node:buffer';
import { readFileSync, statSync } from 'node:fs';
import type { HostManager } from './hosts/host-manager.js';
import type { HostApiDispatchResult } from './hosts/types.js';
import {
  clearSessionRemoteTarget,
  setSessionCwd,
  setSessionRemoteTarget,
} from './conversation-session-header.js';

interface LocalConversationMeta {
  id: string;
  file: string;
  cwd?: string;
  title?: string;
  remoteHostId?: string;
  remoteHostLabel?: string;
  remoteConversationId?: string;
}

interface ConversationBootstrapLike {
  sessionDetail?: {
    meta?: {
      id?: string;
      file?: string;
      cwd?: string;
      title?: string;
    };
  } | null;
  liveSession?: ({ live: false } | {
    live: true;
    id?: string;
    cwd?: string;
    sessionFile?: string;
    title?: string;
  }) | null;
}

interface ConversationExecutionTargetState {
  conversationId: string;
  remoteHostId?: string;
  remoteHostLabel?: string;
  remoteConversationId?: string;
}

interface ConversationSessionFileResolution {
  path: string | null;
  invalidPath?: string;
  invalidPathKind?: 'directory' | 'other';
}

function resolveRegularFilePath(pathValue: string | undefined | null): { path: string | null; invalidKind?: 'directory' | 'other' } {
  const normalizedPath = pathValue?.trim() || '';
  if (!normalizedPath) {
    return { path: null };
  }

  try {
    const stats = statSync(normalizedPath);
    if (stats.isFile()) {
      return { path: normalizedPath };
    }

    return {
      path: null,
      invalidKind: stats.isDirectory() ? 'directory' : 'other',
    };
  } catch {
    return { path: null };
  }
}

function resolveLocalConversationSessionFile(
  bootstrap: ConversationBootstrapLike | undefined,
  localMeta: LocalConversationMeta | null,
): ConversationSessionFileResolution {
  const candidates = [
    typeof bootstrap?.liveSession === 'object' && bootstrap.liveSession?.live === true
      ? bootstrap.liveSession.sessionFile
      : null,
    bootstrap?.sessionDetail?.meta?.file,
    localMeta?.file,
  ];
  let invalidPath: string | undefined;
  let invalidPathKind: 'directory' | 'other' | undefined;

  for (const candidate of candidates) {
    const normalizedCandidate = candidate?.trim() || '';
    if (!normalizedCandidate) {
      continue;
    }

    const resolved = resolveRegularFilePath(normalizedCandidate);
    if (resolved.path) {
      return { path: resolved.path };
    }

    if (!invalidPath && resolved.invalidKind) {
      invalidPath = normalizedCandidate;
      invalidPathKind = resolved.invalidKind;
    }
  }

  return {
    path: null,
    ...(invalidPath ? { invalidPath } : {}),
    ...(invalidPathKind ? { invalidPathKind } : {}),
  };
}

function parseJsonBody<T = unknown>(response: HostApiDispatchResult): T | null {
  const contentType = response.headers['content-type'] ?? response.headers['Content-Type'] ?? '';
  if (!contentType.toLowerCase().includes('application/json')) {
    return null;
  }

  try {
    return JSON.parse(Buffer.from(response.body).toString('utf-8')) as T;
  } catch {
    return null;
  }
}

function encodeJsonResultLike(response: HostApiDispatchResult, body: unknown): HostApiDispatchResult {
  return {
    ...response,
    body: Uint8Array.from(Buffer.from(JSON.stringify(body), 'utf-8')),
    headers: {
      ...response.headers,
      'content-type': 'application/json; charset=utf-8',
    },
  };
}

async function readLocalConversationMeta(hostManager: HostManager, conversationId: string): Promise<LocalConversationMeta | null> {
  const controller = hostManager.getHostController('local');
  if (!controller.readSessionMeta) {
    return null;
  }

  try {
    const meta = await controller.readSessionMeta(conversationId) as Partial<LocalConversationMeta> | null;
    if (!meta || typeof meta.file !== 'string' || typeof meta.id !== 'string') {
      return null;
    }

    return {
      id: meta.id,
      file: meta.file,
      ...(typeof meta.cwd === 'string' ? { cwd: meta.cwd } : {}),
      ...(typeof meta.title === 'string' ? { title: meta.title } : {}),
      ...(typeof meta.remoteHostId === 'string' ? { remoteHostId: meta.remoteHostId } : {}),
      ...(typeof meta.remoteHostLabel === 'string' ? { remoteHostLabel: meta.remoteHostLabel } : {}),
      ...(typeof meta.remoteConversationId === 'string' ? { remoteConversationId: meta.remoteConversationId } : {}),
    };
  } catch {
    return null;
  }
}

async function readConversationExecutionTarget(
  hostManager: HostManager,
  conversationId: string,
): Promise<ConversationExecutionTargetState> {
  const meta = await readLocalConversationMeta(hostManager, conversationId);
  return {
    conversationId,
    ...(meta?.remoteHostId ? { remoteHostId: meta.remoteHostId } : {}),
    ...(meta?.remoteHostLabel ? { remoteHostLabel: meta.remoteHostLabel } : {}),
    ...(meta?.remoteConversationId ? { remoteConversationId: meta.remoteConversationId } : {}),
  };
}

async function resolveConversationRemoteTarget(hostManager: HostManager, conversationId: string): Promise<{
  hostId: string;
  hostLabel?: string;
  remoteConversationId: string;
} | null> {
  const state = await readConversationExecutionTarget(hostManager, conversationId);
  if (!state.remoteHostId || !state.remoteConversationId) {
    return null;
  }

  return {
    hostId: state.remoteHostId,
    ...(state.remoteHostLabel ? { hostLabel: state.remoteHostLabel } : {}),
    remoteConversationId: state.remoteConversationId,
  };
}


function isPlaceholderConversationTitle(title: string | undefined): boolean {
  const normalized = title?.trim().toLowerCase();
  return !normalized || normalized === 'new conversation' || normalized === '(new conversation)' || normalized === 'conversation';
}

function formatFallbackConversationTitle(text: string, imageCount: number): string {
  return text.trim().replace(/\s+/g, ' ').slice(0, 80)
    || (imageCount === 1 ? '(image attachment)' : imageCount > 1 ? `(${String(imageCount)} image attachments)` : '');
}

function hasPromptImageData(value: unknown): boolean {
  if (typeof value !== 'string') {
    return false;
  }

  const normalized = value.trim();
  if (!normalized || normalized.length % 4 === 1 || !/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)) {
    return false;
  }

  return Buffer.from(normalized, 'base64').length > 0;
}

function buildPromptFallbackConversationTitle(body: unknown): string {
  if (!body || typeof body !== 'object') {
    return '';
  }

  const candidate = body as { text?: unknown; images?: unknown };
  const text = typeof candidate.text === 'string' ? candidate.text : '';
  const imageCount = Array.isArray(candidate.images)
    ? candidate.images.filter((image) => (
        !!image
        && typeof image === 'object'
        && hasPromptImageData((image as { data?: unknown }).data)
        && typeof (image as { mimeType?: unknown }).mimeType === 'string'
        && (image as { mimeType: string }).mimeType.trim().length > 0
      )).length
    : 0;
  return formatFallbackConversationTitle(text, imageCount);
}

function buildBashFallbackConversationTitle(body: unknown): string {
  if (!body || typeof body !== 'object') {
    return '';
  }

  const command = typeof (body as { command?: unknown }).command === 'string'
    ? ((body as { command: string }).command)
    : '';
  return formatFallbackConversationTitle(command, 0);
}

function parseRemoteTitleUpdateFromStreamEventData(data: string | undefined): string | null {
  if (!data) {
    return null;
  }

  try {
    const parsed = JSON.parse(data) as { type?: unknown; title?: unknown };
    if (parsed.type !== 'title_update' || typeof parsed.title !== 'string') {
      return null;
    }

    const title = parsed.title.trim();
    return title.length > 0 ? title : null;
  } catch {
    return null;
  }
}

async function renameConversationForRemoteTarget(hostManager: HostManager, input: {
  localConversationId: string;
  remoteHostId: string;
  remoteConversationId: string;
  name: string;
}): Promise<void> {
  const normalizedName = input.name.trim();
  if (!normalizedName) {
    return;
  }

  const remoteController = hostManager.getHostController(input.remoteHostId);
  const localController = hostManager.getHostController('local');

  await remoteController.dispatchApiRequest({
    method: 'PATCH',
    path: `/api/conversations/${encodeURIComponent(input.remoteConversationId)}/title`,
    body: { name: normalizedName },
  }).catch(() => undefined);

  if (localController.renameConversation) {
    await localController.renameConversation({
      conversationId: input.localConversationId,
      name: normalizedName,
    }).catch(() => undefined);
    return;
  }

  await localController.dispatchApiRequest({
    method: 'PATCH',
    path: `/api/conversations/${encodeURIComponent(input.localConversationId)}/title`,
    body: { name: normalizedName },
  }).catch(() => undefined);
}

function translateConversationScopedPath(path: string, localConversationId: string, remoteConversationId: string): string | null {
  const conversationPathPrefix = `/api/conversations/${encodeURIComponent(localConversationId)}`;
  const liveSessionPathPrefix = `/api/live-sessions/${encodeURIComponent(localConversationId)}`;
  const sessionPathPrefix = `/api/sessions/${encodeURIComponent(localConversationId)}`;

  if (path === `${conversationPathPrefix}/bootstrap` || path.startsWith(`${conversationPathPrefix}/bootstrap?`)) {
    return path.replace(conversationPathPrefix, `/api/conversations/${encodeURIComponent(remoteConversationId)}`);
  }

  if (path === `${conversationPathPrefix}/model-preferences` || path.startsWith(`${conversationPathPrefix}/model-preferences?`)) {
    return path.replace(conversationPathPrefix, `/api/conversations/${encodeURIComponent(remoteConversationId)}`);
  }

  if (path === `${conversationPathPrefix}/cwd` || path.startsWith(`${conversationPathPrefix}/cwd?`)) {
    return path.replace(conversationPathPrefix, `/api/conversations/${encodeURIComponent(remoteConversationId)}`);
  }

  if (path === `${liveSessionPathPrefix}`
    || path.startsWith(`${liveSessionPathPrefix}/`)
    || path.startsWith(`${liveSessionPathPrefix}?`)) {
    return path.replace(liveSessionPathPrefix, `/api/live-sessions/${encodeURIComponent(remoteConversationId)}`);
  }

  if (path === `${sessionPathPrefix}`
    || path.startsWith(`${sessionPathPrefix}/`)
    || path.startsWith(`${sessionPathPrefix}?`)) {
    return path.replace(sessionPathPrefix, `/api/sessions/${encodeURIComponent(remoteConversationId)}`);
  }

  return null;
}

function rewriteConversationScopedResponse(
  originalPath: string,
  localConversationId: string,
  response: HostApiDispatchResult,
): HostApiDispatchResult {
  const parsed = parseJsonBody<Record<string, unknown>>(response);
  if (!parsed) {
    return response;
  }

  if (originalPath.includes(`/api/conversations/${encodeURIComponent(localConversationId)}/bootstrap`)) {
    const body = { ...parsed } as Record<string, unknown>;
    body.conversationId = localConversationId;
    const sessionDetail = body.sessionDetail as { meta?: Record<string, unknown> } | null | undefined;
    if (sessionDetail?.meta) {
      sessionDetail.meta = {
        ...sessionDetail.meta,
        id: localConversationId,
      };
      body.sessionDetail = sessionDetail;
    }
    const liveSession = body.liveSession as Record<string, unknown> | null | undefined;
    if (liveSession && typeof liveSession === 'object' && liveSession.live === true) {
      body.liveSession = {
        ...liveSession,
        id: localConversationId,
        live: true,
      };
    }
    return encodeJsonResultLike(response, body);
  }

  if (originalPath === `/api/live-sessions/${encodeURIComponent(localConversationId)}`
    || originalPath.startsWith(`/api/live-sessions/${encodeURIComponent(localConversationId)}?`)) {
    return encodeJsonResultLike(response, {
      ...parsed,
      id: localConversationId,
      live: true,
    });
  }

  if (originalPath.startsWith(`/api/sessions/${encodeURIComponent(localConversationId)}`)) {
    const body = { ...parsed } as Record<string, unknown>;
    const meta = body.meta as Record<string, unknown> | undefined;
    if (meta) {
      body.meta = {
        ...meta,
        id: localConversationId,
      };
    }
    return encodeJsonResultLike(response, body);
  }

  return response;
}

export async function continueConversationInHost(
  hostManager: HostManager,
  input: { conversationId?: string; hostId?: string; cwd?: string | null },
): Promise<ConversationExecutionTargetState> {
  const conversationId = input.conversationId?.trim() || '';
  const hostId = input.hostId?.trim() || '';
  if (!conversationId || !hostId) {
    throw new Error('Conversation id and host id are required.');
  }

  const localController = hostManager.getHostController('local');
  const bootstrap = await localController.readConversationBootstrap?.({ conversationId }) as ConversationBootstrapLike | undefined;
  const localMeta = await readLocalConversationMeta(hostManager, conversationId);
  const sessionFileResolution = resolveLocalConversationSessionFile(bootstrap, localMeta);
  const sessionFile = sessionFileResolution.path;
  const cwd = typeof bootstrap?.liveSession === 'object' && bootstrap.liveSession?.live === true
    ? bootstrap.liveSession.cwd?.trim() || localMeta?.cwd || ''
    : bootstrap?.sessionDetail?.meta?.cwd?.trim() || localMeta?.cwd || '';
  const title = typeof bootstrap?.liveSession === 'object' && bootstrap.liveSession?.live === true
    ? bootstrap.liveSession.title?.trim() || localMeta?.title || 'Conversation'
    : bootstrap?.sessionDetail?.meta?.title?.trim() || localMeta?.title || 'Conversation';

  if (!sessionFile) {
    if (sessionFileResolution.invalidPath) {
      throw new Error(
        sessionFileResolution.invalidPathKind === 'directory'
          ? `Conversation session file is invalid (expected a file, got a directory): ${sessionFileResolution.invalidPath}`
          : `Conversation session file is invalid (not a regular file): ${sessionFileResolution.invalidPath}`,
      );
    }

    throw new Error('Conversation does not have a persisted session file yet. Send a turn first, then continue it remotely.');
  }

  if (hostId === 'local') {
    const existingTarget = await resolveConversationRemoteTarget(hostManager, conversationId);
    if (existingTarget?.hostId) {
      const remoteController = hostManager.getHostController(existingTarget.hostId);
      await remoteController.dispatchApiRequest({
        method: 'DELETE',
        path: `/api/live-sessions/${encodeURIComponent(existingTarget.remoteConversationId)}`,
      }).catch(() => undefined);
    }

    clearSessionRemoteTarget(sessionFile);
    return { conversationId };
  }

  const hostRecord = hostManager.getHostRecord(hostId);
  if (hostRecord.kind === 'local') {
    throw new Error('Use the local option instead of creating a remote link to the local host.');
  }

  const remoteController = hostManager.getHostController(hostId);
  await hostManager.ensureHostRunning(hostId);

  const existingTarget = await resolveConversationRemoteTarget(hostManager, conversationId);
  if (existingTarget?.hostId === hostId && existingTarget.remoteConversationId) {
    const existingRemoteMeta = await remoteController.dispatchApiRequest({
      method: 'GET',
      path: `/api/sessions/${encodeURIComponent(existingTarget.remoteConversationId)}/meta`,
    }).catch(() => null);
    if (existingRemoteMeta && existingRemoteMeta.statusCode >= 200 && existingRemoteMeta.statusCode < 400) {
      const remoteMeta = parseJsonBody<{ cwd?: unknown }>(existingRemoteMeta);
      if (localMeta?.file && typeof remoteMeta?.cwd === 'string') {
        setSessionCwd(localMeta.file, remoteMeta.cwd);
      }

      return {
        conversationId,
        remoteHostId: existingTarget.hostId,
        ...(existingTarget.hostLabel ? { remoteHostLabel: existingTarget.hostLabel } : {}),
        remoteConversationId: existingTarget.remoteConversationId,
      };
    }
  }
  const requestedRemoteCwd = typeof input.cwd === 'string' ? input.cwd.trim() : '';
  const remoteCwd = requestedRemoteCwd || cwd;
  const sessionContent = readFileSync(sessionFile, 'utf-8');
  const created = await remoteController.invokeLocalApi('POST', '/api/live-sessions', {
    conversationId,
    ...(remoteCwd ? { cwd: remoteCwd } : {}),
    sessionContent,
  });
  const remoteConversationId = typeof (created as { id?: unknown } | null | undefined)?.id === 'string'
    ? ((created as { id: string }).id).trim()
    : '';
  if (!remoteConversationId) {
    throw new Error(`Remote host ${hostRecord.label} did not return a conversation id.`);
  }

  if (title.trim().length > 0) {
    await remoteController.invokeLocalApi('PATCH', `/api/conversations/${encodeURIComponent(remoteConversationId)}/title`, {
      name: title.trim(),
    }).catch(() => undefined);
  }

  setSessionRemoteTarget(sessionFile, {
    remoteHostId: hostId,
    remoteHostLabel: hostRecord.label,
    remoteConversationId: remoteConversationId || conversationId,
  });

  const remoteMetaResponse = await remoteController.dispatchApiRequest({
    method: 'GET',
    path: `/api/sessions/${encodeURIComponent(remoteConversationId)}/meta`,
  }).catch(() => null);
  const remoteMeta = remoteMetaResponse ? parseJsonBody<{ cwd?: unknown }>(remoteMetaResponse) : null;
  if (typeof remoteMeta?.cwd === 'string') {
    setSessionCwd(sessionFile, remoteMeta.cwd);
  } else if (remoteCwd) {
    setSessionCwd(sessionFile, remoteCwd);
  }

  if (typeof bootstrap?.liveSession === 'object' && bootstrap.liveSession?.live === true && localController.destroyLiveSession) {
    await localController.destroyLiveSession(conversationId).catch(() => undefined);
  }

  return {
    conversationId,
    remoteHostId: hostId,
    remoteHostLabel: hostRecord.label,
    remoteConversationId,
  };
}

export async function dispatchConversationExecutionRequest(
  hostManager: HostManager,
  input: {
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    path: string;
    body?: unknown;
    headers?: Record<string, string>;
  },
): Promise<HostApiDispatchResult | null> {
  const localConversationId = decodeConversationIdFromPath(input.path);
  if (!localConversationId) {
    return null;
  }

  const target = await resolveConversationRemoteTarget(hostManager, localConversationId);
  if (!target) {
    return null;
  }

  const localMeta = await readLocalConversationMeta(hostManager, localConversationId);

  if (input.method === 'POST') {
    if (localMeta && isPlaceholderConversationTitle(localMeta.title)) {
      const encodedConversationId = encodeURIComponent(localConversationId);
      const fallbackTitle = input.path === `/api/live-sessions/${encodedConversationId}/prompt`
        ? buildPromptFallbackConversationTitle(input.body)
        : input.path === `/api/live-sessions/${encodedConversationId}/bash`
          ? buildBashFallbackConversationTitle(input.body)
          : '';

      if (fallbackTitle) {
        await renameConversationForRemoteTarget(hostManager, {
          localConversationId,
          remoteHostId: target.hostId,
          remoteConversationId: target.remoteConversationId,
          name: fallbackTitle,
        });
      }
    }
  }

  if (input.path === `/api/conversations/${encodeURIComponent(localConversationId)}/title` && input.method === 'PATCH') {
    const localController = hostManager.getHostController('local');
    const remoteController = hostManager.getHostController(target.hostId);
    await remoteController.dispatchApiRequest({
      method: input.method,
      path: `/api/conversations/${encodeURIComponent(target.remoteConversationId)}/title`,
      body: input.body,
      headers: input.headers,
    }).catch(() => undefined);
    return localController.dispatchApiRequest(input);
  }

  const translatedPath = translateConversationScopedPath(input.path, localConversationId, target.remoteConversationId);
  if (!translatedPath) {
    return null;
  }

  const remoteController = hostManager.getHostController(target.hostId);
  const remoteResponse = await remoteController.dispatchApiRequest({
    ...input,
    path: translatedPath,
  });

  if (input.method === 'POST' && input.path === `/api/conversations/${encodeURIComponent(localConversationId)}/cwd`) {
    const parsed = parseJsonBody<Record<string, unknown>>(remoteResponse);
    if (parsed && localMeta?.file) {
      const remoteConversationId = typeof parsed.id === 'string' ? parsed.id.trim() : '';
      const remoteCwd = typeof parsed.cwd === 'string' ? parsed.cwd : '';
      if (remoteConversationId && remoteConversationId !== target.remoteConversationId) {
        const remoteHostLabel = target.hostLabel || hostManager.getHostRecord(target.hostId).label;
        setSessionRemoteTarget(localMeta.file, {
          remoteHostId: target.hostId,
          remoteHostLabel,
          remoteConversationId,
        });
      }
      if (remoteCwd) {
        setSessionCwd(localMeta.file, remoteCwd);
      }

      return encodeJsonResultLike(remoteResponse, {
        ...parsed,
        id: localConversationId,
        ...(localMeta.file ? { sessionFile: localMeta.file } : {}),
        ...(remoteCwd ? { cwd: remoteCwd } : {}),
      });
    }
  }

  const rewrittenResponse = rewriteConversationScopedResponse(input.path, localConversationId, remoteResponse);
  if (localMeta?.file) {
    const rewrittenBody = parseJsonBody<Record<string, unknown>>(rewrittenResponse);
    const bootstrap = rewrittenBody?.sessionDetail as { meta?: { cwd?: unknown } } | undefined;
    const bootstrapCwd = typeof bootstrap?.meta?.cwd === 'string' ? bootstrap.meta.cwd : '';
    const topLevelCwd = typeof rewrittenBody?.cwd === 'string' ? rewrittenBody.cwd : '';
    const nextCwd = bootstrapCwd || topLevelCwd;
    if (nextCwd) {
      setSessionCwd(localMeta.file, nextCwd);
    }
  }

  return rewrittenResponse;
}

export async function subscribeConversationExecutionApiStream(
  hostManager: HostManager,
  path: string,
  onEvent: Parameters<Awaited<ReturnType<HostManager['getHostController']>>['subscribeApiStream']>[1],
): Promise<(() => void) | null> {
  const localConversationId = decodeConversationIdFromPath(path);
  if (!localConversationId) {
    return null;
  }

  const target = await resolveConversationRemoteTarget(hostManager, localConversationId);
  if (!target) {
    return null;
  }

  const translatedPath = translateConversationScopedPath(path, localConversationId, target.remoteConversationId);
  if (!translatedPath) {
    return null;
  }

  const remoteController = hostManager.getHostController(target.hostId);
  const localController = hostManager.getHostController('local');
  return remoteController.subscribeApiStream(translatedPath, (event) => {
    if (event.type === 'message') {
      const remoteTitle = parseRemoteTitleUpdateFromStreamEventData(event.data);
      if (remoteTitle) {
        void (async () => {
          const localMeta = await readLocalConversationMeta(hostManager, localConversationId);
          if (localMeta?.title?.trim() === remoteTitle) {
            return;
          }

          if (localController.renameConversation) {
            await localController.renameConversation({
              conversationId: localConversationId,
              name: remoteTitle,
            }).catch(() => undefined);
            return;
          }

          await localController.dispatchApiRequest({
            method: 'PATCH',
            path: `/api/conversations/${encodeURIComponent(localConversationId)}/title`,
            body: { name: remoteTitle },
          }).catch(() => undefined);
        })();
      }
    }

    onEvent(event);
  });
}

function decodeConversationIdFromPath(path: string): string | null {
  const patterns = [
    /^\/api\/conversations\/([^/]+)\//,
    /^\/api\/live-sessions\/([^/]+)(?:\/|$)/,
    /^\/api\/sessions\/([^/]+)(?:\/|$)/,
  ];

  for (const pattern of patterns) {
    const match = path.match(pattern);
    if (match?.[1]) {
      return decodeURIComponent(match[1]);
    }
  }

  return null;
}

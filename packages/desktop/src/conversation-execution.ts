import { Buffer } from 'node:buffer';
import { readFileSync, writeFileSync } from 'node:fs';
import type { HostManager } from './hosts/host-manager.js';
import type { HostApiDispatchResult } from './hosts/types.js';

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

interface SessionHeaderRecord {
  type: 'session';
  id: string;
  timestamp: string;
  cwd: string;
  version?: number;
  parentSession?: string;
  remoteHostId?: string;
  remoteHostLabel?: string;
  remoteConversationId?: string;
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

function readSessionHeader(filePath: string): { lines: string[]; headerIndex: number; header: SessionHeaderRecord } {
  const raw = readFileSync(filePath, 'utf-8');
  const lines = raw.split(/\r?\n/);
  const headerIndex = lines.findIndex((line) => line.trim().length > 0);
  if (headerIndex === -1) {
    throw new Error(`Conversation header missing in ${filePath}`);
  }

  const parsed = JSON.parse(lines[headerIndex] ?? '') as Partial<SessionHeaderRecord>;
  if (parsed.type !== 'session' || typeof parsed.id !== 'string' || typeof parsed.timestamp !== 'string' || typeof parsed.cwd !== 'string') {
    throw new Error(`Conversation header missing in ${filePath}`);
  }

  return {
    lines,
    headerIndex,
    header: parsed as SessionHeaderRecord,
  };
}

function writeSessionHeader(filePath: string, header: SessionHeaderRecord, lines: string[], headerIndex: number): void {
  lines[headerIndex] = JSON.stringify(header);
  writeFileSync(filePath, `${lines.filter((line) => line.length > 0).join('\n')}\n`, 'utf-8');
}

function setSessionRemoteTarget(filePath: string, input: {
  remoteHostId: string;
  remoteHostLabel?: string;
  remoteConversationId: string;
}): void {
  const { lines, headerIndex, header } = readSessionHeader(filePath);
  writeSessionHeader(filePath, {
    ...header,
    remoteHostId: input.remoteHostId,
    ...(input.remoteHostLabel ? { remoteHostLabel: input.remoteHostLabel } : {}),
    remoteConversationId: input.remoteConversationId,
  }, lines, headerIndex);
}

function clearSessionRemoteTarget(filePath: string): void {
  const { lines, headerIndex, header } = readSessionHeader(filePath);
  const nextHeader = { ...header };
  delete nextHeader.remoteHostId;
  delete nextHeader.remoteHostLabel;
  delete nextHeader.remoteConversationId;
  writeSessionHeader(filePath, nextHeader, lines, headerIndex);
}

function isPlaceholderConversationTitle(title: string | undefined): boolean {
  const normalized = title?.trim().toLowerCase();
  return !normalized || normalized === 'new conversation' || normalized === '(new conversation)' || normalized === 'conversation';
}

function formatFallbackConversationTitle(text: string, imageCount: number): string {
  return text.trim().replace(/\s+/g, ' ').slice(0, 80)
    || (imageCount === 1 ? '(image attachment)' : imageCount > 1 ? `(${String(imageCount)} image attachments)` : '');
}

function buildPromptFallbackConversationTitle(body: unknown): string {
  if (!body || typeof body !== 'object') {
    return '';
  }

  const candidate = body as { text?: unknown; images?: unknown };
  const text = typeof candidate.text === 'string' ? candidate.text : '';
  const imageCount = Array.isArray(candidate.images) ? candidate.images.length : 0;
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
  input: { conversationId?: string; hostId?: string },
): Promise<ConversationExecutionTargetState> {
  const conversationId = input.conversationId?.trim() || '';
  const hostId = input.hostId?.trim() || '';
  if (!conversationId || !hostId) {
    throw new Error('Conversation id and host id are required.');
  }

  const localController = hostManager.getHostController('local');
  const bootstrap = await localController.readConversationBootstrap?.({ conversationId }) as ConversationBootstrapLike | undefined;
  const localMeta = await readLocalConversationMeta(hostManager, conversationId);
  const sessionFile = typeof bootstrap?.liveSession === 'object' && bootstrap.liveSession?.live === true
    ? bootstrap.liveSession.sessionFile?.trim() || localMeta?.file
    : bootstrap?.sessionDetail?.meta?.file?.trim() || localMeta?.file;
  const cwd = typeof bootstrap?.liveSession === 'object' && bootstrap.liveSession?.live === true
    ? bootstrap.liveSession.cwd?.trim() || localMeta?.cwd || ''
    : bootstrap?.sessionDetail?.meta?.cwd?.trim() || localMeta?.cwd || '';
  const title = typeof bootstrap?.liveSession === 'object' && bootstrap.liveSession?.live === true
    ? bootstrap.liveSession.title?.trim() || localMeta?.title || 'Conversation'
    : bootstrap?.sessionDetail?.meta?.title?.trim() || localMeta?.title || 'Conversation';

  if (!sessionFile) {
    throw new Error('Conversation does not have a persisted session file yet. Send a turn first, then continue it remotely.');
  }

  if (hostId === 'local') {
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
      return {
        conversationId,
        remoteHostId: existingTarget.hostId,
        ...(existingTarget.hostLabel ? { remoteHostLabel: existingTarget.hostLabel } : {}),
        remoteConversationId: existingTarget.remoteConversationId,
      };
    }
  }
  const created = await remoteController.invokeLocalApi('POST', '/api/live-sessions', cwd ? { cwd } : {});
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
    remoteConversationId,
  });

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
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
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

  if (input.method === 'POST') {
    const localMeta = await readLocalConversationMeta(hostManager, localConversationId);
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
  return rewriteConversationScopedResponse(input.path, localConversationId, remoteResponse);
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

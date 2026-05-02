import { mkdtempSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import type { DaemonConfig } from '../config.js';
import { DaemonCompanionServer } from './server.js';
import type { CompanionRuntime } from './types.js';

function createTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function createTestConfig(stateRoot: string): DaemonConfig {
  return {
    logLevel: 'debug',
    queue: { maxDepth: 10 },
    ipc: { socketPath: join(stateRoot, 'daemon.sock') },
    companion: { enabled: true, host: '127.0.0.1', port: 0 },
    modules: {
      maintenance: { enabled: false, cleanupIntervalMinutes: 60 },
      tasks: {
        enabled: false,
        taskDir: join(stateRoot, 'tasks'),
        tickIntervalSeconds: 30,
        maxRetries: 3,
        reapAfterDays: 7,
        defaultTimeoutSeconds: 1800,
      },
    },
  };
}

async function readJson(response: Response) {
  return response.json() as Promise<unknown>;
}

async function openSocket(url: string, token: string): Promise<{ socket: WebSocket; firstMessage: unknown }> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    socket.once('message', (data) => {
      try {
        resolve({
          socket,
          firstMessage: JSON.parse(data.toString('utf-8')) as unknown,
        });
      } catch (error) {
        reject(error);
      }
    });
    socket.once('error', reject);
  });
}

async function readSocketMessage(socket: WebSocket): Promise<unknown> {
  return new Promise((resolve, reject) => {
    socket.once('message', (data) => {
      try {
        resolve(JSON.parse(data.toString('utf-8')) as unknown);
      } catch (error) {
        reject(error);
      }
    });
    socket.once('error', reject);
  });
}

describe('daemon companion server', () => {
  const servers: DaemonCompanionServer[] = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.stop()));
  });

  it('serves hello, pairing/admin routes, HTTP attachment routes, and the multiplexed socket', async () => {
    const stateRoot = createTempDir('pa-companion-server-');
    const appSubscribers: Array<(event: unknown) => void> = [];
    const conversationSubscribers: Array<(event: unknown) => void> = [];

    const runtime: CompanionRuntime = {
      listConversations: async () => ({ sessions: [{ id: 'conv-1', title: 'Conversation 1' }], ordering: { sessionIds: ['conv-1'], pinnedSessionIds: ['conv-1'], archivedSessionIds: [], workspacePaths: [] } }),
      updateConversationTabs: async () => ({ ok: true }),
      duplicateConversation: async () => ({ ok: true, conversationId: 'duplicate-1' }),
      listExecutionTargets: async () => ({ executionTargets: [{ id: 'local', label: 'Local', kind: 'local' }] }),
      readModels: async () => ({ currentModel: 'gpt-5.4', currentThinkingLevel: 'high', currentServiceTier: '', models: [] }),
      listSshTargets: async () => ({ hosts: [{ id: 'ssh-1', label: 'Buildbox', kind: 'ssh', sshTarget: 'user@buildbox' }] }),
      saveSshTarget: async (input) => ({ hosts: [{ id: input.id ?? 'ssh-1', label: input.label, kind: 'ssh', sshTarget: input.sshTarget }] }),
      deleteSshTarget: async (targetId) => ({ ok: true, deleted: true, targetId }),
      testSshTarget: async (input) => ({ ok: true, sshTarget: input.sshTarget, os: 'linux', arch: 'arm64', platformKey: 'linux-arm64', homeDirectory: '/home/user', tempDirectory: '/tmp', cacheDirectory: '/tmp/.cache', message: 'reachable' }),
      readRemoteDirectory: async (input) => ({ path: input.path ?? '/repo', parent: '/', entries: [] }),
      readConversationBootstrap: async (input) => ({ conversationId: input.conversationId, bootstrap: true, tailBlocks: input.tailBlocks }),
      createConversation: async () => ({ conversationId: 'created-1' }),
      resumeConversation: async () => ({ conversationId: 'resumed-1' }),
      promptConversation: async (input) => ({ ok: true, conversationId: input.conversationId }),
      parallelPromptConversation: async (input) => ({ ok: true, conversationId: input.conversationId }),
      restoreConversationQueuePrompt: async (input) => ({ ok: true, behavior: input.behavior, index: input.index, text: 'queued hello', images: [] }),
      manageConversationParallelJob: async (input) => ({ ok: true, status: input.action === 'cancel' ? 'cancelled' : input.action === 'skip' ? 'skipped' : 'imported' }),
      cancelConversationDeferredResume: async (input) => ({ ok: true, conversationId: input.conversationId, resumeId: input.resumeId, status: 'cancelled' }),
      fireConversationDeferredResume: async (input) => ({ ok: true, conversationId: input.conversationId, resumeId: input.resumeId, status: 'fired' }),
      abortConversation: async (input) => ({ ok: true, conversationId: input.conversationId }),
      takeOverConversation: async (input) => ({ ok: true, surfaceId: input.surfaceId }),
      renameConversation: async (input) => ({ ok: true, title: input.name }),
      changeConversationCwd: async (input) => ({ ok: true, conversationId: input.conversationId, cwd: input.cwd }),
      readConversationAutoMode: async () => ({ enabled: false, stopReason: null, updatedAt: '2026-04-19T00:00:00.000Z' }),
      updateConversationAutoMode: async ({ enabled }) => ({ enabled, stopReason: null, updatedAt: '2026-04-19T00:00:00.000Z' }),
      readConversationModelPreferences: async () => ({ currentModel: 'gpt-5.4', currentThinkingLevel: 'high', currentServiceTier: 'default', hasExplicitServiceTier: false }),
      updateConversationModelPreferences: async () => ({ currentModel: 'gpt-5.4', currentThinkingLevel: 'high', currentServiceTier: 'default', hasExplicitServiceTier: false }),
      createConversationCheckpoint: async (input) => ({ id: 'checkpoint-1', conversationId: input.conversationId, title: input.message, shortSha: 'abc1234', commitSha: 'abc1234def', subject: input.message, fileCount: input.paths.length, linesAdded: 1, linesDeleted: 0, cwd: '/repo', authorName: 'Test User', committedAt: '2026-04-19T00:00:00.000Z', createdAt: '2026-04-19T00:00:00.000Z', updatedAt: '2026-04-19T00:00:00.000Z', commentCount: 0, files: [], comments: [] }),
      listConversationArtifacts: async (conversationId) => ({ conversationId, artifacts: [] }),
      readConversationArtifact: async ({ conversationId, artifactId }) => ({ conversationId, artifact: { id: artifactId } }),
      listConversationCheckpoints: async (conversationId) => ({ conversationId, checkpoints: [] }),
      readConversationCheckpoint: async ({ conversationId, checkpointId }) => ({ conversationId, checkpoint: { id: checkpointId } }),
      changeConversationExecutionTarget: async (input) => ({ ok: true, executionTargetId: input.executionTargetId }),
      readConversationBlockImage: async ({ imageIndex }) => ({
        data: Buffer.from(typeof imageIndex === 'number' ? `image-${String(imageIndex)}` : 'image-block', 'utf-8'),
        mimeType: 'image/png',
        disposition: 'inline',
      }),
      listConversationAttachments: async (conversationId) => ({ conversationId, attachments: [{ id: 'att-1', title: 'Sketch' }] }),
      readConversationAttachment: async ({ conversationId, attachmentId }) => ({ conversationId, attachment: { id: attachmentId, title: 'Sketch' } }),
      createConversationAttachment: async (input) => ({ conversationId: input.conversationId, attachment: { id: 'att-new' } }),
      updateConversationAttachment: async (input) => ({ conversationId: input.conversationId, attachment: { id: input.attachmentId } }),
      readConversationAttachmentAsset: async () => ({
        data: Buffer.from('preview-bytes', 'utf-8'),
        mimeType: 'image/png',
        fileName: 'preview.png',
        disposition: 'inline',
      }),
      listKnowledgeEntries: async (directoryId) => ({ root: '/vault', entries: directoryId ? [{ id: 'notes/daily.md', kind: 'file', name: 'daily.md' }] : [{ id: 'notes/', kind: 'folder', name: 'notes' }] }),
      searchKnowledge: async ({ query, limit }) => ({ results: [{ id: 'notes/release-checklist.md', name: 'release-checklist.md', title: query?.trim() || 'release-checklist', excerpt: 'Release checklist', limit }] }),
      readKnowledgeFile: async (fileId) => ({ id: fileId, content: '# Demo', updatedAt: '2026-04-19T00:00:00.000Z' }),
      writeKnowledgeFile: async ({ fileId, content }) => ({ id: fileId, kind: 'file', name: fileId.split('/').pop(), sizeBytes: content.length, updatedAt: '2026-04-19T00:00:00.000Z' }),
      createKnowledgeFolder: async (folderId) => ({ id: `${folderId}/`, kind: 'folder', name: folderId.split('/').pop(), sizeBytes: 0, updatedAt: '2026-04-19T00:00:00.000Z' }),
      renameKnowledgeEntry: async ({ id, newName, parentId }) => ({ id: parentId !== undefined && parentId !== null ? `${parentId}${parentId ? '/' : ''}${newName}` : `${id.split('/').slice(0, -1).join('/')}${id.includes('/') ? '/' : ''}${newName}`, kind: id.endsWith('/') ? 'folder' : 'file', name: newName, sizeBytes: 0, updatedAt: '2026-04-19T00:00:00.000Z' }),
      deleteKnowledgeEntry: async () => ({ ok: true }),
      createKnowledgeImageAsset: async ({ fileName }) => ({ id: `_attachments/${fileName ?? 'image.png'}`, url: '/api/vault/asset?id=_attachments%2Fimage.png' }),
      importKnowledge: async (input) => ({ note: { id: 'Inbox/shared-link.md', kind: 'file', name: 'shared-link.md', sizeBytes: JSON.stringify(input).length, updatedAt: '2026-04-19T00:00:00.000Z' }, sourceKind: input.kind, title: input.title ?? 'Shared link' }),
      listScheduledTasks: async () => ({ tasks: [] }),
      readScheduledTask: async (taskId) => ({ taskId, title: 'Task' }),
      readScheduledTaskLog: async (taskId) => ({ path: `/tmp/${taskId}.log`, log: '' }),
      createScheduledTask: async () => ({ ok: true, task: { taskId: 'task-1', title: 'Task' } }),
      updateScheduledTask: async ({ taskId }) => ({ ok: true, task: { taskId, title: 'Task' } }),
      deleteScheduledTask: async (taskId) => ({ ok: true, deleted: true, taskId }),
      runScheduledTask: async () => ({ ok: true, accepted: true, runId: 'run-1' }),
      listDurableRuns: async () => ({ runs: [] }),
      readDurableRun: async (runId) => ({ run: { runId } }),
      readDurableRunLog: async ({ runId, tail }) => ({ path: `/tmp/${runId}.log`, log: '', tail }),
      cancelDurableRun: async (runId) => ({ cancelled: true, runId }),
      subscribeApp: async (onEvent) => {
        appSubscribers.push(onEvent);
        return () => {
          const index = appSubscribers.indexOf(onEvent);
          if (index >= 0) {
            appSubscribers.splice(index, 1);
          }
        };
      },
      subscribeConversation: async (_input, onEvent) => {
        conversationSubscribers.push(onEvent);
        return () => {
          const index = conversationSubscribers.indexOf(onEvent);
          if (index >= 0) {
            conversationSubscribers.splice(index, 1);
          }
        };
      },
    };

    const server = new DaemonCompanionServer(createTestConfig(stateRoot), stateRoot, async () => runtime);
    servers.push(server);
    await server.start();

    const baseUrl = server.getUrl();
    expect(baseUrl).toMatch(/^http:\/\//);

    const helloResponse = await fetch(`${baseUrl}/companion/v1/hello`);
    expect(helloResponse.status).toBe(200);
    const hello = await readJson(helloResponse) as { hostInstanceId: string; hostLabel: string; protocolVersion: string };
    expect(hello.hostInstanceId).toMatch(/^host_/);
    expect(hello.hostLabel.length).toBeGreaterThan(0);
    expect(hello.protocolVersion).toBe('v1');

    const aliasHelloResponse = await fetch(`${baseUrl}/v1/hello`);
    expect(aliasHelloResponse.status).toBe(200);
    expect(await readJson(aliasHelloResponse)).toEqual(hello);

    const setupResponse = await fetch(`${baseUrl}/companion/v1/admin/setup`, { method: 'POST' });
    expect(setupResponse.status).toBe(201);
    const setup = await readJson(setupResponse) as { pairing: { code: string }; links: Array<{ baseUrl: string; setupUrl: string }>; warnings: string[] };
    expect(setup.pairing.code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(setup.links).toEqual([]);
    expect(setup.warnings[0]).toContain('loopback only');

    const pairingCodeResponse = await fetch(`${baseUrl}/companion/v1/admin/pairing-codes`, { method: 'POST' });
    expect(pairingCodeResponse.status).toBe(201);
    const pairing = await readJson(pairingCodeResponse) as { code: string };
    expect(pairing.code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);

    const pairResponse = await fetch(`${baseUrl}/v1/auth/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: pairing.code, deviceLabel: 'User iPhone' }),
    });
    expect(pairResponse.status).toBe(201);
    const paired = await readJson(pairResponse) as { bearerToken: string; device: { id: string; deviceLabel: string } };
    expect(paired.device.deviceLabel).toBe('User iPhone');

    const devicesResponse = await fetch(`${baseUrl}/companion/v1/admin/devices`);
    const devices = await readJson(devicesResponse) as { devices: Array<{ id: string; deviceLabel: string }> };
    expect(devices.devices).toHaveLength(1);

    const conversationsResponse = await fetch(`${baseUrl}/companion/v1/conversations`, {
      headers: { Authorization: `Bearer ${paired.bearerToken}` },
    });
    expect(conversationsResponse.status).toBe(200);
    expect(await readJson(conversationsResponse)).toEqual({
      sessions: [{ id: 'conv-1', title: 'Conversation 1' }],
      ordering: { sessionIds: ['conv-1'], pinnedSessionIds: ['conv-1'], archivedSessionIds: [], workspacePaths: [] },
    });

    const attachmentsResponse = await fetch(`${baseUrl}/companion/v1/conversations/conv-1/attachments`, {
      headers: { Authorization: `Bearer ${paired.bearerToken}` },
    });
    expect(attachmentsResponse.status).toBe(200);
    const attachments = await readJson(attachmentsResponse) as { attachments: Array<{ id: string }> };
    expect(attachments.attachments[0]?.id).toBe('att-1');

    const blockImageResponse = await fetch(`${baseUrl}/companion/v1/conversations/conv-1/blocks/block-1/image`, {
      headers: { Authorization: `Bearer ${paired.bearerToken}` },
    });
    expect(blockImageResponse.status).toBe(200);
    expect(blockImageResponse.headers.get('content-type')).toBe('image/png');
    expect(await blockImageResponse.text()).toBe('image-block');

    const indexedBlockImageResponse = await fetch(`${baseUrl}/companion/v1/conversations/conv-1/blocks/block-1/images/2`, {
      headers: { Authorization: `Bearer ${paired.bearerToken}` },
    });
    expect(indexedBlockImageResponse.status).toBe(200);
    expect(indexedBlockImageResponse.headers.get('content-type')).toBe('image/png');
    expect(await indexedBlockImageResponse.text()).toBe('image-2');

    const malformedIndexedBlockImageResponse = await fetch(`${baseUrl}/companion/v1/conversations/conv-1/blocks/block-1/images/2abc`, {
      headers: { Authorization: `Bearer ${paired.bearerToken}` },
    });
    expect(malformedIndexedBlockImageResponse.status).toBe(400);
    expect(await readJson(malformedIndexedBlockImageResponse)).toEqual({ error: 'imageIndex must be a non-negative integer.' });

    const assetResponse = await fetch(`${baseUrl}/companion/v1/conversations/conv-1/attachments/att-1/assets/preview`, {
      headers: { Authorization: `Bearer ${paired.bearerToken}` },
    });
    expect(assetResponse.status).toBe(200);
    expect(assetResponse.headers.get('content-type')).toBe('image/png');
    expect(await assetResponse.text()).toBe('preview-bytes');

    const malformedAssetRevisionResponse = await fetch(`${baseUrl}/companion/v1/conversations/conv-1/attachments/att-1/assets/preview?revision=2abc`, {
      headers: { Authorization: `Bearer ${paired.bearerToken}` },
    });
    expect(malformedAssetRevisionResponse.status).toBe(400);
    expect(await readJson(malformedAssetRevisionResponse)).toEqual({ error: 'revision must be a positive integer when provided.' });

    const unsafeAssetRevisionResponse = await fetch(`${baseUrl}/companion/v1/conversations/conv-1/attachments/att-1/assets/preview?revision=9007199254740993`, {
      headers: { Authorization: `Bearer ${paired.bearerToken}` },
    });
    expect(unsafeAssetRevisionResponse.status).toBe(400);
    expect(await readJson(unsafeAssetRevisionResponse)).toEqual({ error: 'revision must be a positive integer when provided.' });

    const autoModeResponse = await fetch(`${baseUrl}/companion/v1/conversations/conv-1/auto-mode`, {
      headers: { Authorization: `Bearer ${paired.bearerToken}` },
    });
    expect(autoModeResponse.status).toBe(200);
    expect(await readJson(autoModeResponse)).toEqual({
      enabled: false,
      stopReason: null,
      updatedAt: '2026-04-19T00:00:00.000Z',
    });

    const autoModeUpdateResponse = await fetch(`${baseUrl}/companion/v1/conversations/conv-1/auto-mode`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${paired.bearerToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ enabled: true, surfaceId: 'ios-1' }),
    });
    expect(autoModeUpdateResponse.status).toBe(200);
    expect(await readJson(autoModeUpdateResponse)).toEqual({
      enabled: true,
      stopReason: null,
      updatedAt: '2026-04-19T00:00:00.000Z',
    });

    const knowledgeTreeResponse = await fetch(`${baseUrl}/companion/v1/knowledge/tree`, {
      headers: { Authorization: `Bearer ${paired.bearerToken}` },
    });
    expect(knowledgeTreeResponse.status).toBe(200);
    expect(await readJson(knowledgeTreeResponse)).toEqual({
      root: '/vault',
      entries: [{ id: 'notes/', kind: 'folder', name: 'notes' }],
    });

    const knowledgeFileResponse = await fetch(`${baseUrl}/companion/v1/knowledge/file?id=${encodeURIComponent('notes/daily.md')}`, {
      headers: { Authorization: `Bearer ${paired.bearerToken}` },
    });
    expect(knowledgeFileResponse.status).toBe(200);
    expect(await readJson(knowledgeFileResponse)).toEqual({
      id: 'notes/daily.md',
      content: '# Demo',
      updatedAt: '2026-04-19T00:00:00.000Z',
    });

    const knowledgeSearchResponse = await fetch(`${baseUrl}/companion/v1/knowledge/search?q=release&limit=5`, {
      headers: {
        Authorization: `Bearer ${paired.bearerToken}`,
      },
    });
    expect(knowledgeSearchResponse.status).toBe(200);
    expect(await readJson(knowledgeSearchResponse)).toEqual({
      results: [{
        id: 'notes/release-checklist.md',
        name: 'release-checklist.md',
        title: 'release',
        excerpt: 'Release checklist',
        limit: 5,
      }],
    });

    const malformedKnowledgeSearchResponse = await fetch(`${baseUrl}/companion/v1/knowledge/search?q=release&limit=5abc`, {
      headers: {
        Authorization: `Bearer ${paired.bearerToken}`,
      },
    });
    expect(malformedKnowledgeSearchResponse.status).toBe(200);
    expect(await readJson(malformedKnowledgeSearchResponse)).toEqual({
      results: [{
        id: 'notes/release-checklist.md',
        name: 'release-checklist.md',
        title: 'release',
        excerpt: 'Release checklist',
        limit: undefined,
      }],
    });

    const cappedKnowledgeSearchResponse = await fetch(`${baseUrl}/companion/v1/knowledge/search?q=release&limit=${Number.MAX_SAFE_INTEGER}`, {
      headers: {
        Authorization: `Bearer ${paired.bearerToken}`,
      },
    });
    expect(cappedKnowledgeSearchResponse.status).toBe(200);
    expect(await readJson(cappedKnowledgeSearchResponse)).toEqual({
      results: [{
        id: 'notes/release-checklist.md',
        name: 'release-checklist.md',
        title: 'release',
        excerpt: 'Release checklist',
        limit: 50,
      }],
    });

    const cappedRunLogResponse = await fetch(`${baseUrl}/companion/v1/runs/run-1/log?tail=5000`, {
      headers: { Authorization: `Bearer ${paired.bearerToken}` },
    });
    expect(cappedRunLogResponse.status).toBe(200);
    expect(await readJson(cappedRunLogResponse)).toEqual({ path: '/tmp/run-1.log', log: '', tail: 1000 });

    const knowledgeWriteResponse = await fetch(`${baseUrl}/companion/v1/knowledge/file`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${paired.bearerToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ id: 'notes/new-note.md', content: '# New note' }),
    });
    expect(knowledgeWriteResponse.status).toBe(200);
    expect(await readJson(knowledgeWriteResponse)).toEqual({
      id: 'notes/new-note.md',
      kind: 'file',
      name: 'new-note.md',
      sizeBytes: '# New note'.length,
      updatedAt: '2026-04-19T00:00:00.000Z',
    });

    const knowledgeFolderResponse = await fetch(`${baseUrl}/companion/v1/knowledge/folder`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${paired.bearerToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ id: 'notes/archive' }),
    });
    expect(knowledgeFolderResponse.status).toBe(201);
    expect(await readJson(knowledgeFolderResponse)).toEqual({
      id: 'notes/archive/',
      kind: 'folder',
      name: 'archive',
      sizeBytes: 0,
      updatedAt: '2026-04-19T00:00:00.000Z',
    });

    const knowledgeRenameResponse = await fetch(`${baseUrl}/companion/v1/knowledge/rename`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${paired.bearerToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ id: 'notes/new-note.md', newName: 'renamed-note.md' }),
    });
    expect(knowledgeRenameResponse.status).toBe(200);
    expect(await readJson(knowledgeRenameResponse)).toEqual({
      id: 'notes/renamed-note.md',
      kind: 'file',
      name: 'renamed-note.md',
      sizeBytes: 0,
      updatedAt: '2026-04-19T00:00:00.000Z',
    });

    const knowledgeMoveResponse = await fetch(`${baseUrl}/companion/v1/knowledge/rename`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${paired.bearerToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ id: 'notes/renamed-note.md', newName: 'renamed-note.md', parentId: 'Inbox' }),
    });
    expect(knowledgeMoveResponse.status).toBe(200);
    expect(await readJson(knowledgeMoveResponse)).toEqual({
      id: 'Inbox/renamed-note.md',
      kind: 'file',
      name: 'renamed-note.md',
      sizeBytes: 0,
      updatedAt: '2026-04-19T00:00:00.000Z',
    });

    const knowledgeDeleteResponse = await fetch(`${baseUrl}/companion/v1/knowledge/entry?id=${encodeURIComponent('notes/renamed-note.md')}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${paired.bearerToken}`,
      },
    });
    expect(knowledgeDeleteResponse.status).toBe(200);
    expect(await readJson(knowledgeDeleteResponse)).toEqual({ ok: true });

    const knowledgeImageResponse = await fetch(`${baseUrl}/companion/v1/knowledge/image`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${paired.bearerToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ fileName: 'capture.png', mimeType: 'image/png', dataBase64: Buffer.from('png-bytes', 'utf-8').toString('base64') }),
    });
    expect(knowledgeImageResponse.status).toBe(201);
    expect(await readJson(knowledgeImageResponse)).toEqual({
      id: '_attachments/capture.png',
      url: '/api/vault/asset?id=_attachments%2Fimage.png',
    });

    const knowledgeImportResponse = await fetch(`${baseUrl}/companion/v1/knowledge/import`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${paired.bearerToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ kind: 'url', title: 'Shared link', url: 'https://example.com/post' }),
    });
    expect(knowledgeImportResponse.status).toBe(201);
    expect(await readJson(knowledgeImportResponse)).toEqual({
      note: {
        id: 'Inbox/shared-link.md',
        kind: 'file',
        name: 'shared-link.md',
        sizeBytes: JSON.stringify({ kind: 'url', title: 'Shared link', url: 'https://example.com/post' }).length,
        updatedAt: '2026-04-19T00:00:00.000Z',
      },
      sourceKind: 'url',
      title: 'Shared link',
    });

    const { socket, firstMessage } = await openSocket(`${baseUrl!.replace('http://', 'ws://')}/v1/socket`, paired.bearerToken);
    const ready = firstMessage as { type: string; device: { deviceLabel: string } };
    expect(ready).toEqual(expect.objectContaining({
      type: 'ready',
      device: expect.objectContaining({ deviceLabel: 'User iPhone' }),
    }));

    socket.send(JSON.stringify({ id: '1', type: 'command', name: 'conversations.list' }));
    expect(await readSocketMessage(socket)).toEqual({
      id: '1',
      type: 'response',
      ok: true,
      result: {
        sessions: [{ id: 'conv-1', title: 'Conversation 1' }],
        ordering: { sessionIds: ['conv-1'], pinnedSessionIds: ['conv-1'], archivedSessionIds: [], workspacePaths: [] },
      },
    });

    socket.send(JSON.stringify({ id: '1b', type: 'command', name: 'conversation.bootstrap', payload: { conversationId: 'conv-1', tailBlocks: 5000 } }));
    expect(await readSocketMessage(socket)).toEqual({
      id: '1b',
      type: 'response',
      ok: true,
      result: { conversationId: 'conv-1', bootstrap: true, tailBlocks: 1000 },
    });

    socket.send(JSON.stringify({ id: '2', type: 'subscribe', topic: 'app' }));
    expect(await readSocketMessage(socket)).toEqual({
      id: '2',
      type: 'response',
      ok: true,
      result: { subscribed: true, topic: 'app', key: 'app' },
    });

    appSubscribers[0]?.({ type: 'conversation_list_state', state: { sessions: [] } });
    expect(await readSocketMessage(socket)).toEqual({
      type: 'event',
      topic: 'app',
      key: 'app',
      event: { type: 'conversation_list_state', state: { sessions: [] } },
    });

    socket.send(JSON.stringify({ id: '3', type: 'subscribe', topic: 'conversation', key: 'conv-1', payload: { surfaceId: 'ios-1', surfaceType: 'ios_native' } }));
    expect(await readSocketMessage(socket)).toEqual({
      id: '3',
      type: 'response',
      ok: true,
      result: { subscribed: true, topic: 'conversation', key: 'conv-1' },
    });

    conversationSubscribers[0]?.({ type: 'text_delta', delta: 'hello' });
    expect(await readSocketMessage(socket)).toEqual({
      type: 'event',
      topic: 'conversation',
      key: 'conv-1',
      event: { type: 'text_delta', delta: 'hello' },
    });

    socket.close();

    const revokeResponse = await fetch(`${baseUrl}/companion/v1/admin/devices/${paired.device.id}`, {
      method: 'DELETE',
    });
    expect(revokeResponse.status).toBe(200);
    expect(await readJson(revokeResponse)).toEqual({
      ok: true,
      deleted: true,
      devices: [],
    });

    const revokedConversationsResponse = await fetch(`${baseUrl}/companion/v1/conversations`, {
      headers: { Authorization: `Bearer ${paired.bearerToken}` },
    });
    expect(revokedConversationsResponse.status).toBe(401);
  }, 15000);

  it('falls back to an available port when the preferred companion port is busy', async () => {
    const stateRoot = createTempDir('pa-companion-fallback-');
    const busyServer = createHttpServer();

    await new Promise<void>((resolve) => {
      busyServer.listen(0, '127.0.0.1', () => resolve());
    });

    const busyAddress = busyServer.address();
    if (!busyAddress || typeof busyAddress === 'string') {
      throw new Error('Expected a TCP address for the busy companion port test.');
    }

    const runtime = {
      listConversations: async () => ({ sessions: [], ordering: { sessionIds: [], pinnedSessionIds: [], archivedSessionIds: [], workspacePaths: [] } }),
      updateConversationTabs: async () => ({ ok: true }),
      duplicateConversation: async () => ({ ok: true, conversationId: 'duplicate-1' }),
      listExecutionTargets: async () => ({ executionTargets: [] }),
      readModels: async () => ({ currentModel: 'gpt-5.4', currentThinkingLevel: 'high', currentServiceTier: '', models: [] }),
      listSshTargets: async () => ({ hosts: [] }),
      saveSshTarget: async () => ({ hosts: [] }),
      deleteSshTarget: async () => ({ ok: true, deleted: true, targetId: 'ssh-1' }),
      testSshTarget: async () => ({ ok: true, sshTarget: 'user@host', os: 'linux', arch: 'arm64', platformKey: 'linux-arm64', homeDirectory: '/home/user', tempDirectory: '/tmp', cacheDirectory: '/tmp/.cache', message: 'reachable' }),
      readRemoteDirectory: async () => ({ path: '/repo', entries: [] }),
      readConversationBootstrap: async (input: any) => ({ conversationId: input.conversationId, bootstrap: true }),
      readConversationBlockImage: async () => ({ data: Buffer.from('image-block', 'utf-8'), mimeType: 'image/png', disposition: 'inline' }),
      createConversation: async () => ({ conversationId: 'created-1' }),
      resumeConversation: async () => ({ conversationId: 'resumed-1' }),
      promptConversation: async (input: any) => ({ ok: true, conversationId: input.conversationId }),
      parallelPromptConversation: async (input: any) => ({ ok: true, conversationId: input.conversationId }),
      restoreConversationQueuePrompt: async () => ({ ok: true, behavior: 'steer', index: 0, text: 'queued hello', images: [] }),
      manageConversationParallelJob: async () => ({ ok: true, status: 'skipped' }),
      abortConversation: async (input: any) => ({ ok: true, conversationId: input.conversationId }),
      takeOverConversation: async () => ({ ok: true, surfaceId: 'surface-1' }),
      renameConversation: async () => ({ ok: true, title: 'Conversation' }),
      changeConversationCwd: async (input: any) => ({ ok: true, conversationId: input.conversationId, cwd: input.cwd }),
      readConversationModelPreferences: async () => ({ currentModel: 'gpt-5.4', currentThinkingLevel: 'high', currentServiceTier: 'default', hasExplicitServiceTier: false }),
      updateConversationModelPreferences: async () => ({ currentModel: 'gpt-5.4', currentThinkingLevel: 'high', currentServiceTier: 'default', hasExplicitServiceTier: false }),
      createConversationCheckpoint: async () => ({ id: 'checkpoint-1', conversationId: 'conversation-1', title: 'Checkpoint', shortSha: 'abc1234', commitSha: 'abc1234def', subject: 'Checkpoint', fileCount: 0, linesAdded: 0, linesDeleted: 0, cwd: '/repo', authorName: 'Test User', committedAt: '2026-04-19T00:00:00.000Z', createdAt: '2026-04-19T00:00:00.000Z', updatedAt: '2026-04-19T00:00:00.000Z', commentCount: 0, files: [], comments: [] }),
      listConversationArtifacts: async () => ({ conversationId: 'conversation-1', artifacts: [] }),
      readConversationArtifact: async () => ({ conversationId: 'conversation-1', artifact: { id: 'artifact-1' } }),
      listConversationCheckpoints: async () => ({ conversationId: 'conversation-1', checkpoints: [] }),
      readConversationCheckpoint: async () => ({ conversationId: 'conversation-1', checkpoint: { id: 'checkpoint-1' } }),
      changeConversationExecutionTarget: async () => ({ ok: true, executionTargetId: 'local' }),
      listConversationAttachments: async () => ({ conversationId: 'conversation-1', attachments: [] }),
      readConversationAttachment: async () => ({ conversationId: 'conversation-1', attachment: { id: 'attachment-1' } }),
      createConversationAttachment: async () => ({ conversationId: 'conversation-1', attachment: { id: 'attachment-1' } }),
      updateConversationAttachment: async () => ({ conversationId: 'conversation-1', attachment: { id: 'attachment-1' } }),
      readConversationAttachmentAsset: async () => ({ data: Buffer.from('bytes', 'utf-8'), mimeType: 'image/png' }),
      listKnowledgeEntries: async () => ({ root: '/vault', entries: [] }),
      searchKnowledge: async () => ({ results: [] }),
      readKnowledgeFile: async () => ({ id: 'notes/test.md', content: '# test', updatedAt: '2026-04-19T00:00:00.000Z' }),
      writeKnowledgeFile: async () => ({ id: 'notes/test.md', kind: 'file', name: 'test.md', sizeBytes: 0, updatedAt: '2026-04-19T00:00:00.000Z' }),
      createKnowledgeFolder: async () => ({ id: 'notes/', kind: 'folder', name: 'notes', sizeBytes: 0, updatedAt: '2026-04-19T00:00:00.000Z' }),
      renameKnowledgeEntry: async () => ({ id: 'notes/renamed.md', kind: 'file', name: 'renamed.md', sizeBytes: 0, updatedAt: '2026-04-19T00:00:00.000Z' }),
      deleteKnowledgeEntry: async () => ({ ok: true }),
      createKnowledgeImageAsset: async () => ({ id: '_attachments/image.png', url: '/api/vault/asset?id=_attachments%2Fimage.png' }),
      importKnowledge: async () => ({ note: { id: 'Inbox/shared-link.md', kind: 'file', name: 'shared-link.md', sizeBytes: 0, updatedAt: '2026-04-19T00:00:00.000Z' }, sourceKind: 'url', title: 'Shared link' }),
      listScheduledTasks: async () => ({ tasks: [] }),
      readScheduledTask: async () => ({ taskId: 'task-1', title: 'Task' }),
      readScheduledTaskLog: async () => ({ path: '/tmp/task-1.log', log: '' }),
      createScheduledTask: async () => ({ ok: true, task: { taskId: 'task-1', title: 'Task' } }),
      updateScheduledTask: async () => ({ ok: true, task: { taskId: 'task-1', title: 'Task' } }),
      deleteScheduledTask: async () => ({ ok: true, deleted: true, taskId: 'task-1' }),
      runScheduledTask: async () => ({ ok: true, accepted: true, runId: 'run-1' }),
      listDurableRuns: async () => ({ runs: [] }),
      readDurableRun: async () => ({ run: { runId: 'run-1' } }),
      readDurableRunLog: async () => ({ path: '/tmp/run-1.log', log: '' }),
      cancelDurableRun: async () => ({ cancelled: true, runId: 'run-1' }),
      subscribeApp: async () => () => undefined,
      subscribeConversation: async () => () => undefined,
    } as unknown as CompanionRuntime;

    const config = createTestConfig(stateRoot);
    config.companion = { enabled: true, host: '127.0.0.1', port: busyAddress.port };
    const server = new DaemonCompanionServer(config, stateRoot, async () => runtime);
    servers.push(server);

    try {
      await server.start();
      expect(server.getPortFallbackFrom()).toBe(busyAddress.port);
      const baseUrl = server.getUrl();
      expect(baseUrl).toBeTruthy();
      expect(baseUrl).not.toContain(`:${String(busyAddress.port)}`);

      const helloResponse = await fetch(`${baseUrl}/companion/v1/hello`);
      expect(helloResponse.status).toBe(200);
      const hello = await readJson(helloResponse) as { protocolVersion: string };
      expect(hello.protocolVersion).toBe('v1');
    } finally {
      await new Promise<void>((resolve) => busyServer.close(() => resolve()));
    }
  });
});

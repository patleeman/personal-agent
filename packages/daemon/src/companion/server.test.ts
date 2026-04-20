import { mkdtempSync } from 'node:fs';
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
      listSshTargets: async () => ({ hosts: [{ id: 'ssh-1', label: 'Buildbox', kind: 'ssh', sshTarget: 'patrick@buildbox' }] }),
      saveSshTarget: async (input) => ({ hosts: [{ id: input.id ?? 'ssh-1', label: input.label, kind: 'ssh', sshTarget: input.sshTarget }] }),
      deleteSshTarget: async (targetId) => ({ ok: true, deleted: true, targetId }),
      testSshTarget: async (input) => ({ ok: true, sshTarget: input.sshTarget, os: 'linux', arch: 'arm64', platformKey: 'linux-arm64', homeDirectory: '/home/patrick', tempDirectory: '/tmp', cacheDirectory: '/tmp/.cache', message: 'reachable' }),
      readRemoteDirectory: async (input) => ({ path: input.path ?? '/repo', parent: '/', entries: [] }),
      readConversationBootstrap: async (input) => ({ conversationId: input.conversationId, bootstrap: true }),
      createConversation: async () => ({ conversationId: 'created-1' }),
      resumeConversation: async () => ({ conversationId: 'resumed-1' }),
      promptConversation: async (input) => ({ ok: true, conversationId: input.conversationId }),
      parallelPromptConversation: async (input) => ({ ok: true, conversationId: input.conversationId }),
      restoreConversationQueuePrompt: async (input) => ({ ok: true, behavior: input.behavior, index: input.index, text: 'queued hello', images: [] }),
      manageConversationParallelJob: async (input) => ({ ok: true, status: input.action === 'cancel' ? 'cancelled' : input.action === 'skip' ? 'skipped' : 'imported' }),
      abortConversation: async (input) => ({ ok: true, conversationId: input.conversationId }),
      takeOverConversation: async (input) => ({ ok: true, surfaceId: input.surfaceId }),
      renameConversation: async (input) => ({ ok: true, title: input.name }),
      changeConversationCwd: async (input) => ({ ok: true, conversationId: input.conversationId, cwd: input.cwd }),
      readConversationModelPreferences: async () => ({ currentModel: 'gpt-5.4', currentThinkingLevel: 'high', currentServiceTier: 'default', hasExplicitServiceTier: false }),
      updateConversationModelPreferences: async () => ({ currentModel: 'gpt-5.4', currentThinkingLevel: 'high', currentServiceTier: 'default', hasExplicitServiceTier: false }),
      createConversationCheckpoint: async (input) => ({ id: 'checkpoint-1', conversationId: input.conversationId, title: input.message, shortSha: 'abc1234', commitSha: 'abc1234def', subject: input.message, fileCount: input.paths.length, linesAdded: 1, linesDeleted: 0, cwd: '/repo', authorName: 'Patrick', committedAt: '2026-04-19T00:00:00.000Z', createdAt: '2026-04-19T00:00:00.000Z', updatedAt: '2026-04-19T00:00:00.000Z', commentCount: 0, files: [], comments: [] }),
      listConversationArtifacts: async (conversationId) => ({ conversationId, artifacts: [] }),
      readConversationArtifact: async ({ conversationId, artifactId }) => ({ conversationId, artifact: { id: artifactId } }),
      listConversationCheckpoints: async (conversationId) => ({ conversationId, checkpoints: [] }),
      readConversationCheckpoint: async ({ conversationId, checkpointId }) => ({ conversationId, checkpoint: { id: checkpointId } }),
      changeConversationExecutionTarget: async (input) => ({ ok: true, executionTargetId: input.executionTargetId }),
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
      listScheduledTasks: async () => ({ tasks: [] }),
      readScheduledTask: async (taskId) => ({ taskId, title: 'Task' }),
      readScheduledTaskLog: async (taskId) => ({ path: `/tmp/${taskId}.log`, log: '' }),
      createScheduledTask: async () => ({ ok: true, task: { taskId: 'task-1', title: 'Task' } }),
      updateScheduledTask: async ({ taskId }) => ({ ok: true, task: { taskId, title: 'Task' } }),
      deleteScheduledTask: async (taskId) => ({ ok: true, deleted: true, taskId }),
      runScheduledTask: async () => ({ ok: true, accepted: true, runId: 'run-1' }),
      listDurableRuns: async () => ({ runs: [] }),
      readDurableRun: async (runId) => ({ run: { runId } }),
      readDurableRunLog: async ({ runId }) => ({ path: `/tmp/${runId}.log`, log: '' }),
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
      body: JSON.stringify({ code: pairing.code, deviceLabel: 'Patrick iPhone' }),
    });
    expect(pairResponse.status).toBe(201);
    const paired = await readJson(pairResponse) as { bearerToken: string; device: { id: string; deviceLabel: string } };
    expect(paired.device.deviceLabel).toBe('Patrick iPhone');

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

    const assetResponse = await fetch(`${baseUrl}/companion/v1/conversations/conv-1/attachments/att-1/assets/preview`, {
      headers: { Authorization: `Bearer ${paired.bearerToken}` },
    });
    expect(assetResponse.status).toBe(200);
    expect(assetResponse.headers.get('content-type')).toBe('image/png');
    expect(await assetResponse.text()).toBe('preview-bytes');

    const { socket, firstMessage } = await openSocket(`${baseUrl!.replace('http://', 'ws://')}/v1/socket`, paired.bearerToken);
    const ready = firstMessage as { type: string; device: { deviceLabel: string } };
    expect(ready).toEqual(expect.objectContaining({
      type: 'ready',
      device: expect.objectContaining({ deviceLabel: 'Patrick iPhone' }),
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
});

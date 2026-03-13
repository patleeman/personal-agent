import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createWebLiveConversationRunId, listRecoverableWebLiveConversationRuns, syncWebLiveConversationRun, } from './conversationRuns.js';
import { resolveDurableRunPaths, resolveDurableRunsRoot, scanDurableRun } from '@personal-agent/daemon';
import { PersonalAgentDaemon } from '../../daemon/src/server.js';
const tempDirs = [];
const originalEnv = process.env;
function createTempDir(prefix) {
    const dir = mkdtempSync(join(tmpdir(), prefix));
    tempDirs.push(dir);
    return dir;
}
function createTestConfig(socketPath) {
    return {
        logLevel: 'error',
        queue: { maxDepth: 100 },
        ipc: { socketPath },
        modules: {
            maintenance: {
                enabled: false,
                cleanupIntervalMinutes: 60,
            },
            tasks: {
                enabled: false,
                taskDir: join(createTempDir('tasks-'), 'definitions'),
                tickIntervalSeconds: 30,
                maxRetries: 3,
                reapAfterDays: 7,
                defaultTimeoutSeconds: 1800,
            },
        },
    };
}
describe('web live conversation durable runs', () => {
    beforeEach(() => {
        process.env = { ...originalEnv };
    });
    afterEach(async () => {
        process.env = originalEnv;
        await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
    });
    it('creates and updates a durable conversation run for a live web session', async () => {
        const stateRoot = createTempDir('pa-web-conversation-runs-');
        const daemonSocketDir = createTempDir('pa-web-conversation-sock-');
        const sessionDir = join(stateRoot, 'sessions');
        mkdirSync(sessionDir, { recursive: true });
        const sessionFile = join(sessionDir, 'conv-123.jsonl');
        writeFileSync(sessionFile, '{"type":"session","id":"conv-123","timestamp":"2026-03-12T13:00:00.000Z","cwd":"/tmp/workspace"}\n');
        process.env = {
            ...originalEnv,
            PERSONAL_AGENT_STATE_ROOT: stateRoot,
            PERSONAL_AGENT_DAEMON_SOCKET_PATH: join(daemonSocketDir, 'personal-agentd.sock'),
        };
        await syncWebLiveConversationRun({
            conversationId: 'conv-123',
            sessionFile,
            cwd: '/tmp/workspace',
            title: 'Investigate issue',
            profile: 'datadog',
            state: 'waiting',
            updatedAt: '2026-03-12T13:00:00.000Z',
        });
        await syncWebLiveConversationRun({
            conversationId: 'conv-123',
            sessionFile,
            cwd: '/tmp/workspace',
            title: 'Investigate issue',
            profile: 'datadog',
            state: 'running',
            updatedAt: '2026-03-12T13:00:05.000Z',
            pendingOperation: {
                type: 'prompt',
                text: 'keep going',
                behavior: 'followUp',
                contextMessages: [{ customType: 'referenced_context', content: 'Referenced projects: @foo' }],
                enqueuedAt: '2026-03-12T13:00:05.000Z',
            },
        });
        await syncWebLiveConversationRun({
            conversationId: 'conv-123',
            sessionFile,
            cwd: '/tmp/workspace',
            title: 'Investigate issue',
            profile: 'datadog',
            state: 'interrupted',
            updatedAt: '2026-03-12T13:00:10.000Z',
            lastError: 'web process stopped',
        });
        const runId = createWebLiveConversationRunId('conv-123');
        const scanned = scanDurableRun(resolveDurableRunsRoot(join(stateRoot, 'daemon')), runId);
        expect(scanned).toMatchObject({
            runId,
            recoveryAction: 'resume',
            manifest: expect.objectContaining({
                kind: 'conversation',
                resumePolicy: 'continue',
                source: expect.objectContaining({
                    type: 'web-live-session',
                    id: 'conv-123',
                    filePath: sessionFile,
                }),
            }),
            status: expect.objectContaining({
                status: 'interrupted',
                lastError: 'web process stopped',
            }),
            checkpoint: expect.objectContaining({
                step: 'web-live-session.interrupted',
                payload: expect.objectContaining({
                    title: 'Investigate issue',
                    profile: 'datadog',
                    pendingOperation: expect.objectContaining({
                        type: 'prompt',
                        text: 'keep going',
                        behavior: 'followUp',
                    }),
                }),
            }),
        });
        const runPaths = resolveDurableRunPaths(resolveDurableRunsRoot(join(stateRoot, 'daemon')), runId);
        expect(runPaths.statusPath).toContain(runId);
        await expect(listRecoverableWebLiveConversationRuns()).resolves.toEqual([
            expect.objectContaining({
                runId,
                conversationId: 'conv-123',
                sessionFile,
                cwd: '/tmp/workspace',
                state: 'interrupted',
                pendingOperation: expect.objectContaining({
                    type: 'prompt',
                    text: 'keep going',
                }),
            }),
        ]);
    });
    it('uses the daemon IPC path when the daemon is available', async () => {
        const stateRoot = createTempDir('pa-web-conversation-runs-');
        const daemonSocketDir = createTempDir('pa-web-conversation-sock-');
        const socketPath = join(daemonSocketDir, 'personal-agentd.sock');
        const sessionDir = join(stateRoot, 'sessions');
        mkdirSync(sessionDir, { recursive: true });
        const sessionFile = join(sessionDir, 'conv-ipc.jsonl');
        writeFileSync(sessionFile, '{"type":"session","id":"conv-ipc","timestamp":"2026-03-12T13:00:00.000Z","cwd":"/tmp/workspace"}\n');
        process.env = {
            ...originalEnv,
            PERSONAL_AGENT_STATE_ROOT: stateRoot,
            PERSONAL_AGENT_DAEMON_SOCKET_PATH: socketPath,
        };
        const daemon = new PersonalAgentDaemon(createTestConfig(socketPath));
        await daemon.start();
        try {
            const result = await syncWebLiveConversationRun({
                conversationId: 'conv-ipc',
                sessionFile,
                cwd: '/tmp/workspace',
                state: 'interrupted',
                pendingOperation: {
                    type: 'prompt',
                    text: 'resume me',
                    enqueuedAt: '2026-03-12T13:00:10.000Z',
                },
            });
            expect(result).toEqual({ runId: 'conversation-live-conv-ipc' });
            await expect(listRecoverableWebLiveConversationRuns()).resolves.toEqual([
                expect.objectContaining({
                    runId: 'conversation-live-conv-ipc',
                    conversationId: 'conv-ipc',
                    sessionFile,
                    cwd: '/tmp/workspace',
                    state: 'interrupted',
                    pendingOperation: expect.objectContaining({
                        text: 'resume me',
                    }),
                }),
            ]);
        }
        finally {
            await daemon.stop();
        }
    });
});

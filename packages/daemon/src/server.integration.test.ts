/**
 * P0: Daemon server request handling integration tests
 * Tests IPC request/response flows including malformed requests
 */

import { mkdtempSync, writeFileSync, existsSync, readFileSync } from 'fs';
import { rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createConnection } from 'net';
import { randomUUID } from 'crypto';
import { PersonalAgentDaemon } from './server.js';
import type { DaemonConfig } from './config.js';
import { resolveDaemonPaths } from './paths.js';

const tempDirs: string[] = [];

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function createTestConfig(socketPath: string): DaemonConfig {
  return {
    logLevel: 'error',
    queue: { maxDepth: 100 },
    ipc: { socketPath },
    modules: {
      memory: {
        enabled: false,
        sessionSource: join(createTempDir('memory-'), 'sessions'),
        summaryDir: join(createTempDir('memory-'), 'summaries'),
        collections: [],
        qmd: {
          index: 'test',
          updateDebounceSeconds: 60,
          embedDebounceSeconds: 300,
        },
      },
      maintenance: {
        enabled: false,
        cleanupIntervalMinutes: 60,
      },
    },
  };
}

interface ResponseEnvelope {
  id: string;
  ok: boolean;
  result?: unknown;
  error?: string;
}

async function sendRequest(socketPath: string, request: unknown): Promise<ResponseEnvelope> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath);
    let buffer = '';

    socket.on('connect', () => {
      socket.write(`${JSON.stringify(request)}\n`);
    });

    socket.on('data', (chunk: Buffer | string) => {
      buffer += chunk.toString();

      if (buffer.includes('\n')) {
        const line = buffer.slice(0, buffer.indexOf('\n')).trim();
        buffer = buffer.slice(buffer.indexOf('\n') + 1);

        try {
          const parsed = JSON.parse(line) as ResponseEnvelope;
          resolve(parsed);
          socket.end();
        } catch (error) {
          reject(error);
          socket.end();
        }
      }
    });

    socket.on('error', reject);
  });
}

describe('daemon IPC integration', () => {
  let daemon: PersonalAgentDaemon | null = null;
  let socketPath: string;
  let config: DaemonConfig;

  beforeEach(async () => {
    const tempDir = createTempDir('daemon-test-');
    socketPath = join(tempDir, 'test.sock');
    config = createTestConfig(socketPath);
  });

  afterEach(async () => {
    if (daemon) {
      await daemon.stop();
      daemon = null;
    }
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('responds to ping request', async () => {
    daemon = new PersonalAgentDaemon(config);
    await daemon.start();

    const response = await sendRequest(socketPath, {
      id: `req_${randomUUID()}`,
      type: 'ping',
    });

    expect(response.ok).toBe(true);
    expect(response.result).toEqual({ pong: true });
  });

  it('responds to status request', async () => {
    daemon = new PersonalAgentDaemon(config);
    await daemon.start();

    const response = await sendRequest(socketPath, {
      id: `req_${randomUUID()}`,
      type: 'status',
    });

    expect(response.ok).toBe(true);
    expect(response.result).toMatchObject({
      running: true,
      pid: expect.any(Number),
      socketPath: socketPath,
    });
    expect(response.result).toHaveProperty('startedAt');
    expect(response.result).toHaveProperty('queue');
    expect(response.result).toHaveProperty('modules');
  });

  it('responds to emit request with valid event', async () => {
    daemon = new PersonalAgentDaemon(config);
    await daemon.start();

    const response = await sendRequest(socketPath, {
      id: `req_${randomUUID()}`,
      type: 'emit',
      event: {
        id: `evt_${randomUUID()}`,
        version: 1,
        type: 'test.event',
        source: 'test',
        timestamp: new Date().toISOString(),
        payload: {},
      },
    });

    expect(response.ok).toBe(true);
    expect(response.result).toMatchObject({
      accepted: true,
    });
  });

  it('rejects emit request with invalid event envelope', async () => {
    daemon = new PersonalAgentDaemon(config);
    await daemon.start();

    const response = await sendRequest(socketPath, {
      id: `req_${randomUUID()}`,
      type: 'emit',
      event: {
        // Missing required fields: id, timestamp
        type: 'test.event',
        source: 'test',
      },
    });

    expect(response.ok).toBe(false);
    expect(response.error).toContain('Invalid event envelope');
  });

  it('handles malformed JSON gracefully', async () => {
    daemon = new PersonalAgentDaemon(config);
    await daemon.start();

    const response = await new Promise<ResponseEnvelope>((resolve, reject) => {
      const socket = createConnection(socketPath);
      let buffer = '';

      socket.on('connect', () => {
        socket.write('this is not json\n');
      });

      socket.on('data', (chunk: Buffer | string) => {
        buffer += chunk.toString();

        if (buffer.includes('\n')) {
          const line = buffer.slice(0, buffer.indexOf('\n')).trim();
          try {
            const parsed = JSON.parse(line) as ResponseEnvelope;
            resolve(parsed);
            socket.end();
          } catch (error) {
            reject(error);
            socket.end();
          }
        }
      });

      socket.on('error', reject);
    });

    expect(response.ok).toBe(false);
    expect(response.error).toBeDefined();
  });

  it('handles invalid request envelope', async () => {
    daemon = new PersonalAgentDaemon(config);
    await daemon.start();

    const response = await sendRequest(socketPath, {
      // Missing required fields: id, type
      foo: 'bar',
    });

    expect(response.ok).toBe(false);
    expect(response.error).toContain('Invalid request envelope');
  });

  it('creates and removes pid file on startup/shutdown', async () => {
    const configWithPidPath = {
      ...config,
      ipc: { socketPath: join(createTempDir('daemon-test-'), 'test.sock') },
    };

    const daemonPaths = resolveDaemonPaths(configWithPidPath.ipc.socketPath);
    const pidPath = daemonPaths.pidFile;

    daemon = new PersonalAgentDaemon(configWithPidPath);
    await daemon.start();

    expect(existsSync(pidPath)).toBe(true);
    const pidContent = readFileSync(pidPath, 'utf-8');
    expect(Number(pidContent)).toBe(process.pid);

    await daemon.stop();
    daemon = null;

    expect(existsSync(pidPath)).toBe(false);
  });

  it('removes stale socket on startup', async () => {
    const tempDir = createTempDir('daemon-test-');
    const staleSocketPath = join(tempDir, 'stale.sock');

    // Create a stale socket file
    writeFileSync(staleSocketPath, '');
    expect(existsSync(staleSocketPath)).toBe(true);

    const staleConfig: DaemonConfig = {
      ...config,
      ipc: { socketPath: staleSocketPath },
    };

    daemon = new PersonalAgentDaemon(staleConfig);
    await daemon.start();

    // Daemon should have removed the stale socket and created a new one
    expect(existsSync(staleSocketPath)).toBe(true); // New socket is a file now

    // Verify it's actually a socket by trying to connect
    const response = await sendRequest(staleSocketPath, {
      id: `req_${randomUUID()}`,
      type: 'ping',
    });

    expect(response.ok).toBe(true);
  });

  it('daemon remains stable after multiple malformed requests', async () => {
    daemon = new PersonalAgentDaemon(config);
    await daemon.start();

    // Send several malformed requests
    for (let i = 0; i < 5; i++) {
      const response = await sendRequest(socketPath, {
        id: `req_${randomUUID()}`,
        type: 'emit',
        event: { invalid: true }, // Missing required fields
      });
      expect(response.ok).toBe(false);
    }

    // Daemon should still respond to valid requests
    const validResponse = await sendRequest(socketPath, {
      id: `req_${randomUUID()}`,
      type: 'ping',
    });

    expect(validResponse.ok).toBe(true);
    expect(validResponse.result).toEqual({ pong: true });
  });
});

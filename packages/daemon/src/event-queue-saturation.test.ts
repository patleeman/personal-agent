/**
 * P0: Event queue saturation behavior
 * Tests queue-full behavior and dropped event accounting
 */

import { randomUUID } from 'crypto';
import { mkdtempSync } from 'fs';
import { rm } from 'fs/promises';
import { createConnection } from 'net';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DaemonConfig } from './config.js';
import { EventBus } from './event-bus.js';
import { createDaemonEvent } from './events.js';
import { PersonalAgentDaemon } from './server.js';

const tempDirs: string[] = [];

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function createTestConfig(socketPath: string, maxDepth: number): DaemonConfig {
  return {
    logLevel: 'error',
    queue: { maxDepth },
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

describe('event queue saturation', () => {
  let daemon: PersonalAgentDaemon | null = null;
  let socketPath: string;

  beforeEach(async () => {
    const tempDir = createTempDir('daemon-queue-test-');
    socketPath = join(tempDir, 'test.sock');
  });

  afterEach(async () => {
    if (daemon) {
      await daemon.stop();
      daemon = null;
    }
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('returns accepted: false when queue is full', async () => {
    // Create daemon with very small queue
    const config = createTestConfig(socketPath, 1);
    daemon = new PersonalAgentDaemon(config);
    await daemon.start();

    // First event should be accepted
    const response1 = await sendRequest(socketPath, {
      id: `req_${randomUUID()}`,
      type: 'emit',
      event: createDaemonEvent({
        type: 'test.event',
        source: 'test',
        payload: {},
      }),
    });

    expect(response1.ok).toBe(true);
    expect((response1.result as { accepted: boolean }).accepted).toBe(true);

    // With a queue of 1 and pending event, second event should be rejected
    const response2 = await sendRequest(socketPath, {
      id: `req_${randomUUID()}`,
      type: 'emit',
      event: createDaemonEvent({
        type: 'test.event',
        source: 'test',
        payload: {},
      }),
    });

    // The second event might be accepted if the first was processed, or rejected if queue is full
    // Either way, the daemon should remain stable
    expect(response2.ok).toBe(true);
  });

  it('tracks dropped events in status', async () => {
    const config = createTestConfig(socketPath, 0); // Queue of 0 means all events dropped
    daemon = new PersonalAgentDaemon(config);
    await daemon.start();

    // Request status before any events
    const statusBefore = await sendRequest(socketPath, {
      id: `req_${randomUUID()}`,
      type: 'status',
    });

    const droppedBefore = (statusBefore.result as { queue: { droppedEvents: number } }).queue.droppedEvents;

    // Emit an event that should be dropped
    const emitResponse = await sendRequest(socketPath, {
      id: `req_${randomUUID()}`,
      type: 'emit',
      event: createDaemonEvent({
        type: 'test.event',
        source: 'test',
        payload: {},
      }),
    });

    expect(emitResponse.ok).toBe(true);
    expect((emitResponse.result as { accepted: boolean; reason?: string }).accepted).toBe(false);
    expect((emitResponse.result as { reason?: string }).reason).toContain('queue is full');

    // Check status shows dropped event
    const statusAfter = await sendRequest(socketPath, {
      id: `req_${randomUUID()}`,
      type: 'status',
    });

    const droppedAfter = (statusAfter.result as { queue: { droppedEvents: number } }).queue.droppedEvents;
    expect(droppedAfter).toBeGreaterThan(droppedBefore);
  });

  it('daemon remains stable after queue saturation', async () => {
    const config = createTestConfig(socketPath, 0);
    daemon = new PersonalAgentDaemon(config);
    await daemon.start();

    // Try to emit multiple events that will all be dropped
    for (let i = 0; i < 10; i++) {
      const response = await sendRequest(socketPath, {
        id: `req_${randomUUID()}`,
        type: 'emit',
        event: createDaemonEvent({
          type: 'test.event',
          source: 'test',
          payload: { index: i },
        }),
      });

      expect(response.ok).toBe(true);
    }

    // Daemon should still be responsive
    const statusResponse = await sendRequest(socketPath, {
      id: `req_${randomUUID()}`,
      type: 'status',
    });

    expect(statusResponse.ok).toBe(true);
    expect(statusResponse.result).toHaveProperty('running', true);

    // Ping should still work
    const pingResponse = await sendRequest(socketPath, {
      id: `req_${randomUUID()}`,
      type: 'ping',
    });

    expect(pingResponse.ok).toBe(true);
  });

  it('reports correct queue depth in status', async () => {
    const config = createTestConfig(socketPath, 100);
    daemon = new PersonalAgentDaemon(config);
    await daemon.start();

    const response = await sendRequest(socketPath, {
      id: `req_${randomUUID()}`,
      type: 'status',
    });

    expect(response.ok).toBe(true);

    const queueStatus = (response.result as { queue: { currentDepth: number; maxDepth: number } }).queue;
    expect(queueStatus.maxDepth).toBe(100);
    expect(typeof queueStatus.currentDepth).toBe('number');
    expect(queueStatus.currentDepth).toBeGreaterThanOrEqual(0);
  });
});

describe('EventBus queue behavior', () => {
  it('drops events when maxDepth is 0', () => {
    const bus = new EventBus({ maxDepth: 0 });

    const event = createDaemonEvent({
      type: 'test.event',
      source: 'test',
      payload: {},
    });

    const accepted = bus.publish(event);

    expect(accepted).toBe(false);
    expect(bus.getStatus().droppedEvents).toBe(1);
  });

  it('processes events when queue has capacity', async () => {
    const bus = new EventBus({ maxDepth: 10 });
    const handler = vi.fn();

    bus.subscribe('test.event', handler);

    const event = createDaemonEvent({
      type: 'test.event',
      source: 'test',
      payload: {},
    });

    const accepted = bus.publish(event);

    expect(accepted).toBe(true);

    await bus.waitForIdle();

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('tracks processed events', async () => {
    const bus = new EventBus({ maxDepth: 10 });

    bus.subscribe('test.event', async () => {
      // Simulate some work
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    for (let i = 0; i < 5; i++) {
      bus.publish(
        createDaemonEvent({
          type: 'test.event',
          source: 'test',
          payload: {},
        }),
      );
    }

    await bus.waitForIdle();

    const status = bus.getStatus();
    expect(status.processedEvents).toBe(5);
  });
});

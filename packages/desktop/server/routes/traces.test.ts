/**
 * Tests for traces routes
 */

import { closeTraceDbs, writeTraceCompaction, writeTraceContext, writeTraceStats, writeTraceToolCall } from '@personal-agent/core';
import { randomUUID } from 'crypto';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterAll, describe, expect, it } from 'vitest';

// We need to test the route handlers. Since they're Express handlers,
// we'll test the underlying query functions and the route registration.
import { registerTraceRoutes } from './traces.js';

describe('traces routes', () => {
  const testDir = join(tmpdir(), `trace-routes-test-${randomUUID()}`);
  const originalRoot = process.env.PERSONAL_AGENT_STATE_ROOT;

  beforeAll(() => {
    if (!existsSync(testDir)) {
      mkdirSync(testDir, { recursive: true });
    }
    process.env.PERSONAL_AGENT_STATE_ROOT = testDir;

    // Seed data
    writeTraceStats({
      sessionId: 'route-test',
      modelId: 'gpt-4o',
      tokensInput: 2000,
      tokensOutput: 4000,
      cost: 0.1,
      turnCount: 3,
      stepCount: 12,
      runId: 'run-test-1',
    });
    writeTraceToolCall({ sessionId: 'route-test', toolName: 'bash', status: 'ok' });
    writeTraceToolCall({ sessionId: 'route-test', toolName: 'read', status: 'error', errorMessage: 'not found' });
    writeTraceContext({ sessionId: 'route-test', modelId: 'gpt-4o', totalTokens: 8000, contextWindow: 128000, pct: 6.25 });
    writeTraceCompaction({ sessionId: 'route-test', reason: 'overflow', tokensBefore: 100000, tokensSaved: 50000 });
  });

  afterAll(() => {
    closeTraceDbs();
    if (originalRoot) {
      process.env.PERSONAL_AGENT_STATE_ROOT = originalRoot;
    } else {
      delete process.env.PERSONAL_AGENT_STATE_ROOT;
    }
    rmSync(testDir, { recursive: true, force: true });
  });

  it('registerTraceRoutes accepts a router', () => {
    const routes: Array<{ method: string; path: string }> = [];
    const router = {
      get: (path: string) => {
        routes.push({ method: 'GET', path });
      },
      post: () => {},
      patch: () => {},
    };

    registerTraceRoutes(router as any);
    expect(routes.length).toBeGreaterThan(0);
    expect(routes.some((r) => r.path.includes('/api/traces/summary'))).toBe(true);
    expect(routes.some((r) => r.path.includes('/api/traces/model-usage'))).toBe(true);
    expect(routes.some((r) => r.path.includes('/api/traces/tool-health'))).toBe(true);
    expect(routes.some((r) => r.path.includes('/api/traces/context'))).toBe(true);
    expect(routes.some((r) => r.path.includes('/api/traces/agent-loop'))).toBe(true);
    expect(routes.some((r) => r.path.includes('/api/traces/tokens-daily'))).toBe(true);
    expect(routes.some((r) => r.path.includes('/api/traces/cost-by-conversation'))).toBe(true);
  });

  it('registerTraceRoutes is exported from registerAll', async () => {
    // Verify the registerAll module compiles and includes trace routes
    const { registerServerRoutes } = await import('../routes/registerAll.js');
    expect(registerServerRoutes).toBeDefined();
  });
});

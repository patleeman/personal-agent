/**
 * Integration tests for traces API routes.
 *
 * Tests the route handlers with real trace data in SQLite,
 * using the same handler-capture pattern as runs.test.ts.
 * Core query logic is tested in packages/core/src/trace-db.test.ts.
 */

import { closeTraceDbs, writeTraceContext, writeTraceStats, writeTraceToolCall } from '@personal-agent/core';
import { randomUUID } from 'crypto';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { registerTraceRoutes } from './traces.js';

describe('traces API integration', () => {
  const testDir = join(tmpdir(), `trace-api-int-${randomUUID()}`);
  const originalRoot = process.env.PERSONAL_AGENT_STATE_ROOT;
  const handlers: Record<string, (req: any, res: any) => void | Promise<void>> = {};

  beforeAll(() => {
    if (!existsSync(testDir)) mkdirSync(testDir, { recursive: true });
    process.env.PERSONAL_AGENT_STATE_ROOT = testDir;

    // Seed data — all tables except compactions (tested in core unit tests)
    writeTraceStats({
      sessionId: 's1',
      modelId: 'gpt-4o',
      tokensInput: 5000,
      tokensOutput: 10000,
      cost: 0.25,
      runId: 'r1',
      turnCount: 2,
      stepCount: 4,
      durationMs: 120000,
    });
    writeTraceStats({
      sessionId: 's2',
      modelId: 'gpt-4o-mini',
      tokensInput: 1000,
      tokensOutput: 2000,
      cost: 0.03,
      runId: 'r2',
      turnCount: 1,
      stepCount: 3,
      durationMs: 240000,
    });
    writeTraceToolCall({ sessionId: 's1', runId: 'r1', toolName: 'bash', toolInput: { command: 'git status --short' }, status: 'ok' });
    writeTraceToolCall({ sessionId: 's1', toolName: 'read', status: 'error', errorMessage: 'not found' });
    writeTraceToolCall({
      sessionId: 's2',
      runId: 'r2',
      toolName: 'bash',
      toolInput: { command: 'npm test | tee /tmp/test.log' },
      status: 'ok',
    });
    writeTraceContext({ sessionId: 's1', modelId: 'gpt-4o', totalTokens: 12000, contextWindow: 128000, pct: 9.4 });

    const router = {
      get: vi.fn((path: string, handler: any) => {
        handlers[`GET ${path}`] = handler;
      }),
      post: vi.fn(),
      patch: vi.fn(),
    };
    registerTraceRoutes(router as any);
  });

  afterAll(() => {
    closeTraceDbs();
    if (originalRoot) process.env.PERSONAL_AGENT_STATE_ROOT = originalRoot;
    else delete process.env.PERSONAL_AGENT_STATE_ROOT;
    rmSync(testDir, { recursive: true, force: true });
  });

  function call(method: string, path: string, query: Record<string, string> = {}): Promise<{ status: number; body: any }> {
    return new Promise((resolve) => {
      const key = `${method} ${path.split('?')[0]}`;
      const handler = handlers[key];
      if (!handler) {
        resolve({ status: 404, body: { error: `no handler: ${key}` } });
        return;
      }
      let statusCode = 200;
      handler(
        { query, params: {} },
        {
          status: (c: number) => {
            statusCode = c;
            return this;
          },
          json: (body: any) => resolve({ status: statusCode, body }),
        },
      );
    });
  }

  it('registers all routes', () => {
    const routes = Object.keys(handlers);
    expect(routes).toContain('GET /api/traces/summary');
    expect(routes).toContain('GET /api/traces/model-usage');
    expect(routes).toContain('GET /api/traces/tool-health');
    expect(routes).toContain('GET /api/traces/context');
    expect(routes).toContain('GET /api/traces/agent-loop');
    expect(routes).toContain('GET /api/traces/tokens-daily');
    expect(routes).toContain('GET /api/traces/tool-flow');
    expect(routes).toContain('GET /api/traces/cost-by-conversation');
  });

  it('summary returns aggregates', async () => {
    const res = await call('GET', '/api/traces/summary');
    expect(res.status).toBe(200);
    expect(res.body.tokensTotal).toBeGreaterThan(0);
    expect(res.body.totalCost).toBeGreaterThan(0);
    expect(res.body.toolErrors).toBe(1);
  });

  it('model-usage returns models', async () => {
    const res = await call('GET', '/api/traces/model-usage');
    expect(res.status).toBe(200);
    expect(res.body.models.length).toBeGreaterThanOrEqual(2);
    const gpt4o = res.body.models.find((m: any) => m.modelId === 'gpt-4o');
    expect(gpt4o).toBeDefined();
    expect(gpt4o.cost).toBeGreaterThan(0);
  });

  it('tool-health returns per-tool stats', async () => {
    const res = await call('GET', '/api/traces/tool-health');
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(2);
    const bash = res.body.find((t: any) => t.toolName === 'bash');
    expect(bash.calls).toBe(2);
    expect(bash.errors).toBe(0);
    expect(bash.bashBreakdown.map((row: any) => row.command)).toEqual(['git', 'npm']);
    expect(bash.bashComplexity.pipelineCalls).toBe(1);
    const read = res.body.find((t: any) => t.toolName === 'read');
    expect(read.errors).toBe(1);
  });

  it('context returns sessions', async () => {
    const res = await call('GET', '/api/traces/context');
    expect(res.status).toBe(200);
    expect(res.body.sessions.length).toBeGreaterThanOrEqual(1);
    expect(res.body.compactionAggs).toHaveProperty('autoCount');
  });

  it('agent-loop returns metrics', async () => {
    const res = await call('GET', '/api/traces/agent-loop');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('turnsPerRun');
  });

  it('tool-flow returns transitions and trajectories', async () => {
    const res = await call('GET', '/api/traces/tool-flow');
    expect(res.status).toBe(200);
    expect(res.body.transitions).toBeInstanceOf(Array);
    expect(res.body.failureTrajectories).toBeInstanceOf(Array);
    expect(res.body.failureTrajectories.length).toBeGreaterThanOrEqual(1);
  });

  it('tokens-daily returns daily data', async () => {
    const res = await call('GET', '/api/traces/tokens-daily');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('handles range parameter', async () => {
    const res = await call('GET', '/api/traces/summary', { range: '1h' });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('activeSessions');
  });
});

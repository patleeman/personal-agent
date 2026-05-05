/**
 * Tests for trace-db.ts
 */

import { randomUUID } from 'crypto';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

// We test the query functions by writing data and reading it back.
// The module uses getStateRoot() which defaults to process.cwd-based paths.
// We override by setting up our own DB path via environment manipulation.
import {
  closeTraceDbs,
  queryAgentLoop,
  queryCompactionAggregates,
  queryCompactions,
  queryContextSessions,
  queryModelUsage,
  querySummary,
  queryTokensDaily,
  queryToolHealth,
  writeTraceCompaction,
  writeTraceContext,
  writeTraceStats,
  writeTraceToolCall,
} from './trace-db.js';

describe('trace-db', () => {
  // Use a temp directory for trace DB during tests
  const testDir = join(tmpdir(), `trace-db-test-${randomUUID()}`);
  const originalRoot = process.env.PERSONAL_AGENT_STATE_ROOT;

  beforeAll(() => {
    if (!existsSync(testDir)) {
      mkdirSync(testDir, { recursive: true });
    }
    process.env.PERSONAL_AGENT_STATE_ROOT = testDir;
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

  const sessionId = 'test-session-1';
  const fiveHoursAgo = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString();

  beforeEach(() => {
    closeTraceDbs();
    rmSync(join(testDir, 'pi-agent'), { recursive: true, force: true });

    // Write some test data
    writeTraceStats({ sessionId, modelId: 'gpt-4o', tokensInput: 1000, tokensOutput: 2000, cost: 0.05, turnCount: 2, stepCount: 10 });
    writeTraceStats({ sessionId, modelId: 'gpt-4o', tokensInput: 500, tokensOutput: 1500, cost: 0.03, turnCount: 1, stepCount: 5 });
    writeTraceStats({
      sessionId: 'session-2',
      modelId: 'gpt-4o-mini',
      tokensInput: 300,
      tokensOutput: 700,
      cost: 0.01,
      runId: 'run-1',
      turnCount: 3,
      stepCount: 15,
    });

    writeTraceToolCall({ sessionId, toolName: 'bash', status: 'ok', durationMs: 1200 });
    writeTraceToolCall({ sessionId, toolName: 'bash', status: 'ok', durationMs: 800 });
    writeTraceToolCall({ sessionId, toolName: 'read', status: 'error', errorMessage: 'File not found' });
    writeTraceToolCall({ sessionId, toolName: 'read', status: 'ok', durationMs: 400 });

    writeTraceContext({
      sessionId,
      modelId: 'gpt-4o',
      totalTokens: 5000,
      contextWindow: 128000,
      pct: 3.9,
      segSystem: 1000,
      segUser: 2000,
      segAssistant: 1500,
      segTool: 300,
      segSummary: 200,
    });

    writeTraceCompaction({ sessionId, reason: 'overflow', tokensBefore: 120000, tokensAfter: 52000, tokensSaved: 68000 });
    writeTraceCompaction({ sessionId: 'session-2', reason: 'threshold', tokensBefore: 90000, tokensAfter: 45000, tokensSaved: 45000 });
  });

  it('querySummary returns correct aggregates', () => {
    const result = querySummary(fiveHoursAgo);
    expect(result.activeSessions).toBeGreaterThanOrEqual(2);
    expect(result.totalCost).toBeGreaterThan(0);
    expect(result.tokensTotal).toBeGreaterThan(0);
    expect(result.toolCalls).toBe(4);
    expect(result.toolErrors).toBe(1);
  });

  it('queryModelUsage returns models grouped correctly', () => {
    const result = queryModelUsage(fiveHoursAgo);
    expect(result.length).toBeGreaterThanOrEqual(2);
    const gpt4 = result.find((m) => m.modelId === 'gpt-4o');
    expect(gpt4).toBeDefined();
    expect(gpt4!.tokens).toBeGreaterThan(0);
  });

  it('queryToolHealth returns per-tool stats', () => {
    const result = queryToolHealth(fiveHoursAgo);
    expect(result.length).toBe(2);
    const bash = result.find((t) => t.toolName === 'bash');
    expect(bash).toBeDefined();
    expect(bash!.calls).toBe(2);
    expect(bash!.errors).toBe(0);
    expect(bash!.successRate).toBe(100);

    const read = result.find((t) => t.toolName === 'read');
    expect(read).toBeDefined();
    expect(read!.calls).toBe(2);
    expect(read!.errors).toBe(1);
    expect(read!.successRate).toBe(50);
  });

  it('queryContextSessions returns latest per session', () => {
    const result = queryContextSessions(fiveHoursAgo);
    expect(result.length).toBe(1);
    expect(result[0].sessionId).toBe(sessionId);
    expect(result[0].totalTokens).toBe(5000);
  });

  it('queryCompactions returns compaction events', () => {
    const result = queryCompactions(fiveHoursAgo);
    expect(result.length).toBe(2);
    expect(result[0].reason).toBeDefined();
  });

  it('queryCompactionAggregates returns correct counts', () => {
    const result = queryCompactionAggregates(fiveHoursAgo);
    expect(result.autoCount).toBe(2);
    expect(result.manualCount).toBe(0);
    expect(result.totalTokensSaved).toBe(113000);
  });

  it('queryAgentLoop returns stats', () => {
    const result = queryAgentLoop(fiveHoursAgo);
    expect(result.turnsPerRun).toBeGreaterThan(0);
  });

  it('queryTokensDaily returns daily aggregation', () => {
    const result = queryTokensDaily(fiveHoursAgo);
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0].tokensInput).toBeGreaterThan(0);
    expect(result[0].tokensOutput).toBeGreaterThan(0);
  });
});

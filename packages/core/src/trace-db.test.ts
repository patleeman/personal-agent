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
  queryBashBreakdown,
  queryBashComplexity,
  queryCacheEfficiency,
  queryCacheEfficiencyAggregate,
  queryCompactionAggregates,
  queryCompactions,
  queryContextSessions,
  queryCostByConversation,
  queryModelUsage,
  querySummary,
  querySystemPromptAggregate,
  querySystemPromptTrend,
  queryThroughput,
  queryTokensDaily,
  queryToolFlow,
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
    writeTraceStats({
      sessionId,
      modelId: 'gpt-4o',
      tokensInput: 1000,
      tokensOutput: 2000,
      tokensCachedInput: 250,
      cost: 0.05,
      turnCount: 2,
      stepCount: 5,
      durationMs: 1000,
    });
    writeTraceStats({ sessionId, modelId: 'gpt-4o', tokensInput: 500, tokensOutput: 1500, cost: 0.03, turnCount: 1, stepCount: 5 });
    writeTraceStats({
      sessionId: 'session-2',
      modelId: 'gpt-4o-mini',
      tokensInput: 300,
      tokensOutput: 700,
      cost: 0.01,
      runId: 'run-1',
      turnCount: 3,
      stepCount: 5,
      durationMs: 700000,
    });

    writeTraceToolCall({
      sessionId,
      toolName: 'bash',
      toolInput: { command: 'git status --short && git diff' },
      status: 'ok',
      durationMs: 1200,
      conversationTitle: 'Test chat',
    });
    writeTraceToolCall({
      sessionId,
      toolName: 'bash',
      toolInput: { command: 'rg "foo" packages | head -20 > /tmp/foo.txt' },
      status: 'ok',
      durationMs: 800,
      conversationTitle: 'Test chat',
    });
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
    expect(result.tokensTotal).toBe(result.tokensInput + result.tokensCached + result.tokensOutput);
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
    expect(bash!.p95LatencyMs).toBe(1200);
    expect(bash!.bashBreakdown?.map((row) => row.command)).toEqual(['git', 'rg']);
    expect(bash!.bashComplexity).toMatchObject({ pipelineCalls: 1, chainCalls: 1, redirectCalls: 1, maxCommandCount: 2 });

    const read = result.find((t) => t.toolName === 'read');
    expect(read).toBeDefined();
    expect(read!.calls).toBe(2);
    expect(read!.errors).toBe(1);
    expect(read!.successRate).toBe(50);
  });

  it('queryBashBreakdown returns command-family stats', () => {
    const result = queryBashBreakdown(fiveHoursAgo);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ command: 'git', calls: 1, errors: 0, errorRate: 0, successRate: 100, p95LatencyMs: 1200 });
    expect(result[1]).toMatchObject({ command: 'rg', calls: 1, errors: 0, errorRate: 0, successRate: 100, p95LatencyMs: 800 });
  });

  it('queryBashComplexity returns command shape and complexity stats', () => {
    const result = queryBashComplexity(fiveHoursAgo);
    expect(result).toMatchObject({
      maxScore: 5,
      avgScore: 4,
      maxCommandCount: 2,
      pipelineCalls: 1,
      chainCalls: 1,
      redirectCalls: 1,
    });
    expect(result.shapeBreakdown).toEqual([
      { shape: 'chain', calls: 1 },
      { shape: 'pipeline', calls: 1 },
    ]);
  });

  it('queryToolFlow breaks bash into command-family labels', () => {
    const result = queryToolFlow(fiveHoursAgo);

    expect(result.transitions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ fromTool: 'bash:git', toTool: 'bash:rg', count: 1 }),
        expect.objectContaining({ fromTool: 'bash:rg', toTool: 'read', count: 1 }),
      ]),
    );
    expect(result.coOccurrences).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ toolA: 'bash:git', toolB: 'bash:rg', sessions: 1 }),
        expect.objectContaining({ toolA: 'bash:rg', toolB: 'read', sessions: 1 }),
      ]),
    );
    expect(result.failureTrajectories[0]).toMatchObject({
      toolName: 'read',
      previousCalls: ['bash:git', 'bash:rg'],
    });
  });

  it('queryToolFlow normalizes legacy bash apply_patch calls to the apply_patch tool label', () => {
    writeTraceToolCall({
      sessionId: 'patch-session',
      toolName: 'bash',
      toolInput: { command: "apply_patch <<'PATCH'\n*** Begin Patch\n*** End Patch\nPATCH" },
      status: 'ok',
    });
    writeTraceToolCall({ sessionId: 'patch-session', toolName: 'read', status: 'ok' });

    const result = queryToolFlow(fiveHoursAgo);

    expect(result.transitions).toEqual(
      expect.arrayContaining([expect.objectContaining({ fromTool: 'apply_patch', toTool: 'read', count: 1 })]),
    );
    expect(result.transitions).not.toEqual(expect.arrayContaining([expect.objectContaining({ fromTool: 'bash:apply_patch' })]));
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
    expect(result).not.toBeNull();
    if (!result) throw new Error('expected agent loop stats');
    expect(result.turnsPerRun).toBeGreaterThan(0);
    expect(result.stepsPerTurn).toBeGreaterThan(0);
    expect(result.avgDurationMs).toBeGreaterThan(0);
    expect(result.durationP50Ms).toBeGreaterThan(0);
    expect(result.durationP95Ms).toBeGreaterThan(0);
    expect(result.durationP99Ms).toBeGreaterThan(0);
    expect(result.stuckRuns).toBe(1);
  });

  it('queryAgentLoop returns null when no run metrics exist', () => {
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    expect(queryAgentLoop(future)).toBeNull();
  });

  it('queryCacheEfficiency maps token cache columns', () => {
    const series = queryCacheEfficiency(fiveHoursAgo);
    // totalInput = tokens_input + tokens_cached_input + tokens_cached_write = 1000 + 250 + 0 = 1250
    expect(series[0]).toMatchObject({ totalInput: 1250, cachedInput: 250, hitRate: 20 });

    const aggregate = queryCacheEfficiencyAggregate(fiveHoursAgo);
    // gpt-4o: input=1500, cachedInput=250, cachedWrite=0 → totalInput=1750, totalCached=250
    // gpt-4o-mini: input=300, cachedInput=0, cachedWrite=0 → totalInput=300, totalCached=0
    // overall: 250 / (1750+300) = 250/2050 ≈ 12.2%
    expect(aggregate.totalInput).toBe(2050);
    expect(aggregate.totalCached).toBe(250);
    expect(aggregate.totalCachedWrite).toBe(0);
    expect(aggregate.requests).toBe(3);
    expect(aggregate.cachedRequests).toBe(1);
    expect(aggregate.requestCacheHitRate).toBe(33.33);
    expect(aggregate.overallHitRate).toBeGreaterThan(0);
    expect(aggregate.overallHitRate).toBeLessThanOrEqual(100);
  });

  it('querySystemPromptAggregate reports system prompt context window usage by model', () => {
    writeTraceContext({
      sessionId: 'system-prompt-model-a',
      modelId: 'model-a',
      totalTokens: 10_000,
      contextWindow: 100_000,
      pct: 10,
      systemPromptTokens: 5_000,
    });
    writeTraceContext({
      sessionId: 'system-prompt-model-b',
      modelId: 'model-b',
      totalTokens: 20_000,
      contextWindow: 200_000,
      pct: 10,
      systemPromptTokens: 10_000,
    });

    const aggregate = querySystemPromptAggregate(fiveHoursAgo);
    expect(aggregate.avgSystemPromptTokens).toBe(7_500);
    expect(aggregate.avgPctOfContextWindow).toBe(5);
    expect(aggregate.byModel).toEqual([
      {
        modelId: 'model-b',
        avgSystemPromptTokens: 10_000,
        maxSystemPromptTokens: 10_000,
        contextWindow: 200_000,
        avgPctOfContextWindow: 5,
        samples: 1,
      },
      {
        modelId: 'model-a',
        avgSystemPromptTokens: 5_000,
        maxSystemPromptTokens: 5_000,
        contextWindow: 100_000,
        avgPctOfContextWindow: 5,
        samples: 1,
      },
    ]);

    const trend = querySystemPromptTrend(fiveHoursAgo).filter((point) => point.sessionId.startsWith('system-prompt-model-'));
    expect(trend[0]).toMatchObject({ modelId: 'model-a', contextWindow: 100_000, pctOfContextWindow: 5 });
  });

  it('queryCostByConversation does not multiply stats by tool calls', () => {
    const result = queryCostByConversation(fiveHoursAgo);
    const chat = result.find((r) => r.conversationTitle === 'Test chat');

    expect(chat).toBeDefined();
    expect(chat!.cost).toBe(0.08);
  });

  it('queryThroughput uses output tokens over recorded run duration', () => {
    const result = queryThroughput(fiveHoursAgo);
    const gpt4 = result.find((r) => r.modelId === 'gpt-4o');

    expect(gpt4).toBeDefined();
    expect(gpt4!.avgTokensPerSec).toBe(2000);
    expect(gpt4!.peakTokensPerSec).toBe(2000);
    expect(gpt4!.tokensOutput).toBe(2000);
  });

  it('queryTokensDaily returns daily aggregation with tool errors', () => {
    const result = queryTokensDaily(fiveHoursAgo);
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0].tokensInput).toBeGreaterThan(0);
    expect(result[0].tokensOutput).toBeGreaterThan(0);
    expect(typeof result[0].toolErrors).toBe('number');
    // Fixture has 1 tool error (read tool), so today's row should have toolErrors >= 1
    const totalErrors = result.reduce((sum, r) => sum + r.toolErrors, 0);
    expect(totalErrors).toBeGreaterThanOrEqual(1);
  });
});

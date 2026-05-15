/**
 * Tests for trace-db.ts
 */

import { randomUUID } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

// We test the query functions by writing data and reading it back.
// The module uses getStateRoot() which defaults to process.cwd-based paths.
// We override by setting up our own DB path via environment manipulation.
import { resolveObservabilityDbPath } from './observability-db.js';
import { openSqliteDatabase } from './sqlite.js';
import {
  closeTraceDbs,
  queryAgentLoop,
  queryAutoMode,
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
  writeTraceAutoMode,
  writeTraceCompaction,
  writeTraceContext,
  writeTraceContextPointerInspect,
  writeTraceStats,
  writeTraceSuggestedContext,
  writeTraceToolCall,
} from './trace-db.js';
import { resolveTraceTelemetryLogDir } from './trace-telemetry-log.js';

describe('trace-db', () => {
  // Use a temp directory for trace DB during tests
  const testDir = join(tmpdir(), `trace-db-test-${randomUUID()}`);
  const originalRoot = process.env.PERSONAL_AGENT_STATE_ROOT;
  const originalTraceTableMaxRows = process.env.PERSONAL_AGENT_TRACE_TABLE_MAX_ROWS;

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
    if (originalTraceTableMaxRows) {
      process.env.PERSONAL_AGENT_TRACE_TABLE_MAX_ROWS = originalTraceTableMaxRows;
    } else {
      delete process.env.PERSONAL_AGENT_TRACE_TABLE_MAX_ROWS;
    }
    rmSync(testDir, { recursive: true, force: true });
  });

  const sessionId = 'test-session-1';
  const fiveHoursAgo = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString();

  function readSingleValue<T>(sql: string): T {
    closeTraceDbs();
    const db = openSqliteDatabase(resolveObservabilityDbPath(testDir));
    try {
      return (db.prepare(sql).get() as { value: T }).value;
    } finally {
      db.close();
    }
  }

  function countRows(table: string): number {
    return readSingleValue<number>(`SELECT COUNT(*) AS value FROM ${table}`);
  }

  function readTraceLogEvents(): Array<{ type: string; sessionId: string; payload: Record<string, unknown> }> {
    const dir = resolveTraceTelemetryLogDir(testDir);
    const files = readdirSync(dir).filter((fileName) => fileName.startsWith('trace-telemetry-') && fileName.endsWith('.jsonl'));
    return files.flatMap((fileName) =>
      readFileSync(join(dir, fileName), 'utf-8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as { type: string; sessionId: string; payload: Record<string, unknown> }),
    );
  }

  beforeEach(() => {
    closeTraceDbs();
    rmSync(join(testDir, 'pi-agent'), { recursive: true, force: true });
    rmSync(join(testDir, 'observability'), { recursive: true, force: true });

    delete process.env.PERSONAL_AGENT_TRACE_TABLE_MAX_ROWS;

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
    writeTraceToolCall({ sessionId: 'session-2', runId: 'run-1', toolName: 'subagent', status: 'ok', durationMs: 2000 });

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

  it('writes trace JSONL before indexing SQLite', () => {
    const events = readTraceLogEvents();
    expect(events.some((event) => event.type === 'stats' && event.sessionId === sessionId && event.payload.tokensInput === 1000)).toBe(
      true,
    );
    expect(events.some((event) => event.type === 'tool_call' && event.sessionId === sessionId && event.payload.toolName === 'bash')).toBe(
      true,
    );
    expect(events.some((event) => event.type === 'context' && event.sessionId === sessionId && event.payload.totalTokens === 5000)).toBe(
      true,
    );
  });

  it('keeps trace JSONL when SQLite indexing fails', () => {
    closeTraceDbs();
    rmSync(join(testDir, 'logs'), { recursive: true, force: true });
    rmSync(join(testDir, 'observability'), { recursive: true, force: true });
    mkdirSync(resolveObservabilityDbPath(testDir), { recursive: true });

    writeTraceStats({ sessionId: 'jsonl-survives-sqlite-failure', modelId: 'gpt-4o', tokensInput: 42, tokensOutput: 1, cost: 0.01 });

    const events = readTraceLogEvents();
    expect(events.some((event) => event.type === 'stats' && event.sessionId === 'jsonl-survives-sqlite-failure')).toBe(true);
  });

  it('redacts stale suggested-context pointer ids while preserving aggregate counts', () => {
    writeTraceSuggestedContext({ sessionId: 'stale-suggested-context', pointerIds: ['old-a', 'old-b'] });
    writeTraceSuggestedContext({ sessionId: 'fresh-suggested-context', pointerIds: ['fresh-a'] });
    closeTraceDbs();

    const dbPath = resolveObservabilityDbPath(testDir);
    const db = openSqliteDatabase(dbPath);
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    db.prepare(`UPDATE trace_suggested_context SET ts = ? WHERE session_id = ?`).run(eightDaysAgo, 'stale-suggested-context');
    db.close();

    writeTraceStats({ sessionId: 'trigger-prune', modelId: 'gpt-4o', tokensInput: 0, tokensOutput: 0, cost: 0 });
    closeTraceDbs();

    const prunedDb = openSqliteDatabase(dbPath);
    const stale = prunedDb
      .prepare(`SELECT pointer_ids, pointer_count FROM trace_suggested_context WHERE session_id = ?`)
      .get('stale-suggested-context') as { pointer_ids: string; pointer_count: number };
    const fresh = prunedDb
      .prepare(`SELECT pointer_ids, pointer_count FROM trace_suggested_context WHERE session_id = ?`)
      .get('fresh-suggested-context') as { pointer_ids: string; pointer_count: number };
    prunedDb.close();

    expect(stale).toEqual({ pointer_ids: '', pointer_count: 2 });
    expect(fresh).toEqual({ pointer_ids: 'fresh-a', pointer_count: 1 });
  });

  it('queryAutoMode returns activity and latest active sessions', () => {
    writeTraceAutoMode({ sessionId, enabled: true });
    writeTraceAutoMode({ sessionId, enabled: false, stopReason: 'complete' });
    writeTraceAutoMode({ sessionId: 'session-2', enabled: true });

    const result = queryAutoMode(fiveHoursAgo);

    expect(result.enabledCount).toBe(2);
    expect(result.disabledCount).toBe(1);
    expect(result.currentActive).toBe(1);
    expect(result.topStopReasons).toEqual([{ reason: 'complete', count: 1 }]);
    expect(result.recentEvents).toHaveLength(3);
    expect(result.recentEvents[0]).toMatchObject({ sessionId: 'session-2', enabled: true, stopReason: null });
  });

  it('querySummary returns correct aggregates', () => {
    const result = querySummary(fiveHoursAgo);
    expect(result.activeSessions).toBeGreaterThanOrEqual(2);
    expect(result.totalCost).toBeGreaterThan(0);
    expect(result.tokensTotal).toBeGreaterThan(0);
    expect(result.tokensTotal).toBe(result.tokensInput + result.tokensCached + result.tokensCachedWrite + result.tokensOutput);
    expect(result.toolCalls).toBe(5);
    expect(result.toolErrors).toBe(1);
  });

  it('truncates fractional token counters before storing trace stats', () => {
    writeTraceStats({
      sessionId: 'fractional-tokens',
      modelId: 'gpt-4o',
      tokensInput: 10.9,
      tokensOutput: 20.8,
      tokensCachedInput: 30.7,
      tokensCachedWrite: 40.6,
      cost: 1.23,
    });

    const result = querySummary(fiveHoursAgo);
    expect(result.tokensInput).toBe(1810);
    expect(result.tokensOutput).toBe(4220);
    expect(result.tokensCached).toBe(280);
    expect(result.tokensCachedWrite).toBe(40);
    expect(result.tokensTotal).toBe(6350);
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
    expect(result.length).toBe(3);
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

  it('deletes legacy trace DB after successful import', () => {
    closeTraceDbs();
    const legacyDir = join(testDir, 'pi-agent', 'state', 'trace');
    mkdirSync(legacyDir, { recursive: true });
    const legacyPath = join(legacyDir, 'trace.db');
    cpSync(resolveObservabilityDbPath(testDir), legacyPath);
    rmSync(join(testDir, 'observability'), { recursive: true, force: true });

    writeTraceStats({ sessionId: 'post-import-session', modelId: 'gpt-4o', tokensInput: 1, tokensOutput: 2, cost: 0 });
    closeTraceDbs();

    const db = openSqliteDatabase(resolveObservabilityDbPath(testDir));
    const imported = db.prepare(`SELECT COUNT(*) AS count FROM trace_stats WHERE session_id = ?`).get(sessionId) as { count: number };
    db.close();

    expect(imported.count).toBeGreaterThan(0);
    expect(existsSync(legacyPath)).toBe(false);
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

  it('queryToolFlow ignores bash calls without command metadata', () => {
    writeTraceToolCall({ sessionId: 'unknown-bash-session', toolName: 'bash', status: 'ok' });
    writeTraceToolCall({ sessionId: 'unknown-bash-session', toolName: 'bash', status: 'error', errorMessage: 'missing command' });

    const result = queryToolFlow(fiveHoursAgo);

    expect(result.transitions).not.toEqual(expect.arrayContaining([expect.objectContaining({ fromTool: 'bash:unknown' })]));
    expect(result.transitions).not.toEqual(expect.arrayContaining([expect.objectContaining({ toTool: 'bash:unknown' })]));
    expect(result.failureTrajectories).not.toEqual(expect.arrayContaining([expect.objectContaining({ toolName: 'bash:unknown' })]));
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
    expect(result.toolCallsPerRun).toBe(1.7);
    expect(result.toolCallsP95).toBe(4);
    expect(result.toolErrorRatePct).toBe(20);
    expect(result.avgTokensPerRun).toBe(2083);
    expect(result.subagentsPerRun).toBe(0.3);
    expect(result.stuckRunPct).toBe(33.3);
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

  it('caps trace tables on open', () => {
    process.env.PERSONAL_AGENT_TRACE_TABLE_MAX_ROWS = '1000';

    for (let index = 0; index < 1005; index++) {
      writeTraceStats({ sessionId: `cap-${index}`, modelId: 'cap-model', tokensInput: 1, tokensOutput: 1, cost: 1 });
      writeTraceSuggestedContext({ sessionId: `cap-suggested-${index}`, pointerIds: [`pointer-${index}`] });
      writeTraceContextPointerInspect({
        sessionId: `cap-inspect-${index}`,
        inspectedConversationId: `pointer-${index}`,
        wasSuggested: index % 2 === 0,
      });
    }

    closeTraceDbs();
    const usage = queryModelUsage(fiveHoursAgo).find((row) => row.modelId === 'cap-model');

    expect(usage?.calls).toBe(1000);
    expect(countRows('trace_suggested_context')).toBe(1000);
    expect(countRows('trace_context_pointer_inspect')).toBe(1000);
  });

  it('prunes stale suggested context telemetry on open', () => {
    writeTraceSuggestedContext({ sessionId: 'stale-suggested', pointerIds: ['old-pointer'] });
    writeTraceContextPointerInspect({ sessionId: 'stale-inspect', inspectedConversationId: 'old-pointer', wasSuggested: true });

    closeTraceDbs();
    const oldTimestamp = new Date(Date.now() - 91 * 24 * 60 * 60 * 1000).toISOString();
    const db = openSqliteDatabase(resolveObservabilityDbPath(testDir));
    try {
      db.prepare(`UPDATE trace_suggested_context SET ts = ? WHERE session_id = ?`).run(oldTimestamp, 'stale-suggested');
      db.prepare(`UPDATE trace_context_pointer_inspect SET ts = ? WHERE session_id = ?`).run(oldTimestamp, 'stale-inspect');
    } finally {
      db.close();
    }

    writeTraceSuggestedContext({ sessionId: 'fresh-suggested', pointerIds: ['new-pointer'] });

    expect(countRows('trace_suggested_context')).toBe(1);
    expect(countRows('trace_context_pointer_inspect')).toBe(0);
  });

  it('drops raw suggested context pointer ids before aggregate telemetry expires', () => {
    writeTraceSuggestedContext({ sessionId: 'suggested-ids', pointerIds: ['pointer-a', 'pointer-b'] });

    closeTraceDbs();
    const oldTimestamp = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    let db = openSqliteDatabase(resolveObservabilityDbPath(testDir));
    try {
      db.prepare(`UPDATE trace_suggested_context SET ts = ? WHERE session_id = ?`).run(oldTimestamp, 'suggested-ids');
    } finally {
      db.close();
    }

    writeTraceStats({ sessionId: 'trigger-prune', modelId: 'prune-model', tokensInput: 1, tokensOutput: 1, cost: 1 });

    closeTraceDbs();
    db = openSqliteDatabase(resolveObservabilityDbPath(testDir));
    try {
      const row = db
        .prepare(`SELECT pointer_ids, pointer_count FROM trace_suggested_context WHERE session_id = ?`)
        .get('suggested-ids') as {
        pointer_ids: string;
        pointer_count: number;
      };
      expect(row).toEqual({ pointer_ids: '', pointer_count: 2 });
    } finally {
      db.close();
    }
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

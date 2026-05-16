import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  closeTraceDbs,
  maintainTraceDb,
  querySessionSuggestedPointerIds,
  writeTraceAutoMode,
  writeTraceCompaction,
  writeTraceContext,
  writeTraceContextPointerInspect,
  writeTraceStats,
  writeTraceSuggestedContext,
  writeTraceToolCall,
} from './trace-db.js';
import { resolveTraceTelemetryLogDir } from './trace-telemetry-log.js';

describe('trace-db JSONL writers', () => {
  const testDir = join(tmpdir(), `trace-jsonl-test-${randomUUID()}`);
  const originalRoot = process.env.PERSONAL_AGENT_STATE_ROOT;

  beforeAll(() => {
    mkdirSync(testDir, { recursive: true });
    process.env.PERSONAL_AGENT_STATE_ROOT = testDir;
  });

  afterAll(() => {
    closeTraceDbs();
    if (originalRoot) process.env.PERSONAL_AGENT_STATE_ROOT = originalRoot;
    else delete process.env.PERSONAL_AGENT_STATE_ROOT;
    rmSync(testDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    closeTraceDbs();
    rmSync(join(testDir, 'logs'), { recursive: true, force: true });
  });

  function events(): Array<{ type: string; sessionId: string; runId: string | null; payload: Record<string, unknown> }> {
    const dir = resolveTraceTelemetryLogDir(testDir);
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((fileName) => fileName.startsWith('trace-telemetry-') && fileName.endsWith('.jsonl'))
      .flatMap((fileName) =>
        readFileSync(join(dir, fileName), 'utf-8')
          .split('\n')
          .filter(Boolean)
          .map((line) => JSON.parse(line) as { type: string; sessionId: string; runId: string | null; payload: Record<string, unknown> }),
      );
  }

  it('writes all trace event types to canonical JSONL', () => {
    writeTraceStats({ sessionId: 's1', runId: 'r1', modelId: 'gpt-4o', tokensInput: 10, tokensOutput: 5, cost: 0.01 });
    writeTraceToolCall({ sessionId: 's1', runId: 'r1', toolName: 'bash', toolInput: { command: 'git status --short' }, status: 'ok' });
    writeTraceContext({ sessionId: 's1', modelId: 'gpt-4o', totalTokens: 100, contextWindow: 1000, pct: 10 });
    writeTraceCompaction({ sessionId: 's1', reason: 'manual', tokensBefore: 100, tokensAfter: 50, tokensSaved: 50 });
    writeTraceAutoMode({ sessionId: 's1', enabled: true });
    writeTraceSuggestedContext({ sessionId: 's1', pointerIds: ['a', 'b'] });
    writeTraceContextPointerInspect({ sessionId: 's1', inspectedConversationId: 'a', wasSuggested: true });

    const rows = events();
    expect(rows.map((row) => row.type)).toEqual([
      'stats',
      'tool_call',
      'context',
      'compaction',
      'auto_mode',
      'suggested_context',
      'context_pointer_inspect',
    ]);
    expect(rows[0]).toMatchObject({ sessionId: 's1', runId: 'r1', payload: { modelId: 'gpt-4o', tokensInput: 10 } });
    expect(rows[1].payload).toMatchObject({ toolName: 'bash', bashCommand: 'git status --short', bashCommandLabel: 'git' });
  });

  it('returns the latest suggested pointer ids for a session', () => {
    writeTraceSuggestedContext({ sessionId: 's1', pointerIds: ['old-a', 'old-b'] });
    writeTraceSuggestedContext({ sessionId: 's2', pointerIds: ['other'] });
    writeTraceSuggestedContext({ sessionId: 's1', pointerIds: ['new-a', 'new-b'] });

    expect([...querySessionSuggestedPointerIds('s1', { stateRoot: testDir })]).toEqual(['new-a', 'new-b']);
    expect([...querySessionSuggestedPointerIds('s2', { stateRoot: testDir })]).toEqual(['other']);
    expect([...querySessionSuggestedPointerIds('missing', { stateRoot: testDir })]).toEqual([]);
  });

  it('keeps maintenance as a no-op for old trace SQLite state', () => {
    const result = maintainTraceDb(testDir);
    expect(result.deletedRows).toEqual({});
    expect(result.vacuumed).toBe(false);
  });
});

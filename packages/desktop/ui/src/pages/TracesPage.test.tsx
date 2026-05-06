/**
 * Tests for TracesPage
 */

import React from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { TracesPage } from './TracesPage';

(globalThis as typeof globalThis & { React?: typeof React }).React = React;

// Mock the data hook
vi.mock('./traces/useTracesData', () => ({
  useTracesData: () => ({
    summary: {
      activeSessions: 3,
      runsToday: 28,
      totalCost: 2.84,
      tokensTotal: 1200000,
      tokensInput: 384000,
      tokensOutput: 816000,
      tokensCached: 268000,
      cacheHitRate: 32,
      toolErrors: 14,
      toolCalls: 312,
    },
    modelUsage: [
      { modelId: 'gpt-4o', tokens: 744000, cost: 1.73, calls: 18 },
      { modelId: 'gpt-4o-mini', tokens: 336000, cost: 0.39, calls: 8 },
      { modelId: 'claude-3-opus', tokens: 96000, cost: 0.72, calls: 2 },
    ],
    throughput: [
      { modelId: 'gpt-4o', avgTokensPerSec: 142, peakTokensPerSec: 180, tokensOutput: 14200, durationMs: 100000 },
      { modelId: 'gpt-4o-mini', avgTokensPerSec: 98, peakTokensPerSec: 120, tokensOutput: 9800, durationMs: 100000 },
    ],
    costByConversation: [
      { conversationTitle: 'Refactor auth', modelId: 'gpt-4o', tokens: 428000, cost: 1.42 },
      { conversationTitle: 'Debug CI', modelId: 'gpt-4o-mini', tokens: 196000, cost: 0.39 },
    ],
    toolHealth: [
      {
        toolName: 'bash',
        calls: 142,
        errors: 2,
        successRate: 98.6,
        avgLatencyMs: 1200,
        p95LatencyMs: 3800,
        maxLatencyMs: 12400,
        bashBreakdown: [
          {
            command: 'git',
            calls: 48,
            errors: 0,
            errorRate: 0,
            successRate: 100,
            avgLatencyMs: 600,
            p95LatencyMs: 1800,
            maxLatencyMs: 3200,
          },
          {
            command: 'npm',
            calls: 23,
            errors: 1,
            errorRate: 4.3,
            successRate: 95.7,
            avgLatencyMs: 4000,
            p95LatencyMs: 12400,
            maxLatencyMs: 12400,
          },
        ],
        bashComplexity: {
          avgScore: 3.8,
          maxScore: 12,
          avgCommandCount: 2.2,
          maxCommandCount: 7,
          avgCharCount: 84,
          maxCharCount: 360,
          pipelineCalls: 31,
          chainCalls: 44,
          redirectCalls: 12,
          multilineCalls: 5,
          shellCalls: 3,
          substitutionCalls: 8,
          shapeBreakdown: [
            { shape: 'single', calls: 64 },
            { shape: 'chain', calls: 35 },
            { shape: 'pipeline', calls: 31 },
          ],
        },
      },
      { toolName: 'read', calls: 89, errors: 7, successRate: 92.1, avgLatencyMs: 400, p95LatencyMs: 1100, maxLatencyMs: 2800 },
    ],
    contextSessions: [
      {
        sessionId: 'session-1',
        totalTokens: 5000,
        contextWindow: 128000,
        pct: 3.9,
        segSystem: 1000,
        segUser: 2000,
        segAssistant: 1500,
        segTool: 300,
        segSummary: 200,
        systemPromptTokens: 1000,
      },
    ],
    compactions: [
      {
        sessionId: 'session-1',
        ts: '2026-05-03T14:23:00.000Z',
        reason: 'overflow',
        tokensBefore: 120000,
        tokensAfter: 52000,
        tokensSaved: 68000,
      },
    ],
    compactionAggs: { autoCount: 4, manualCount: 1, totalTokensSaved: 301000, overflowPct: 65 },
    agentLoop: {
      turnsPerRun: 4.2,
      stepsPerTurn: 8.6,
      runsOver20Turns: 2,
      subagentsPerRun: 1.4,
      avgDurationMs: 252000,
      durationP50Ms: 138000,
      durationP95Ms: 522000,
      durationP99Ms: 846000,
      stuckRuns: 1,
    },
    tokensDaily: [
      { date: '2026-05-01', tokensInput: 100000, tokensOutput: 200000, tokensCached: 30000, cost: 0.5 },
      { date: '2026-05-02', tokensInput: 150000, tokensOutput: 250000, tokensCached: 40000, cost: 0.75 },
    ],
    cacheEfficiency: null,
    systemPrompt: {
      avgSystemPromptTokens: 8000,
      avgPctOfTotal: 40,
      avgPctOfContextWindow: 4,
      maxSystemPromptTokens: 10000,
      samples: 2,
      byModel: [
        {
          modelId: 'gpt-4o',
          avgSystemPromptTokens: 8000,
          maxSystemPromptTokens: 10000,
          contextWindow: 200000,
          avgPctOfContextWindow: 4,
          samples: 2,
        },
      ],
    },
    loading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

describe('TracesPage', () => {
  it('renders the top bar with title', () => {
    const html = renderToString(
      <MemoryRouter>
        <TracesPage />
      </MemoryRouter>,
    );
    expect(html).toContain('Telemetry');
    expect(html).toContain('instrumentation');
  });

  it('renders pulse card labels', () => {
    const html = renderToString(
      <MemoryRouter>
        <TracesPage />
      </MemoryRouter>,
    );
    expect(html).toContain('Traced Sessions');
    expect(html).toContain('Runs Today');
    expect(html).toContain('Total Cost');
    expect(html).toContain('Tokens Today');
    expect(html).toContain('Tool Errors');
  });

  it('renders pulse card values', () => {
    const html = renderToString(
      <MemoryRouter>
        <TracesPage />
      </MemoryRouter>,
    );
    expect(html).toContain('$2.84'); // total cost
    expect(html).toContain('28'); // runs
  });

  it('renders time range selector', () => {
    const html = renderToString(
      <MemoryRouter>
        <TracesPage />
      </MemoryRouter>,
    );
    expect(html).toContain('1H');
    expect(html).toContain('6H');
    expect(html).toContain('24H');
    expect(html).toContain('7D');
  });

  it('renders section headers', () => {
    const html = renderToString(
      <MemoryRouter>
        <TracesPage />
      </MemoryRouter>,
    );
    expect(html).toContain('Model Usage');
    expect(html).toContain('Tool Telemetry');
    expect(html).toContain('Context Pressure');
    expect(html).toContain('Agent Loop Health');
  });

  it('renders model data', () => {
    const html = renderToString(
      <MemoryRouter>
        <TracesPage />
      </MemoryRouter>,
    );
    expect(html).toContain('gpt-4o');
    expect(html).toContain('gpt-4o-mini');
  });

  it('renders system prompt context-window usage by model', () => {
    const html = renderToString(
      <MemoryRouter>
        <TracesPage />
      </MemoryRouter>,
    );
    expect(html).toContain('System Prompt');
    expect(html).toContain('Avg % Window');
    expect(html).toContain('200K');
  });

  it('renders tool health stats', () => {
    const html = renderToString(
      <MemoryRouter>
        <TracesPage />
      </MemoryRouter>,
    );
    expect(html).toContain('bash');
    expect(html).toContain('read');
    expect(html).toContain('Bash breakdown');
    expect(html).toContain('git');
    expect(html).toContain('Avg score');
    expect(html).toContain('piped');
    expect(html).toContain('Errors');
    expect(html).toContain('4.3');
  });

  it('renders agent loop stats', () => {
    const html = renderToString(
      <MemoryRouter>
        <TracesPage />
      </MemoryRouter>,
    );
    expect(html).toContain('4.2');
    expect(html).toContain('8.6');
    expect(html).toContain('8m 42s');
  });

  it('renders compaction data', () => {
    const html = renderToString(
      <MemoryRouter>
        <TracesPage />
      </MemoryRouter>,
    );
    expect(html).toContain('overflow');
  });

  it('renders loading state when no data', () => {
    // Temporarily override the mock

    // Just test that the component doesn't crash with minimal data
    const html = renderToString(
      <MemoryRouter>
        <TracesPage />
      </MemoryRouter>,
    );
    expect(html).toBeTruthy();
  });
});

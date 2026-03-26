import React from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CodexPlanUsageSummary } from './CodexPlanUsageSummary.js';

(globalThis as typeof globalThis & { React?: typeof React }).React = React;

describe('CodexPlanUsageSummary', () => {
  it('renders compact usage indicators for codex oauth accounts', () => {
    const html = renderToString(
      <CodexPlanUsageSummary
        loading={false}
        refreshing={false}
        usage={{
          available: true,
          planType: 'Pro',
          fiveHour: {
            remainingPercent: 89,
            usedPercent: 11,
            windowMinutes: 300,
            resetsAt: '2026-03-26T15:18:00.000Z',
          },
          weekly: {
            remainingPercent: 87,
            usedPercent: 13,
            windowMinutes: 10_080,
            resetsAt: '2026-04-01T19:02:00.000Z',
          },
          credits: {
            hasCredits: true,
            unlimited: false,
            balance: '188',
          },
          updatedAt: '2026-03-26T12:00:00.000Z',
          error: null,
        }}
      />,
    );

    expect(html).toContain('Codex plan usage');
    expect(html).toContain('89%');
    expect(html).toContain('87%');
    expect(html).toContain('188');
    expect(html).toContain('Weekly');
  });

  it('renders nothing when codex usage is unavailable', () => {
    const html = renderToString(
      <CodexPlanUsageSummary
        loading={false}
        refreshing={false}
        usage={{
          available: false,
          planType: null,
          fiveHour: null,
          weekly: null,
          credits: null,
          updatedAt: null,
          error: null,
        }}
      />,
    );

    expect(html).toBe('');
  });
});

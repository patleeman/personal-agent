import { describe, expect, it } from 'vitest';

import type { MessageBlock } from '../../shared/types';
import { buildToolPreview, collectTraceClusterLinkedRuns, normalizeRunLabel, readLinkedRuns } from './linkedRuns.js';

function runToolBlock(overrides: Partial<Extract<MessageBlock, { type: 'tool_use' }>>): Extract<MessageBlock, { type: 'tool_use' }> {
  return {
    type: 'tool_use',
    ts: '2026-04-26T00:00:00.000Z',
    tool: 'run',
    input: {},
    output: '',
    ...overrides,
  };
}

describe('linkedRuns', () => {
  it('normalizes labels for stable comparisons', () => {
    expect(normalizeRunLabel('Background_Run  Thing')).toBe('background run thing');
  });

  it('builds compact previews for run tool actions', () => {
    expect(buildToolPreview(runToolBlock({ details: { action: 'list' } }))).toBe('list background work');
    expect(buildToolPreview(runToolBlock({ details: { action: 'logs', runId: 'run-debug-router-abc123' } }))).toBe('logs Debug router');
    expect(buildToolPreview(runToolBlock({ details: { action: 'start_agent', prompt: '# Fix architecture\n\nPlease do it' } }))).toBe(
      'start_agent Fix architecture',
    );
  });

  it('builds useful previews for object-valued tool commands', () => {
    expect(
      buildToolPreview({
        type: 'tool_use',
        ts: '2026-04-26T00:00:00.000Z',
        tool: 'browser_cdp',
        input: { command: { method: 'Page.navigate', params: { url: 'https://excalidraw.com/' } } },
        output: '',
      }),
    ).toBe('Page.navigate excalidraw.com/');

    expect(
      buildToolPreview({
        type: 'tool_use',
        ts: '2026-04-26T00:00:00.000Z',
        tool: 'browser_cdp',
        input: { command: [{ method: 'Runtime.evaluate' }, { method: 'DOM.getDocument' }] },
        output: '',
      }),
    ).toBe('Runtime.evaluate, DOM.getDocument');
  });

  it('presents listed durable runs with kind and status detail', () => {
    const linkedRuns = readLinkedRuns(
      runToolBlock({
        details: {
          action: 'list',
          runs: [
            { runId: 'run-chat-cleanup-abc123', status: 'running', kind: 'background-run' },
            { runId: 'task-nightly-review', status: 'queued', source: 'scheduled-task' },
            { runId: 'run-chat-cleanup-abc123', status: 'running', kind: 'background-run' },
          ],
        },
      }),
    );

    expect(linkedRuns).toEqual({
      scope: 'listed',
      runs: [
        { runId: 'run-chat-cleanup-abc123', title: 'Chat cleanup', detail: 'running · background task' },
        { runId: 'task-nightly-review', title: 'Nightly review', detail: 'queued · automation execution' },
      ],
    });
  });

  it('presents non-list run actions from detail fields', () => {
    const linkedRuns = readLinkedRuns(
      runToolBlock({
        status: 'running',
        details: {
          action: 'start_agent',
          runId: 'run-architecture-pass-abc123',
          prompt: 'Improve the chat architecture by extracting linked runs.',
          taskSlug: 'architecture-pass',
          cwd: '/Users/patrick/workingdir/personal-agent',
          model: 'openai/gpt-5.1',
        },
      }),
    );

    expect(linkedRuns.scope).toBe('mentioned');
    expect(linkedRuns.runs).toEqual([
      {
        runId: 'run-architecture-pass-abc123',
        title: 'Improve the chat architecture by extracting linked runs.',
        detail: 'running · agent task · architecture-pass · cwd personal-agent · gpt-5.1',
      },
    ]);
  });

  it('falls back to durable run ids mentioned in generic tool blocks', () => {
    const linkedRuns = readLinkedRuns({
      type: 'tool_use',
      ts: '2026-04-26T00:00:00.000Z',
      tool: 'bash',
      input: { command: 'echo run-foo-bar-abc123' },
      output: 'started run-foo-bar-abc123',
    });

    expect(linkedRuns).toEqual({
      scope: 'mentioned',
      runs: [{ runId: 'run-foo-bar-abc123', title: 'Foo bar', detail: 'background task' }],
    });
  });

  it('does not render linked run cards for background shell tool calls', () => {
    const startBlock: Extract<MessageBlock, { type: 'tool_use' }> = {
      type: 'tool_use',
      ts: '2026-04-26T00:00:00.000Z',
      tool: 'bash',
      input: { command: 'npm run desktop:dev', background: true },
      output: 'Started background command run-desktop-dev-abc123 for desktop-dev.',
      details: { action: 'start', runId: 'run-desktop-dev-abc123' },
    };
    const inspectBlock: Extract<MessageBlock, { type: 'tool_use' }> = {
      type: 'tool_use',
      ts: '2026-04-26T00:00:00.000Z',
      tool: 'background_command',
      input: { action: 'logs', runId: 'run-desktop-dev-abc123' },
      output: 'Run logs: run-desktop-dev-abc123',
      details: { action: 'logs', runId: 'run-desktop-dev-abc123' },
    };

    expect(readLinkedRuns(startBlock)).toEqual({ scope: 'mentioned', runs: [] });
    expect(readLinkedRuns(inspectBlock)).toEqual({ scope: 'mentioned', runs: [] });
    expect(collectTraceClusterLinkedRuns([startBlock, inspectBlock])).toEqual([]);
  });

  it('collects trace cluster linked runs from newest to oldest without duplicates', () => {
    const older = runToolBlock({ details: { action: 'logs', runId: 'run-old-cleanup-abc123' } });
    const newer = runToolBlock({ details: { action: 'logs', runId: 'run-new-cleanup-def456' } });
    const duplicateOlder = runToolBlock({ details: { action: 'logs', runId: 'run-old-cleanup-abc123' } });

    expect(
      collectTraceClusterLinkedRuns([older, { type: 'thinking', ts: '2026-04-26T00:00:00.000Z', text: 'thinking' }, newer, duplicateOlder]),
    ).toEqual([
      { runId: 'run-old-cleanup-abc123', title: 'Old cleanup', detail: 'log view' },
      { runId: 'run-new-cleanup-def456', title: 'New cleanup', detail: 'log view' },
    ]);
  });

  it('does not promote bulk run list results to trace cluster linked cards', () => {
    const listRuns = runToolBlock({
      details: {
        action: 'list',
        runs: [
          { runId: 'run-old-cleanup-abc123', status: 'completed', kind: 'background-run' },
          { runId: 'run-new-cleanup-def456', status: 'running', kind: 'background-run' },
        ],
      },
    });
    const activeRun = runToolBlock({ details: { action: 'logs', runId: 'run-new-cleanup-def456' } });

    expect(collectTraceClusterLinkedRuns([listRuns, activeRun])).toEqual([
      { runId: 'run-new-cleanup-def456', title: 'New cleanup', detail: 'log view' },
    ]);
  });
});

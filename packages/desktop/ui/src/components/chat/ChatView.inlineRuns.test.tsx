// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppDataContext } from '../../app/contexts';
import type { DurableRunRecord, MessageBlock } from '../../shared/types';
import { ChatView } from './ChatView';

const apiMocks = vi.hoisted(() => ({
  durableRun: vi.fn(),
  durableRunLog: vi.fn(),
}));

vi.mock('../../client/api', () => ({
  api: apiMocks,
}));

const RUN_ID = 'run-ui-preview-check-2026-03-25T00-53-25-347Z-903aa31b';
const mountedRoots: Root[] = [];

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

function createRunRecord(): DurableRunRecord {
  return {
    runId: RUN_ID,
    paths: {
      root: `/tmp/runs/${RUN_ID}`,
      manifestPath: `/tmp/runs/${RUN_ID}/manifest.json`,
      statusPath: `/tmp/runs/${RUN_ID}/status.json`,
      checkpointPath: `/tmp/runs/${RUN_ID}/checkpoint.json`,
      eventsPath: `/tmp/runs/${RUN_ID}/events.jsonl`,
      outputLogPath: `/tmp/runs/${RUN_ID}/output.log`,
      resultPath: `/tmp/runs/${RUN_ID}/result.json`,
    },
    manifest: {
      version: 1,
      id: RUN_ID,
      kind: 'background-run',
      resumePolicy: 'continue',
      createdAt: '2026-04-14T01:23:19.371Z',
      spec: {
        metadata: {
          taskSlug: 'ui-preview-check',
        },
      },
      source: {
        type: 'tool',
        id: 'conv-123',
      },
    },
    status: {
      version: 1,
      runId: RUN_ID,
      status: 'running',
      createdAt: '2026-04-14T01:23:19.371Z',
      updatedAt: '2026-04-14T01:24:01.000Z',
      activeAttempt: 1,
      startedAt: '2026-04-14T01:23:19.900Z',
    },
    problems: [],
    recoveryAction: 'none',
  };
}

function createMessages(): MessageBlock[] {
  return [
    {
      type: 'tool_use',
      ts: '2026-03-11T18:00:00.000Z',
      tool: 'run',
      input: {
        action: 'start_agent',
        prompt: 'Inspect git diff',
      },
      output: `Started durable agent run ${RUN_ID} for ui-preview-check.`,
      status: 'ok',
      details: {
        action: 'start_agent',
        runId: RUN_ID,
        prompt: 'Inspect git diff',
        status: 'running',
      },
    },
    {
      type: 'text',
      ts: '2026-03-11T18:00:01.000Z',
      text: 'Keeping an eye on that background run.',
    },
    {
      type: 'tool_use',
      ts: '2026-03-11T18:00:02.000Z',
      tool: 'bash',
      input: {
        command: `echo ${RUN_ID}`,
      },
      output: RUN_ID,
      status: 'ok',
    },
  ];
}

function renderChatView(messages: MessageBlock[], options?: { listedRuns?: DurableRunRecord[] }) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const listedRuns = options?.listedRuns ?? [createRunRecord()];

  act(() => {
    root.render(
      <AppDataContext.Provider
        value={{
          projects: null,
          sessions: null,
          tasks: null,
          runs: {
            scannedAt: '2026-03-11T18:00:10.000Z',
            runsRoot: '/tmp/runs',
            summary: {
              total: listedRuns.length,
              recoveryActions: {},
              statuses: listedRuns.length > 0 ? { running: listedRuns.length } : {},
            },
            runs: listedRuns,
          },
          setProjects: () => {},
          setSessions: () => {},
          setTasks: () => {},
          setRuns: () => {},
        }}
      >
        <ChatView messages={messages} isStreaming={false} />
      </AppDataContext.Provider>,
    );
  });

  mountedRoots.push(root);
  return { container, root };
}

function findInlineRunButtons(container: HTMLElement): HTMLButtonElement[] {
  return Array.from(container.querySelectorAll('button[aria-expanded]'))
    .filter((button): button is HTMLButtonElement => button instanceof HTMLButtonElement)
    .filter((button) => button.textContent?.includes('ui-preview-check') ?? false);
}

async function flushAsyncWork() {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => window.setTimeout(resolve, 0));
}

describe('ChatView inline run cards', () => {
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    apiMocks.durableRun.mockReset();
    apiMocks.durableRunLog.mockReset();
    apiMocks.durableRun.mockResolvedValue({
      scannedAt: '2026-03-11T18:00:10.000Z',
      runsRoot: '/tmp/runs',
      run: createRunRecord(),
    });
    apiMocks.durableRunLog.mockResolvedValue({
      path: `/tmp/runs/${RUN_ID}/output.log`,
      log: 'ok',
    });

    if (!window.requestAnimationFrame) {
      window.requestAnimationFrame = ((callback: FrameRequestCallback) =>
        window.setTimeout(() => callback(performance.now()), 0)) as typeof window.requestAnimationFrame;
    }
    if (!window.cancelAnimationFrame) {
      window.cancelAnimationFrame = ((handle: number) => window.clearTimeout(handle)) as typeof window.cancelAnimationFrame;
    }
  });

  afterEach(() => {
    for (const root of mountedRoots.splice(0)) {
      act(() => {
        root.unmount();
      });
    }
    document.body.innerHTML = '';
  });

  it.skip('keeps repeated linked runs collapsed until the specific card is expanded', async () => {
    const { container } = renderChatView(createMessages());

    expect(apiMocks.durableRun).not.toHaveBeenCalled();
    expect(apiMocks.durableRunLog).not.toHaveBeenCalled();

    let runButtons = findInlineRunButtons(container);
    expect(runButtons).toHaveLength(2);
    expect(runButtons[0]?.getAttribute('aria-expanded')).toBe('false');
    expect(runButtons[1]?.getAttribute('aria-expanded')).toBe('false');
    expect(container.textContent).not.toContain('Polling live log');

    await act(async () => {
      runButtons[0]?.click();
      await flushAsyncWork();
    });

    runButtons = findInlineRunButtons(container);
    expect(runButtons).toHaveLength(2);
    expect(runButtons[0]?.getAttribute('aria-expanded')).toBe('true');
    expect(runButtons[1]?.getAttribute('aria-expanded')).toBe('false');
    expect(apiMocks.durableRun).toHaveBeenCalledTimes(1);
    expect(apiMocks.durableRun).toHaveBeenCalledWith(RUN_ID);
    expect(apiMocks.durableRunLog).toHaveBeenCalledTimes(1);
    expect(apiMocks.durableRunLog).toHaveBeenCalledWith(RUN_ID, 240);
    expect(container.textContent).toContain('Polling live log');
  });

  it.skip('shows a friendly unavailable state when a linked run record cannot be loaded', async () => {
    apiMocks.durableRun.mockRejectedValue(
      new Error("Error invoking remote method 'personal-agent-desktop:read-durable-run': Error: Run not found"),
    );
    apiMocks.durableRunLog.mockRejectedValue(new Error('Run not found'));

    const { container } = renderChatView(createMessages());
    const runButtons = findInlineRunButtons(container);

    await act(async () => {
      runButtons[0]?.click();
      await flushAsyncWork();
    });

    expect(apiMocks.durableRun).toHaveBeenCalledWith(RUN_ID);
    expect(container.textContent).toContain('Run record unavailable');
    expect(container.textContent).toContain('This linked task may have been cleaned up or belongs to an older dev session.');
    expect(container.textContent).not.toContain('Error invoking remote method');
  });

  it('collapses raw delivered run callbacks into a clickable run card', async () => {
    const { container } = renderChatView([
      {
        type: 'text',
        ts: '2026-03-11T18:00:00.000Z',
        text: [
          `Durable run ${RUN_ID} has finished.`,
          'taskSlug=ui-preview-check',
          'status=completed',
          `log=/tmp/runs/${RUN_ID}/output.log`,
          'command=npm test',
          '',
          'Recent log tail:',
          'very noisy callback output',
        ].join('\n'),
      },
    ]);

    expect(container.textContent).toContain('Background work finished.');
    expect(container.textContent).toContain('ui-preview-check');
    expect(container.textContent).not.toContain('very noisy callback output');
    expect(apiMocks.durableRun).not.toHaveBeenCalled();

    const runButtons = findInlineRunButtons(container);
    expect(runButtons).toHaveLength(1);
    expect(runButtons[0]?.getAttribute('aria-expanded')).toBe('false');

    await act(async () => {
      runButtons[0]?.click();
      await flushAsyncWork();
    });

    expect(apiMocks.durableRun).toHaveBeenCalledWith(RUN_ID);
    expect(apiMocks.durableRunLog).toHaveBeenCalledWith(RUN_ID, 240);
    expect(container.textContent).toContain('Polling live log');
  });

  it('collapses raw run callback user messages into a clickable run card', async () => {
    const { container } = renderChatView([
      {
        type: 'user',
        ts: '2026-03-11T18:00:00.000Z',
        text: [
          `Background task ${RUN_ID} has finished.`,
          'taskSlug=ui-preview-check',
          'status=completed',
          `log=/tmp/runs/${RUN_ID}/output.log`,
          'command=npm test',
          '',
          'Recent log tail:',
          'very noisy callback output',
          '',
          'Use run get/logs if you need more detail. Then continue from this point.',
        ].join('\n'),
      },
    ]);

    expect(container.textContent).toContain('Background work finished.');
    expect(container.textContent).toContain('ui-preview-check');
    expect(container.textContent).not.toContain('very noisy callback output');
    expect(container.textContent).not.toContain('/tmp/runs/');

    const runButtons = findInlineRunButtons(container);
    expect(runButtons).toHaveLength(1);

    await act(async () => {
      runButtons[0]?.click();
      await flushAsyncWork();
    });

    expect(apiMocks.durableRun).toHaveBeenCalledWith(RUN_ID);
    expect(apiMocks.durableRunLog).toHaveBeenCalledWith(RUN_ID, 240);
  });

  it('collapses raw run callback context blocks into a clickable run card', async () => {
    const { container } = renderChatView([
      {
        type: 'context',
        ts: '2026-03-11T18:00:00.000Z',
        customType: 'referenced_context',
        text: [
          `Background task ${RUN_ID} has finished.`,
          'taskSlug=ui-preview-check',
          'status=failed',
          `log=/tmp/runs/${RUN_ID}/output.log`,
          'command=npm test',
          '',
          'Recent log tail:',
          'very noisy callback output',
        ].join('\n'),
      },
    ]);

    expect(container.textContent).toContain('Background work finished.');
    expect(container.textContent).toContain('ui-preview-check');
    expect(container.textContent).not.toContain('very noisy callback output');

    const runButtons = findInlineRunButtons(container);
    expect(runButtons).toHaveLength(1);

    await act(async () => {
      runButtons[0]?.click();
      await flushAsyncWork();
    });

    expect(apiMocks.durableRun).toHaveBeenCalledWith(RUN_ID);
    expect(apiMocks.durableRunLog).toHaveBeenCalledWith(RUN_ID, 240);
  });
});

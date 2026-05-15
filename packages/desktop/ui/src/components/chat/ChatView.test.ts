import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppDataContext } from '../../app/contexts.js';
import { ChatView } from './ChatView.js';

(globalThis as typeof globalThis & { React?: typeof React }).React = React;

afterEach(() => {
  vi.useRealTimers();
});

function renderAssistantText(
  text: string,
  options?: {
    onOpenFilePath?: (path: string) => void;
    onOpenCheckpoint?: (checkpointId: string) => void;
  },
) {
  return renderToStaticMarkup(
    createElement(ChatView, {
      messages: [
        {
          type: 'text',
          ts: '2026-03-11T18:00:00.000Z',
          text,
        },
      ],
      onOpenFilePath: options?.onOpenFilePath,
      onOpenCheckpoint: options?.onOpenCheckpoint,
    }),
  );
}

describe('chat view streaming disclosure', () => {
  it('auto-opens running tool blocks inside internal-work clusters', () => {
    const html = renderToStaticMarkup(
      createElement(ChatView, {
        messages: [
          {
            type: 'tool_use',
            ts: '2026-03-11T18:00:00.000Z',
            tool: 'bash',
            input: { command: 'sleep 1' },
            output: '',
            status: 'running',
          },
        ],
        isStreaming: true,
      }),
    );

    expect(html).toContain('Working');
    expect(html).toContain('running…');
    expect(html).toContain('>input<');
  });

  it('only auto-opens the tail thinking block while the stream is active', () => {
    const tailHtml = renderToStaticMarkup(
      createElement(ChatView, {
        messages: [
          {
            type: 'thinking',
            ts: '2026-03-11T18:00:00.000Z',
            text: 'Working through the request…\nSecond line stays hidden unless the block opens.',
          },
        ],
        isStreaming: true,
      }),
    );
    const nonTailHtml = renderToStaticMarkup(
      createElement(ChatView, {
        messages: [
          {
            type: 'thinking',
            ts: '2026-03-11T18:00:00.000Z',
            text: 'Working through the request…\nSecond line stays hidden unless the block opens.',
          },
          {
            type: 'tool_use',
            ts: '2026-03-11T18:00:01.000Z',
            tool: 'bash',
            input: { command: 'pwd' },
            output: '/repo',
            status: 'ok',
          },
        ],
        isStreaming: true,
      }),
    );

    expect(tailHtml).toContain('Second line stays hidden unless the block opens.');
    expect(nonTailHtml).not.toContain('Second line stays hidden unless the block opens.');
  });

  it('derives the live status label from the current tail block in the rendered chat view', () => {
    const workingHtml = renderToStaticMarkup(createElement(ChatView, { messages: [], isStreaming: true }));
    const thinkingHtml = renderToStaticMarkup(
      createElement(ChatView, {
        messages: [{ type: 'thinking', ts: '2026-03-11T18:00:00.000Z', text: 'Working through the request…' }],
        isStreaming: true,
      }),
    );
    const toolHtml = renderToStaticMarkup(
      createElement(ChatView, {
        messages: [
          {
            type: 'tool_use',
            ts: '2026-03-11T18:00:00.000Z',
            tool: 'bash',
            input: { command: 'sleep 1' },
            output: '',
            status: 'running',
          },
        ],
        isStreaming: true,
      }),
    );
    const textHtml = renderToStaticMarkup(
      createElement(ChatView, {
        messages: [{ type: 'text', ts: '2026-03-11T18:00:00.000Z', text: 'Half-finished response' }],
        isStreaming: true,
      }),
    );

    expect(workingHtml).toContain('Working…');
    expect(thinkingHtml).toContain('Working');
    expect(thinkingHtml).toContain('>Thinking<');
    expect(toolHtml).toContain('Working');
    expect(toolHtml).toContain('running…');
    expect(textHtml).toContain('animation:cursorBlink');
  });

  it('renders a pending status indicator immediately even before live streaming starts', () => {
    const html = renderToStaticMarkup(
      createElement(ChatView, {
        messages: [{ type: 'text', ts: '2026-03-11T18:00:00.000Z', text: 'Most recent assistant reply' }],
        pendingStatusLabel: 'Resuming…',
        isStreaming: false,
      }),
    );

    expect(html).toContain('Resuming…');
  });

  it('renders the compaction status indicator even when the latest block is from the assistant', () => {
    const html = renderToStaticMarkup(
      createElement(ChatView, {
        messages: [{ type: 'text', ts: '2026-03-11T18:00:00.000Z', text: 'Most recent assistant reply' }],
        isCompacting: true,
        isStreaming: false,
      }),
    );

    expect(html).toContain('Compacting context…');
  });

  it('auto-opens the internal-work cluster while live or when a running step remains', () => {
    const liveHtml = renderToStaticMarkup(
      createElement(ChatView, {
        messages: [{ type: 'thinking', ts: '2026-03-11T18:00:00.000Z', text: 'Thinking…' }],
        isStreaming: true,
      }),
    );
    const runningHtml = renderToStaticMarkup(
      createElement(ChatView, {
        messages: [
          {
            type: 'tool_use',
            ts: '2026-03-11T18:00:00.000Z',
            tool: 'bash',
            input: { command: 'sleep 1' },
            output: '',
            status: 'running',
          },
        ],
        isStreaming: false,
      }),
    );
    const idleHtml = renderToStaticMarkup(
      createElement(ChatView, {
        messages: [{ type: 'thinking', ts: '2026-03-11T18:00:00.000Z', text: 'Thinking…' }],
        isStreaming: false,
      }),
    );

    expect(liveHtml).toContain('▲ hide');
    expect(runningHtml).toContain('▲ hide');
    expect(idleHtml).toContain('▼ show');
  });

  it('renders rich markdown structures in assistant messages', () => {
    const html = renderAssistantText(
      [
        '# Preview title',
        '',
        'Paragraph with **bold**, `inline code`, and a [link](https://example.com).',
        '',
        '- Bullet one',
        '  - Nested bullet',
        '',
        '> Quoted note',
        '',
        '| A | B |',
        '| --- | --- |',
        '| 1 | 2 |',
        '',
        '```ts',
        'const value = 1;',
        '```',
      ].join('\n'),
    );

    expect(html).toContain('<h1');
    expect(html).toContain('<ul');
    expect(html).toContain('<blockquote');
    expect(html).toContain('<table');
    expect(html).toContain('my-3 min-w-0 max-w-full overflow-x-auto');
    expect(html).toContain('<pre');
    expect(html).toContain('href="https://example.com"');
    expect(html).not.toContain('Copy code block');
    expect(html).not.toContain('ui-markdown-code-copy');
  });

  it('does not auto-link file paths inside assistant message text', () => {
    const html = renderAssistantText(
      [
        'Touch packages/desktop/ui/src/app/App.tsx next.',
        '',
        '`packages/desktop/ui/src/app/main.tsx`',
        '',
        '[relative file](packages/desktop/ui/src/content/latexArtifacts.ts)',
      ].join('\n'),
      { onOpenFilePath: () => undefined },
    );

    expect(html).toContain('packages/desktop/ui/src/app/App.tsx');
    expect(html).toContain('packages/desktop/ui/src/app/main.tsx');
    expect(html).toContain('relative file');
    expect(html).not.toContain('data-file-path-link=');
    expect(html).not.toContain('role="button"');
    expect(html).not.toContain('href="packages/desktop/ui/src/content/latexArtifacts.ts"');
  });

  it('renders commit hashes as clickable transcript controls when a checkpoint opener is available', () => {
    const html = renderAssistantText('Checkpoint saved: `93f02a21` and plain 93f02a21.', { onOpenCheckpoint: () => undefined });

    expect(html).toContain('aria-label="Open diff for commit 93f02a21"');
    expect(html.match(/Open diff for commit 93f02a21/g)).toHaveLength(2);
    expect(html).toContain('type="button"');
  });

  it('renders project mentions as pills inside markdown text', () => {
    const html = renderAssistantText('Check @desktop-ui before touching @projects.');

    expect(html).toContain('@desktop-ui');
    expect(html).toContain('@projects');
    expect(html).toContain('ui-markdown-mention');
  });

  it('does not turn email addresses into mention pills', () => {
    const html = renderAssistantText('Email user@example.com and ping @desktop-ui for follow-up.');

    expect(html).toContain('user@example.com');
    expect(html.match(/ui-markdown-mention/g)).toHaveLength(1);
  });

  it('renders vault file mentions as a single pill', () => {
    const html = renderAssistantText('Open @notes/reference/INDEX.md before editing.');

    expect(html).toContain('@notes/reference/INDEX.md');
    expect(html.match(/ui-markdown-mention/g)).toHaveLength(1);
  });

  it('renders markdown formatting in user messages', () => {
    const html = renderToStaticMarkup(
      createElement(ChatView, {
        messages: [
          {
            type: 'user',
            ts: '2026-03-11T18:00:00.000Z',
            text: '# Checklist\n\n- **One**\n- `Two`',
          },
        ],
      }),
    );

    expect(html).toContain('<h1');
    expect(html).toContain('<ul');
    expect(html).toContain('<strong>One</strong>');
    expect(html).toContain('<code');
  });

  it('renders transcript images as inspectable buttons', () => {
    const html = renderToStaticMarkup(
      createElement(ChatView, {
        messages: [
          {
            type: 'image',
            ts: '2026-03-11T18:00:00.000Z',
            alt: 'Build screenshot',
            caption: 'Latest desktop build',
            src: 'data:image/png;base64,abc123',
          },
        ],
      }),
    );

    expect(html).toContain('Inspect image');
    expect(html).toContain('aria-label="Inspect image: Latest desktop build"');
    expect(html).toContain('cursor-zoom-in');
  });

  it('renders user attachment images as inspectable buttons', () => {
    const html = renderToStaticMarkup(
      createElement(ChatView, {
        messages: [
          {
            type: 'user',
            ts: '2026-03-11T18:00:00.000Z',
            text: '',
            images: [
              {
                alt: 'Shared screenshot',
                caption: 'Before refactor',
                src: 'data:image/png;base64,xyz789',
              },
            ],
          },
        ],
      }),
    );

    expect(html).toContain('Inspect image');
    expect(html).toContain('aria-label="Inspect image: Before refactor"');
    expect(html).toContain('cursor-zoom-in');
  });

  it('does not render background task cards for plain run id mentions', () => {
    const html = renderToStaticMarkup(
      createElement(ChatView, {
        messages: [
          {
            type: 'tool_use',
            ts: '2026-03-11T18:00:00.000Z',
            tool: 'bash',
            input: { command: 'npm --prefix packages/desktop run start' },
            output: 'Inspect runId=run-continuous-conversations-next-chunk-ui-2026-03-25T00-53-25-347Z-903aa31b',
            status: 'running',
          },
        ],
        isStreaming: true,
      }),
    );

    expect(html).not.toContain('Background task: Continuous conversations next chunk ui');
    expect(html).not.toContain('Background task mentioned by this step');
    expect(html).not.toContain('background task mentioned in this step');
  });

  it('shows run tool previews and linked run metadata for started agent runs', () => {
    const html = renderToStaticMarkup(
      createElement(ChatView, {
        messages: [
          {
            type: 'tool_use',
            ts: '2026-03-11T18:00:00.000Z',
            tool: 'run',
            input: {
              action: 'start_agent',
              taskSlug: 'ui-polish',
              prompt: 'Inspect git diff',
              cwd: '/Users/patrick/workingdir/personal-agent',
            },
            output: 'Started durable agent run run-ui-polish-2026-03-25T00-53-25-347Z-903aa31b for ui-polish.',
            status: 'running',
            details: {
              action: 'start_agent',
              runId: 'run-ui-polish-2026-03-25T00-53-25-347Z-903aa31b',
              taskSlug: 'ui-polish',
              cwd: '/Users/patrick/workingdir/personal-agent',
              model: 'openai-codex/gpt-5.4',
            },
          },
        ],
        isStreaming: true,
      }),
    );

    expect(html).toContain('start_agent Inspect git diff');
    expect(html).toContain('Inspect git diff');
    expect(html).toContain('agent task');
    expect(html).toContain('ui-polish');
    expect(html).toContain('cwd personal-agent');
    expect(html).toContain('gpt-5.4');
  });

  it('uses run tool input context even when the persisted step lacks structured run details', () => {
    const html = renderToStaticMarkup(
      createElement(ChatView, {
        messages: [
          {
            type: 'tool_use',
            ts: '2026-03-11T18:00:00.000Z',
            tool: 'run',
            input: {
              action: 'start',
              taskSlug: 'ui-preview-check',
              command: 'printf ok',
              cwd: '/Users/patrick/workingdir/personal-agent',
            },
            output: 'Started durable run run-ui-preview-check-2026-03-25T00-53-25-347Z-903aa31b for ui-preview-check.',
            status: 'running',
          },
        ],
        isStreaming: true,
      }),
    );

    expect(html).toContain('start printf ok');
    expect(html).toContain('printf ok');
    expect(html).toContain('background command');
    expect(html).toContain('ui-preview-check');
    expect(html).toContain('cwd personal-agent');
  });

  it('does not surface linked run cards as separate internal-work cluster shelf content', () => {
    const html = renderToStaticMarkup(
      createElement(ChatView, {
        messages: [
          {
            type: 'tool_use',
            ts: '2026-03-11T18:00:00.000Z',
            tool: 'run',
            input: {
              action: 'start_agent',
              prompt: 'Inspect git diff',
            },
            output: 'Started durable agent run run-ui-polish-2026-03-25T00-53-25-347Z-903aa31b for ui-polish.',
            status: 'ok',
            details: {
              action: 'start_agent',
              runId: 'run-ui-polish-2026-03-25T00-53-25-347Z-903aa31b',
              prompt: 'Inspect git diff',
              status: 'running',
            },
          },
        ],
        isStreaming: false,
      }),
    );

    expect(html).toContain('Internal work');
    expect(html).not.toContain('related background work');
    expect(html).not.toContain('background task mentioned in this step');
    expect(html).not.toContain('show details');
  });

  it('resolves legacy linked run ids to current durable run records using task slug', () => {
    const html = renderToStaticMarkup(
      createElement(
        AppDataContext.Provider,
        {
          value: {
            projects: null,
            sessions: null,
            tasks: null,
            runs: {
              scannedAt: '2026-03-11T18:00:10.000Z',
              runsRoot: '/tmp/runs',
              summary: {
                total: 1,
                recoveryActions: {},
                statuses: { running: 1 },
              },
              runs: [
                {
                  runId: 'run-f1844efc-3748-49f9-aa62-d625fd1ccbe9-2026-04-14T01-23-19-371Z-3f40e1b4',
                  paths: {
                    root: '/tmp/runs/run-f1844efc-3748-49f9-aa62-d625fd1ccbe9-2026-04-14T01-23-19-371Z-3f40e1b4',
                    manifestPath: '/tmp/runs/run-f1844efc-3748-49f9-aa62-d625fd1ccbe9-2026-04-14T01-23-19-371Z-3f40e1b4/manifest.json',
                    statusPath: '/tmp/runs/run-f1844efc-3748-49f9-aa62-d625fd1ccbe9-2026-04-14T01-23-19-371Z-3f40e1b4/status.json',
                    checkpointPath: '/tmp/runs/run-f1844efc-3748-49f9-aa62-d625fd1ccbe9-2026-04-14T01-23-19-371Z-3f40e1b4/checkpoint.json',
                    eventsPath: '/tmp/runs/run-f1844efc-3748-49f9-aa62-d625fd1ccbe9-2026-04-14T01-23-19-371Z-3f40e1b4/events.jsonl',
                    outputLogPath: '/tmp/runs/run-f1844efc-3748-49f9-aa62-d625fd1ccbe9-2026-04-14T01-23-19-371Z-3f40e1b4/output.log',
                    resultPath: '/tmp/runs/run-f1844efc-3748-49f9-aa62-d625fd1ccbe9-2026-04-14T01-23-19-371Z-3f40e1b4/result.json',
                  },
                  manifest: {
                    version: 1,
                    id: 'run-f1844efc-3748-49f9-aa62-d625fd1ccbe9-2026-04-14T01-23-19-371Z-3f40e1b4',
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
                    runId: 'run-f1844efc-3748-49f9-aa62-d625fd1ccbe9-2026-04-14T01-23-19-371Z-3f40e1b4',
                    status: 'running',
                    createdAt: '2026-04-14T01:23:19.371Z',
                    updatedAt: '2026-04-14T01:24:01.000Z',
                    activeAttempt: 1,
                    startedAt: '2026-04-14T01:23:19.900Z',
                  },
                  problems: [],
                  recoveryAction: 'none',
                },
              ],
            },
            setProjects: () => {},
            setSessions: () => {},
            setTasks: () => {},
            setRuns: () => {},
          },
        },
        createElement(ChatView, {
          messages: [
            {
              type: 'tool_use',
              ts: '2026-04-14T01:24:05.000Z',
              tool: 'bash',
              input: { command: 'echo run-ui-preview-check-2026-03-25T00-53-25-347Z-903aa31b' },
              output: 'run-ui-preview-check-2026-03-25T00-53-25-347Z-903aa31b',
              status: 'ok',
            },
          ],
          isStreaming: false,
        }),
      ),
    );

    expect(html).not.toContain('ui-preview-check');
    expect(html).not.toContain('linked Ui preview check');
  });

  it('limits listed runs in the transcript to 5 rows by default', () => {
    const listedRuns = Array.from({ length: 7 }, (_, index) => ({
      runId: `run-fix-build-${String.fromCharCode(97 + index)}-2026-03-25T00-53-25-347Z-903aa31b`,
      status: 'queued',
      kind: 'background-run',
      source: 'tool',
    }));

    const html = renderToStaticMarkup(
      createElement(ChatView, {
        messages: [
          {
            type: 'tool_use',
            ts: '2026-03-11T18:00:00.000Z',
            tool: 'run',
            input: { action: 'list' },
            output: '',
            status: 'running',
            details: {
              action: 'list',
              runCount: listedRuns.length,
              runIds: listedRuns.map((run) => run.runId),
              runs: listedRuns,
            },
          },
        ],
        isStreaming: true,
      }),
    );

    expect(html).toContain('listed executions');
    expect(html).toContain('Showing 5 of 7 executions returned by the tool.');
    expect(html).toContain('Show all');
    expect(html).toContain('Fix build a');
    expect(html).toContain('Fix build e');
    expect(html).toContain('queued · background task');
    expect(html).not.toContain('Fix build f');
    expect(html).not.toContain('Fix build g');
  });

  it('renders tool input and output as plain text without file path buttons', () => {
    const html = renderToStaticMarkup(
      createElement(ChatView, {
        messages: [
          {
            type: 'tool_use',
            ts: '2026-03-11T18:00:00.000Z',
            tool: 'bash',
            input: { command: 'cat packages/desktop/ui/src/app/App.tsx' },
            output: 'Updated packages/desktop/ui/src/app/App.tsx',
            status: 'running',
          },
        ],
        isStreaming: true,
        onOpenFilePath: () => undefined,
      }),
    );

    expect(html).toContain('cat packages/desktop/ui/src/app/App.tsx');
    expect(html).toContain('Updated packages/desktop/ui/src/app/App.tsx');
    expect(html).not.toContain('data-file-path-link=');
    expect(html).not.toContain('role="button"');
  });

  it('shows a clean preview for collapsed thinking steps inside an open internal-work cluster', () => {
    const html = renderToStaticMarkup(
      createElement(ChatView, {
        messages: [
          {
            type: 'thinking',
            ts: '2026-03-11T18:00:00.000Z',
            text: '**Investigate the render path first.**\nThen patch the collapsed header.',
          },
          {
            type: 'tool_use',
            ts: '2026-03-11T18:00:01.000Z',
            tool: 'bash',
            input: { command: 'echo done' },
            output: '',
            status: 'running',
          },
        ],
        isStreaming: true,
      }),
    );

    expect(html).toContain('Investigate the render path first.');
    expect(html).not.toContain('**Investigate the render path first.**');
    expect(html).not.toContain('Then patch the collapsed header.');
    expect(html).toContain('echo done');
  });

  it('shows only the latest 5 internal-work steps by default and summarizes older ones above', () => {
    const html = renderToStaticMarkup(
      createElement(ChatView, {
        messages: Array.from({ length: 7 }, (_, index) => ({
          type: 'tool_use' as const,
          ts: `2026-03-11T18:00:0${index}.000Z`,
          tool: 'bash',
          input: { command: `echo step-${index + 1}` },
          output: '',
          status: index === 6 ? ('running' as const) : ('ok' as const),
        })),
        isStreaming: true,
      }),
    );

    expect(html).toContain('7 steps');
    expect(html).toContain('2 earlier steps summarized above.');
    expect(html).toContain('Show all');
    expect(html).toContain('echo step-3');
    expect(html).toContain('echo step-7');
    expect(html).not.toContain('echo step-1');
    expect(html).not.toContain('echo step-2');
  });

  it('shows estimated tok/s while a thinking block is actively streaming', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-11T18:00:03.000Z'));

    const html = renderToStaticMarkup(
      createElement(ChatView, {
        messages: [
          {
            type: 'thinking',
            ts: '2026-03-11T18:00:00.000Z',
            text: 'a'.repeat(48),
          },
        ],
        isStreaming: true,
      }),
    );

    expect(html).toContain('tok/s');
    expect(html).toContain('~4.0 tok/s');
  });

  it('renders a single-item trace cluster for ask_user_question when no extension renders them', () => {
    const html = renderToStaticMarkup(
      createElement(ChatView, {
        messages: [
          {
            type: 'tool_use',
            ts: '2026-03-11T18:00:00.000Z',
            tool: 'ask_user_question',
            input: { question: 'Which environment should I use?', options: ['staging', 'prod'] },
            output: 'Asked the user 2 questions.',
            status: 'ok',
          },
        ],
        onSubmitAskUserQuestion: () => undefined,
      }),
    );

    expect(html).toContain('Internal work');
    expect(html).toContain('1 step');
  });

  it('renders pending ask_user_question tool calls as generic tool blocks in composer mode', () => {
    const html = renderToStaticMarkup(
      createElement(ChatView, {
        messages: [
          {
            type: 'tool_use',
            ts: '2026-03-11T18:00:00.000Z',
            tool: 'ask_user_question',
            input: { question: 'Which environment should I use?', options: ['staging', 'prod'] },
            output: 'Asked the user 2 questions.',
            status: 'ok',
          },
        ],
        askUserQuestionDisplayMode: 'composer',
        onSubmitAskUserQuestion: () => undefined,
      }),
    );

    expect(html).toContain('question');
  });

  it('renders check-style ask_user_question options as generic tool blocks', () => {
    const html = renderToStaticMarkup(
      createElement(ChatView, {
        messages: [
          {
            type: 'tool_use',
            ts: '2026-03-11T18:00:00.000Z',
            tool: 'ask_user_question',
            input: { question: 'Which notifications should I enable?', options: ['Email', 'Telegram'] },
            output: 'Asked the user a question.',
            status: 'ok',
          },
        ],
        onSubmitAskUserQuestion: () => undefined,
      }),
    );

    expect(html).toContain('question');
  });

  it('renders multi-question ask_user_question calls as generic tool blocks', () => {
    const html = renderToStaticMarkup(
      createElement(ChatView, {
        messages: [
          {
            type: 'tool_use',
            ts: '2026-03-11T18:00:00.000Z',
            tool: 'ask_user_question',
            input: {
              question: 'Which notifications should I enable?',
              options: ['Email', 'Telegram'],
            },
            output: 'Asked the user 2 questions.',
            status: 'ok',
          },
        ],
        onSubmitAskUserQuestion: () => undefined,
      }),
    );

    expect(html).toContain('question');
  });

  it('shows user reply after ask_user_question tool blocks', () => {
    const html = renderToStaticMarkup(
      createElement(ChatView, {
        messages: [
          {
            type: 'tool_use',
            ts: '2026-03-11T18:00:00.000Z',
            tool: 'ask_user_question',
            input: {
              question: 'Which environment should I use?',
            },
            output: 'Asked the user: Which environment should I use?',
            status: 'ok',
          },
          {
            type: 'user',
            ts: '2026-03-11T18:00:05.000Z',
            text: 'Use staging for this deploy.',
          },
        ],
      }),
    );

    expect(html).toContain('Use staging for this deploy.');
    expect(html).not.toContain('Reply in Composer');
  });

  it('renders markdown footnotes with isolated ids per message', () => {
    const html = renderToStaticMarkup(
      createElement(ChatView, {
        messages: [
          {
            type: 'text',
            ts: '2026-03-11T18:00:00.000Z',
            text: 'First answer.[^1]\n\n[^1]: Alpha reference',
          },
          {
            type: 'text',
            ts: '2026-03-11T18:01:00.000Z',
            text: 'Second answer.[^1]\n\n[^1]: Beta reference',
          },
        ],
      }),
    );

    expect(html).toContain('class="footnotes"');
    expect(html).toContain('Alpha reference');
    expect(html).toContain('Beta reference');

    const footnoteIds = Array.from(html.matchAll(/id="([^"]*fn-1)"/g), (match) => match[1]);
    expect(footnoteIds.length).toBeGreaterThanOrEqual(2);
    expect(new Set(footnoteIds).size).toBe(footnoteIds.length);
  });

  it('renders copy rewind and fork actions for user messages when available', () => {
    const html = renderToStaticMarkup(
      createElement(ChatView, {
        messages: [
          {
            type: 'user',
            ts: '2026-03-11T18:00:00.000Z',
            text: 'Try a different approach',
          },
        ],
        onRewindMessage: () => undefined,
        onForkMessage: () => undefined,
      }),
    );

    expect(html).toContain('⎘ copy');
    expect(html).toContain('↩ rewind');
    expect(html).toContain('⑂ fork');
  });

  it('renders copy rewind and fork actions for assistant messages when available', () => {
    const html = renderToStaticMarkup(
      createElement(ChatView, {
        messages: [
          {
            type: 'text',
            ts: '2026-03-11T18:00:00.000Z',
            text: 'Assistant output to branch from',
          },
        ],
        onRewindMessage: () => undefined,
        onForkMessage: () => undefined,
      }),
    );

    expect(html).toContain('⎘ copy');
    expect(html).toContain('↩ rewind');
    expect(html).toContain('⑂ fork');
  });

  it('renders a copy action for assistant messages', () => {
    const html = renderToStaticMarkup(
      createElement(ChatView, {
        messages: [
          {
            type: 'text',
            ts: '2026-03-11T18:00:00.000Z',
            text: 'Assistant output to copy',
          },
        ],
      }),
    );

    expect(html).toContain('⎘ copy');
  });

  it('uses absolute message ids when a transcript window starts mid-conversation', () => {
    const html = renderToStaticMarkup(
      createElement(ChatView, {
        messages: [
          {
            type: 'text',
            ts: '2026-03-11T18:00:00.000Z',
            text: 'Windowed conversation block',
          },
        ],
        messageIndexOffset: 7,
      }),
    );

    expect(html).toContain('id="msg-7"');
    expect(html).toContain('data-message-index="7"');
  });

  it('marks exactly one tail transcript item as the scroll anchor', () => {
    const html = renderToStaticMarkup(
      createElement(ChatView, {
        messages: [
          {
            type: 'text',
            ts: '2026-03-11T18:00:00.000Z',
            text: 'Earlier assistant message',
          },
          {
            type: 'text',
            ts: '2026-03-11T18:01:00.000Z',
            text: 'Latest assistant message',
          },
        ],
      }),
    );

    expect(html.match(/data-chat-tail="1"/g)).toHaveLength(1);
  });

  it('marks a tail trace cluster as the scroll anchor too', () => {
    const html = renderToStaticMarkup(
      createElement(ChatView, {
        messages: [
          {
            type: 'tool_use',
            ts: '2026-03-11T18:00:00.000Z',
            tool: 'bash',
            input: { command: 'echo tail' },
            output: '',
            status: 'running',
          },
        ],
        isStreaming: true,
      }),
    );

    expect(html.match(/data-chat-tail="1"/g)).toHaveLength(1);
  });

  it('renders skill invocations as disclosure cards instead of raw wrapper markup', () => {
    const html = renderToStaticMarkup(
      createElement(ChatView, {
        messages: [
          {
            type: 'user',
            ts: '2026-03-11T18:00:00.000Z',
            text: [
              '<skill name="checkpoint" location="/state/profiles/shared/agent/skills/checkpoint/INDEX.md">',
              'References are relative to /state/profiles/shared/agent/skills/checkpoint.',
              '',
              '# Checkpoint',
              '',
              "Create a focused commit for the agent's current work.",
              '</skill>',
            ].join('\n'),
          },
        ],
      }),
    );

    expect(html).toContain('checkpoint');
    expect(html).toContain('References resolve relative to /state/profiles/shared/agent/skills/checkpoint');
    expect(html).not.toContain('&lt;skill name=');
    expect(html).not.toContain('location=&quot;/state/profiles/shared/agent/skills/checkpoint/INDEX.md&quot;');
  });

  it('renders compaction summaries as system events instead of assistant bubbles', () => {
    const html = renderToStaticMarkup(
      createElement(ChatView, {
        messages: [
          {
            type: 'summary',
            ts: '2026-03-11T18:00:00.000Z',
            kind: 'compaction',
            title: 'Compaction summary',
            text: '## Goal\nKeep the compacted context visible.',
          },
        ],
      }),
    );

    expect(html).toContain('data-summary-kind="compaction"');
    expect(html).toContain('<details');
    expect(html).toContain('rounded-xl');
    expect(html).toContain('bg-surface/25');
    expect(html).toContain('Context compacted');
    expect(html).toContain('Older turns were summarized to keep the active context window focused.');
    expect(html).not.toContain('Show summary');
    expect(html).not.toContain('border-warning');
    expect(html).not.toContain('ui-chat-avatar-mark">pa<');
    expect(html).not.toContain('ui-message-card-assistant');
  });

  it('renders the system prompt as an optional collapsed transcript disclosure', () => {
    const html = renderToStaticMarkup(
      createElement(ChatView, {
        systemPrompt: 'You are Patrick’s personal agent.\nUse the repo instructions.',
        messages: [
          {
            type: 'user',
            ts: '2026-03-11T18:00:00.000Z',
            text: 'Start',
          },
        ],
      }),
    );

    expect(html).toContain('<details');
    expect(html).toContain('data-context-type="system_prompt"');
    expect(html).toContain('System prompt');
    expect(html).toContain('Runtime instructions available for inspection.');
    expect(html).toContain('You are Patrick');
    expect(html).toContain('~15 tokens');
    expect(html).toContain('rounded-xl');
    expect(html).not.toContain('Dec 31');
    expect(html).not.toContain('ui-message-card-assistant');
  });

  it('groups startup context disclosures tightly before the first user message', () => {
    const html = renderToStaticMarkup(
      createElement(ChatView, {
        systemPrompt: 'Runtime instructions.',
        messages: [
          {
            type: 'summary',
            ts: '2026-03-11T18:00:00.000Z',
            kind: 'related',
            title: 'Related conversation pointers',
            text: '1. Suggested context pointer',
            detail: '1 related conversation pointer was offered before this prompt. Inspect a conversation before relying on its details.',
          },
          {
            type: 'user',
            ts: '2026-03-11T18:00:01.000Z',
            text: 'Start',
          },
        ],
      }),
    );

    expect(html).toContain('mb-7 space-y-1.5');
    expect(html).toContain('data-context-type="system_prompt"');
    expect(html).toContain('data-summary-kind="related"');
    expect(html).toContain('Related conversation pointers');
    expect(html).toContain('~6 tokens');
    expect(html).toContain('~7 tokens');
  });

  it('renders context blocks as quiet expandable system events', () => {
    const html = renderToStaticMarkup(
      createElement(ChatView, {
        messages: [
          {
            type: 'context',
            ts: '2026-03-11T18:00:00.000Z',
            customType: 'referenced_context',
            text: 'Conversation automation context:\n\n- Review the agent reminders before stopping.',
          },
        ],
      }),
    );

    expect(html).toContain('<details');
    expect(html).toContain('rounded-xl');
    expect(html).toContain('bg-surface/25');
    expect(html).toContain('Context added');
    expect(html).toContain('data-context-type="referenced_context"');
    expect(html).toContain('Conversation automation context');
    expect(html).toContain('tokens');
    expect(html).not.toContain('border-warning');
    expect(html).not.toContain('ui-chat-avatar-mark">pa<');
    expect(html).not.toContain('ui-message-card-assistant');
  });

  it('renders goal continuations as visible context blocks', () => {
    const html = renderToStaticMarkup(
      createElement(ChatView, {
        messages: [
          {
            type: 'context',
            ts: '2026-03-11T18:00:00.000Z',
            customType: 'goal-continuation',
            text: 'Goal continuation.\n\nObjective: keep shipping',
          },
        ],
      }),
    );

    expect(html).toContain('<details');
    expect(html).toContain('Goal continuation');
    expect(html).toContain('data-context-type="goal-continuation"');
    expect(html).toContain('Objective: keep shipping');
    expect(html).not.toContain('ui-chat-avatar-mark">pa<');
    expect(html).not.toContain('ui-message-card-assistant');
  });

  it('marks the transcript container as a selection context-menu surface', () => {
    const html = renderToStaticMarkup(
      createElement(ChatView, {
        messages: [
          {
            type: 'text',
            id: 'assistant-1',
            ts: '2026-03-11T18:00:00.000Z',
            text: 'Assistant reply body.',
          },
        ],
      }),
    );

    expect(html).toContain('data-chat-transcript-panel="1"');
  });

  it('marks assistant-facing transcript blocks as reply-selectable scopes', () => {
    const html = renderToStaticMarkup(
      createElement(ChatView, {
        messages: [
          {
            type: 'text',
            id: 'assistant-1',
            ts: '2026-03-11T18:00:00.000Z',
            text: 'Assistant reply body.',
          },
          {
            type: 'context',
            id: 'context-1',
            ts: '2026-03-11T18:01:00.000Z',
            customType: 'referenced_context',
            text: 'Injected context body.',
          },
          {
            type: 'summary',
            id: 'summary-1',
            ts: '2026-03-11T18:02:00.000Z',
            kind: 'branch',
            title: 'Branch summary',
            text: 'Summary body.',
          },
        ],
        onReplyToSelection: () => undefined,
      }),
    );

    const scopeMatches = html.match(/data-selection-reply-scope="assistant-message"/g) ?? [];
    expect(scopeMatches).toHaveLength(3);
    expect(html).toContain('data-message-index="0"');
    expect(html).toContain('data-message-index="1"');
    expect(html).toContain('data-message-index="2"');
    expect(html).toContain('data-block-id="assistant-1"');
    expect(html).toContain('data-block-id="context-1"');
    expect(html).toContain('data-block-id="summary-1"');
    expect(html).toContain('data-summary-kind="branch"');
    expect(html).toContain('<details');
    expect(html).not.toContain('border-teal');
  });

  it('renders specific compaction kinds when the summary title provides one', () => {
    const html = renderToStaticMarkup(
      createElement(ChatView, {
        messages: [
          {
            type: 'summary',
            ts: '2026-03-11T18:00:00.000Z',
            kind: 'compaction',
            title: 'Overflow recovery compaction',
            text: '## Goal\nRetry after compaction.',
          },
        ],
      }),
    );

    expect(html).toContain('Overflow recovery compaction');
    expect(html).toContain('interrupted turn could retry automatically');
  });

  it('renders Codex compaction detail when the summary metadata provides it', () => {
    const html = renderToStaticMarkup(
      createElement(ChatView, {
        messages: [
          {
            type: 'summary',
            ts: '2026-03-11T18:00:00.000Z',
            kind: 'compaction',
            title: 'Overflow recovery compaction',
            text: '## Goal\nRetry after compaction.',
            detail: 'This used Codex compaction under the hood. Pi kept the text summary for display and portability.',
          },
        ],
      }),
    );

    expect(html).toContain('Overflow recovery compaction');
    expect(html).toContain('interrupted turn could retry automatically');
    expect(html).toContain('This used Codex compaction under the hood.');
  });

  it('renders long compaction summaries inside the shared system event frame', () => {
    const html = renderToStaticMarkup(
      createElement(ChatView, {
        messages: [
          {
            type: 'summary',
            ts: '2026-03-11T18:00:00.000Z',
            kind: 'compaction',
            title: 'Compaction summary',
            text: '## Goal\nFirst item.\nSecond item.\nThird item.\nFourth item.\nFifth item.',
          },
        ],
      }),
    );

    expect(html).toContain('data-summary-kind="compaction"');
    expect(html).toContain('<details');
    expect(html).not.toContain('Show summary');
    expect(html).toContain('Goal');
    expect(html).toContain('First item.');
    expect(html).toContain('Fifth item.');
  });

  it('renders reused thread summaries as collapsed transcript events', () => {
    const html = renderToStaticMarkup(
      createElement(ChatView, {
        messages: [
          {
            type: 'summary',
            ts: '2026-03-11T18:00:00.000Z',
            kind: 'related',
            title: 'Reused thread summaries',
            detail:
              '2 selected conversations were summarized and injected before this prompt so this thread could start with reused context.',
            text: '### Conversation 1 — Release signing\n- Workspace: `/repo/a`\n- Created: 2026-04-10T10:00:00.000Z\nKeep the notarization mapping fix.\n\n### Conversation 2 — Auto mode wakeups\n- Workspace: `/repo/b`\n- Created: 2026-04-11T10:00:00.000Z\nWakeups use durable run callbacks.',
          },
        ],
      }),
    );

    expect(html).toContain('data-summary-kind="related"');
    expect(html).toContain('Reused thread summaries');
    expect(html).toContain('2 selected conversations were summarized and injected before this prompt');
    expect(html).toContain('<details');
    expect(html).not.toContain('Show summary');
    expect(html).toContain('Conversation 1 — Release signing');
    expect(html).toContain('Workspace:');
    expect(html).toContain('/repo/a');
    expect(html).toContain('Conversation 2 — Auto mode wakeups');
  });

  it('renders terminal bash blocks without extension registration', () => {
    const html = renderToStaticMarkup(
      createElement(ChatView, {
        messages: [
          {
            type: 'tool_use',
            ts: '2026-03-11T18:00:00.000Z',
            tool: 'bash',
            input: { command: 'npm run release:publish' },
            output: '/bin/bash: npm: command not found',
            status: 'error',
            details: {
              displayMode: 'terminal',
              exitCode: 127,
              excludeFromContext: true,
            },
          },
        ],
      }),
    );

    expect(html).not.toContain('Internal work');
    expect(html).toContain('ui-terminal-block');
    expect(html).toContain('npm run release:publish');
    expect(html).toContain('/bin/bash: npm: command not found');
  });

  it('renders background bash starts like normal bash tool calls with a background modifier', () => {
    const html = renderToStaticMarkup(
      createElement(ChatView, {
        messages: [
          {
            type: 'tool_use',
            ts: '2026-03-11T18:00:00.000Z',
            tool: 'bash',
            input: { command: 'npm run desktop:dev', background: true },
            output: 'Started background command run-desktop-dev-abc123 for desktop-dev.',
            status: 'done',
            details: {
              action: 'start',
              displayMode: 'terminal',
              command: 'npm run desktop:dev',
              runId: 'run-desktop-dev-abc123',
              taskSlug: 'desktop-dev',
            },
          },
        ],
      }),
    );

    expect(html).not.toContain('ui-terminal-block');
    expect(html).not.toContain('background work');
    expect(html).not.toContain('linked');
    expect(html).toContain('bash');
    expect(html).toContain('background task');
  });

  it('renders a continue action for the tail internal-work cluster when recovery is available', () => {
    const html = renderToStaticMarkup(
      createElement(ChatView, {
        messages: [
          {
            type: 'tool_use',
            ts: '2026-03-11T18:00:00.000Z',
            tool: 'bash',
            input: { command: 'sleep 1' },
            output: 'timed out',
            status: 'error',
          },
        ],
        onResumeConversation: () => undefined,
        resumeConversationTitle: 'Continue the interrupted turn.',
      }),
    );

    expect(html).toContain('continue');
    expect(html).toContain('Internal work');
  });

  it('renders a continue action for a tail error trace when recovery is available', () => {
    const html = renderToStaticMarkup(
      createElement(ChatView, {
        messages: [
          {
            type: 'error',
            ts: '2026-03-11T18:00:00.000Z',
            message: 'The model returned an error before completing its response.',
          },
        ],
        onResumeConversation: () => undefined,
        resumeConversationTitle: 'Ask the agent to continue from the last error.',
      }),
    );

    expect(html).toContain('continue');
    expect(html).toContain('Internal work');
    expect(html).toContain('ui-pill-danger');
  });

  it('preserves inline code content without stringifying React nodes', () => {
    const html = renderAssistantText('Use `artifact` in `packages/desktop/ui/src/pages/ConversationPage.tsx` before pinging @desktop-ui.');

    expect(html).toContain('artifact');
    expect(html).toContain('packages/desktop/ui/src/pages/ConversationPage.tsx');
    expect(html).not.toContain('[object Object]');
  });

  it('renders local paths as plain inline code without path actions', () => {
    const html = renderAssistantText('Open `/Users/patrick/notes.md` soon.');

    expect(html).toContain('/Users/patrick/notes.md');
    expect(html).not.toContain('role="tooltip"');
    expect(html).not.toContain('>Open<');
    expect(html).not.toContain('>Copy<');
  });

  it('renders slash commands as plain inline code without actions', () => {
    const html = renderAssistantText('Use `/model` before opening `/Users/patrick/notes.md`.');

    expect(html).toContain('/model');
    expect(html).toContain('/Users/patrick/notes.md');
    expect(html).not.toContain('role="tooltip"');
    expect(html).not.toContain('>Open<');
    expect(html).not.toContain('>Copy<');
  });

  it('renders knowledge base file paths as links when file opening is available', () => {
    const html = renderAssistantText(
      'Open `/Users/patrick/.local/state/personal-agent/knowledge-base/repo/skills/checkpoint/SKILL.md` next.',
      { onOpenFilePath: () => undefined },
    );

    expect(html).toContain('href="/knowledge?file=skills%2Fcheckpoint%2FSKILL.md"');
    expect(html).toContain('/Users/patrick/.local/state/personal-agent/knowledge-base/repo/skills/checkpoint/SKILL.md');
  });

  it('keeps knowledge base paths as plain inline code without file opening', () => {
    const html = renderAssistantText(
      'Open `/Users/patrick/.local/state/personal-agent/knowledge-base/repo/skills/checkpoint/SKILL.md` next.',
    );

    expect(html).toContain('<code');
    expect(html).toContain('/Users/patrick/.local/state/personal-agent/knowledge-base/repo/skills/checkpoint/SKILL.md');
    expect(html).not.toContain('/knowledge?file=skills%2Fcheckpoint%2FSKILL.md');
  });

  it('links knowledge base paths in prose without swallowing trailing punctuation', () => {
    const html = renderAssistantText('Read /runtime/knowledge-base/repo/projects/Personal/Plan.md, then continue.', {
      onOpenFilePath: () => undefined,
    });

    expect(html).toContain('href="/knowledge?file=projects%2FPersonal%2FPlan.md"');
    expect(html).toContain('/runtime/knowledge-base/repo/projects/Personal/Plan.md</a>, then continue.');
  });

  it('defers content-visibility on the initial render of long conversations', () => {
    const html = renderToStaticMarkup(
      createElement(ChatView, {
        messages: Array.from({ length: 130 }, (_, index) => ({
          type: 'text' as const,
          ts: `2026-03-11T18:00:${String(index).padStart(2, '0')}.000Z`,
          text: `Long conversation block ${index + 1}`,
        })),
      }),
    );

    expect(html).not.toMatch(/content-visibility/i);
  });

  it('renders transcript boundary content inline before windowed messages', () => {
    const html = renderToStaticMarkup(
      createElement(ChatView, {
        messages: Array.from({ length: 96 }, (_, index) => ({
          type: 'text' as const,
          ts: `2026-03-11T18:02:${String(index).padStart(2, '0')}.000Z`,
          text: `Windowed block ${index + 1}`,
        })),
        performanceMode: 'aggressive',
        scrollContainerRef: { current: null },
        windowingHeaderContent: createElement('div', null, 'Earlier conversation hidden · Viewing 75–100% · Load previous 10%'),
      }),
    );

    expect(html).toContain('Earlier conversation hidden');
    expect(html).toContain('Viewing 75–100%');
    expect(html).toContain('Load previous 10%');
    expect(html).not.toContain('windowing');
    expect(html).not.toContain('mounted');
  });
});

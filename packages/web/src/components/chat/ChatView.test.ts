import React, { Fragment, createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MessageBlock } from '../../types';
import {
  ChatView,
  getStreamingStatusLabel,
  normalizeConversationViewMode,
  renderText,
  resolveDisclosureOpen,
  shouldAutoOpenConversationBlock,
  shouldAutoOpenTraceCluster,
  toggleDisclosurePreference,
} from './ChatView.js';

(globalThis as typeof globalThis & { React?: typeof React }).React = React;

afterEach(() => {
  vi.useRealTimers();
});

describe('chat view streaming disclosure', () => {
  it('auto-opens running tool blocks', () => {
    const block: MessageBlock = {
      type: 'tool_use',
      ts: '2026-03-11T18:00:00.000Z',
      tool: 'bash',
      input: { command: 'sleep 1' },
      output: '',
      status: 'running',
    };

    expect(shouldAutoOpenConversationBlock(block, 1, 3, true)).toBe(true);
  });

  it('only auto-opens the tail thinking block while the stream is active', () => {
    const thinking: MessageBlock = {
      type: 'thinking',
      ts: '2026-03-11T18:00:00.000Z',
      text: 'Working through the request…',
    };

    expect(shouldAutoOpenConversationBlock(thinking, 2, 3, true)).toBe(true);
    expect(shouldAutoOpenConversationBlock(thinking, 1, 3, true)).toBe(false);
    expect(shouldAutoOpenConversationBlock(thinking, 2, 3, false)).toBe(false);
  });

  it('derives a live status label from the current tail block', () => {
    expect(getStreamingStatusLabel([], false)).toBeNull();
    expect(getStreamingStatusLabel([], true)).toBe('Working…');

    expect(getStreamingStatusLabel([
      { type: 'thinking', ts: '2026-03-11T18:00:00.000Z', text: 'Working through the request…' },
    ], true)).toBe('Thinking…');

    expect(getStreamingStatusLabel([
      { type: 'tool_use', ts: '2026-03-11T18:00:00.000Z', tool: 'bash', input: { command: 'sleep 1' }, output: '', status: 'running' },
    ], true)).toBe('Running bash…');

    expect(getStreamingStatusLabel([
      { type: 'text', ts: '2026-03-11T18:00:00.000Z', text: 'Half-finished response' },
    ], true)).toBe('Responding…');
  });

  it('renders a pending status indicator immediately even before live streaming starts', () => {
    const html = renderToStaticMarkup(createElement(ChatView, {
      messages: [{ type: 'text', ts: '2026-03-11T18:00:00.000Z', text: 'Most recent assistant reply' }],
      pendingStatusLabel: 'Resuming…',
      isStreaming: false,
    }));

    expect(html).toContain('Resuming…');
  });

  it('renders the compaction status indicator even when the latest block is from the assistant', () => {
    const html = renderToStaticMarkup(createElement(ChatView, {
      messages: [{ type: 'text', ts: '2026-03-11T18:00:00.000Z', text: 'Most recent assistant reply' }],
      isCompacting: true,
      isStreaming: false,
    }));

    expect(html).toContain('Compacting context…');
  });

  it('collapses auto-opened blocks once live streaming ends unless manually overridden', () => {
    expect(resolveDisclosureOpen(true, 'auto')).toBe(true);
    expect(resolveDisclosureOpen(false, 'auto')).toBe(false);

    expect(toggleDisclosurePreference(true, 'auto')).toBe('closed');
    expect(resolveDisclosureOpen(true, 'closed')).toBe(false);

    expect(toggleDisclosurePreference(false, 'closed')).toBe('open');
    expect(resolveDisclosureOpen(false, 'open')).toBe(true);
  });

  it('auto-opens the internal-work cluster while live or when a running step remains', () => {
    expect(shouldAutoOpenTraceCluster(true, false)).toBe(true);
    expect(shouldAutoOpenTraceCluster(false, true)).toBe(true);
    expect(shouldAutoOpenTraceCluster(false, false)).toBe(false);
  });

  it('forces the conversation view mode to hybrid', () => {
    expect(normalizeConversationViewMode('transcript')).toBe('hybrid');
    expect(normalizeConversationViewMode('hybrid')).toBe('hybrid');
    expect(normalizeConversationViewMode('raw')).toBe('hybrid');
    expect(normalizeConversationViewMode('unknown')).toBe('hybrid');
    expect(normalizeConversationViewMode(null)).toBe('hybrid');
  });

  it('renders rich markdown structures in assistant messages', () => {
    const html = renderToStaticMarkup(createElement(Fragment, null, renderText([
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
    ].join('\n'))));

    expect(html).toContain('<h1');
    expect(html).toContain('<ul');
    expect(html).toContain('<blockquote');
    expect(html).toContain('<table');
    expect(html).toContain('<pre');
    expect(html).toContain('href="https://example.com"');
    expect(html).not.toContain('Copy code block');
    expect(html).not.toContain('ui-markdown-code-copy');
  });

  it('does not auto-link file paths inside assistant message text', () => {
    const html = renderToStaticMarkup(createElement(Fragment, null, renderText([
      'Touch packages/web/src/App.tsx next.',
      '',
      '`packages/web/src/main.tsx`',
      '',
      '[relative file](packages/web/src/filePathLinks.tsx)',
    ].join('\n'), { onOpenFilePath: () => undefined })));

    expect(html).toContain('packages/web/src/App.tsx');
    expect(html).toContain('packages/web/src/main.tsx');
    expect(html).toContain('relative file');
    expect(html).not.toContain('data-file-path-link=');
    expect(html).not.toContain('role="button"');
    expect(html).not.toContain('href="packages/web/src/filePathLinks.tsx"');
  });

  it('renders project mentions as pills inside markdown text', () => {
    const html = renderToStaticMarkup(createElement(Fragment, null, renderText('Check @web-ui before touching @projects.')));

    expect(html).toContain('@web-ui');
    expect(html).toContain('@projects');
    expect(html).toContain('ui-markdown-mention');
  });

  it('does not turn email addresses into mention pills', () => {
    const html = renderToStaticMarkup(createElement(Fragment, null, renderText('Email patrick@example.com and ping @web-ui for follow-up.')));

    expect(html).toContain('patrick@example.com');
    expect(html.match(/ui-markdown-mention/g)).toHaveLength(1);
  });

  it('renders vault file mentions as a single pill', () => {
    const html = renderToStaticMarkup(createElement(Fragment, null, renderText('Open @_profiles/datadog/AGENTS.md before editing.')));

    expect(html).toContain('@_profiles/datadog/AGENTS.md');
    expect(html.match(/ui-markdown-mention/g)).toHaveLength(1);
  });

  it('renders markdown formatting in user messages', () => {
    const html = renderToStaticMarkup(createElement(ChatView, {
      messages: [{
        type: 'user',
        ts: '2026-03-11T18:00:00.000Z',
        text: '# Checklist\n\n- **One**\n- `Two`',
      }],
    }));

    expect(html).toContain('<h1');
    expect(html).toContain('<ul');
    expect(html).toContain('<strong>One</strong>');
    expect(html).toContain('<code');
  });

  it('renders transcript images as inspectable buttons', () => {
    const html = renderToStaticMarkup(createElement(ChatView, {
      messages: [{
        type: 'image',
        ts: '2026-03-11T18:00:00.000Z',
        alt: 'Build screenshot',
        caption: 'Latest desktop build',
        src: 'data:image/png;base64,abc123',
      }],
    }));

    expect(html).toContain('Inspect image');
    expect(html).toContain('aria-label="Inspect image: Latest desktop build"');
    expect(html).toContain('cursor-zoom-in');
  });

  it('renders user attachment images as inspectable buttons', () => {
    const html = renderToStaticMarkup(createElement(ChatView, {
      messages: [{
        type: 'user',
        ts: '2026-03-11T18:00:00.000Z',
        text: '',
        images: [{
          alt: 'Shared screenshot',
          caption: 'Before refactor',
          src: 'data:image/png;base64,xyz789',
        }],
      }],
    }));

    expect(html).toContain('Inspect image');
    expect(html).toContain('aria-label="Inspect image: Before refactor"');
    expect(html).toContain('cursor-zoom-in');
  });

  it('renders mentioned runs as left-aligned action rows with a human-readable title', () => {
    const html = renderToStaticMarkup(createElement(ChatView, {
      messages: [{
        type: 'tool_use',
        ts: '2026-03-11T18:00:00.000Z',
        tool: 'bash',
        input: { command: 'npm --prefix packages/web run start' },
        output: 'Inspect runId=run-continuous-conversations-next-chunk-ui-2026-03-25T00-53-25-347Z-903aa31b',
        status: 'running',
      }],
      isStreaming: true,
      onOpenRun: () => undefined,
    }));

    expect(html).toContain('Open Continuous conversations next chunk ui');
    expect(html).toContain('background run');
    expect(html).toContain('text-left');
    expect(html).toContain('mentioned run');
  });

  it('limits listed runs in the transcript to 5 rows by default', () => {
    const listedRuns = Array.from({ length: 7 }, (_, index) => ({
      runId: `run-fix-build-${String.fromCharCode(97 + index)}-2026-03-25T00-53-25-347Z-903aa31b`,
      status: 'queued',
      kind: 'background-run',
      source: 'tool',
    }));

    const html = renderToStaticMarkup(createElement(ChatView, {
      messages: [{
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
      }],
      isStreaming: true,
      onOpenRun: () => undefined,
    }));

    expect(html).toContain('listed runs');
    expect(html).toContain('Showing 5 of 7 runs returned by the tool.');
    expect(html).toContain('Show all');
    expect(html).toContain('Open Fix build a');
    expect(html).toContain('Open Fix build e');
    expect(html).toContain('queued · background run');
    expect(html).not.toContain('Open Fix build f');
    expect(html).not.toContain('Open Fix build g');
  });

  it('renders tool input and output as plain text without file path buttons', () => {
    const html = renderToStaticMarkup(createElement(ChatView, {
      messages: [{
        type: 'tool_use',
        ts: '2026-03-11T18:00:00.000Z',
        tool: 'bash',
        input: { command: 'cat packages/web/src/App.tsx' },
        output: 'Updated packages/web/src/App.tsx',
        status: 'running',
      }],
      isStreaming: true,
      onOpenFilePath: () => undefined,
    }));

    expect(html).toContain('cat packages/web/src/App.tsx');
    expect(html).toContain('Updated packages/web/src/App.tsx');
    expect(html).not.toContain('data-file-path-link=');
    expect(html).not.toContain('role="button"');
  });

  it('shows a clean preview for collapsed thinking steps inside an open internal-work cluster', () => {
    const html = renderToStaticMarkup(createElement(ChatView, {
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
    }));

    expect(html).toContain('Investigate the render path first.');
    expect(html).not.toContain('**Investigate the render path first.**');
    expect(html).not.toContain('Then patch the collapsed header.');
    expect(html).toContain('echo done');
  });

  it('shows only the latest 5 internal-work steps by default and summarizes older ones above', () => {
    const html = renderToStaticMarkup(createElement(ChatView, {
      messages: Array.from({ length: 7 }, (_, index) => ({
        type: 'tool_use' as const,
        ts: `2026-03-11T18:00:0${index}.000Z`,
        tool: 'bash',
        input: { command: `echo step-${index + 1}` },
        output: '',
        status: index === 6 ? 'running' as const : 'ok' as const,
      })),
      isStreaming: true,
    }));

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

    const html = renderToStaticMarkup(createElement(ChatView, {
      messages: [{
        type: 'thinking',
        ts: '2026-03-11T18:00:00.000Z',
        text: 'a'.repeat(48),
      }],
      isStreaming: true,
    }));

    expect(html).toContain('tok/s');
    expect(html).toContain('~4.0 tok/s');
  });

  it('renders ask_user_question tool calls as questionnaire cards with navigation and submit', () => {
    const html = renderToStaticMarkup(createElement(ChatView, {
      messages: [{
        type: 'tool_use',
        ts: '2026-03-11T18:00:00.000Z',
        tool: 'ask_user_question',
        input: {},
        details: {
          action: 'ask_user_question',
          conversationId: 'conv-123',
          details: 'Pick the configuration before I continue.',
          questions: [
            {
              id: 'target',
              label: 'Which environment should I use?',
              style: 'radio',
              options: ['staging', 'prod'],
            },
            {
              id: 'notify',
              label: 'Which notifications should I enable?',
              style: 'check',
              options: ['Email', 'Telegram'],
            },
          ],
        },
        output: 'Asked the user 2 questions.',
        status: 'ok',
      }],
      onSubmitAskUserQuestion: () => undefined,
    }));

    expect(html).toContain('Questions for you');
    expect(html).toContain('Pick the configuration before I continue.');
    expect(html).toContain('Which environment should I use?');
    expect(html).toContain('Which notifications should I enable?');
    expect(html).toContain('0/2 answered');
    expect(html).toContain('role="tab"');
    expect(html).toContain('role="radio"');
    expect(html).toContain('aria-keyshortcuts="1"');
    expect(html).toContain('✓ Submit →');
    expect(html).toContain('1-9 selects · n/p switches questions · ↑/↓ moves · Esc exits · send a normal message to skip');
    expect(html).not.toContain('Internal work');
  });

  it('renders pending ask_user_question tool calls as compact transcript summaries in composer mode', () => {
    const html = renderToStaticMarkup(createElement(ChatView, {
      messages: [{
        type: 'tool_use',
        ts: '2026-03-11T18:00:00.000Z',
        tool: 'ask_user_question',
        input: {},
        details: {
          action: 'ask_user_question',
          conversationId: 'conv-123',
          details: 'Pick the configuration before I continue.',
          questions: [
            {
              id: 'target',
              label: 'Which environment should I use?',
              style: 'radio',
              options: ['staging', 'prod'],
            },
            {
              id: 'notify',
              label: 'Which notifications should I enable?',
              style: 'check',
              options: ['Email', 'Telegram'],
            },
          ],
        },
        output: 'Asked the user 2 questions.',
        status: 'ok',
      }],
      askUserQuestionDisplayMode: 'composer',
      onSubmitAskUserQuestion: () => undefined,
    }));

    expect(html).toContain('Questions for you');
    expect(html).toContain('Which environment should I use?');
    expect(html).toContain('Which notifications should I enable?');
    expect(html).toContain('Answer using the composer below. Type 1-9 to select, or send a normal message to skip.');
    expect(html).not.toContain('role="radio"');
    expect(html).not.toContain('✓ Submit →');
  });

  it('renders check-style ask_user_question options as checkboxes', () => {
    const html = renderToStaticMarkup(createElement(ChatView, {
      messages: [{
        type: 'tool_use',
        ts: '2026-03-11T18:00:00.000Z',
        tool: 'ask_user_question',
        input: {},
        details: {
          action: 'ask_user_question',
          conversationId: 'conv-123',
          questions: [{
            id: 'notify',
            label: 'Which notifications should I enable?',
            style: 'check',
            options: ['Email', 'Telegram'],
          }],
        },
        output: 'Asked the user a question.',
        status: 'ok',
      }],
      onSubmitAskUserQuestion: () => undefined,
    }));

    expect(html).toContain('Question for you');
    expect(html).toContain('Which notifications should I enable?');
    expect(html).toContain('role="checkbox"');
    expect(html).toContain('✓ Submit →');
  });

  it('shows the first user reply on answered question cards', () => {
    const html = renderToStaticMarkup(createElement(ChatView, {
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
    }));

    expect(html).toContain('answered');
    expect(html).toContain('Your reply');
    expect(html).toContain('Use staging for this deploy.');
    expect(html).not.toContain('Reply in Composer');
  });

  it('renders markdown footnotes with isolated ids per message', () => {
    const html = renderToStaticMarkup(createElement(ChatView, {
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
    }));

    expect(html).toContain('class="footnotes"');
    expect(html).toContain('Alpha reference');
    expect(html).toContain('Beta reference');

    const footnoteIds = Array.from(html.matchAll(/id="([^"]*fn-1)"/g), (match) => match[1]);
    expect(footnoteIds.length).toBeGreaterThanOrEqual(2);
    expect(new Set(footnoteIds).size).toBe(footnoteIds.length);
  });

  it('renders a rewind action for user messages when rewinding is available', () => {
    const html = renderToStaticMarkup(createElement(ChatView, {
      messages: [{
        type: 'user',
        ts: '2026-03-11T18:00:00.000Z',
        text: 'Try a different approach',
      }],
      onRewindMessage: () => undefined,
    }));

    expect(html).toContain('↩ rewind');
  });

  it('renders rewind and fork actions for assistant messages when both are available', () => {
    const html = renderToStaticMarkup(createElement(ChatView, {
      messages: [{
        type: 'text',
        ts: '2026-03-11T18:00:00.000Z',
        text: 'Assistant output to branch from',
      }],
      onRewindMessage: () => undefined,
      onForkMessage: () => undefined,
    }));

    expect(html).toContain('↩ rewind');
    expect(html).toContain('⑂ fork');
  });

  it('renders a copy action for assistant messages', () => {
    const html = renderToStaticMarkup(createElement(ChatView, {
      messages: [{
        type: 'text',
        ts: '2026-03-11T18:00:00.000Z',
        text: 'Assistant output to copy',
      }],
    }));

    expect(html).toContain('⎘ copy');
  });

  it('uses absolute message ids when a transcript window starts mid-conversation', () => {
    const html = renderToStaticMarkup(createElement(ChatView, {
      messages: [{
        type: 'text',
        ts: '2026-03-11T18:00:00.000Z',
        text: 'Windowed conversation block',
      }],
      messageIndexOffset: 7,
    }));

    expect(html).toContain('id="msg-7"');
    expect(html).toContain('data-message-index="7"');
  });

  it('renders skill invocations as disclosure cards instead of raw wrapper markup', () => {
    const html = renderToStaticMarkup(createElement(ChatView, {
      messages: [{
        type: 'user',
        ts: '2026-03-11T18:00:00.000Z',
        text: [
          '<skill name="checkpoint" location="/state/profiles/shared/agent/skills/checkpoint/INDEX.md">',
          'References are relative to /state/profiles/shared/agent/skills/checkpoint.',
          '',
          '# Checkpoint',
          '',
          'Create a focused commit for the agent\'s current work.',
          '</skill>',
        ].join('\n'),
      }],
    }));

    expect(html).toContain('checkpoint');
    expect(html).toContain('References resolve relative to /state/profiles/shared/agent/skills/checkpoint');
    expect(html).not.toContain('&lt;skill name=');
    expect(html).not.toContain('location=&quot;/state/profiles/shared/agent/skills/checkpoint/INDEX.md&quot;');
  });

  it('renders compaction summaries as system events instead of assistant bubbles', () => {
    const html = renderToStaticMarkup(createElement(ChatView, {
      messages: [{
        type: 'summary',
        ts: '2026-03-11T18:00:00.000Z',
        kind: 'compaction',
        title: 'Compaction summary',
        text: '## Goal\nKeep the compacted context visible.',
      }],
    }));

    expect(html).toContain('data-summary-kind="compaction"');
    expect(html).toContain('Context compacted');
    expect(html).toContain('Older turns were summarized to keep the active context window focused.');
    expect(html).toContain('Show summary');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('ui-chat-avatar-mark">pa<');
    expect(html).not.toContain('ui-message-card-assistant');
  });

  it('renders injected context blocks with dedicated reminder styling', () => {
    const html = renderToStaticMarkup(createElement(ChatView, {
      messages: [{
        type: 'context',
        ts: '2026-03-11T18:00:00.000Z',
        customType: 'referenced_context',
        text: 'Conversation automation context:\n\n- Review the agent reminders before stopping.',
      }],
    }));

    expect(html).toContain('Injected context');
    expect(html).toContain('data-context-type="referenced_context"');
    expect(html).toContain('Conversation automation context:');
    expect(html).not.toContain('ui-chat-avatar-mark">pa<');
    expect(html).not.toContain('ui-message-card-assistant');
  });

  it('marks the transcript container as a selection context-menu surface', () => {
    const html = renderToStaticMarkup(createElement(ChatView, {
      messages: [{
        type: 'text',
        id: 'assistant-1',
        ts: '2026-03-11T18:00:00.000Z',
        text: 'Assistant reply body.',
      }],
    }));

    expect(html).toContain('data-chat-transcript-panel="1"');
  });

  it('marks assistant-facing transcript blocks as reply-selectable scopes', () => {
    const html = renderToStaticMarkup(createElement(ChatView, {
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
    }));

    const scopeMatches = html.match(/data-selection-reply-scope="assistant-message"/g) ?? [];
    expect(scopeMatches).toHaveLength(3);
    expect(html).toContain('data-message-index="0"');
    expect(html).toContain('data-message-index="1"');
    expect(html).toContain('data-message-index="2"');
    expect(html).toContain('data-block-id="assistant-1"');
    expect(html).toContain('data-block-id="context-1"');
    expect(html).toContain('data-block-id="summary-1"');
  });

  it('renders specific compaction kinds when the summary title provides one', () => {
    const html = renderToStaticMarkup(createElement(ChatView, {
      messages: [{
        type: 'summary',
        ts: '2026-03-11T18:00:00.000Z',
        kind: 'compaction',
        title: 'Overflow recovery compaction',
        text: '## Goal\nRetry after compaction.',
      }],
    }));

    expect(html).toContain('Overflow recovery compaction');
    expect(html).toContain('interrupted turn could retry automatically');
  });

  it('collapses long compaction summaries to a short preview by default', () => {
    const html = renderToStaticMarkup(createElement(ChatView, {
      messages: [{
        type: 'summary',
        ts: '2026-03-11T18:00:00.000Z',
        kind: 'compaction',
        title: 'Compaction summary',
        text: '## Goal\nFirst item.\nSecond item.\nThird item.\nFourth item.\nFifth item.',
      }],
    }));

    expect(html).toContain('Show summary');
    expect(html).toContain('Goal');
    expect(html).toContain('First item.');
    expect(html).toContain('Third item.');
    expect(html).not.toContain('Fourth item.');
    expect(html).not.toContain('Fifth item.');
  });

  it('renders a resume action for the tail internal-work cluster when recovery is available', () => {
    const html = renderToStaticMarkup(createElement(ChatView, {
      messages: [{
        type: 'tool_use',
        ts: '2026-03-11T18:00:00.000Z',
        tool: 'bash',
        input: { command: 'sleep 1' },
        output: 'timed out',
        status: 'error',
      }],
      onResumeConversation: () => undefined,
      resumeConversationTitle: 'Resume the interrupted turn.',
    }));

    expect(html).toContain('resume');
    expect(html).toContain('Internal work');
  });

  it('renders a resume action for a tail error trace when recovery is available', () => {
    const html = renderToStaticMarkup(createElement(ChatView, {
      messages: [{
        type: 'error',
        ts: '2026-03-11T18:00:00.000Z',
        message: 'The model returned an error before completing its response.',
      }],
      onResumeConversation: () => undefined,
      resumeConversationTitle: 'Ask the agent to continue from the last error.',
    }));

    expect(html).toContain('resume');
    expect(html).toContain('Internal work');
    expect(html).toContain('ui-pill-danger');
  });

  it('preserves inline code content without stringifying React nodes', () => {
    const html = renderToStaticMarkup(createElement(Fragment, null, renderText('Use `artifact` in `packages/web/src/pages/ConversationPage.tsx` before pinging @web-ui.')));

    expect(html).toContain('artifact');
    expect(html).toContain('packages/web/src/pages/ConversationPage.tsx');
    expect(html).not.toContain('[object Object]');
  });

  it('renders local paths as plain inline code without path actions', () => {
    const html = renderToStaticMarkup(createElement(Fragment, null, renderText('Open `/Users/patrick/notes.md` soon.')));

    expect(html).toContain('/Users/patrick/notes.md');
    expect(html).not.toContain('role="tooltip"');
    expect(html).not.toContain('>Open<');
    expect(html).not.toContain('>Copy<');
  });

  it('renders slash commands as plain inline code without actions', () => {
    const html = renderToStaticMarkup(createElement(Fragment, null, renderText('Use `/model` before opening `/Users/patrick/notes.md`.')));

    expect(html).toContain('/model');
    expect(html).toContain('/Users/patrick/notes.md');
    expect(html).not.toContain('role="tooltip"');
    expect(html).not.toContain('>Open<');
    expect(html).not.toContain('>Copy<');
  });

  it('defers content-visibility on the initial render of long conversations', () => {
    const html = renderToStaticMarkup(createElement(ChatView, {
      messages: Array.from({ length: 130 }, (_, index) => ({
        type: 'text' as const,
        ts: `2026-03-11T18:00:${String(index).padStart(2, '0')}.000Z`,
        text: `Long conversation block ${index + 1}`,
      })),
    }));

    expect(html).not.toMatch(/content-visibility/i);
  });

  it('positions the windowing badge below sticky history controls when given a top offset', () => {
    const html = renderToStaticMarkup(createElement(ChatView, {
      messages: Array.from({ length: 96 }, (_, index) => ({
        type: 'text' as const,
        ts: `2026-03-11T18:01:${String(index).padStart(2, '0')}.000Z`,
        text: `Windowed block ${index + 1}`,
      })),
      performanceMode: 'aggressive',
      scrollContainerRef: { current: null },
      windowingBadgeTopOffset: 56,
    }));

    expect(html).toContain('windowing');
    expect(html).toContain('style="top:56px"');
  });
});

import React, { Fragment, createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
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
          '<skill name="workflow-checkpoint" location="/state/profiles/shared/agent/skills/workflow-checkpoint/SKILL.md">',
          'References are relative to /state/profiles/shared/agent/skills/workflow-checkpoint.',
          '',
          '# Checkpoint',
          '',
          'Create a focused commit for the agent\'s current work.',
          '</skill>',
        ].join('\n'),
      }],
    }));

    expect(html).toContain('workflow-checkpoint');
    expect(html).toContain('References resolve relative to /state/profiles/shared/agent/skills/workflow-checkpoint');
    expect(html).not.toContain('&lt;skill name=');
    expect(html).not.toContain('location=&quot;/state/profiles/shared/agent/skills/workflow-checkpoint/SKILL.md&quot;');
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
});

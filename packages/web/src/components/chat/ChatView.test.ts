import { Fragment, createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { MessageBlock } from '../../types';
import {
  getStreamingStatusLabel,
  normalizeConversationViewMode,
  renderText,
  resolveDisclosureOpen,
  shouldAutoOpenConversationBlock,
  shouldAutoOpenTraceCluster,
  toggleDisclosurePreference,
} from './ChatView.js';

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

  it('normalizes conversation view mode values', () => {
    expect(normalizeConversationViewMode('transcript')).toBe('transcript');
    expect(normalizeConversationViewMode('hybrid')).toBe('hybrid');
    expect(normalizeConversationViewMode('raw')).toBe('raw');
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
    expect(html).toContain('Copy code block');
    expect(html.match(/ui-markdown-code-copy/g)).toHaveLength(1);
  });

  it('renders project mentions as pills inside markdown text', () => {
    const html = renderToStaticMarkup(createElement(Fragment, null, renderText('Check @web-ui before touching @projects.')));

    expect(html).toContain('@web-ui');
    expect(html).toContain('@projects');
    expect(html).toContain('ui-markdown-mention');
  });

  it('preserves inline code content without stringifying React nodes', () => {
    const html = renderToStaticMarkup(createElement(Fragment, null, renderText('Use `artifact` in `packages/web/src/pages/ConversationPage.tsx` before pinging @web-ui.')));

    expect(html).toContain('artifact');
    expect(html).toContain('packages/web/src/pages/ConversationPage.tsx');
    expect(html).not.toContain('[object Object]');
  });
});

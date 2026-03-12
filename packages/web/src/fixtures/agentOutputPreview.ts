import type { MessageBlock } from '../types';
import agentOutputPreviewMarkdown from './agent-output-preview.md?raw';

export const AGENT_OUTPUT_PREVIEW_MARKDOWN_PATH = 'packages/web/src/fixtures/agent-output-preview.md';
export const AGENT_OUTPUT_PREVIEW_MARKDOWN = agentOutputPreviewMarkdown.trim();

export const AGENT_OUTPUT_PREVIEW_BLOCKS: MessageBlock[] = [
  {
    type: 'user',
    ts: '2026-03-12T16:00:00.000Z',
    text: 'Render the markdown fixture and show every conversation block type in one place.',
    images: [
      {
        alt: 'User attachment placeholder',
        caption: 'Optional user image attachment',
        width: 1600,
        height: 900,
      },
    ],
  },
  {
    type: 'thinking',
    ts: '2026-03-12T16:00:01.000Z',
    text: 'Load the fixture. Then preview text, tools, images, errors, and subagent output in a single transcript.',
  },
  {
    type: 'tool_use',
    ts: '2026-03-12T16:00:02.000Z',
    tool: 'read',
    input: { path: AGENT_OUTPUT_PREVIEW_MARKDOWN_PATH },
    output: '# Agent output markdown preview\n\nThis fixture exercises the kinds of markdown an agent might return in chat.\n...',
    durationMs: 142,
    status: 'ok',
  },
  {
    type: 'tool_use',
    ts: '2026-03-12T16:00:03.000Z',
    tool: 'bash',
    input: { command: 'npm test -- --runInBand' },
    output: 'RUN  packages/web/src/components/chat/ChatView.test.ts\nPASS packages/web/src/components/chat/ChatView.test.ts',
    durationMs: 1834,
    status: 'ok',
  },
  {
    type: 'subagent',
    ts: '2026-03-12T16:00:04.000Z',
    name: 'markdown-audit',
    prompt: 'Check whether the preview exercises headings, lists, tables, code blocks, mentions, and task lists.',
    status: 'complete',
    summary: 'Coverage looks good. The preview includes rich markdown plus every non-text chat block type.',
  },
  {
    type: 'image',
    ts: '2026-03-12T16:00:05.000Z',
    alt: 'Generated chart preview placeholder',
    caption: 'Standalone image block placeholder',
    width: 1280,
    height: 720,
  },
  {
    type: 'error',
    ts: '2026-03-12T16:00:06.000Z',
    tool: 'web_fetch',
    message: 'Example error block for visual regression testing.',
  },
  {
    type: 'text',
    ts: '2026-03-12T16:00:07.000Z',
    text: AGENT_OUTPUT_PREVIEW_MARKDOWN,
  },
];

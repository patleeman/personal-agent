import { describe, expect, it } from 'vitest';
import type { MessageBlock } from '../../shared/types';
import {
  applyConversationRailFisheye,
  getConversationRailScrollTopFromThumb,
  getConversationRailTurns,
  getConversationRailViewportTop,
  isConversationRailThumbHit,
  pickNearestConversationRailMarker,
} from './conversationRail.js';

describe('conversation rail turns', () => {
  it('builds semantic snippets by stripping markdown and code noise', () => {
    const messages: MessageBlock[] = [
      {
        type: 'user',
        ts: '2026-03-10T20:00:00.000Z',
        text: '## Current plan\n- [x] Ship the rail\n- [ ] Keep it quiet\nRead [LessWrong](https://lesswrong.com) and use `git status`.\n```ts\nconst x = 1\n```',
      },
    ];

    expect(getConversationRailTurns(messages)).toEqual([
      { index: 0, kind: 'user', label: 'User', snippet: 'Current plan Ship the rail Keep it quiet Read LessWrong and use git status.' },
    ]);
  });

  it('falls back to image-oriented recall when a user turn has no text', () => {
    const messages: MessageBlock[] = [
      {
        type: 'user',
        ts: '2026-03-10T20:00:00.000Z',
        text: '',
        images: [
          { alt: 'image', caption: 'Screenshot of the rail mockup' },
          { alt: 'image' },
        ],
      },
    ];

    expect(getConversationRailTurns(messages)).toEqual([
      { index: 0, kind: 'user', label: 'User', snippet: '2 image attachments · Screenshot of the rail mockup' },
    ]);
  });

  it('ignores malformed images when building image-only snippets', () => {
    const messages: MessageBlock[] = [
      {
        type: 'user',
        ts: '2026-03-10T20:00:00.000Z',
        text: '',
        images: [
          { alt: 'bad data', src: 'data:', mimeType: 'image/png' },
          { alt: 'bad mime', src: 'data:text/plain;base64,aGVsbG8=', mimeType: 'text/plain' },
          { alt: 'bad base64', src: 'data:image/png;base64,not-valid-base64!', mimeType: 'image/png' },
          { alt: 'image', caption: 'Valid screenshot', src: 'data:image/png;base64,aGVsbG8=', mimeType: 'image/png' },
        ],
      },
    ];

    expect(getConversationRailTurns(messages)).toEqual([
      { index: 0, kind: 'user', label: 'User', snippet: '1 image attachment · Valid screenshot' },
    ]);
  });

  it('strips xml tags and file paths so previews prefer human-language text', () => {
    const messages: MessageBlock[] = [
      {
        type: 'user',
        ts: '2026-03-10T20:00:00.000Z',
        text: '<note><path>/var/folders/c_/wv0qj11n47s5jdvn6z162py80000gn/T/file.png</path></note> Can we make the rail quieter and more readable?',
      },
    ];

    expect(getConversationRailTurns(messages)).toEqual([
      { index: 0, kind: 'user', label: 'User', snippet: 'Can we make the rail quieter and more readable?' },
    ]);
  });

  it('falls back when a user message only contains technical path noise', () => {
    const messages: MessageBlock[] = [
      {
        type: 'user',
        ts: '2026-03-10T20:00:00.000Z',
        text: '/var/folders/c_/wv0qj11n47s5jdvn6z162py80000gn/T/file.png',
      },
    ];

    expect(getConversationRailTurns(messages)).toEqual([
      { index: 0, kind: 'user', label: 'User', snippet: 'Message' },
    ]);
  });

  it('drops escaped screenshot filenames and keeps the actual request text', () => {
    const messages: MessageBlock[] = [
      {
        type: 'user',
        ts: '2026-03-10T20:00:00.000Z',
        text: '/var/folders/c_/tmp/Screenshot\\ 2026-03-10\\ at\\ 7.58.51\\ PM.png Get rid of the bold text',
      },
    ];

    expect(getConversationRailTurns(messages)).toEqual([
      { index: 0, kind: 'user', label: 'User', snippet: 'Get rid of the bold text' },
    ]);
  });

  it('includes only user turns', () => {
    const messages: MessageBlock[] = [
      { type: 'user', ts: '2026-03-10T20:00:00.000Z', text: 'First user turn' },
      { type: 'tool_use', ts: '2026-03-10T20:00:01.000Z', tool: 'bash', input: {}, output: '' },
      { type: 'text', ts: '2026-03-10T20:00:02.000Z', text: 'Assistant reply' },
      { type: 'thinking', ts: '2026-03-10T20:00:03.000Z', text: 'hidden' },
    ];

    expect(getConversationRailTurns(messages)).toEqual([
      { index: 0, kind: 'user', label: 'User', snippet: 'First user turn' },
    ]);
  });

  it('defaults fractional snippet limits instead of letting slice truncate them', () => {
    const messages: MessageBlock[] = [
      { type: 'user', ts: '2026-03-10T20:00:00.000Z', text: 'Please keep this readable' },
    ];

    expect(getConversationRailTurns(messages, 3.5)).toEqual([
      { index: 0, kind: 'user', label: 'User', snippet: 'Please keep this readable' },
    ]);
  });

  it('can offset marker indexes for windowed transcript slices', () => {
    const messages: MessageBlock[] = [
      { type: 'user', ts: '2026-03-10T20:00:00.000Z', text: 'Windowed user turn' },
      { type: 'text', ts: '2026-03-10T20:00:01.000Z', text: 'Assistant reply' },
    ];

    expect(getConversationRailTurns(messages, undefined, 12)).toEqual([
      { index: 12, kind: 'user', label: 'User', snippet: 'Windowed user turn' },
    ]);
  });
});

describe('conversation rail fisheye', () => {
  it('pushes nearby markers away from the cursor and leaves far markers alone', () => {
    expect(applyConversationRailFisheye(90, 120, 80, 12)).toBeLessThan(90);
    expect(applyConversationRailFisheye(150, 120, 80, 12)).toBeGreaterThan(150);
    expect(applyConversationRailFisheye(20, 120, 40, 12)).toBe(20);
  });

  it('picks the nearest projected marker', () => {
    expect(pickNearestConversationRailMarker([
      { index: 1, baseY: 24, displayY: 22 },
      { index: 7, baseY: 96, displayY: 105 },
      { index: 10, baseY: 180, displayY: 176 },
    ], 110)).toEqual({ index: 7, baseY: 96, displayY: 105 });

    expect(pickNearestConversationRailMarker([], 50)).toBeNull();
  });
});

describe('conversation rail viewport math', () => {
  const metrics = {
    clientHeight: 400,
    contentHeight: 1000,
    trackHeight: 368,
    viewportHeightPx: 147.2,
  };

  it('maps scroll range to thumb travel like a scrollbar', () => {
    expect(getConversationRailViewportTop(metrics, 0)).toBe(0);
    expect(getConversationRailViewportTop(metrics, 300)).toBeCloseTo(110.4);
    expect(getConversationRailViewportTop(metrics, 600)).toBeCloseTo(220.8);
  });

  it('maps dragged thumb position back to scrollTop', () => {
    expect(getConversationRailScrollTopFromThumb({
      metrics,
      pointerY: 147.2,
      dragOffsetPx: 36.8,
    })).toBeCloseTo(300);
  });

  it('detects hits inside the viewport thumb', () => {
    expect(isConversationRailThumbHit(90, 80, 40)).toBe(true);
    expect(isConversationRailThumbHit(79, 80, 40)).toBe(false);
    expect(isConversationRailThumbHit(121, 80, 40)).toBe(false);
  });
});

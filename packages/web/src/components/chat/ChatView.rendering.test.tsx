// @vitest-environment jsdom
import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import type { MessageBlock } from '../../shared/types';

const timeAgoSpy = vi.hoisted(() => vi.fn<(iso: string) => void>());

vi.mock('../../shared/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../shared/utils')>();
  return {
    ...actual,
    timeAgo: vi.fn((iso: string) => {
      timeAgoSpy(iso);
      return actual.timeAgo(iso);
    }),
  };
});

import { ChatView } from './ChatView';

const mountedRoots: Root[] = [];

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

function createUserBlock(): Extract<MessageBlock, { type: 'user' }> {
  return {
    id: 'user-1',
    type: 'user',
    ts: '2026-04-23T18:00:00.000Z',
    text: 'User prompt',
  };
}

function createAssistantBlock(): Extract<MessageBlock, { type: 'text' }> {
  return {
    id: 'assistant-1',
    type: 'text',
    ts: '2026-04-23T18:00:01.000Z',
    text: 'Stable assistant reply',
  };
}

function createStreamingTail(text: string): Extract<MessageBlock, { type: 'text' }> {
  return {
    id: 'assistant-tail',
    type: 'text',
    ts: '2026-04-23T18:00:02.000Z',
    text,
  };
}

function renderChatView(messages: MessageBlock[]) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(<ChatView messages={messages} isStreaming />);
  });

  mountedRoots.push(root);
  return { container, root };
}

describe('ChatView rendering stability', () => {
  beforeEach(() => {
    timeAgoSpy.mockReset();
    if (!window.requestAnimationFrame) {
      window.requestAnimationFrame = ((callback: FrameRequestCallback) => window.setTimeout(() => callback(performance.now()), 0)) as typeof window.requestAnimationFrame;
    }
    if (!window.cancelAnimationFrame) {
      window.cancelAnimationFrame = ((handle: number) => window.clearTimeout(handle)) as typeof window.cancelAnimationFrame;
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
    for (const root of mountedRoots.splice(0)) {
      act(() => {
        root.unmount();
      });
    }
    document.body.innerHTML = '';
  });

  it('does not rerender stable transcript rows when only the streaming tail changes', () => {
    const userBlock = createUserBlock();
    const assistantBlock = createAssistantBlock();
    const initialTail = createStreamingTail('Tail draft');
    const { container, root } = renderChatView([userBlock, assistantBlock, initialTail]);

    expect(container.textContent).toContain('Tail draft');

    timeAgoSpy.mockClear();
    const updatedTail = {
      ...initialTail,
      text: 'Tail draft with more output',
    } satisfies Extract<MessageBlock, { type: 'text' }>;

    act(() => {
      root.render(<ChatView messages={[userBlock, assistantBlock, updatedTail]} isStreaming />);
    });

    expect(container.textContent).toContain('Tail draft with more output');
    expect(timeAgoSpy).toHaveBeenCalledTimes(1);
    expect(timeAgoSpy).toHaveBeenCalledWith(updatedTail.ts);
  });

  it('does not install continuous reply-selection polling when selection replies are enabled', () => {
    const setIntervalSpy = vi.spyOn(window, 'setInterval');

    renderChatView([createAssistantBlock()]);

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoots.push(root);

    act(() => {
      root.render(
        <ChatView
          messages={[createAssistantBlock()]}
          onReplyToSelection={() => undefined}
        />,
      );
    });

    expect(setIntervalSpy).not.toHaveBeenCalled();
  });
});

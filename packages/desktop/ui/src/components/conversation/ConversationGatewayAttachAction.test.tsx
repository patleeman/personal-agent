// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '../../client/api';
import type { GatewayState } from '../../shared/types';
import { ConversationGatewayAttachAction } from './ConversationGatewayAttachAction';

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

const roots: Root[] = [];

function gatewayState(overrides: Partial<GatewayState> = {}): GatewayState {
  return { providers: [], connections: [], bindings: [], chatTargets: [], events: [], ...overrides };
}

function renderAction() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <MemoryRouter>
        <ConversationGatewayAttachAction conversationId="thread-1" conversationTitle="Support thread" />
      </MemoryRouter>,
    );
  });
  roots.push(root);
  return container;
}

async function flushAsyncWork() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
}

function click(element: HTMLElement) {
  act(() => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

describe('ConversationGatewayAttachAction', () => {
  beforeEach(() => {
    vi.spyOn(api, 'gateways');
    vi.spyOn(api, 'attachGatewayConversation');
    vi.spyOn(api, 'detachGatewayConversation');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    for (const root of roots.splice(0)) {
      act(() => root.unmount());
    }
    document.body.innerHTML = '';
  });

  it('attaches the saved Telegram chat to the current conversation', async () => {
    vi.mocked(api.gateways).mockResolvedValue(
      gatewayState({
        connections: [
          {
            id: 'telegram-default',
            provider: 'telegram',
            label: 'Telegram',
            status: 'active',
            enabled: true,
            createdAt: '2026-05-05T00:00:00Z',
            updatedAt: '2026-05-05T00:00:00Z',
          },
        ],
        chatTargets: [
          {
            id: 'telegram-default:chat:123',
            provider: 'telegram',
            connectionId: 'telegram-default',
            externalChatId: '123',
            externalChatLabel: '123',
            conversationId: '',
            repliesEnabled: false,
            createdAt: '2026-05-05T00:00:00Z',
            updatedAt: '2026-05-05T00:00:00Z',
          },
        ],
      }),
    );
    vi.mocked(api.attachGatewayConversation).mockResolvedValue(
      gatewayState({
        connections: [
          {
            id: 'telegram-default',
            provider: 'telegram',
            label: 'Telegram',
            status: 'active',
            enabled: true,
            createdAt: '2026-05-05T00:00:00Z',
            updatedAt: '2026-05-05T00:00:00Z',
          },
        ],
        bindings: [
          {
            id: 'telegram-default:thread-1',
            provider: 'telegram',
            connectionId: 'telegram-default',
            conversationId: 'thread-1',
            conversationTitle: 'Support thread',
            externalChatId: '123',
            externalChatLabel: '123',
            repliesEnabled: true,
            createdAt: '2026-05-05T00:00:00Z',
            updatedAt: '2026-05-05T00:00:00Z',
          },
        ],
      }),
    );

    const container = renderAction();
    await flushAsyncWork();

    const button = Array.from(container.querySelectorAll('button')).find((candidate) => candidate.textContent === 'Attach Telegram');
    expect(button).toBeTruthy();
    click(button!);
    await flushAsyncWork();

    expect(api.attachGatewayConversation).toHaveBeenCalledWith({
      provider: 'telegram',
      conversationId: 'thread-1',
      conversationTitle: 'Support thread',
      externalChatId: '123',
      externalChatLabel: '123',
    });
    expect(container.textContent).toContain('Telegram attached to this thread.');
  });

  it('links to gateway setup when no Telegram chat is configured', async () => {
    vi.mocked(api.gateways).mockResolvedValue(gatewayState());

    const container = renderAction();
    await flushAsyncWork();

    const link = container.querySelector<HTMLAnchorElement>('a[href="/gateways"]');
    expect(link?.textContent).toBe('Set up gateway');
  });
});

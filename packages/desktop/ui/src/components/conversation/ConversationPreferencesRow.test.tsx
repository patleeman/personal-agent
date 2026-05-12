// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { ModelInfo } from '../../shared/types';
import { ConversationPreferencesRow } from './ConversationPreferencesRow';

(globalThis as typeof globalThis & { React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean }).React = React;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const models: ModelInfo[] = [
  {
    id: 'model-a',
    provider: 'Provider A',
    name: 'Model A',
    context: 128000,
    supportedServiceTiers: ['priority'],
  },
];

function rowProps(overrides: Partial<React.ComponentProps<typeof ConversationPreferencesRow>> = {}) {
  return {
    models,
    currentModel: 'model-a',
    currentThinkingLevel: 'medium',
    currentServiceTier: 'priority',
    savingPreference: null,
    composerButtons: [],
    composerButtonContext: {
      composerDisabled: false,
      streamIsStreaming: false,
      composerHasContent: false,
      goalEnabled: false,
      toggleGoal: vi.fn(),
      insertText: vi.fn(),
    },
    onSelectModel: vi.fn(),
    onSelectThinkingLevel: vi.fn(),
    onSelectServiceTier: vi.fn(),
    inlineLimit: Number.POSITIVE_INFINITY,
    ...overrides,
  } satisfies React.ComponentProps<typeof ConversationPreferencesRow>;
}

function renderRow(overrides: Partial<React.ComponentProps<typeof ConversationPreferencesRow>> = {}) {
  return renderToString(<ConversationPreferencesRow {...rowProps(overrides)} />);
}

function renderInteractive(overrides: Partial<React.ComponentProps<typeof ConversationPreferencesRow>> = {}) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<ConversationPreferencesRow {...rowProps(overrides)} />);
  });

  return {
    container,
    unmount: () => {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}

describe('ConversationPreferencesRow', () => {
  it('renders inline model, thinking, and fast mode controls', () => {
    const html = renderRow();

    expect(html).toContain('Conversation model');
    expect(html).toContain('Provider A');
    expect(html).toContain('Model A');
    expect(html).toContain('Conversation thinking level');
    expect(html).toContain('Disable fast mode');
  });

  it('does not render the overflow menu when all preference items fit inline', () => {
    const { container, unmount } = renderInteractive();

    try {
      expect(container.querySelector<HTMLButtonElement>('button[aria-label="More composer settings"]')).toBeNull();
      expect(container.textContent).toContain('Fast');
      expect(container.textContent.indexOf('Fast')).toBeGreaterThan(container.textContent.indexOf('Model A'));
    } finally {
      unmount();
    }
  });

  it('progressively moves overflowing controls into the settings menu', () => {
    const { container, unmount } = renderInteractive({ inlineLimit: 2 });

    try {
      expect(container.textContent).not.toContain('Thinking');
      expect(container.textContent).toContain('Fast');

      const moreButton = container.querySelector<HTMLButtonElement>('button[aria-label="More composer settings"]');
      expect(moreButton).not.toBeNull();
      act(() => {
        moreButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });

      expect(container.textContent).toContain('Model A');
      expect(container.textContent).toContain('Thinking');
      expect(container.textContent).toContain('Fast');
    } finally {
      unmount();
    }
  });

  it('hides fast mode when the selected model does not support priority service tier', () => {
    const html = renderRow({
      models: [{ ...models[0]!, supportedServiceTiers: [] }],
      currentServiceTier: '',
    });

    expect(html).not.toContain('Enable fast mode');
    expect(html).toContain('Conversation thinking level');
  });
});

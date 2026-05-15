// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { ConversationPreferencesRow } from './ConversationPreferencesRow';

vi.mock('../../extensions/ComposerButtonHost', () => ({
  ComposerButtonHost: ({ registration, buttonContext }: { registration: { id: string }; buttonContext: { renderMode: string } }) => (
    <span data-control-id={registration.id} data-render-mode={buttonContext.renderMode}>
      {registration.id}:{buttonContext.renderMode}
    </span>
  ),
}));

(globalThis as typeof globalThis & { React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean }).React = React;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function control(id: string, priority: number) {
  return { extensionId: 'test-extension', id, component: 'Control', slot: 'preferences' as const, priority };
}

function rowProps(overrides: Partial<React.ComponentProps<typeof ConversationPreferencesRow>> = {}) {
  return {
    composerButtons: [control('model-preferences', 10), control('goal-mode', 100)],
    composerButtonContext: {
      composerDisabled: false,
      streamIsStreaming: false,
      composerHasContent: false,
      openFilePicker: vi.fn(),
      addFiles: vi.fn(),
      insertText: vi.fn(),
      models: [],
      currentModel: '',
      currentThinkingLevel: '',
      currentServiceTier: '',
      savingPreference: null,
      selectModel: vi.fn(),
      selectThinkingLevel: vi.fn(),
      selectServiceTier: vi.fn(),
      goalEnabled: false,
      toggleGoal: vi.fn(),
    },
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
  it('renders composer controls inline', () => {
    const html = renderRow();

    expect(html).toContain('data-control-id="model-preferences"');
    expect(html).toContain('data-render-mode="inline"');
    expect(html).toContain('data-control-id="goal-mode"');
  });

  it('does not render the overflow menu when all preference controls fit inline', () => {
    const { container, unmount } = renderInteractive();

    try {
      expect(container.querySelector<HTMLButtonElement>('button[aria-label="More composer settings"]')).toBeNull();
      expect(container.textContent).toContain('model-preferences:inline');
      expect(container.textContent).toContain('goal-mode:inline');
    } finally {
      unmount();
    }
  });

  it('moves extra controls into the settings menu', () => {
    const { container, unmount } = renderInteractive({ inlineLimit: 1 });

    try {
      expect(container.textContent).toContain('model-preferences:inline');
      expect(container.textContent).not.toContain('goal-mode:menu');

      const moreButton = container.querySelector<HTMLButtonElement>('button[aria-label="More composer settings"]');
      expect(moreButton).not.toBeNull();
      act(() => moreButton?.click());
      expect(container.textContent).toContain('goal-mode:menu');
    } finally {
      unmount();
    }
  });
});

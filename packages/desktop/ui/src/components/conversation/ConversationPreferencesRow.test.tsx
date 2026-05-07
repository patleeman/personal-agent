import React from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { ModelInfo } from '../../shared/types';
import { ConversationPreferencesRow } from './ConversationPreferencesRow';

(globalThis as typeof globalThis & { React?: typeof React }).React = React;

const models: ModelInfo[] = [
  {
    id: 'model-a',
    provider: 'Provider A',
    name: 'Model A',
    context: 128000,
    supportedServiceTiers: ['priority'],
  },
];

function renderRow(overrides: Partial<React.ComponentProps<typeof ConversationPreferencesRow>> = {}) {
  return renderToString(
    <ConversationPreferencesRow
      models={models}
      currentModel="model-a"
      currentThinkingLevel="medium"
      currentServiceTier="priority"
      savingPreference={null}
      showAutoModeToggle
      autoModeEnabled={false}
      autoModeBusy={false}
      autoModeState={null}
      suggestedAutoModeMission="Finish the current task"
      onSelectModel={vi.fn()}
      onSelectThinkingLevel={vi.fn()}
      onSelectServiceTier={vi.fn()}
      onConfigureAutoMode={vi.fn()}
      compact={false}
      {...overrides}
    />,
  );
}

describe('ConversationPreferencesRow', () => {
  it('renders inline model, thinking, fast, and auto controls', () => {
    const html = renderRow();

    expect(html).toContain('Conversation model');
    expect(html).toContain('Provider A');
    expect(html).toContain('Model A');
    expect(html).toContain('Conversation thinking level');
    expect(html).toContain('Disable fast mode');
    expect(html).toContain('Turn on conversation auto mode');
  });

  it('renders the compact settings affordance without opening the menu on server render', () => {
    const html = renderRow({ compact: true });

    expect(html).toContain('More composer settings');
    expect(html).not.toContain('Composer settings');
    expect(html).not.toContain('Conversation model');
  });

  it('hides fast mode when the selected model does not support priority service tier', () => {
    const html = renderRow({
      models: [{ ...models[0]!, supportedServiceTiers: [] }],
      currentServiceTier: '',
    });

    expect(html).not.toContain('Enable fast mode');
    expect(html).toContain('Turn on conversation auto mode');
  });
});

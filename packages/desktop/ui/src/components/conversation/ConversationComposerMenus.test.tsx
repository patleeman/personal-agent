import React from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { MentionMenu, ModelPicker, SlashMenu } from './ConversationComposerMenus';
import type { ModelInfo } from '../../shared/types';

(globalThis as typeof globalThis & { React?: typeof React }).React = React;

const models: ModelInfo[] = [
  { id: 'model-a', provider: 'Provider A', name: 'Model A', context: 128000 },
  { id: 'model-b', provider: 'Provider A', name: 'Model B', context: 1000000 },
];

describe('ConversationComposerMenus', () => {
  it('renders grouped model choices and focused/current affordances', () => {
    const html = renderToString(
      <ModelPicker
        models={models}
        currentModel="model-a"
        query="model"
        idx={1}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(html).toContain('Switch model');
    expect(html).toContain('Provider A');
    expect(html).toContain('Model A');
    expect(html).toContain('model-a');
    expect(html).toContain('128k');
    expect(html).toContain('Model B');
    expect(html).toContain('1M');
  });

  it('renders an empty model state with the query', () => {
    const html = renderToString(
      <ModelPicker
        models={[]}
        currentModel=""
        query="missing"
        idx={0}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(html).toContain('No models match');
    expect(html).toContain('missing');
  });

  it('renders slash and mention menu entries', () => {
    const slashHtml = renderToString(
      <SlashMenu
        items={[{ key: 'help', cmd: '/help', displayCmd: '/help', desc: 'Show help', icon: '?', source: 'core' }]}
        idx={0}
        onSelect={vi.fn()}
      />,
    );
    expect(slashHtml).toContain('/help');
    expect(slashHtml).toContain('Show help');
    expect(slashHtml).toContain('core');

    const mentionHtml = renderToString(
      <MentionMenu
        items={[{ kind: 'note', id: 'note-one', label: 'note-one', title: 'Note One', summary: 'A useful note' }]}
        query="note"
        idx={0}
        onSelect={vi.fn()}
      />,
    );
    expect(mentionHtml).toContain('Mention');
    expect(mentionHtml).toContain('note-one');
    expect(mentionHtml).toContain('A useful note');
  });
});

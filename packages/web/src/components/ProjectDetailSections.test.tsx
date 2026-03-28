import React from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ProjectActivityContent, ProjectDocumentContent, ProjectPlanOverview, ProjectRequirementsContent } from './ProjectDetailSections.js';

(globalThis as typeof globalThis & { React?: typeof React }).React = React;

describe('ProjectDetailSections markdown rendering', () => {
  it('renders markdown footnotes with isolated ids across detail sections', () => {
    const html = renderToString(
      <>
        <ProjectRequirementsContent
          goal=""
          fallbackContent={'Goal note.[^1]\n\n[^1]: Requirements reference'}
          acceptanceCriteria={[]}
        />
        <ProjectPlanOverview
          planContent={'Plan note.[^1]\n\n[^1]: Plan reference'}
          currentFocus=""
          blockers={[]}
          recentProgress={[]}
          pct={0}
        />
      </>,
    );

    expect(html).toContain('class="footnotes"');
    expect(html).toContain('Requirements reference');
    expect(html).toContain('Plan reference');

    const footnoteIds = Array.from(html.matchAll(/id="([^"]*fn-1)"/g), (match) => match[1]);
    expect(footnoteIds.length).toBeGreaterThanOrEqual(2);
    expect(new Set(footnoteIds).size).toBe(footnoteIds.length);
  });

  it('renders the project document with the same note-style editor frame', () => {
    const html = renderToString(
      <ProjectDocumentContent
        content={'Ship a tight prototype that proves whether proactive help feels useful.'}
        busy={false}
        dirty={false}
        error={null}
        onChange={() => undefined}
      />,
    );

    expect(html).toContain('ui-note-editor-frame');
    expect(html).toContain('ui-note-editor-doc');
    expect(html).not.toContain('For the agent (optional)');
  });

  it('renders activity rows without duplicating relative timestamps', () => {
    const html = renderToString(
      <ProjectActivityContent
        items={[
          {
            id: 'timeline:document:1',
            kind: 'timeline',
            entry: {
              id: 'document:1',
              kind: 'document',
              createdAt: '2026-03-27T14:15:00',
              title: 'Project doc updated',
            },
          },
        ]}
      />,
    );

    expect(html).toContain('Project doc updated');
    expect(html).toContain('2:15p');
    expect(html).not.toContain('ago');
  });

  it('shows a compact recent slice of activity before older events', () => {
    const html = renderToString(
      <ProjectActivityContent
        items={Array.from({ length: 7 }, (_, index) => ({
          id: `timeline:document:${index + 1}`,
          kind: 'timeline' as const,
          entry: {
            id: `document:${index + 1}`,
            kind: 'document',
            createdAt: `2026-03-27T14:1${index}:00`,
            title: `Activity item ${index + 1}`,
          },
        }))}
      />,
    );

    expect(html).toContain('Activity item 1');
    expect(html).toContain('Activity item 6');
    expect(html).not.toContain('Activity item 7');
    expect(html).toContain('Show 1 older event');
  });
});

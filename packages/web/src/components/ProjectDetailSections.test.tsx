import React from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ProjectPlanOverview, ProjectRequirementsContent } from './ProjectDetailSections.js';

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
});

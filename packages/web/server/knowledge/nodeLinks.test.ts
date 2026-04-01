import { describe, expect, it } from 'vitest';
import { buildNodeLinksFromDocuments } from './nodeLinks.js';

describe('nodeLinks', () => {
  it('builds outgoing and incoming links from explicit refs and @mentions', () => {
    const links = buildNodeLinksFromDocuments([
      {
        kind: 'note',
        id: 'research-index',
        title: 'Research Index',
        summary: 'Structure note',
        path: '/tmp/research-index/INDEX.md',
        contentParts: ['See @agent-browser for validation.'],
        explicitTargets: [{ id: 'paper-summary', kindHint: 'note' }],
      },
      {
        kind: 'note',
        id: 'paper-summary',
        title: 'Paper Summary',
        summary: 'Evergreen note',
        path: '/tmp/paper-summary/INDEX.md',
        contentParts: ['Tracks the paper.'],
        explicitTargets: [],
      },
      {
        kind: 'skill',
        id: 'agent-browser',
        title: 'Agent Browser',
        summary: 'Browser automation skill',
        path: '/tmp/agent-browser/INDEX.md',
        contentParts: ['Use for browser checks.'],
        explicitTargets: [],
      },
    ]);

    expect(links.get('note:research-index')).toEqual({
      outgoing: [
        {
          kind: 'note',
          id: 'paper-summary',
          title: 'Paper Summary',
          summary: 'Evergreen note',
        },
        {
          kind: 'skill',
          id: 'agent-browser',
          title: 'Agent Browser',
          summary: 'Browser automation skill',
        },
      ],
      incoming: [],
      unresolved: [],
    });

    expect(links.get('note:paper-summary')?.incoming).toEqual([
      {
        kind: 'note',
        id: 'research-index',
        title: 'Research Index',
        summary: 'Structure note',
      },
    ]);
    expect(links.get('skill:agent-browser')?.incoming).toEqual([
      {
        kind: 'note',
        id: 'research-index',
        title: 'Research Index',
        summary: 'Structure note',
      },
    ]);
  });

  it('derives project links from project docs and notes instead of project metadata', () => {
    const links = buildNodeLinksFromDocuments([
      {
        kind: 'project',
        id: 'ship-ui',
        title: 'Ship UI',
        summary: 'Project node',
        path: '/tmp/ship-ui/INDEX.md',
        contentParts: [
          'Project doc mentions @agent-browser.',
          'Decision log',
          'Follow up with @paper-summary before the rollout.',
        ],
        explicitTargets: [],
      },
      {
        kind: 'note',
        id: 'paper-summary',
        title: 'Paper Summary',
        summary: 'Evergreen note',
        path: '/tmp/paper-summary/INDEX.md',
        contentParts: ['Tracks the paper.'],
        explicitTargets: [],
      },
      {
        kind: 'skill',
        id: 'agent-browser',
        title: 'Agent Browser',
        summary: 'Browser automation skill',
        path: '/tmp/agent-browser/INDEX.md',
        contentParts: ['Use for browser checks.'],
        explicitTargets: [],
      },
    ]);

    expect(links.get('project:ship-ui')).toEqual({
      outgoing: [
        {
          kind: 'note',
          id: 'paper-summary',
          title: 'Paper Summary',
          summary: 'Evergreen note',
        },
        {
          kind: 'skill',
          id: 'agent-browser',
          title: 'Agent Browser',
          summary: 'Browser automation skill',
        },
      ],
      incoming: [],
      unresolved: [],
    });
  });

  it('tracks unresolved ids when a mention is missing or ambiguous', () => {
    const links = buildNodeLinksFromDocuments([
      {
        kind: 'project',
        id: 'ship-ui',
        title: 'Ship UI',
        summary: 'Project node',
        path: '/tmp/ship-ui/state.yaml',
        contentParts: ['Depends on @missing-node and @shared-id.'],
        explicitTargets: [],
      },
      {
        kind: 'note',
        id: 'shared-id',
        title: 'Shared note',
        summary: 'Note',
        path: '/tmp/shared-id/INDEX.md',
        contentParts: [],
        explicitTargets: [],
      },
      {
        kind: 'skill',
        id: 'shared-id',
        title: 'Shared skill',
        summary: 'Skill',
        path: '/tmp/shared-id-skill/INDEX.md',
        contentParts: [],
        explicitTargets: [],
      },
    ]);

    expect(links.get('project:ship-ui')).toEqual({
      outgoing: [],
      incoming: [],
      unresolved: ['missing-node', 'shared-id'],
    });
  });
});

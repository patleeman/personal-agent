import { beforeEach, describe, expect, it, vi } from 'vitest';

const loadUnifiedNodesMock = vi.hoisted(() => vi.fn());

vi.mock('@personal-agent/core', () => ({
  loadUnifiedNodes: loadUnifiedNodesMock,
}));

import { expandPromptReferencesWithNodeGraph } from './promptReferences.js';

describe('expandPromptReferencesWithNodeGraph', () => {
  beforeEach(() => {
    loadUnifiedNodesMock.mockReset();
  });

  it('adds parent, relationship, and child node references without duplicating seeds', () => {
    loadUnifiedNodesMock.mockReturnValue({
      nodes: [
        {
          id: 'project-seed',
          type: 'project',
          kinds: [],
          links: {
            parent: 'parent-project',
            related: [],
            conversations: [],
            relationships: [
              { type: 'uses', targetId: 'skill-related' },
              { type: 'notes', targetId: 'note-related' },
              { type: 'missing', targetId: 'missing-node' },
            ],
          },
        },
        {
          id: 'parent-project',
          type: 'note',
          kinds: ['project'],
          links: {
            related: [],
            conversations: [],
            relationships: [],
          },
        },
        {
          id: 'memory-seed',
          type: 'note',
          kinds: [],
          links: {
            parent: 'parent-project',
            related: [],
            conversations: [],
            relationships: [{ type: 'supports', targetId: 'child-note' }],
          },
        },
        {
          id: 'skill-related',
          type: 'skill',
          kinds: [],
          links: {
            related: [],
            conversations: [],
            relationships: [],
          },
        },
        {
          id: 'note-related',
          type: 'note',
          kinds: [],
          links: {
            related: [],
            conversations: [],
            relationships: [],
          },
        },
        {
          id: 'child-note',
          type: 'note',
          kinds: [],
          links: {
            parent: 'project-seed',
            related: [],
            conversations: [],
            relationships: [],
          },
        },
      ],
      parseErrors: [],
    });

    expect(
      expandPromptReferencesWithNodeGraph({
        projectIds: ['project-seed'],
        memoryDocIds: ['memory-seed'],
        skillNames: ['missing-seed'],
        maxRelatedPerSeed: 2,
      }),
    ).toEqual({
      projectIds: ['project-seed', 'parent-project'],
      memoryDocIds: ['memory-seed', 'child-note'],
      skillNames: ['missing-seed', 'skill-related'],
    });

    expect(loadUnifiedNodesMock).toHaveBeenCalledWith();
  });

  it('defaults malformed related-node limits instead of honoring fractional values', () => {
    loadUnifiedNodesMock.mockReturnValue({
      nodes: [
        {
          id: 'seed',
          type: 'note',
          kinds: [],
          links: {
            related: [],
            conversations: [],
            relationships: [
              { type: 'mentions', targetId: 'one' },
              { type: 'mentions', targetId: 'two' },
              { type: 'mentions', targetId: 'three' },
            ],
          },
        },
        ...['one', 'two', 'three'].map((id) => ({
          id,
          type: 'note',
          kinds: [],
          links: { related: [], conversations: [], relationships: [] },
        })),
      ],
      parseErrors: [],
    });

    expect(
      expandPromptReferencesWithNodeGraph({
        projectIds: [],
        memoryDocIds: ['seed'],
        skillNames: [],
        maxRelatedPerSeed: 0.5,
      }),
    ).toMatchObject({
      memoryDocIds: ['seed', 'one', 'two'],
    });
  });

  it('caps absurd related-node limits instead of expanding every linked node', () => {
    loadUnifiedNodesMock.mockReturnValue({
      nodes: [
        {
          id: 'seed',
          type: 'note',
          kinds: [],
          links: {
            related: [],
            conversations: [],
            relationships: Array.from({ length: 24 }, (_, index) => ({ type: 'mentions', targetId: `note-${index}` })),
          },
        },
        ...Array.from({ length: 24 }, (_, index) => ({
          id: `note-${index}`,
          type: 'note',
          kinds: [],
          links: { related: [], conversations: [], relationships: [] },
        })),
      ],
      parseErrors: [],
    });

    expect(
      expandPromptReferencesWithNodeGraph({
        projectIds: [],
        memoryDocIds: ['seed'],
        skillNames: [],
        maxRelatedPerSeed: Number.MAX_SAFE_INTEGER,
      }).memoryDocIds,
    ).toEqual(['seed', ...Array.from({ length: 20 }, (_, index) => `note-${index}`)]);
  });
});

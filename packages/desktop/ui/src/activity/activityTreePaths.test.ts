import { describe, expect, it } from 'vitest';

import type { ActivityTreeItem } from './activityTree';
import { buildActivityTreePathModel } from './activityTreePaths';

function item(overrides: Partial<ActivityTreeItem> & Pick<ActivityTreeItem, 'id' | 'title'>): ActivityTreeItem {
  return {
    kind: overrides.kind ?? 'conversation',
    status: overrides.status ?? 'idle',
    ...overrides,
  };
}

describe('buildActivityTreePathModel', () => {
  it('turns parent-linked activity items into Pierre tree paths', () => {
    const model = buildActivityTreePathModel([
      item({ id: 'conversation:1', title: 'Build activity tree' }),
      item({ id: 'run:1', kind: 'run', parentId: 'conversation:1', title: 'npm test', status: 'running' }),
    ]);

    expect(model.paths).toEqual(['Build activity tree', 'Build activity tree/npm test']);
    expect(model.itemByPath.get('Build activity tree/npm test')).toEqual(expect.objectContaining({ id: 'run:1' }));
  });

  it('keeps duplicate sibling titles addressable', () => {
    const model = buildActivityTreePathModel([
      item({ id: 'conversation:1', title: 'Untitled' }),
      item({ id: 'conversation:2', title: 'Untitled' }),
    ]);

    expect(model.paths).toEqual(['Untitled', 'Untitled 2']);
  });

  it('sanitizes path separators from titles', () => {
    const model = buildActivityTreePathModel([item({ id: 'conversation:1', title: 'Fix / bad / title' })]);

    expect(model.paths).toEqual(['Fix bad title']);
  });
});

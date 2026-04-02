import { describe, expect, it } from 'vitest';
import {
  buildNodeCreateSearch,
  buildNodesHref,
  readCreateNodeKind,
  readCreateNodeParent,
  readCreatingNode,
  readNodeBrowserFilter,
  readSelectedNode,
} from './nodeWorkspaceState';

describe('nodeWorkspaceState', () => {
  it('builds page hrefs with page selection', () => {
    expect(buildNodesHref('project', 'active-project')).toBe('/pages?kind=project&page=active-project');
  });

  it('reads the selected page from modern or legacy params', () => {
    expect(readSelectedNode('?kind=note&page=memory-index')).toEqual({ kind: 'note', id: 'memory-index' });
    expect(readSelectedNode('?kind=skill&node=agent-browser')).toEqual({ kind: 'skill', id: 'agent-browser' });
  });

  it('builds page-creation search state without keeping the selected page', () => {
    expect(buildNodeCreateSearch('?type=project&kind=project&page=ship-it', {
      creating: true,
      createKind: 'note',
      parent: 'ship-it',
    })).toBe('?type=page&new=1&createType=note&parent=ship-it');
    expect(buildNodeCreateSearch('?type=note&new=1&createType=note&parent=ship-it', {
      creating: false,
    })).toBe('?type=page');
  });

  it('reads page-creation state and defaults the role to note', () => {
    expect(readCreatingNode('?new=1&createType=project&parent=platform-architecture')).toBe(true);
    expect(readCreateNodeKind('?new=1&createType=project')).toBe('project');
    expect(readCreateNodeKind('?new=1')).toBe('note');
    expect(readCreateNodeParent('?new=1&parent=platform-architecture')).toBe('platform-architecture');
    expect(readCreateNodeParent('?new=1')).toBeNull();
  });

  it('normalizes legacy note/project filters to page', () => {
    expect(readNodeBrowserFilter('?type=note')).toBe('page');
    expect(readNodeBrowserFilter('?type=project')).toBe('page');
    expect(readNodeBrowserFilter('?type=page')).toBe('page');
    expect(readNodeBrowserFilter('?type=skill')).toBe('skill');
  });
});

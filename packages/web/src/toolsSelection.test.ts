import { describe, expect, it } from 'vitest';
import { buildToolsSearch, getToolsSelectionKey, parseToolsSelection } from './toolsSelection.js';

describe('toolsSelection', () => {
  it('parses supported tool rail selections from search params', () => {
    expect(parseToolsSelection('?inspect=tool&name=project')).toEqual({ kind: 'tool', name: 'project' });
    expect(parseToolsSelection('?inspect=package-target&target=profile&profile=datadog')).toEqual({
      kind: 'package-target',
      target: 'profile',
      profileName: 'datadog',
    });
    expect(parseToolsSelection('?inspect=cli&id=op')).toEqual({ kind: 'cli', id: 'op' });
    expect(parseToolsSelection('?inspect=mcp-server&server=atlassian')).toEqual({ kind: 'mcp-server', server: 'atlassian' });
    expect(parseToolsSelection('?inspect=mcp-tool&server=atlassian&tool=search')).toEqual({
      kind: 'mcp-tool',
      server: 'atlassian',
      tool: 'search',
    });
  });

  it('builds tool rail selections while preserving unrelated params', () => {
    expect(buildToolsSearch('?q=memory', { kind: 'tool', name: 'project' })).toBe('?q=memory&inspect=tool&name=project');
    expect(buildToolsSearch('?q=memory&inspect=tool&name=project', {
      kind: 'mcp-tool',
      server: 'atlassian',
      tool: 'search',
    })).toBe('?q=memory&inspect=mcp-tool&server=atlassian&tool=search');
    expect(buildToolsSearch('?q=memory&inspect=tool&name=project', null)).toBe('?q=memory');
  });

  it('creates stable comparison keys for selections', () => {
    expect(getToolsSelectionKey({ kind: 'tool', name: 'project' })).toBe('tool:project');
    expect(getToolsSelectionKey({ kind: 'package-target', target: 'profile', profileName: 'datadog' })).toBe('package-target:profile:datadog');
    expect(getToolsSelectionKey({ kind: 'mcp-tool', server: 'atlassian', tool: 'search' })).toBe('mcp-tool:atlassian:search');
    expect(getToolsSelectionKey(null)).toBeNull();
  });
});

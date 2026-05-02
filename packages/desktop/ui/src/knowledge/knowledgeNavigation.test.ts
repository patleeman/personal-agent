import { describe, expect, it, vi } from 'vitest';
import { navigateKnowledgeFile } from './knowledgeNavigation';

describe('navigateKnowledgeFile', () => {
  it('pushes note selections by default', () => {
    const setSearchParams = vi.fn();

    navigateKnowledgeFile(setSearchParams, 'notes/demo.md');

    expect(setSearchParams).toHaveBeenCalledWith({ file: 'notes/demo.md' }, {});
  });

  it('can replace history entries when explicitly requested', () => {
    const setSearchParams = vi.fn();

    navigateKnowledgeFile(setSearchParams, 'notes/demo-renamed.md', { replace: true });

    expect(setSearchParams).toHaveBeenCalledWith({ file: 'notes/demo-renamed.md' }, { replace: true });
  });

  it('clears the file selection when passed an empty id', () => {
    const setSearchParams = vi.fn();

    navigateKnowledgeFile(setSearchParams, '   ');

    expect(setSearchParams).toHaveBeenCalledWith({}, {});
  });
});

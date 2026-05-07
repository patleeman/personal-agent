import { describe, expect, it } from 'vitest';

import { getAppNameFromSearch, setAppNameInSearch } from './appSearchParams';

// ── appSearchParams — URL param helpers for skill apps ──────────────────────

describe('appSearchParams', () => {
  describe('getAppNameFromSearch', () => {
    it('returns null for empty search string', () => {
      expect(getAppNameFromSearch('')).toBeNull();
    });

    it('returns null when app param is absent', () => {
      expect(getAppNameFromSearch('?other=value')).toBeNull();
    });

    it('returns the app name when present', () => {
      expect(getAppNameFromSearch('?app=my-app')).toBe('my-app');
    });

    it('handles search with multiple params', () => {
      expect(getAppNameFromSearch('?file=doc.md&app=dashboard&view=zen')).toBe('dashboard');
    });
  });

  describe('setAppNameInSearch', () => {
    it('adds app param to empty search', () => {
      const result = setAppNameInSearch('', 'my-app');
      expect(result).toContain('app=my-app');
    });

    it('removes app param when null', () => {
      const result = setAppNameInSearch('?app=my-app', null);
      expect(result).not.toContain('app=');
    });

    it('replaces existing app param', () => {
      const result = setAppNameInSearch('?app=old&file=doc.md', 'new');
      expect(result).toContain('app=new');
      expect(result).toContain('file=doc');
    });

    it('preserves other params when setting', () => {
      const result = setAppNameInSearch('?file=doc.md&view=compact', 'dashboard');
      expect(result).toContain('app=dashboard');
      expect(result).toContain('file=doc');
      expect(result).toContain('view=compact');
    });
  });
});

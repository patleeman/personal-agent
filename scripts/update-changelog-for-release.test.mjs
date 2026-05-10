import { describe, expect, it } from 'vitest';

import { applyChangelogRelease, formatReleaseSection } from './update-changelog-for-release.mjs';

describe('update-changelog-for-release', () => {
  it('formats a release section from commit entries', () => {
    expect(formatReleaseSection('0.7.9', '2026-05-10', ['Fix the thing'])).toBe('## 0.7.9 — 2026-05-10\n\n- Fix the thing\n');
  });

  it('inserts a new release below the changelog title', () => {
    const content = '# Changelog\n\n## 0.7.8 — 2026-05-09\n\n- Previous release\n';

    const result = applyChangelogRelease(content, '0.7.9', '2026-05-10', ['Add release notes']);

    expect(result.changed).toBe(true);
    expect(result.content).toBe(
      '# Changelog\n\n## 0.7.9 — 2026-05-10\n\n- Add release notes\n\n## 0.7.8 — 2026-05-09\n\n- Previous release\n',
    );
  });

  it('does not duplicate an existing release entry', () => {
    const content = '# Changelog\n\n## 0.7.9 — 2026-05-10\n\n- Existing release\n';

    const result = applyChangelogRelease(content, '0.7.9', '2026-05-10', ['Ignored']);

    expect(result.changed).toBe(false);
    expect(result.content).toBe(content);
  });
});

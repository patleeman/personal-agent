import { describe, expect, it } from 'vitest';

import { applyLatestPiVersion, resolvePiDependencyRange } from './update-pi-version.mjs';

describe('update-pi-version', () => {
  it('updates the root pi dependency to the latest caret range', () => {
    const rootPackage = {
      name: 'personal-agent',
      dependencies: {
        '@mariozechner/pi-coding-agent': '^0.69.0',
        jsdom: '^24.0.0',
      },
    };

    const result = applyLatestPiVersion(rootPackage, '0.70.0');

    expect(result.changed).toBe(true);
    expect(result.nextRange).toBe('^0.70.0');
    expect(result.packageJson.dependencies['@mariozechner/pi-coding-agent']).toBe('^0.70.0');
    expect(result.packageJson.dependencies.jsdom).toBe('^24.0.0');
  });

  it('is a no-op when pi is already at the latest range', () => {
    const rootPackage = {
      name: 'personal-agent',
      dependencies: {
        '@mariozechner/pi-coding-agent': '^0.70.0',
      },
    };

    const result = applyLatestPiVersion(rootPackage, '0.70.0');

    expect(result.changed).toBe(false);
    expect(result.packageJson).toBe(rootPackage);
  });

  it('builds a caret dependency range from the published pi version', () => {
    expect(resolvePiDependencyRange('0.70.0')).toBe('^0.70.0');
  });
});

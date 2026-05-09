// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { systemExtensionModules } from './systemExtensionModules';
import { __resetLoadedStylesForTest, useExtensionStyles } from './useExtensionStyles';

describe('useExtensionStyles', () => {
  afterEach(() => {
    // Clean up injected link elements
    document.head.querySelectorAll('[data-extension-style]').forEach((el) => el.remove());
    __resetLoadedStylesForTest();
  });

  it('does not inject styles for system extensions (Vite handles CSS)', () => {
    const systemId = 'system-knowledge';
    expect(systemExtensionModules.has(systemId)).toBe(true);

    renderHook(() => useExtensionStyles(systemId, ['src/components/knowledge.css']));

    const links = document.head.querySelectorAll('link[data-extension-style]');
    expect(links.length).toBe(0);
  });

  it('injects stylesheets for non-system extensions', () => {
    const extensionId = 'some-user-extension';
    expect(systemExtensionModules.has(extensionId)).toBe(false);

    renderHook(() => useExtensionStyles(extensionId, ['styles/main.css', 'styles/extra.css']));

    const links = document.head.querySelectorAll('link[data-extension-style]');
    expect(links.length).toBe(2);

    const keys = Array.from(links).map((link) => link.getAttribute('data-extension-style'));
    expect(keys).toContain('some-user-extension:styles/main.css');
    expect(keys).toContain('some-user-extension:styles/extra.css');

    // Verify hrefs point to the extension file endpoint
    const hrefs = Array.from(links).map((link) => link.getAttribute('href'));
    for (const href of hrefs) {
      expect(href).toMatch(/\/api\/extensions\/some-user-extension\/files\//);
    }
  });

  it('does not duplicate stylesheets across multiple renders', () => {
    const extensionId = 'dedup-extension';
    expect(systemExtensionModules.has(extensionId)).toBe(false);

    const { rerender } = renderHook(() => useExtensionStyles(extensionId, ['theme.css']));

    expect(document.head.querySelectorAll('link[data-extension-style]').length).toBe(1);

    // Re-render with same styles — should not add duplicates
    rerender();
    expect(document.head.querySelectorAll('link[data-extension-style]').length).toBe(1);
  });

  it('does nothing when no styles are provided', () => {
    renderHook(() => useExtensionStyles('some-extension', undefined));
    expect(document.head.querySelectorAll('link[data-extension-style]').length).toBe(0);

    renderHook(() => useExtensionStyles('some-extension', []));
    expect(document.head.querySelectorAll('link[data-extension-style]').length).toBe(0);
  });
});

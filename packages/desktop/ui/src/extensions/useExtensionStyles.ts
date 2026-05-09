import { useEffect } from 'react';

import { buildApiPath } from '../client/apiBase';
import { systemExtensionModules } from './systemExtensionModules';

/**
 * Tracks which extension stylesheets have already been injected into the DOM.
 * A single global set ensures deduplication across all extension surfaces.
 */
const loadedStyles = new Set<string>();

/**
 * @internal — exported only for testing.
 */
export function __resetLoadedStylesForTest(): void {
  loadedStyles.clear();
}

const RESOLVE_CACHE = new Map<string, string>();

function resolveExtensionStyleUrl(extensionId: string, stylePath: string): string {
  const cacheKey = `${extensionId}:${stylePath}`;
  const cached = RESOLVE_CACHE.get(cacheKey);
  if (cached) return cached;
  const url = buildApiPath(
    `/extensions/${encodeURIComponent(extensionId)}/files/${stylePath.split('/').map(encodeURIComponent).join('/')}`,
  );
  RESOLVE_CACHE.set(cacheKey, url);
  return url;
}

/**
 * Injects `<link rel="stylesheet">` elements for the extension's declared
 * frontend stylesheets. Only acts for non-system extensions — system extensions
 * are Vite-bundled and their CSS imports are handled automatically.
 *
 * Safe to call multiple times for the same extension; each stylesheet is
 * injected at most once (global dedup by `extensionId:stylePath`).
 */
export function useExtensionStyles(extensionId: string, styles: string[] | undefined): void {
  useEffect(() => {
    // System extensions rely on Vite's CSS import — skip.
    if (systemExtensionModules.has(extensionId)) return;
    if (!styles || styles.length === 0) return;

    for (const stylePath of styles) {
      const key = `${extensionId}:${stylePath}`;
      if (loadedStyles.has(key)) continue;
      loadedStyles.add(key);

      const url = resolveExtensionStyleUrl(extensionId, stylePath);
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = url;
      link.dataset.extensionStyle = key;
      document.head.appendChild(link);
    }
  }, [extensionId, styles]);
}

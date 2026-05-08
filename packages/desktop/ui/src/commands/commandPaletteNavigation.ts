import type { ExtensionSurfaceSummary } from '../extensions/types';
import { routeSupportsWorkbenchFilePane } from '../navigation/routeRegistry';
import type { AppLayoutMode } from '../ui-state/appLayoutMode';

export function supportsWorkbenchFilePane(pathname: string, surfaces: ExtensionSurfaceSummary[] = []): boolean {
  return routeSupportsWorkbenchFilePane(pathname, surfaces);
}

export function buildCommandPaletteFileOpenRoute(input: {
  pathname: string;
  search: string;
  hash?: string;
  layoutMode: AppLayoutMode;
  fileId: string;
  extensionSurfaces?: ExtensionSurfaceSummary[];
}): string {
  if (input.layoutMode === 'workbench' && supportsWorkbenchFilePane(input.pathname, input.extensionSurfaces)) {
    const searchParams = new URLSearchParams(input.search.startsWith('?') ? input.search.slice(1) : input.search);
    searchParams.set('file', input.fileId);

    const query = searchParams.toString();
    return `${input.pathname}${query ? `?${query}` : ''}${input.hash ?? ''}`;
  }

  return `/knowledge?file=${encodeURIComponent(input.fileId)}`;
}

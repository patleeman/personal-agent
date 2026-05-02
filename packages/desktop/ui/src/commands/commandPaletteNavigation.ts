import type { AppLayoutMode } from '../ui-state/appLayoutMode';

export function supportsWorkbenchFilePane(pathname: string): boolean {
  return (
    pathname === '/conversations' ||
    pathname.startsWith('/conversations/') ||
    pathname === '/automations' ||
    pathname.startsWith('/automations/')
  );
}

export function buildCommandPaletteFileOpenRoute(input: {
  pathname: string;
  search: string;
  hash?: string;
  layoutMode: AppLayoutMode;
  fileId: string;
}): string {
  if (input.layoutMode === 'workbench' && supportsWorkbenchFilePane(input.pathname)) {
    const searchParams = new URLSearchParams(input.search.startsWith('?') ? input.search.slice(1) : input.search);
    searchParams.set('file', input.fileId);

    const query = searchParams.toString();
    return `${input.pathname}${query ? `?${query}` : ''}${input.hash ?? ''}`;
  }

  return `/knowledge?file=${encodeURIComponent(input.fileId)}`;
}

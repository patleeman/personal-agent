import { useMemo } from 'react';
import { useLocation } from 'react-router-dom';

import { buildApiPath } from '../client/apiBase';
import { ErrorState, LoadingState } from '../components/ui';
import { TasksPage } from '../pages/TasksPage';
import { isExtensionPageSurface } from './types';
import { useExtensionRegistry } from './useExtensionRegistry';

function routeMatches(route: string, pathname: string): boolean {
  return pathname === route || pathname.startsWith(`${route}/`);
}

function buildExtensionFileSrc(input: {
  extensionId: string;
  entry: string;
  surfaceId: string;
  route: string;
  pathname: string;
  search: string;
  hash: string;
}): string {
  const query = new URLSearchParams({
    surfaceId: input.surfaceId,
    route: input.route,
    pathname: input.pathname,
    search: input.search,
    hash: input.hash,
  });
  return buildApiPath(
    `/extensions/${encodeURIComponent(input.extensionId)}/files/${input.entry.split('/').map(encodeURIComponent).join('/')}?${query.toString()}`,
  );
}

export function ExtensionPage() {
  const location = useLocation();
  const registry = useExtensionRegistry();
  const surface = useMemo(
    () => registry.surfaces.find((candidate) => isExtensionPageSurface(candidate) && routeMatches(candidate.route, location.pathname)),
    [location.pathname, registry.surfaces],
  );

  if (registry.loading) {
    return <LoadingState label="Loading extension…" />;
  }

  if (registry.error) {
    return <ErrorState message={`Extensions unavailable: ${registry.error}`} />;
  }

  if (surface?.component === 'automations') {
    return <TasksPage />;
  }

  if (surface?.entry) {
    return (
      <iframe
        title={surface.title ?? surface.label ?? surface.extensionId}
        src={buildExtensionFileSrc({
          extensionId: surface.extensionId,
          entry: surface.entry,
          surfaceId: surface.id,
          route: surface.route,
          pathname: location.pathname,
          search: location.search,
          hash: location.hash,
        })}
        className="h-full w-full border-0 bg-base"
        sandbox="allow-scripts allow-forms allow-modals allow-popups allow-same-origin"
      />
    );
  }

  return <ErrorState message="Extension surface unavailable: no extension page is registered for this route." />;
}

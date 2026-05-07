import { useMemo } from 'react';
import { useLocation } from 'react-router-dom';

import { ErrorState, LoadingState } from '../components/ui';
import { TasksPage } from '../pages/TasksPage';
import { ExtensionFrame } from './ExtensionFrame';
import { isExtensionPageSurface } from './types';
import { useExtensionRegistry } from './useExtensionRegistry';

function routeMatches(route: string, pathname: string): boolean {
  return pathname === route || pathname.startsWith(`${route}/`);
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
      <ExtensionFrame
        title={surface.title ?? surface.label ?? surface.extensionId}
        extensionId={surface.extensionId}
        entry={surface.entry}
        surfaceId={surface.id}
        route={surface.route}
        pathname={location.pathname}
        search={location.search}
        hash={location.hash}
      />
    );
  }

  return <ErrorState message="Extension surface unavailable: no extension page is registered for this route." />;
}

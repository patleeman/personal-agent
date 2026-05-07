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

function buildExtensionFileSrc(extensionId: string, entry: string): string {
  return buildApiPath(`/extensions/${encodeURIComponent(extensionId)}/files/${entry.split('/').map(encodeURIComponent).join('/')}`);
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
    return <ErrorState title="Extensions unavailable" message={registry.error} />;
  }

  if (surface?.component === 'automations') {
    return <TasksPage />;
  }

  if (surface?.entry) {
    return (
      <iframe
        title={surface.title ?? surface.label ?? surface.extensionId}
        src={buildExtensionFileSrc(surface.extensionId, surface.entry)}
        className="h-full w-full border-0 bg-base"
        sandbox="allow-scripts allow-forms allow-modals allow-popups allow-same-origin"
      />
    );
  }

  return <ErrorState title="Extension surface unavailable" message="No extension page is registered for this route." />;
}

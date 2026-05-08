import { useMemo } from 'react';
import { useLocation } from 'react-router-dom';

import { ErrorState, LoadingState } from '../components/ui';
import { NativeExtensionSurfaceHost } from './NativeExtensionSurfaceHost';
import { isNativeExtensionPageSurface } from './types';
import { useExtensionRegistry } from './useExtensionRegistry';

function routeMatches(route: string, pathname: string): boolean {
  return pathname === route || pathname.startsWith(`${route}/`);
}

export function ExtensionPage() {
  const location = useLocation();
  const registry = useExtensionRegistry();
  const nativeSurface = useMemo(
    () =>
      registry.surfaces.find((candidate) => isNativeExtensionPageSurface(candidate) && routeMatches(candidate.route, location.pathname)),
    [location.pathname, registry.surfaces],
  );

  if (registry.loading) {
    return <LoadingState label="Loading extension…" />;
  }

  if (registry.error) {
    return <ErrorState message={`Extensions unavailable: ${registry.error}`} />;
  }

  if (nativeSurface) {
    return (
      <NativeExtensionSurfaceHost surface={nativeSurface} pathname={location.pathname} search={location.search} hash={location.hash} />
    );
  }

  return <ErrorState message="Extension surface unavailable: no native extension page is registered for this route." />;
}

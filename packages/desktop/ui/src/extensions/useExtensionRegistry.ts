import { useEffect, useState } from 'react';

import { api } from '../client/api';
import type { ExtensionManifest, ExtensionRouteSummary, ExtensionSurfaceSummary } from './types';

export interface ExtensionRegistryState {
  extensions: ExtensionManifest[];
  routes: ExtensionRouteSummary[];
  surfaces: ExtensionSurfaceSummary[];
  loading: boolean;
  error: string | null;
}

export function useExtensionRegistry(): ExtensionRegistryState {
  const [state, setState] = useState<ExtensionRegistryState>({ extensions: [], routes: [], surfaces: [], loading: true, error: null });

  useEffect(() => {
    let cancelled = false;
    setState((previous) => ({ ...previous, loading: true, error: null }));

    Promise.all([api.extensions(), api.extensionRoutes(), api.extensionSurfaces()])
      .then(([extensions, routes, surfaces]) => {
        if (cancelled) return;
        setState({ extensions, routes, surfaces, loading: false, error: null });
      })
      .catch((error: Error) => {
        if (cancelled) return;
        setState({ extensions: [], routes: [], surfaces: [], loading: false, error: error.message });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}

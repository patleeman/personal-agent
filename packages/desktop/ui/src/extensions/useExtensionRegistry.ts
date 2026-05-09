import { useEffect, useState } from 'react';

import { api } from '../client/api';
import { EXTENSION_REGISTRY_CHANGED_EVENT } from './extensionRegistryEvents';
import type { ExtensionManifest, ExtensionRouteSummary, ExtensionSurfaceSummary } from './types';

export interface ExtensionTopBarElementRegistration {
  extensionId: string;
  id: string;
  component: string;
  label?: string;
  frontendEntry?: string;
}

export interface ExtensionComposerShelfRegistration {
  extensionId: string;
  id: string;
  component: string;
  title?: string;
  placement: 'top' | 'bottom';
  frontendEntry?: string;
}

export interface ExtensionMessageActionRegistration {
  extensionId: string;
  id: string;
  title: string;
  action: string;
  when?: string;
  priority?: number;
}

export interface ExtensionRegistryState {
  extensions: ExtensionManifest[];
  routes: ExtensionRouteSummary[];
  surfaces: ExtensionSurfaceSummary[];
  topBarElements: ExtensionTopBarElementRegistration[];
  messageActions: ExtensionMessageActionRegistration[];
  composerShelves: ExtensionComposerShelfRegistration[];
  loading: boolean;
  error: string | null;
}

function normalizeTopBarElements(extensions: ExtensionManifest[]): ExtensionTopBarElementRegistration[] {
  const result: ExtensionTopBarElementRegistration[] = [];
  for (const extension of extensions) {
    const elements = extension.contributes?.topBarElements;
    if (!elements?.length) continue;
    for (const element of elements) {
      result.push({
        extensionId: extension.id,
        id: element.id,
        component: element.component,
        label: element.label,
        frontendEntry: extension.frontend?.entry,
      });
    }
  }
  return result;
}

function normalizeMessageActions(extensions: ExtensionManifest[]): ExtensionMessageActionRegistration[] {
  const result: ExtensionMessageActionRegistration[] = [];
  for (const extension of extensions) {
    const actions = extension.contributes?.messageActions;
    if (!actions?.length) continue;
    for (const action of actions) {
      result.push({
        extensionId: extension.id,
        id: action.id,
        title: action.title,
        action: action.action,
        ...(action.when ? { when: action.when } : {}),
        ...(typeof action.priority === 'number' ? { priority: action.priority } : {}),
      });
    }
  }
  result.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  return result;
}

function normalizeComposerShelves(extensions: ExtensionManifest[]): ExtensionComposerShelfRegistration[] {
  const result: ExtensionComposerShelfRegistration[] = [];
  for (const extension of extensions) {
    const shelves = extension.contributes?.composerShelves;
    if (!shelves?.length) continue;
    for (const shelf of shelves) {
      result.push({
        extensionId: extension.id,
        id: shelf.id,
        component: shelf.component,
        title: shelf.title,
        placement: shelf.placement ?? 'bottom',
        frontendEntry: extension.frontend?.entry,
      });
    }
  }
  return result;
}

export function useExtensionRegistry(): ExtensionRegistryState {
  const [state, setState] = useState<ExtensionRegistryState>({
    extensions: [],
    routes: [],
    surfaces: [],
    topBarElements: [],
    messageActions: [],
    composerShelves: [],
    loading: true,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;

    const load = () => {
      setState((previous) => ({ ...previous, loading: true, error: null }));

      if (
        typeof api.extensions !== 'function' ||
        typeof api.extensionRoutes !== 'function' ||
        typeof api.extensionSurfaces !== 'function'
      ) {
        if (cancelled) return;
        setState({ extensions: [], routes: [], surfaces: [], topBarElements: [], messageActions: [], composerShelves: [], loading: false, error: null });
        return;
      }

      Promise.all([api.extensions(), api.extensionRoutes(), api.extensionSurfaces()])
        .then(([extensions, routes, surfaces]) => {
          if (cancelled) return;
          setState({
            extensions,
            routes,
            surfaces,
            topBarElements: normalizeTopBarElements(extensions),
            messageActions: normalizeMessageActions(extensions),
            composerShelves: normalizeComposerShelves(extensions),
            loading: false,
            error: null,
          });
        })
        .catch((error: Error) => {
          if (cancelled) return;
          setState({
            extensions: [],
            routes: [],
            surfaces: [],
            topBarElements: [],
            messageActions: [],
            composerShelves: [],
            loading: false,
            error: error.message,
          });
        });
    };

    load();
    window.addEventListener(EXTENSION_REGISTRY_CHANGED_EVENT, load);

    return () => {
      cancelled = true;
      window.removeEventListener(EXTENSION_REGISTRY_CHANGED_EVENT, load);
    };
  }, []);

  return state;
}

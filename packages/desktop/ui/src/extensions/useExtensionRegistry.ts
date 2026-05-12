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

interface ExtensionToolbarActionRegistration {
  extensionId: string;
  id: string;
  title: string;
  icon: string;
  action: string;
  when?: string;
  priority?: number;
}

export interface ExtensionComposerButtonRegistration {
  extensionId: string;
  id: string;
  component: string;
  title?: string;
  placement: 'afterModelPicker';
  when?: string;
  priority?: number;
  frontendEntry?: string;
}

export interface ExtensionComposerInputToolRegistration {
  extensionId: string;
  id: string;
  component: string;
  title?: string;
  when?: string;
  priority?: number;
  frontendEntry?: string;
}

export interface ExtensionConversationHeaderElementRegistration {
  extensionId: string;
  id: string;
  component: string;
  label?: string;
  frontendEntry?: string;
}

export interface ExtensionStatusBarItemRegistration {
  extensionId: string;
  id: string;
  label: string;
  action?: string;
  component?: string;
  alignment: 'left' | 'right';
  priority?: number;
  frontendEntry?: string;
}

interface ExtensionContextMenuRegistration {
  extensionId: string;
  id: string;
  title: string;
  action: string;
  surface: 'message' | 'conversationList';
  separator?: boolean;
  when?: string;
}

export interface ExtensionThreadHeaderActionRegistration {
  extensionId: string;
  id: string;
  component: string;
  title?: string;
  priority?: number;
  frontendEntry?: string;
}

export interface ExtensionConversationDecoratorRegistration {
  extensionId: string;
  id: string;
  component: string;
  position: 'before-title' | 'after-title' | 'subtitle';
  priority?: number;
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

export interface ExtensionNewConversationPanelRegistration {
  extensionId: string;
  id: string;
  component: string;
  title?: string;
  priority?: number;
  frontendEntry?: string;
}

export interface ExtensionSettingsComponentRegistration {
  extensionId: string;
  id: string;
  component: string;
  sectionId: string;
  label: string;
  description?: string;
  order?: number;
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
  newConversationPanels: ExtensionNewConversationPanelRegistration[];
  settingsComponent: ExtensionSettingsComponentRegistration | null;
  settingsComponents: ExtensionSettingsComponentRegistration[];
  composerButtons: ExtensionComposerButtonRegistration[];
  composerInputTools: ExtensionComposerInputToolRegistration[];
  toolbarActions: ExtensionToolbarActionRegistration[];
  contextMenus: ExtensionContextMenuRegistration[];
  threadHeaderActions: ExtensionThreadHeaderActionRegistration[];
  statusBarItems: ExtensionStatusBarItemRegistration[];
  conversationHeaderElements: ExtensionConversationHeaderElementRegistration[];
  conversationDecorators: ExtensionConversationDecoratorRegistration[];
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

function normalizeNewConversationPanels(extensions: ExtensionManifest[]): ExtensionNewConversationPanelRegistration[] {
  const result: ExtensionNewConversationPanelRegistration[] = [];
  for (const extension of extensions) {
    const panels = extension.contributes?.newConversationPanels;
    if (!panels?.length) continue;
    for (const panel of panels) {
      result.push({
        extensionId: extension.id,
        id: panel.id,
        component: panel.component,
        ...(panel.title ? { title: panel.title } : {}),
        ...(typeof panel.priority === 'number' ? { priority: panel.priority } : {}),
        frontendEntry: extension.frontend?.entry,
      });
    }
  }
  result.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  return result;
}

function normalizeSettingsComponents(extensions: ExtensionManifest[]): ExtensionSettingsComponentRegistration[] {
  const result: ExtensionSettingsComponentRegistration[] = [];
  for (const extension of extensions) {
    const panel = extension.contributes?.settingsComponent;
    if (!panel) continue;
    result.push({
      extensionId: extension.id,
      id: panel.id,
      component: panel.component,
      sectionId: panel.sectionId,
      label: panel.label,
      ...(panel.description ? { description: panel.description } : {}),
      ...(typeof panel.order === 'number' ? { order: panel.order } : {}),
      frontendEntry: extension.frontend?.entry,
    });
  }
  result.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  return result;
}

function normalizeComposerButtons(extensions: ExtensionManifest[]): ExtensionComposerButtonRegistration[] {
  const result: ExtensionComposerButtonRegistration[] = [];
  for (const extension of extensions) {
    const buttons = extension.contributes?.composerButtons;
    if (!buttons?.length) continue;
    for (const button of buttons) {
      result.push({
        extensionId: extension.id,
        id: button.id,
        component: button.component,
        placement: button.placement ?? 'afterModelPicker',
        ...(button.title ? { title: button.title } : {}),
        ...(button.when ? { when: button.when } : {}),
        ...(typeof button.priority === 'number' ? { priority: button.priority } : {}),
        frontendEntry: extension.frontend?.entry,
      });
    }
  }
  result.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  return result;
}

function normalizeComposerInputTools(extensions: ExtensionManifest[]): ExtensionComposerInputToolRegistration[] {
  const result: ExtensionComposerInputToolRegistration[] = [];
  for (const extension of extensions) {
    const tools = extension.contributes?.composerInputTools;
    if (!tools?.length) continue;
    for (const tool of tools) {
      result.push({
        extensionId: extension.id,
        id: tool.id,
        component: tool.component,
        ...(tool.title ? { title: tool.title } : {}),
        ...(tool.when ? { when: tool.when } : {}),
        ...(typeof tool.priority === 'number' ? { priority: tool.priority } : {}),
        frontendEntry: extension.frontend?.entry,
      });
    }
  }
  result.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  return result;
}

function normalizeToolbarActions(extensions: ExtensionManifest[]): ExtensionToolbarActionRegistration[] {
  const result: ExtensionToolbarActionRegistration[] = [];
  for (const extension of extensions) {
    const actions = extension.contributes?.toolbarActions;
    if (!actions?.length) continue;
    for (const action of actions) {
      result.push({
        extensionId: extension.id,
        id: action.id,
        title: action.title,
        icon: action.icon,
        action: action.action,
        ...(action.when ? { when: action.when } : {}),
        ...(typeof action.priority === 'number' ? { priority: action.priority } : {}),
      });
    }
  }
  result.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  return result;
}

function normalizeConversationHeaderElements(extensions: ExtensionManifest[]): ExtensionConversationHeaderElementRegistration[] {
  const result: ExtensionConversationHeaderElementRegistration[] = [];
  for (const extension of extensions) {
    const elements = extension.contributes?.conversationHeaderElements;
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

function normalizeConversationDecorators(extensions: ExtensionManifest[]): ExtensionConversationDecoratorRegistration[] {
  const result: ExtensionConversationDecoratorRegistration[] = [];
  for (const extension of extensions) {
    const decorators = extension.contributes?.conversationDecorators;
    if (!decorators?.length) continue;
    for (const decorator of decorators) {
      result.push({
        extensionId: extension.id,
        id: decorator.id,
        component: decorator.component,
        position: decorator.position,
        ...(typeof decorator.priority === 'number' ? { priority: decorator.priority } : {}),
        frontendEntry: extension.frontend?.entry,
      });
    }
  }
  result.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  return result;
}

function normalizeContextMenus(extensions: ExtensionManifest[]): ExtensionContextMenuRegistration[] {
  const result: ExtensionContextMenuRegistration[] = [];
  for (const extension of extensions) {
    const menus = extension.contributes?.contextMenus;
    if (!menus?.length) continue;
    for (const menu of menus) {
      result.push({
        extensionId: extension.id,
        id: menu.id,
        title: menu.title,
        action: menu.action,
        surface: menu.surface,
        ...(menu.separator ? { separator: true } : {}),
        ...(menu.when ? { when: menu.when } : {}),
      });
    }
  }
  return result;
}

function normalizeThreadHeaderActions(extensions: ExtensionManifest[]): ExtensionThreadHeaderActionRegistration[] {
  const result: ExtensionThreadHeaderActionRegistration[] = [];
  for (const extension of extensions) {
    const actions = extension.contributes?.threadHeaderActions;
    if (!actions?.length) continue;
    for (const action of actions) {
      result.push({
        extensionId: extension.id,
        id: action.id,
        component: action.component,
        ...(action.title ? { title: action.title } : {}),
        ...(typeof action.priority === 'number' ? { priority: action.priority } : {}),
        frontendEntry: extension.frontend?.entry,
      });
    }
  }
  result.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  return result;
}

function normalizeStatusBarItems(extensions: ExtensionManifest[]): ExtensionStatusBarItemRegistration[] {
  const result: ExtensionStatusBarItemRegistration[] = [];
  for (const extension of extensions) {
    const items = extension.contributes?.statusBarItems;
    if (!items?.length) continue;
    for (const item of items) {
      result.push({
        extensionId: extension.id,
        id: item.id,
        label: item.label,
        ...(item.action ? { action: item.action } : {}),
        ...(item.component ? { component: item.component } : {}),
        alignment: item.alignment ?? 'right',
        ...(typeof item.priority === 'number' ? { priority: item.priority } : {}),
        frontendEntry: extension.frontend?.entry,
      });
    }
  }
  result.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
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
    newConversationPanels: [],
    settingsComponent: null,
    settingsComponents: [],
    composerButtons: [],
    composerInputTools: [],
    toolbarActions: [],
    contextMenus: [],
    threadHeaderActions: [],
    statusBarItems: [],
    conversationHeaderElements: [],
    conversationDecorators: [],
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
        setState({
          extensions: [],
          routes: [],
          surfaces: [],
          topBarElements: [],
          messageActions: [],
          composerShelves: [],
          newConversationPanels: [],
          settingsComponent: null,
          settingsComponents: [],
          composerButtons: [],
          composerInputTools: [],
          toolbarActions: [],
          contextMenus: [],
          threadHeaderActions: [],
          statusBarItems: [],
          conversationHeaderElements: [],
          conversationDecorators: [],
          loading: false,
          error: null,
        });
        return;
      }

      Promise.all([api.extensions(), api.extensionRoutes(), api.extensionSurfaces()])
        .then(([extensions, routes, surfaces]) => {
          if (cancelled) return;
          const settingsComponents = normalizeSettingsComponents(extensions);
          setState({
            extensions,
            routes,
            surfaces,
            topBarElements: normalizeTopBarElements(extensions),
            messageActions: normalizeMessageActions(extensions),
            composerShelves: normalizeComposerShelves(extensions),
            newConversationPanels: normalizeNewConversationPanels(extensions),
            settingsComponents,
            settingsComponent: settingsComponents[0] ?? null,
            composerButtons: normalizeComposerButtons(extensions),
            composerInputTools: normalizeComposerInputTools(extensions),
            toolbarActions: normalizeToolbarActions(extensions),
            contextMenus: normalizeContextMenus(extensions),
            threadHeaderActions: normalizeThreadHeaderActions(extensions),
            statusBarItems: normalizeStatusBarItems(extensions),
            conversationHeaderElements: normalizeConversationHeaderElements(extensions),
            conversationDecorators: normalizeConversationDecorators(extensions),
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
            newConversationPanels: [],
            settingsComponent: null,
            settingsComponents: [],
            composerButtons: [],
            composerInputTools: [],
            toolbarActions: [],
            contextMenus: [],
            threadHeaderActions: [],
            statusBarItems: [],
            conversationHeaderElements: [],
            conversationDecorators: [],
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

import { createContext, createElement, type ReactNode, useContext, useEffect, useState } from 'react';

import { useAppEvents } from '../app/contexts';
import { api } from '../client/api';
import { EXTENSION_REGISTRY_CHANGED_EVENT } from './extensionRegistryEvents';
import type { ExtensionInstallSummary, ExtensionManifest, ExtensionRouteSummary, ExtensionSurfaceSummary } from './types';

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

export interface ExtensionComposerControlRegistration {
  extensionId: string;
  id: string;
  component: string;
  title?: string;
  slot: 'leading' | 'preferences' | 'actions';
  when?: string;
  priority?: number;
  frontendEntry?: string;
}

export type ExtensionComposerButtonRegistration = ExtensionComposerControlRegistration;

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
  surface: 'message' | 'conversationList' | 'selection' | 'fileSelection' | 'transcriptSelection';
  separator?: boolean;
  when?: string;
}

export interface ExtensionSelectionActionRegistration {
  extensionId: string;
  id: string;
  title: string;
  action: string;
  kinds: Array<'text' | 'messages' | 'files' | 'transcriptRange'>;
  icon?: string;
  args?: unknown;
  when?: string;
  priority?: number;
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

export interface ExtensionActivityTreeItemElementRegistration {
  extensionId: string;
  id: string;
  component: string;
  slot: 'leading' | 'before-title' | 'after-title' | 'subtitle' | 'trailing';
  priority?: number;
  frontendEntry?: string;
}

export interface ExtensionActivityTreeItemStyleRegistration {
  extensionId: string;
  id: string;
  provider: string;
  priority?: number;
}

export interface ExtensionConversationLifecycleRegistration {
  extensionId: string;
  id: string;
  component: string;
  events: Array<
    | 'before-run'
    | 'after-run-start'
    | 'blocked'
    | 'waiting-for-user'
    | 'model-error'
    | 'tool-error'
    | 'goal-active'
    | 'compaction-available'
  >;
  slot: 'banner' | 'inline';
  priority?: number;
  frontendEntry?: string;
}

export interface ExtensionComposerAttachmentProviderRegistration {
  extensionId: string;
  id: string;
  title: string;
  action: string;
  icon?: string;
  priority?: number;
}

export interface ExtensionComposerAttachmentRendererRegistration {
  extensionId: string;
  id: string;
  type: string;
  component: string;
  priority?: number;
  frontendEntry?: string;
}

export interface ExtensionComposerAttachmentResolverRegistration {
  extensionId: string;
  id: string;
  type: string;
  action: string;
}

export interface ExtensionActivityTreeItemActionRegistration {
  extensionId: string;
  id: string;
  title: string;
  action: string;
  icon?: string;
  when?: string;
  priority?: number;
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

export type ExtensionRegistryEntry = ExtensionInstallSummary & ExtensionManifest;

function normalizeRegistryExtensions(extensions: ExtensionInstallSummary[]): ExtensionRegistryEntry[] {
  return extensions.map((extension) => ({
    ...extension.manifest,
    ...extension,
  }));
}

const EMPTY_EXTENSION_REGISTRY_STATE: ExtensionRegistryState = {
  extensions: [],
  routes: [],
  surfaces: [],
  topBarElements: [],
  messageActions: [],
  composerShelves: [],
  newConversationPanels: [],
  settingsComponent: null,
  settingsComponents: [],
  composerControls: [],
  composerButtons: [],
  composerInputTools: [],
  toolbarActions: [],
  contextMenus: [],
  selectionActions: [],
  threadHeaderActions: [],
  statusBarItems: [],
  conversationHeaderElements: [],
  conversationDecorators: [],
  activityTreeItemElements: [],
  activityTreeItemStyles: [],
  conversationLifecycle: [],
  composerAttachmentProviders: [],
  composerAttachmentRenderers: [],
  composerAttachmentResolvers: [],
  activityTreeItemActions: [],
  loading: false,
  error: null,
};

const INITIAL_EXTENSION_REGISTRY_STATE: ExtensionRegistryState = {
  ...EMPTY_EXTENSION_REGISTRY_STATE,
  loading: true,
};

const ExtensionRegistryContext = createContext<ExtensionRegistryState>(EMPTY_EXTENSION_REGISTRY_STATE);

export interface ExtensionRegistryState {
  extensions: ExtensionRegistryEntry[];
  routes: ExtensionRouteSummary[];
  surfaces: ExtensionSurfaceSummary[];
  topBarElements: ExtensionTopBarElementRegistration[];
  messageActions: ExtensionMessageActionRegistration[];
  composerShelves: ExtensionComposerShelfRegistration[];
  newConversationPanels: ExtensionNewConversationPanelRegistration[];
  settingsComponent: ExtensionSettingsComponentRegistration | null;
  settingsComponents: ExtensionSettingsComponentRegistration[];
  composerControls: ExtensionComposerControlRegistration[];
  composerButtons: ExtensionComposerButtonRegistration[];
  composerInputTools: ExtensionComposerInputToolRegistration[];
  toolbarActions: ExtensionToolbarActionRegistration[];
  contextMenus: ExtensionContextMenuRegistration[];
  selectionActions: ExtensionSelectionActionRegistration[];
  threadHeaderActions: ExtensionThreadHeaderActionRegistration[];
  statusBarItems: ExtensionStatusBarItemRegistration[];
  conversationHeaderElements: ExtensionConversationHeaderElementRegistration[];
  conversationDecorators: ExtensionConversationDecoratorRegistration[];
  activityTreeItemElements: ExtensionActivityTreeItemElementRegistration[];
  activityTreeItemStyles: ExtensionActivityTreeItemStyleRegistration[];
  conversationLifecycle: ExtensionConversationLifecycleRegistration[];
  composerAttachmentProviders: ExtensionComposerAttachmentProviderRegistration[];
  composerAttachmentRenderers: ExtensionComposerAttachmentRendererRegistration[];
  composerAttachmentResolvers: ExtensionComposerAttachmentResolverRegistration[];
  activityTreeItemActions: ExtensionActivityTreeItemActionRegistration[];
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

function compareComposerControls(a: ExtensionComposerControlRegistration, b: ExtensionComposerControlRegistration): number {
  return (a.priority ?? 0) - (b.priority ?? 0) || a.extensionId.localeCompare(b.extensionId) || a.id.localeCompare(b.id);
}

function normalizeComposerControls(extensions: ExtensionManifest[]): ExtensionComposerControlRegistration[] {
  const result: ExtensionComposerControlRegistration[] = [];
  for (const extension of extensions) {
    for (const control of extension.contributes?.composerControls ?? []) {
      result.push({
        extensionId: extension.id,
        id: control.id,
        component: control.component,
        slot: control.slot ?? 'preferences',
        ...(control.title ? { title: control.title } : {}),
        ...(control.when ? { when: control.when } : {}),
        ...(typeof control.priority === 'number' ? { priority: control.priority } : {}),
        frontendEntry: extension.frontend?.entry,
      });
    }

    for (const button of extension.contributes?.composerButtons ?? []) {
      result.push({
        extensionId: extension.id,
        id: button.id,
        component: button.component,
        slot: button.placement === 'actions' ? 'actions' : 'preferences',
        ...(button.title ? { title: button.title } : {}),
        ...(button.when ? { when: button.when } : {}),
        ...(typeof button.priority === 'number' ? { priority: button.priority } : {}),
        frontendEntry: extension.frontend?.entry,
      });
    }
  }
  result.sort(compareComposerControls);
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

function normalizeActivityTreeItemElements(extensions: ExtensionManifest[]): ExtensionActivityTreeItemElementRegistration[] {
  const result: ExtensionActivityTreeItemElementRegistration[] = [];
  for (const extension of extensions) {
    const elements = extension.contributes?.activityTreeItemElements;
    if (!elements?.length) continue;
    for (const element of elements) {
      result.push({
        extensionId: extension.id,
        id: element.id,
        component: element.component,
        slot: element.slot,
        ...(typeof element.priority === 'number' ? { priority: element.priority } : {}),
        frontendEntry: extension.frontend?.entry,
      });
    }
  }
  result.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  return result;
}

function normalizeActivityTreeItemStyles(extensions: ExtensionManifest[]): ExtensionActivityTreeItemStyleRegistration[] {
  const result: ExtensionActivityTreeItemStyleRegistration[] = [];
  for (const extension of extensions) {
    const styles = extension.contributes?.activityTreeItemStyles;
    if (!styles?.length) continue;
    for (const style of styles) {
      result.push({
        extensionId: extension.id,
        id: style.id,
        provider: style.provider,
        ...(typeof style.priority === 'number' ? { priority: style.priority } : {}),
      });
    }
  }
  result.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  return result;
}

function normalizeConversationLifecycle(extensions: ExtensionManifest[]): ExtensionConversationLifecycleRegistration[] {
  const result: ExtensionConversationLifecycleRegistration[] = [];
  for (const extension of extensions) {
    const items = extension.contributes?.conversationLifecycle;
    if (!items?.length) continue;
    for (const item of items) {
      result.push({
        extensionId: extension.id,
        id: item.id,
        component: item.component,
        events: item.events,
        slot: item.slot ?? 'banner',
        ...(typeof item.priority === 'number' ? { priority: item.priority } : {}),
        frontendEntry: extension.frontend?.entry,
      });
    }
  }
  result.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  return result;
}

function normalizeComposerAttachmentProviders(extensions: ExtensionManifest[]): ExtensionComposerAttachmentProviderRegistration[] {
  const result: ExtensionComposerAttachmentProviderRegistration[] = [];
  for (const extension of extensions)
    for (const provider of extension.contributes?.composerAttachmentProviders ?? [])
      result.push({
        extensionId: extension.id,
        id: provider.id,
        title: provider.title,
        action: provider.action,
        ...(provider.icon ? { icon: provider.icon } : {}),
        ...(typeof provider.priority === 'number' ? { priority: provider.priority } : {}),
      });
  result.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  return result;
}

function normalizeComposerAttachmentRenderers(extensions: ExtensionManifest[]): ExtensionComposerAttachmentRendererRegistration[] {
  const result: ExtensionComposerAttachmentRendererRegistration[] = [];
  for (const extension of extensions)
    for (const renderer of extension.contributes?.composerAttachmentRenderers ?? [])
      result.push({
        extensionId: extension.id,
        id: renderer.id,
        type: renderer.type,
        component: renderer.component,
        ...(typeof renderer.priority === 'number' ? { priority: renderer.priority } : {}),
        frontendEntry: extension.frontend?.entry,
      });
  result.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  return result;
}

function normalizeComposerAttachmentResolvers(extensions: ExtensionManifest[]): ExtensionComposerAttachmentResolverRegistration[] {
  const result: ExtensionComposerAttachmentResolverRegistration[] = [];
  for (const extension of extensions)
    for (const resolver of extension.contributes?.composerAttachmentResolvers ?? [])
      result.push({ extensionId: extension.id, id: resolver.id, type: resolver.type, action: resolver.action });
  return result;
}

function normalizeActivityTreeItemActions(extensions: ExtensionManifest[]): ExtensionActivityTreeItemActionRegistration[] {
  const result: ExtensionActivityTreeItemActionRegistration[] = [];
  for (const extension of extensions)
    for (const action of extension.contributes?.activityTreeItemActions ?? [])
      result.push({
        extensionId: extension.id,
        id: action.id,
        title: action.title,
        action: action.action,
        ...(action.icon ? { icon: action.icon } : {}),
        ...(action.when ? { when: action.when } : {}),
        ...(typeof action.priority === 'number' ? { priority: action.priority } : {}),
      });
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

function normalizeSelectionActions(extensions: ExtensionManifest[]): ExtensionSelectionActionRegistration[] {
  const result: ExtensionSelectionActionRegistration[] = [];
  for (const extension of extensions) {
    const actions = extension.contributes?.selectionActions;
    if (!actions?.length) continue;
    for (const action of actions) {
      result.push({
        extensionId: extension.id,
        id: action.id,
        title: action.title,
        action: action.action,
        kinds: action.kinds,
        ...(action.icon ? { icon: action.icon } : {}),
        ...(action.args !== undefined ? { args: action.args } : {}),
        ...(action.when ? { when: action.when } : {}),
        ...(typeof action.priority === 'number' ? { priority: action.priority } : {}),
      });
    }
  }
  result.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
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

function useExtensionRegistryLoader(): ExtensionRegistryState {
  const { versions } = useAppEvents();
  const [state, setState] = useState<ExtensionRegistryState>(INITIAL_EXTENSION_REGISTRY_STATE);

  useEffect(() => {
    let cancelled = false;

    const load = () => {
      setState((previous) => ({ ...previous, loading: true, error: null }));

      if (
        typeof api.extensionInstallations !== 'function' ||
        typeof api.extensionRoutes !== 'function' ||
        typeof api.extensionSurfaces !== 'function'
      ) {
        if (cancelled) return;
        setState(EMPTY_EXTENSION_REGISTRY_STATE);
        return;
      }

      Promise.all([api.extensionInstallations(), api.extensionRoutes(), api.extensionSurfaces()])
        .then(([extensions, routes, surfaces]) => {
          if (cancelled) return;
          const registryExtensions = normalizeRegistryExtensions(extensions);
          const enabledRegistryExtensions = registryExtensions.filter((extension) => extension.enabled);
          const settingsComponents = normalizeSettingsComponents(enabledRegistryExtensions);
          setState({
            extensions: registryExtensions,
            routes,
            surfaces,
            topBarElements: normalizeTopBarElements(enabledRegistryExtensions),
            messageActions: normalizeMessageActions(enabledRegistryExtensions),
            composerShelves: normalizeComposerShelves(enabledRegistryExtensions),
            newConversationPanels: normalizeNewConversationPanels(enabledRegistryExtensions),
            settingsComponents,
            settingsComponent: settingsComponents[0] ?? null,
            composerControls: normalizeComposerControls(enabledRegistryExtensions),
            composerButtons: normalizeComposerControls(enabledRegistryExtensions),
            composerInputTools: normalizeComposerInputTools(enabledRegistryExtensions),
            toolbarActions: normalizeToolbarActions(enabledRegistryExtensions),
            contextMenus: normalizeContextMenus(enabledRegistryExtensions),
            selectionActions: normalizeSelectionActions(enabledRegistryExtensions),
            threadHeaderActions: normalizeThreadHeaderActions(enabledRegistryExtensions),
            statusBarItems: normalizeStatusBarItems(enabledRegistryExtensions),
            conversationHeaderElements: normalizeConversationHeaderElements(enabledRegistryExtensions),
            conversationDecorators: normalizeConversationDecorators(enabledRegistryExtensions),
            activityTreeItemElements: normalizeActivityTreeItemElements(enabledRegistryExtensions),
            activityTreeItemStyles: normalizeActivityTreeItemStyles(enabledRegistryExtensions),
            conversationLifecycle: normalizeConversationLifecycle(enabledRegistryExtensions),
            composerAttachmentProviders: normalizeComposerAttachmentProviders(enabledRegistryExtensions),
            composerAttachmentRenderers: normalizeComposerAttachmentRenderers(enabledRegistryExtensions),
            composerAttachmentResolvers: normalizeComposerAttachmentResolvers(enabledRegistryExtensions),
            activityTreeItemActions: normalizeActivityTreeItemActions(enabledRegistryExtensions),
            loading: false,
            error: null,
          });
        })
        .catch((error: Error) => {
          if (cancelled) return;
          setState({
            ...EMPTY_EXTENSION_REGISTRY_STATE,
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
  }, [versions.extensions]);

  return state;
}

export function ExtensionRegistryProvider({ children }: { children: ReactNode }) {
  const state = useExtensionRegistryLoader();
  return createElement(ExtensionRegistryContext.Provider, { value: state }, children);
}

export function useExtensionRegistry(): ExtensionRegistryState {
  return useContext(ExtensionRegistryContext);
}

export const EXTENSION_MANIFEST_VERSION = 2;

export type ExtensionPackageType = 'user' | 'system';
export type ExtensionRightSurfaceScope = 'global' | 'conversation' | 'workspace' | 'selection';
export type ExtensionViewPlacement = 'primary' | 'workbench-tool';
export type ExtensionViewScope = 'global' | 'workspace' | 'conversation';
export type ExtensionViewActivation = 'always' | 'on-route' | 'on-open' | 'on-demand';
export type ExtensionIconName =
  | 'app'
  | 'automation'
  | 'browser'
  | 'database'
  | 'diff'
  | 'file'
  | 'gear'
  | 'graph'
  | 'kanban'
  | 'play'
  | 'sparkle'
  | 'terminal';
export type ExtensionPermission =
  | 'runs:read'
  | 'runs:start'
  | 'runs:cancel'
  | 'storage:read'
  | 'storage:write'
  | 'storage:readwrite'
  | 'vault:read'
  | 'vault:write'
  | 'vault:readwrite'
  | 'conversations:read'
  | 'conversations:write'
  | 'conversations:readwrite'
  | 'ui:notify'
  | `${string}:${string}`;

export interface ExtensionFrontend {
  entry: string;
  styles?: string[];
}

export interface ExtensionViewContribution {
  id: string;
  title: string;
  location: 'main' | 'rightRail' | 'workbench';
  component: string;
  route?: string;
  scope?: ExtensionRightSurfaceScope | ExtensionViewScope;
  icon?: ExtensionIconName;
  /** Controls where this view appears across compact/workbench layout modes. */
  placement?: ExtensionViewPlacement;
  /** Controls when the host should mount/load this view. */
  activation?: ExtensionViewActivation;
  defaultOpen?: boolean;
  persistOpen?: boolean;
  /** For rightRail views, optional paired workbench view id rendered in the center pane while this rail tool is active. */
  detailView?: string;
  /** Optional host layout behaviors enabled when this main view's route is active. */
  routeCapabilities?: Array<'contextRail' | 'workbench' | 'workbenchFilePane' | 'knowledgeFiles' | 'settingsSection'>;
}

export interface ExtensionNavContribution {
  id: string;
  label: string;
  route: string;
  icon?: ExtensionIconName;
  badgeAction?: string;
  /** Nav section. Default 'primary'. Use 'settings' for items in the settings area. */
  section?: 'primary' | 'settings';
}

export interface ExtensionCommandContribution {
  id: string;
  title: string;
  action: string;
  icon?: ExtensionIconName;
}

export interface ExtensionKeybindingContribution {
  id: string;
  title: string;
  keys: string[];
  command: string;
  when?: string;
  scope?: 'global' | 'surface';
}

export interface ExtensionSlashCommandContribution {
  name: string;
  description: string;
  action: string;
}

export interface ExtensionMentionContribution {
  id: string;
  title: string;
  description?: string;
  kinds: string[];
  provider: string;
}

export interface ExtensionSkillContribution {
  id: string;
  title?: string;
  description?: string;
  path: string;
}

export interface ExtensionToolContribution {
  id: string;
  title?: string;
  label?: string;
  description: string;
  action?: string;
  handler?: string;
  inputSchema?: Record<string, unknown>;
  promptSnippet?: string;
  promptGuidelines?: string[];
  name?: string;
  /**
   * Name of a built-in tool to replace (e.g. "bash", "read", "write", "edit").
   * When set, this tool overrides the built-in tool of that name.
   */
  replaces?: string;
}

export interface ExtensionTranscriptRendererContribution {
  id: string;
  tool: string;
  component: string;
}

export interface ExtensionPromptReferenceContribution {
  id: string;
  handler: string;
  title?: string;
}

export interface ExtensionQuickOpenContribution {
  id: string;
  provider: string;
  title?: string;
  section?: string;
}

export interface ExtensionThemeContribution {
  id: string;
  label: string;
  appearance: 'light' | 'dark';
  tokens: Record<string, string>;
}

export interface ExtensionTopBarElementContribution {
  id: string;
  component: string;
  label?: string;
}

export interface ExtensionMessageActionContribution {
  id: string;
  title: string;
  action: string;
  /** Context condition for when this action is visible, e.g. "role:assistant && hasText" */
  when?: string;
  /** Sort priority. Higher = closer to end of button row. Default 0. */
  priority?: number;
}

export interface ExtensionComposerShelfContribution {
  id: string;
  component: string;
  title?: string;
  /** Where this shelf appears relative to built-in shelves. Default 'bottom'. */
  placement?: 'top' | 'bottom';
}

export interface ExtensionToolbarActionContribution {
  id: string;
  title: string;
  icon: ExtensionIconName;
  action: string;
  /** Condition for visibility, e.g. "composerHasContent && !streamIsStreaming" */
  when?: string;
  /** Sort priority. Higher = closer to submit button. Default 0. */
  priority?: number;
}

export interface ExtensionStatusBarItemContribution {
  id: string;
  label: string;
  action?: string;
  /** Left or right alignment. Default 'right'. */
  alignment?: 'left' | 'right';
  /** Sort priority within alignment. Higher = closer to edge. Default 0. */
  priority?: number;
}

export interface ExtensionContextMenuContribution {
  id: string;
  title: string;
  action: string;
  /** Which context menu this item appears in. */
  surface: 'message' | 'conversationList';
  /** Show a separator above this item. */
  separator?: boolean;
  /** Context condition, e.g. "selectedText" or "role:assistant" */
  when?: string;
}

export interface ExtensionConversationDecoratorContribution {
  id: string;
  component: string;
  /** Where this decorator appears relative to the conversation title. */
  position: 'before-title' | 'after-title' | 'subtitle';
  /** Sort priority within position. Higher = closer to title. Default 0. */
  priority?: number;
}

export interface ExtensionContributions {
  views?: ExtensionViewContribution[];
  nav?: ExtensionNavContribution[];
  commands?: ExtensionCommandContribution[];
  keybindings?: ExtensionKeybindingContribution[];
  slashCommands?: ExtensionSlashCommandContribution[];
  mentions?: ExtensionMentionContribution[];
  skills?: Array<string | ExtensionSkillContribution>;
  tools?: ExtensionToolContribution[];
  transcriptRenderers?: ExtensionTranscriptRendererContribution[];
  promptReferences?: ExtensionPromptReferenceContribution[];
  quickOpen?: ExtensionQuickOpenContribution[];
  themes?: ExtensionThemeContribution[];
  topBarElements?: ExtensionTopBarElementContribution[];
  messageActions?: ExtensionMessageActionContribution[];
  composerShelves?: ExtensionComposerShelfContribution[];
  toolbarActions?: ExtensionToolbarActionContribution[];
  contextMenus?: ExtensionContextMenuContribution[];
  statusBarItems?: ExtensionStatusBarItemContribution[];
  conversationDecorators?: ExtensionConversationDecoratorContribution[];
  settings?: Record<string, unknown>;
}

export interface ExtensionManifest {
  schemaVersion: typeof EXTENSION_MANIFEST_VERSION;
  id: string;
  name: string;
  packageType?: ExtensionPackageType;
  description?: string;
  version?: string;
  frontend?: ExtensionFrontend;
  contributes?: ExtensionContributions;
  backend?: ExtensionBackend;
  permissions?: ExtensionPermission[];
}

export interface ExtensionBackend {
  entry: string;
  actions?: ExtensionBackendAction[];
  agentExtension?: string;
}

export interface ExtensionBackendAction {
  id: string;
  handler: string;
  title?: string;
  description?: string;
}

export interface ExtensionRenderContext {
  extensionId: string;
  surfaceId: string;
  route?: string | null;
  pathname: string;
  search: string;
  hash: string;
  conversationId?: string | null;
  cwd?: string | null;
}

export interface ExtensionSurfaceProps<Params = Record<string, string>> {
  pa: PersonalAgentClient;
  context: ExtensionRenderContext;
  surface: ExtensionViewContribution;
  params: Params;
}

export interface PersonalAgentClient {
  extension: {
    invoke(actionId: string, input?: unknown): Promise<unknown>;
    getManifest(): Promise<unknown>;
    listSurfaces(): Promise<unknown>;
  };
  automations: {
    list(): Promise<unknown>;
    readSchedulerHealth(): Promise<unknown>;
    get(taskId: string): Promise<unknown>;
    create(input: unknown): Promise<unknown>;
    update(taskId: string, input: unknown): Promise<unknown>;
    delete(taskId: string): Promise<unknown>;
    run(taskId: string): Promise<unknown>;
    readLog(taskId: string): Promise<unknown>;
  };
  runs: {
    start(input: unknown): Promise<unknown>;
    get(runId: string): Promise<unknown>;
    list(): Promise<unknown>;
    readLog(runId: string, tail?: number): Promise<unknown>;
    cancel(runId: string): Promise<unknown>;
  };
  storage: {
    get<T = unknown>(key: string): Promise<T | null>;
    put(key: string, value: unknown, opts?: { expectedVersion?: number }): Promise<unknown>;
    delete(key: string): Promise<unknown>;
    list<T = unknown>(prefix?: string): Promise<Array<{ key: string; value: T }>>;
  };
  workspace: {
    tree(cwd: string, path?: string): Promise<unknown>;
    readFile(cwd: string, path: string, opts?: { force?: boolean }): Promise<unknown>;
    writeFile(cwd: string, path: string, content: string): Promise<unknown>;
    createFile(cwd: string, path: string, content?: string): Promise<unknown>;
    createFolder(cwd: string, path: string): Promise<unknown>;
    deletePath(cwd: string, path: string): Promise<unknown>;
    renamePath(cwd: string, path: string, newName: string): Promise<unknown>;
    movePath(cwd: string, path: string, targetDir: string): Promise<unknown>;
    diff(cwd: string, path: string): Promise<unknown>;
    uncommittedDiff(cwd: string): Promise<unknown>;
  };
  workbench: {
    getDetailState<T = unknown>(surfaceId: string): T | null;
    setDetailState(surfaceId: string, state: unknown): void;
  };
  browser: {
    isAvailable(): boolean;
    getState(input?: { tabId?: string | null }): Promise<unknown>;
    open(input: { url: string; tabId?: string | null }): Promise<unknown>;
    goBack(input?: { tabId?: string | null }): Promise<unknown>;
    goForward(input?: { tabId?: string | null }): Promise<unknown>;
    reload(input?: { tabId?: string | null }): Promise<unknown>;
    stop(input?: { tabId?: string | null }): Promise<unknown>;
    snapshot(input?: { tabId?: string | null }): Promise<unknown>;
  };
  ui: {
    toast(message: string, type?: 'info' | 'warning' | 'error'): void;
    confirm(options: { title?: string; message: string }): Promise<boolean>;
  };
  /** Inter-extension communication. */
  events: {
    /** Publish an event that other extensions can receive. */
    publish(event: string, payload: unknown): Promise<void>;
  };
  /** List and call actions on other extensions. */
  extensions: {
    /** Invoke an action on any installed extension. */
    callAction(extensionId: string, actionId: string, input?: unknown): Promise<unknown>;
    /** List all extensions that expose callable actions. */
    listActions(): Promise<
      Array<{
        extensionId: string;
        extensionName: string;
        actions: Array<{ id: string; title?: string; description?: string }>;
      }>
    >;
  };
}

export interface ExtensionBackendContext {
  extensionId: string;
  profile: string;
  storage: {
    get<T = unknown>(key: string): Promise<T | null>;
    put(key: string, value: unknown, opts?: { expectedVersion?: number }): Promise<{ ok: true }>;
    delete(key: string): Promise<{ ok: true; deleted: boolean }>;
    list<T = unknown>(prefix?: string): Promise<Array<{ key: string; value: T }>>;
  };
  runs: Record<string, (...args: never[]) => Promise<unknown>>;
  automations: Record<string, (...args: never[]) => Promise<unknown>>;
  vault: Record<string, (...args: never[]) => Promise<unknown>>;
  conversations: Record<string, (...args: never[]) => Promise<unknown>>;
  workspace: Record<string, (...args: never[]) => Promise<unknown>>;
  git: Record<string, (...args: never[]) => Promise<unknown>>;
  shell: Record<string, (...args: never[]) => Promise<unknown>>;
  notify: {
    toast(message: string, type?: 'info' | 'warning' | 'error'): void;
    system(input: { message: string; title?: string; subtitle?: string; persistent?: boolean }): boolean;
    setBadge(count: number): { badge: number; aggregated: number };
    clearBadge(): void;
    isSystemAvailable(): boolean;
  };
  events: {
    publish(input: { event: string; payload: unknown }): Promise<void>;
    subscribe(
      pattern: string,
      handler: (event: { event: string; payload: unknown; sourceExtensionId: string; publishedAt: string }) => void | Promise<void>,
    ): { unsubscribe: () => void };
  };
  extensions: {
    callAction(extensionId: string, actionId: string, input?: unknown): Promise<unknown>;
    listActions(): Promise<
      Array<{
        extensionId: string;
        extensionName: string;
        actions: Array<{ id: string; title?: string; description?: string }>;
      }>
    >;
  };
  ui: { invalidate(topics: string | string[]): void };
  log: {
    info(message: string, fields?: Record<string, unknown>): void;
    warn(message: string, fields?: Record<string, unknown>): void;
    error(message: string, fields?: Record<string, unknown>): void;
  };
}

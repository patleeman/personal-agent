export interface NativeExtensionClient {
  extension: {
    invoke(actionId: string, input?: unknown): Promise<unknown>;
    getManifest(): Promise<unknown>;
    listSurfaces(): Promise<unknown>;
  };
  ui: {
    toast(message: string): void;
    confirm(options: { title?: string; message: string }): Promise<boolean>;
    openModal(options: {
      title?: string;
      component: string;
      props?: Record<string, unknown>;
      size?: 'default' | 'fullscreen';
    }): Promise<unknown>;
  };
  [capability: string]: unknown;
}

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
  | 'agent:run'
  | 'agent:conversations'
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
  | 'network:listen'
  | 'ui:notify'
  | `${string}:${string}`;

export interface ExtensionFrontend {
  entry: string;
  styles?: string[];
}

export interface ExtensionHostComponentReference {
  host: string;
  props?: Record<string, unknown>;
  /** Legacy shorthand for overrides.wrapper. */
  override?: string;
  /** Extension frontend exports used to customize supported host override slots. */
  overrides?: Record<string, string>;
}

export type ExtensionComponentReference = string | ExtensionHostComponentReference;

export interface ExtensionViewContribution {
  id: string;
  title: string;
  location: 'main' | 'rightRail' | 'workbench';
  component: ExtensionComponentReference;
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
  /**
   * Identifies the logical slot this view occupies in the workbench tool panel.
   * When set, the host uses the slot name (e.g. "files", "diffs", "runs") to position
   * the tool bar button instead of matching by extension id.
   */
  toolSlot?: string;
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
  /** When true, this block renders outside internal-work trace clusters. */
  standalone?: boolean;
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
  order?: number;
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

export interface ExtensionComposerButtonContribution {
  id: string;
  component: string;
  title?: string;
  /** Where the control should appear in the composer. Defaults to the right-side action slot. */
  placement?: 'afterModelPicker' | 'actions';
  /** Condition for visibility, e.g. "composerHasContent && !streamIsStreaming" */
  when?: string;
  /** Sort priority. Higher = closer to submit button. Default 0. */
  priority?: number;
}

export interface ExtensionComposerInputToolContribution {
  id: string;
  component: string;
  title?: string;
  /** Condition for visibility, e.g. "!streamIsStreaming" */
  when?: string;
  /** Sort priority. Higher = closer to the text input. Default 0. */
  priority?: number;
}

export interface ExtensionConversationHeaderContribution {
  id: string;
  component: string;
  label?: string;
}

export interface ExtensionThreadHeaderActionContribution {
  id: string;
  component: string;
  title?: string;
  priority?: number;
}

export interface ThreadHeaderActionContext {
  activeConversationId?: string | null;
  cwd?: string | null;
}

export interface ThreadHeaderActionProps {
  pa: NativeExtensionClient;
  actionContext: ThreadHeaderActionContext;
}

export interface ExtensionStatusBarItemContribution {
  id: string;
  label: string;
  action?: string;
  /** Optional component for dynamic status bar content. */
  component?: string;
  /** Left or right alignment. Default 'right'. */
  alignment?: 'left' | 'right';
  /** Sort priority within alignment. Higher = closer to edge. Default 0. */
  priority?: number;
}

export interface ExtensionStatusBarItemContext {
  conversationId?: string | null;
  cwd?: string | null;
  branchLabel?: string | null;
  gitSummary?: {
    kind: 'none' | 'summary' | 'diff';
    text?: string;
    added?: string;
    deleted?: string;
  };
  contextUsage?: {
    total: number | null;
    contextWindow: number;
  } | null;
}

export interface ExtensionStatusBarItemProps {
  pa: NativeExtensionClient;
  statusBarContext: ExtensionStatusBarItemContext;
}

export interface ExtensionContextMenuContribution {
  id: string;
  title: string;
  action: string;
  /** Which context menu this item appears in. */
  surface: 'message' | 'conversationList' | 'selection' | 'fileSelection' | 'transcriptSelection';
  /** Show a separator above this item. */
  separator?: boolean;
  /** Context condition, e.g. "selectedText" or "role:assistant" */
  when?: string;
}

export type ExtensionSelectionKind = 'text' | 'messages' | 'files' | 'transcriptRange';

export interface ExtensionSelectionActionContribution {
  id: string;
  title: string;
  action: string;
  kinds: ExtensionSelectionKind[];
  when?: string;
  priority?: number;
}

export interface ExtensionTranscriptBlockContribution {
  id: string;
  component: string;
  title?: string;
  schemaVersion?: number;
}

export interface ExtensionSubscriptionContribution {
  id: string;
  handler: string;
  source: 'workspaceFiles' | 'vaultFiles' | 'settings' | 'conversation' | 'route' | 'selection' | string;
  pattern?: string;
  debounceMs?: number;
}

export interface ExtensionSecretContribution {
  label: string;
  description?: string;
  env?: string;
  placeholder?: string;
  order?: number;
}

export interface ExtensionSecretBackendContribution {
  id: string;
  label: string;
  description?: string;
  handler: string;
  order?: number;
}

export type ExtensionSettingType = 'string' | 'boolean' | 'number' | 'select';

export interface ExtensionSettingsContribution {
  type: ExtensionSettingType;
  default?: unknown;
  description?: string;
  /** Group label for UI organization. Defaults to 'General'. */
  group?: string;
  /** Enum values for 'select' type. */
  enum?: string[];
  placeholder?: string;
  /** Sort order within group. Default 0. */
  order?: number;
}

export interface ExtensionConversationDecoratorContribution {
  id: string;
  component: string;
  /** Where this decorator appears relative to the conversation title. */
  position: 'before-title' | 'after-title' | 'subtitle';
  /** Sort priority within position. Higher = closer to title. Default 0. */
  priority?: number;
}

export type ExtensionActivityTreeItemSlot = 'leading' | 'before-title' | 'after-title' | 'subtitle' | 'trailing';

export interface ExtensionActivityTreeItemElementContribution {
  id: string;
  component: string;
  /** Which row slot renders this element. */
  slot: ExtensionActivityTreeItemSlot;
  /** Sort priority within slot. Higher renders first. Default 0. */
  priority?: number;
}

export interface ExtensionActivityTreeItemStyleContribution {
  id: string;
  /** Backend action that returns data-only row style metadata. */
  provider: string;
  /** Sort priority for merge order. Higher runs first. Default 0. */
  priority?: number;
}

export interface ExtensionSettingsComponentContribution {
  id: string;
  component: string;
  /** Settings page section id, e.g. "settings-dictation". */
  sectionId: string;
  label: string;
  description?: string;
  /** Sort order among extension settings panels. Default 0. */
  order?: number;
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
  composerButtons?: ExtensionComposerButtonContribution[];
  composerInputTools?: ExtensionComposerInputToolContribution[];
  toolbarActions?: ExtensionToolbarActionContribution[];
  contextMenus?: ExtensionContextMenuContribution[];
  selectionActions?: ExtensionSelectionActionContribution[];
  transcriptBlocks?: ExtensionTranscriptBlockContribution[];
  subscriptions?: ExtensionSubscriptionContribution[];
  threadHeaderActions?: ExtensionThreadHeaderActionContribution[];
  statusBarItems?: ExtensionStatusBarItemContribution[];
  conversationHeaderElements?: ExtensionConversationHeaderContribution[];
  conversationDecorators?: ExtensionConversationDecoratorContribution[];
  activityTreeItemElements?: ExtensionActivityTreeItemElementContribution[];
  activityTreeItemStyles?: ExtensionActivityTreeItemStyleContribution[];
  settings?: Record<string, ExtensionSettingsContribution>;
  secrets?: Record<string, ExtensionSecretContribution>;
  secretBackends?: ExtensionSecretBackendContribution[];
  settingsComponent?: ExtensionSettingsComponentContribution;
}

export interface ExtensionDependencyContribution {
  id: string;
  optional?: boolean;
  version?: string;
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
  dependsOn?: Array<string | ExtensionDependencyContribution>;
}

export interface ExtensionBackend {
  entry: string;
  actions?: ExtensionBackendAction[];
  services?: ExtensionBackendService[];
  startupAction?: string;
  onEnableAction?: string;
  onDisableAction?: string;
  onUninstallAction?: string;
  agentExtension?: string;
}

export interface ExtensionBackendService {
  id: string;
  handler: string;
  title?: string;
  description?: string;
  healthCheck?: string;
  restart?: 'never' | 'on-failure' | 'always';
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

export interface ExtensionAutomationSummary {
  id: string;
  title?: string;
  enabled?: boolean;
  [key: string]: unknown;
}

export interface ExtensionRunSummary {
  id: string;
  status?: string;
  title?: string;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

export interface ExtensionWorkspaceTreeEntry {
  name: string;
  path: string;
  type: 'file' | 'directory' | string;
  children?: ExtensionWorkspaceTreeEntry[];
  [key: string]: unknown;
}

export interface ExtensionWorkspaceFileResult {
  path: string;
  content: string;
  encoding?: string;
  [key: string]: unknown;
}

export interface ExtensionBrowserState {
  tabs?: Array<{ id: string; url?: string; title?: string; active?: boolean; [key: string]: unknown }>;
  activeTabId?: string | null;
  [key: string]: unknown;
}

export interface ExtensionSelectionState {
  kind: ExtensionSelectionKind;
  text?: string;
  messageBlockIds?: string[];
  files?: Array<{ cwd: string; path: string }>;
  transcriptRange?: { conversationId: string; startBlockId: string; endBlockId: string };
  conversationId?: string | null;
  cwd?: string | null;
  updatedAt: string;
}

export interface ExtensionConversationCreateInput {
  title?: string;
  cwd?: string;
  initialPrompt?: string;
  model?: string;
  metadata?: Record<string, unknown>;
}

export interface ExtensionConversationForkInput {
  conversationId: string;
  atBlockId?: string;
  title?: string;
  metadata?: Record<string, unknown>;
}

export interface ExtensionConversationResult {
  conversationId: string;
  title?: string;
  route?: string;
  [key: string]: unknown;
}

export interface ExtensionTranscriptBlockWriteInput {
  conversationId: string;
  blockType: string;
  data: unknown;
  title?: string;
  blockId?: string;
}

export interface PersonalAgentClient {
  extension: {
    invoke<T = unknown>(actionId: string, input?: unknown): Promise<T>;
    getManifest(): Promise<ExtensionManifest>;
    listSurfaces(): Promise<ExtensionViewContribution[]>;
  };
  automations: {
    list(): Promise<ExtensionAutomationSummary[]>;
    readSchedulerHealth(): Promise<Record<string, unknown>>;
    get(taskId: string): Promise<ExtensionAutomationSummary>;
    create(input: unknown): Promise<ExtensionAutomationSummary>;
    update(taskId: string, input: unknown): Promise<ExtensionAutomationSummary>;
    delete(taskId: string): Promise<{ ok: true } | Record<string, unknown>>;
    run(taskId: string): Promise<Record<string, unknown>>;
    readLog(taskId: string): Promise<string | Record<string, unknown>>;
  };
  runs: {
    start(input: unknown): Promise<ExtensionRunSummary>;
    get(runId: string): Promise<ExtensionRunSummary>;
    list(): Promise<ExtensionRunSummary[]>;
    readLog(runId: string, tail?: number): Promise<string | Record<string, unknown>>;
    cancel(runId: string): Promise<ExtensionRunSummary | Record<string, unknown>>;
  };
  storage: {
    get<T = unknown>(key: string): Promise<T | null>;
    put(key: string, value: unknown, opts?: { expectedVersion?: number }): Promise<unknown>;
    delete(key: string): Promise<unknown>;
    list<T = unknown>(prefix?: string): Promise<Array<{ key: string; value: T }>>;
  };
  workspace: {
    tree(cwd: string, path?: string): Promise<ExtensionWorkspaceTreeEntry[]>;
    readFile(cwd: string, path: string, opts?: { force?: boolean }): Promise<ExtensionWorkspaceFileResult>;
    writeFile(cwd: string, path: string, content: string): Promise<{ ok: true } | Record<string, unknown>>;
    createFile(cwd: string, path: string, content?: string): Promise<{ ok: true } | Record<string, unknown>>;
    createFolder(cwd: string, path: string): Promise<{ ok: true } | Record<string, unknown>>;
    deletePath(cwd: string, path: string): Promise<{ ok: true } | Record<string, unknown>>;
    renamePath(cwd: string, path: string, newName: string): Promise<{ ok: true } | Record<string, unknown>>;
    movePath(cwd: string, path: string, targetDir: string): Promise<{ ok: true } | Record<string, unknown>>;
    diff(cwd: string, path: string): Promise<string | Record<string, unknown>>;
    uncommittedDiff(cwd: string): Promise<string | Record<string, unknown>>;
  };
  workbench: {
    getDetailState<T = unknown>(surfaceId: string): T | null;
    setDetailState(surfaceId: string, state: unknown): void;
  };
  browser: {
    isAvailable(): boolean;
    getState(input?: { tabId?: string | null }): Promise<ExtensionBrowserState>;
    open(input: { url: string; tabId?: string | null }): Promise<ExtensionBrowserState>;
    goBack(input?: { tabId?: string | null }): Promise<ExtensionBrowserState>;
    goForward(input?: { tabId?: string | null }): Promise<ExtensionBrowserState>;
    reload(input?: { tabId?: string | null }): Promise<ExtensionBrowserState>;
    stop(input?: { tabId?: string | null }): Promise<ExtensionBrowserState>;
    snapshot(input?: { tabId?: string | null }): Promise<Record<string, unknown>>;
  };
  ui: {
    toast(message: string, type?: 'info' | 'warning' | 'error'): void;
    /** Post a richer notification with optional details and source attribution. */
    notify(options: { message: string; type?: 'info' | 'warning' | 'error'; details?: string; source?: string }): void;
    confirm(options: { title?: string; message: string }): Promise<boolean>;
    openModal(options: {
      title?: string;
      component: string;
      props?: Record<string, unknown>;
      size?: 'default' | 'fullscreen';
    }): Promise<unknown>;
  };
  /** Inter-extension communication. */
  events: {
    /** Publish an event that other extensions can receive. */
    publish(event: string, payload: unknown): Promise<void>;
    /** Subscribe to events matching a pattern. Supports '*' (all) and 'namespace:*' (prefix). */
    subscribe(pattern: string, handler: (event: { event: string; payload: unknown }) => void): { unsubscribe: () => void };
  };
  selection: {
    get(): ExtensionSelectionState | null;
    set(selection: Omit<ExtensionSelectionState, 'updatedAt'> | null): void;
    subscribe(handler: (selection: ExtensionSelectionState | null) => void): { unsubscribe: () => void };
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
    /** Check whether an extension is enabled and healthy. */
    getStatus(extensionId: string): Promise<{ enabled: boolean; healthy: boolean; errors?: string[] }>;
  };
}

export interface ExtensionBackendContext {
  extensionId: string;
  profile: string;
  /** Absolute path to the pi-agent-runtime directory. */
  runtimeDir: string;
  /** Absolute path to the current profile's settings file. */
  profileSettingsFilePath: string;
  storage: {
    get<T = unknown>(key: string): Promise<T | null>;
    put(key: string, value: unknown, opts?: { expectedVersion?: number }): Promise<{ ok: true }>;
    delete(key: string): Promise<{ ok: true; deleted: boolean }>;
    list<T = unknown>(prefix?: string): Promise<Array<{ key: string; value: T }>>;
  };
  runs: Record<string, (...args: never[]) => Promise<unknown>>;
  automations: Record<string, (...args: never[]) => Promise<unknown>>;
  vault: Record<string, (...args: never[]) => Promise<unknown>>;
  conversations: Record<string, (...args: never[]) => Promise<unknown>> & {
    list(...args: never[]): Promise<unknown>;
    getMeta(conversationId: string): Promise<unknown>;
    get(conversationId: string, options?: { tailBlocks?: number }): Promise<unknown>;
    searchIndex(sessionIds: string[]): Promise<unknown>;
    sendMessage(conversationId: string, text: string, options?: { steer?: boolean }): Promise<unknown>;
    setTitle(conversationId: string, title: string): Promise<unknown>;
    compact(conversationId: string): Promise<unknown>;
    create(input?: ExtensionConversationCreateInput): Promise<ExtensionConversationResult>;
    fork(input: ExtensionConversationForkInput): Promise<ExtensionConversationResult>;
    appendTranscriptBlock(input: ExtensionTranscriptBlockWriteInput): Promise<{ blockId: string }>;
    updateTranscriptBlock(input: ExtensionTranscriptBlockWriteInput & { blockId: string }): Promise<{ blockId: string }>;
  };
  workspace: Record<string, (...args: never[]) => Promise<unknown>>;
  git: Record<string, (...args: never[]) => Promise<unknown>>;
  shell: {
    exec(input: {
      command: string;
      args?: string[];
      cwd?: string;
      timeoutMs?: number;
      maxBuffer?: number;
      env?: Record<string, string>;
    }): Promise<{
      command: string;
      args: string[];
      cwd?: string;
      stdout: string;
      stderr: string;
      executionWrappers: Array<{ id: string; label?: string }>;
    }>;
  };
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
    getStatus(extensionId: string): Promise<{ enabled: boolean; healthy: boolean; errors?: string[] }>;
    /** Enable or disable an extension by ID. */
    setEnabled(extensionId: string, enabled: boolean): void;
  };
  secrets: {
    /** Resolve a secret registered in this extension's manifest. */
    get(secretId: string): string | undefined;
  };
  ui: { invalidate(topics: string | string[]): void };
  telemetry: {
    record(event: {
      source?: 'server' | 'renderer' | 'agent' | 'system';
      category: string;
      name: string;
      sessionId?: string;
      runId?: string;
      route?: string;
      status?: number;
      durationMs?: number;
      count?: number;
      value?: number;
      metadata?: Record<string, unknown>;
    }): void;
  };
  log: {
    info(message: string, fields?: Record<string, unknown>): void;
    warn(message: string, fields?: Record<string, unknown>): void;
    error(message: string, fields?: Record<string, unknown>): void;
  };
}

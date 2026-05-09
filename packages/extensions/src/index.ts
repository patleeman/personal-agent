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
  systemFactory?: string;
  name?: string;
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
    toast(message: string): void;
    confirm(options: { title?: string; message: string }): Promise<boolean>;
  };
}

export interface ExtensionBackendContext {
  extensionId: string;
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
  ui: { invalidate(topics: string | string[]): void };
  log: {
    info(message: string, fields?: Record<string, unknown>): void;
    warn(message: string, fields?: Record<string, unknown>): void;
    error(message: string, fields?: Record<string, unknown>): void;
  };
}

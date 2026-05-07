export const EXTENSION_MANIFEST_VERSION = 1;

export type ExtensionPackageType = 'user' | 'system';
export type ExtensionPlacement = 'left' | 'main' | 'right' | 'conversation' | 'command' | 'slash';
export type ExtensionSurfaceKind = 'navItem' | 'navSection' | 'page' | 'toolPanel' | 'inlineAction' | 'command' | 'slashCommand';
export type ExtensionRightSurfaceScope = 'global' | 'conversation' | 'workspace' | 'selection';
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

export interface ExtensionManifest {
  schemaVersion: typeof EXTENSION_MANIFEST_VERSION;
  id: string;
  name: string;
  packageType?: ExtensionPackageType;
  description?: string;
  version?: string;
  surfaces?: ExtensionSurface[];
  backend?: ExtensionBackend;
  permissions?: ExtensionPermission[];
}

export type ExtensionSurface =
  | ExtensionLeftNavItemSurface
  | ExtensionLeftNavSectionSurface
  | ExtensionMainPageSurface
  | ExtensionRightToolPanelSurface
  | ExtensionConversationInlineActionSurface
  | ExtensionCommandSurface
  | ExtensionSlashCommandSurface;

interface ExtensionSurfaceBase {
  id: string;
  placement: ExtensionPlacement;
  kind: ExtensionSurfaceKind;
  title?: string;
  label?: string;
  icon?: ExtensionIconName;
  action?: string;
}

export interface ExtensionLeftNavItemSurface extends ExtensionSurfaceBase {
  placement: 'left';
  kind: 'navItem';
  label: string;
  route: string;
  icon?: ExtensionIconName;
  badgeAction?: string;
}

export interface ExtensionLeftNavSectionSurface extends ExtensionSurfaceBase {
  placement: 'left';
  kind: 'navSection';
  label: string;
  icon?: ExtensionIconName;
  items?: Array<{ label: string; route: string; icon?: ExtensionIconName; badgeAction?: string }>;
}

export interface ExtensionMainPageSurface extends ExtensionSurfaceBase {
  placement: 'main';
  kind: 'page';
  route: string;
  entry?: string;
}

export interface ExtensionRightToolPanelSurface extends ExtensionSurfaceBase {
  placement: 'right';
  kind: 'toolPanel';
  label: string;
  entry: string;
  scope: ExtensionRightSurfaceScope;
  icon?: ExtensionIconName;
  defaultOpen?: boolean;
}

export interface ExtensionConversationInlineActionSurface extends ExtensionSurfaceBase {
  placement: 'conversation';
  kind: 'inlineAction';
  label: string;
  action: string;
  icon?: ExtensionIconName;
  when?: 'message' | 'selection' | 'composer';
}

export interface ExtensionCommandSurface extends ExtensionSurfaceBase {
  placement: 'command';
  kind: 'command';
  title: string;
  action: string;
  icon?: ExtensionIconName;
}

export interface ExtensionSlashCommandSurface extends ExtensionSurfaceBase {
  placement: 'slash';
  kind: 'slashCommand';
  name: string;
  description: string;
  action: string;
}

export interface ExtensionBackend {
  entry: string;
  actions?: ExtensionBackendAction[];
}

export interface ExtensionBackendAction {
  id: string;
  handler: string;
  title?: string;
  description?: string;
}

export interface ExtensionCommandRegistration {
  extensionId: string;
  surfaceId: string;
  packageType: ExtensionPackageType;
  title: string;
  action: string;
  icon?: string;
}

export interface ExtensionSlashCommandRegistration {
  extensionId: string;
  surfaceId: string;
  packageType: ExtensionPackageType;
  name: string;
  description: string;
  action: string;
}

export interface ExtensionStateDocument<T = unknown> {
  key: string;
  value: T;
  version: number;
  createdAt: number;
  updatedAt: number;
}

export interface ExtensionBackendContext {
  extensionId: string;
  storage: {
    get<T = unknown>(key: string): Promise<T | null>;
    put(key: string, value: unknown, opts?: { expectedVersion?: number }): Promise<{ ok: true }>;
    delete(key: string): Promise<{ ok: true; deleted: boolean }>;
    list<T = unknown>(prefix?: string): Promise<Array<{ key: string; value: T }>>;
  };
  runs: {
    start(input: {
      prompt: string;
      cwd?: string | null;
      source?: string | null;
      taskSlug?: string | null;
    }): Promise<{ runId: string; logPath?: string }>;
    get(runId: string): Promise<unknown>;
    list(): Promise<unknown>;
    readLog(runId: string, tail?: number): Promise<unknown>;
    cancel(runId: string): Promise<unknown>;
  };
  automations: {
    list(): Promise<unknown>;
    get(taskId: string): Promise<unknown>;
    create(input: unknown): Promise<unknown>;
    update(taskId: string, input: unknown): Promise<unknown>;
    delete(taskId: string): Promise<unknown>;
    run(taskId: string): Promise<unknown>;
    readLog(taskId: string): Promise<unknown>;
    readSchedulerHealth(): Promise<unknown>;
  };
  vault: {
    read(path: string): Promise<unknown>;
    write(path: string, content: string): Promise<unknown>;
    list(path?: string): Promise<unknown>;
    search(query: string): Promise<unknown>;
  };
  conversations: {
    list(): Promise<unknown>;
    get(conversationId: string, options?: { tailBlocks?: number }): Promise<unknown>;
    getMeta(conversationId: string): Promise<unknown>;
    searchIndex(sessionIds: string[]): Promise<unknown>;
  };
  log: {
    info(message: string, fields?: Record<string, unknown>): void;
    warn(message: string, fields?: Record<string, unknown>): void;
    error(message: string, fields?: Record<string, unknown>): void;
  };
}

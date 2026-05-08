export const EXTENSION_MANIFEST_VERSION = 2;

export type ExtensionPackageType = 'user' | 'system';
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
  scope?: ExtensionRightSurfaceScope;
  icon?: ExtensionIconName;
  defaultOpen?: boolean;
  /** For rightRail views, optional paired workbench view id rendered in the center pane while this rail tool is active. */
  detailView?: string;
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

export interface ExtensionSlashCommandContribution {
  name: string;
  description: string;
  action: string;
}

export interface ExtensionContributions {
  views?: ExtensionViewContribution[];
  nav?: ExtensionNavContribution[];
  commands?: ExtensionCommandContribution[];
  slashCommands?: ExtensionSlashCommandContribution[];
  skills?: string[];
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
  automations: Record<string, (...args: never[]) => Promise<unknown>>;
  runs: Record<string, (...args: never[]) => Promise<unknown>>;
  storage: {
    get<T = unknown>(key: string): Promise<T | null>;
    put(key: string, value: unknown, opts?: { expectedVersion?: number }): Promise<unknown>;
    delete(key: string): Promise<unknown>;
    list<T = unknown>(prefix?: string): Promise<Array<{ key: string; value: T }>>;
  };
  ui: {
    toast(message: string, options?: Record<string, unknown>): void;
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
  log: {
    info(message: string, fields?: Record<string, unknown>): void;
    warn(message: string, fields?: Record<string, unknown>): void;
    error(message: string, fields?: Record<string, unknown>): void;
  };
}

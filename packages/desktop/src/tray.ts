import { basename } from 'node:path';
import { Menu, Tray, nativeImage, type MenuItemConstructorOptions, type NativeImage } from 'electron';
import { resolveDesktopRuntimePaths } from './desktop-env.js';
import type { HostManager } from './hosts/host-manager.js';

const MAX_RECENT_CONVERSATIONS = 10;

export type DesktopTrayStartupState =
  | { kind: 'starting' }
  | { kind: 'ready' }
  | { kind: 'error'; message: string };

export interface DesktopTrayRecentConversation {
  id: string;
  title: string;
  cwd: string;
  timestamp: string;
  lastActivityAt?: string;
  isRunning?: boolean;
  needsAttention?: boolean;
}

export type DesktopTrayRecentConversationsState =
  | { kind: 'hidden'; conversations: []; totalCount: 0 }
  | { kind: 'loading'; conversations: DesktopTrayRecentConversation[]; totalCount: number }
  | { kind: 'ready'; conversations: DesktopTrayRecentConversation[]; totalCount: number };

export interface DesktopTrayActions {
  onOpen: () => void;
  onOpenConversation: (conversationId: string) => void;
  onNewConversation: () => void;
  onSettings: () => void;
  onCheckForUpdates: () => void;
  onRestartRuntime: () => void;
  onOpenLogs: () => void;
  onQuit: () => void;
}

function createTrayIcon(): string | NativeImage {
  const runtime = resolveDesktopRuntimePaths();
  if (process.platform === 'darwin') {
    return runtime.trayTemplateIconFile;
  }

  return nativeImage.createFromPath(runtime.colorIconFile).resize({ width: 18, height: 18 });
}

function buildTrayToolTip(activeHostLabel: string, startupState: DesktopTrayStartupState): string {
  if (startupState.kind === 'ready') {
    return `Personal Agent — ${activeHostLabel}`;
  }

  if (startupState.kind === 'starting') {
    return `Personal Agent — starting ${activeHostLabel}`;
  }

  return `Personal Agent — startup failed (${activeHostLabel})`;
}

function truncateMenuLabel(value: string, maxLength = 90): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

function readRecentConversationSortTimestamp(conversation: DesktopTrayRecentConversation): string {
  const lastActivityAt = conversation.lastActivityAt?.trim();
  return lastActivityAt && lastActivityAt.length > 0
    ? lastActivityAt
    : conversation.timestamp;
}

function buildRecentConversationSublabel(conversation: DesktopTrayRecentConversation): string | undefined {
  const normalizedCwd = conversation.cwd.trim();
  const projectLabel = normalizedCwd
    ? basename(normalizedCwd) || normalizedCwd
    : '';
  const parts = [projectLabel].filter((value) => value.length > 0);

  if (conversation.isRunning) {
    parts.push('running');
  }

  if (conversation.needsAttention) {
    parts.push('attention');
  }

  if (parts.length === 0) {
    return undefined;
  }

  return truncateMenuLabel(parts.join(' · '), 90);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeRecentConversation(value: unknown): DesktopTrayRecentConversation | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = typeof value.id === 'string' ? value.id.trim() : '';
  const title = typeof value.title === 'string' ? value.title.trim() : '';
  const cwd = typeof value.cwd === 'string' ? value.cwd.trim() : '';
  const timestamp = typeof value.timestamp === 'string' ? value.timestamp.trim() : '';
  const lastActivityAt = typeof value.lastActivityAt === 'string' ? value.lastActivityAt.trim() : '';

  if (!id || !title || !timestamp) {
    return null;
  }

  return {
    id,
    title,
    cwd,
    timestamp,
    ...(lastActivityAt ? { lastActivityAt } : {}),
    ...(typeof value.isRunning === 'boolean' ? { isRunning: value.isRunning } : {}),
    ...(typeof value.needsAttention === 'boolean' ? { needsAttention: value.needsAttention } : {}),
  };
}

function normalizeRecentConversations(value: unknown): { conversations: DesktopTrayRecentConversation[]; totalCount: number } {
  if (!Array.isArray(value)) {
    return { conversations: [], totalCount: 0 };
  }

  const conversations = value
    .map((entry) => normalizeRecentConversation(entry))
    .filter((entry): entry is DesktopTrayRecentConversation => entry !== null)
    .sort((left, right) => readRecentConversationSortTimestamp(right).localeCompare(readRecentConversationSortTimestamp(left)));

  return {
    conversations: conversations.slice(0, MAX_RECENT_CONVERSATIONS),
    totalCount: conversations.length,
  };
}

function sameRecentConversations(
  left: DesktopTrayRecentConversation[],
  right: DesktopTrayRecentConversation[],
): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((entry, index) => {
    const other = right[index];
    return other
      && entry.id === other.id
      && entry.title === other.title
      && entry.cwd === other.cwd
      && entry.timestamp === other.timestamp
      && entry.lastActivityAt === other.lastActivityAt
      && entry.isRunning === other.isRunning
      && entry.needsAttention === other.needsAttention;
  });
}

export function buildDesktopTrayMenuTemplate(options: {
  activeHostLabel: string;
  startupState: DesktopTrayStartupState;
  recentConversationsState?: DesktopTrayRecentConversationsState;
  actions: DesktopTrayActions;
}): MenuItemConstructorOptions[] {
  const {
    activeHostLabel,
    startupState,
    actions,
    recentConversationsState = { kind: 'hidden', conversations: [], totalCount: 0 },
  } = options;
  const controlsReady = startupState.kind === 'ready';
  const canRetry = startupState.kind !== 'starting';
  const statusLabel = startupState.kind === 'ready'
    ? `Connected to: ${activeHostLabel}`
    : startupState.kind === 'starting'
      ? `Starting: ${activeHostLabel}`
      : `Startup failed: ${activeHostLabel}`;

  const template: MenuItemConstructorOptions[] = [
    {
      label: statusLabel,
      enabled: false,
    },
  ];

  if (startupState.kind === 'starting') {
    template.push({
      label: 'Launching desktop backend…',
      enabled: false,
    });
  }

  if (startupState.kind === 'error') {
    template.push({
      label: truncateMenuLabel(startupState.message),
      enabled: false,
    });
  }

  if (recentConversationsState.kind !== 'hidden') {
    template.push(
      { type: 'separator' },
      {
        label: 'Recent',
        enabled: false,
      },
    );

    if (recentConversationsState.conversations.length > 0) {
      for (const conversation of recentConversationsState.conversations) {
        template.push({
          label: truncateMenuLabel(conversation.title, 72),
          sublabel: buildRecentConversationSublabel(conversation),
          click: () => {
            actions.onOpenConversation(conversation.id);
          },
          enabled: controlsReady,
        });
      }
    } else {
      template.push({
        label: recentConversationsState.kind === 'loading'
          ? 'Loading recent conversations…'
          : 'No recent conversations yet',
        enabled: false,
      });
    }

    if (recentConversationsState.totalCount > recentConversationsState.conversations.length) {
      template.push({
        label: 'More Conversations…',
        click: actions.onOpen,
        enabled: controlsReady,
      });
    }
  }

  template.push(
    { type: 'separator' },
    {
      label: startupState.kind === 'error' ? 'Retry Personal Agent' : 'Show Personal Agent',
      click: actions.onOpen,
      enabled: canRetry,
    },
    {
      label: 'New Conversation',
      click: actions.onNewConversation,
      enabled: controlsReady,
    },
    {
      label: 'Settings…',
      click: actions.onSettings,
      enabled: controlsReady,
    },
    {
      label: 'Check for Updates…',
      click: actions.onCheckForUpdates,
    },
    {
      label: 'Restart Runtime',
      click: actions.onRestartRuntime,
      enabled: canRetry,
    },
  );

  if (startupState.kind === 'error') {
    template.push({
      label: 'Open Desktop Logs',
      click: actions.onOpenLogs,
    });
  }

  template.push(
    { type: 'separator' },
    {
      label: 'Quit Personal Agent',
      click: actions.onQuit,
    },
  );

  return template;
}

export class DesktopTrayController {
  private tray: Tray;
  private startupState: DesktopTrayStartupState = { kind: 'starting' };
  private recentConversations: DesktopTrayRecentConversation[] = [];
  private recentConversationTotalCount = 0;
  private recentConversationsLoadedHostId: string | null = null;
  private recentConversationsLoadingHostId: string | null = null;
  private recentConversationsLoadingPromise: Promise<void> | null = null;
  private recentConversationsRequestId = 0;

  constructor(
    private readonly options: {
      hostManager: HostManager;
    } & DesktopTrayActions,
  ) {
    this.tray = new Tray(createTrayIcon());
    this.tray.on('click', () => {
      this.refresh();
      if (this.startupState.kind === 'starting') {
        return;
      }

      this.options.onOpen();
    });
    this.tray.on('right-click', () => {
      void this.showContextMenu();
    });
    this.refresh();
  }

  setStartupState(state: DesktopTrayStartupState): void {
    this.startupState = state;
    this.refresh();
  }

  refresh(): void {
    this.renderMenu();
    void this.ensureRecentConversationsLoaded();
  }

  destroy(): void {
    this.tray.destroy();
  }

  private async showContextMenu(): Promise<void> {
    await this.ensureRecentConversationsLoaded({ force: true });
    this.renderMenu();
    this.tray.popUpContextMenu();
  }

  private renderMenu(): void {
    const activeHost = this.options.hostManager.getActiveHostRecord();
    this.tray.setToolTip(buildTrayToolTip(activeHost.label, this.startupState));
    const menu = Menu.buildFromTemplate(buildDesktopTrayMenuTemplate({
      activeHostLabel: activeHost.label,
      startupState: this.startupState,
      recentConversationsState: this.getRecentConversationsState(),
      actions: this.options,
    }));

    this.tray.setContextMenu(menu);
  }

  private getRecentConversationsState(): DesktopTrayRecentConversationsState {
    if (this.startupState.kind !== 'ready') {
      return { kind: 'hidden', conversations: [], totalCount: 0 };
    }

    const activeHostId = this.options.hostManager.getActiveHostId();
    const hasLoadedCurrentHost = this.recentConversationsLoadedHostId === activeHostId;
    const isLoadingCurrentHost = this.recentConversationsLoadingHostId === activeHostId;

    if (isLoadingCurrentHost) {
      return {
        kind: 'loading',
        conversations: hasLoadedCurrentHost ? this.recentConversations : [],
        totalCount: hasLoadedCurrentHost ? this.recentConversationTotalCount : 0,
      };
    }

    if (hasLoadedCurrentHost) {
      return {
        kind: 'ready',
        conversations: this.recentConversations,
        totalCount: this.recentConversationTotalCount,
      };
    }

    return { kind: 'loading', conversations: [], totalCount: 0 };
  }

  private async ensureRecentConversationsLoaded(options: { force?: boolean } = {}): Promise<void> {
    if (this.startupState.kind !== 'ready') {
      return;
    }

    const activeHostId = this.options.hostManager.getActiveHostId();
    if (this.recentConversationsLoadingHostId === activeHostId && this.recentConversationsLoadingPromise) {
      await this.recentConversationsLoadingPromise;
      return;
    }

    if (!options.force && this.recentConversationsLoadedHostId === activeHostId) {
      return;
    }

    const requestId = ++this.recentConversationsRequestId;
    const previouslyLoadedCurrentHost = this.recentConversationsLoadedHostId === activeHostId;
    this.recentConversationsLoadingHostId = activeHostId;
    this.renderMenu();

    const loadPromise = (async () => {
      try {
        const sessions = await this.options.hostManager.getActiveHostController().invokeLocalApi('GET', '/api/sessions');
        if (requestId !== this.recentConversationsRequestId || activeHostId !== this.options.hostManager.getActiveHostId()) {
          return;
        }

        const normalized = normalizeRecentConversations(sessions);
        const changed = this.recentConversationsLoadedHostId !== activeHostId
          || this.recentConversationTotalCount !== normalized.totalCount
          || !sameRecentConversations(this.recentConversations, normalized.conversations);

        this.recentConversations = normalized.conversations;
        this.recentConversationTotalCount = normalized.totalCount;
        this.recentConversationsLoadedHostId = activeHostId;

        if (changed) {
          this.renderMenu();
        }
      } catch {
        if (requestId !== this.recentConversationsRequestId || activeHostId !== this.options.hostManager.getActiveHostId()) {
          return;
        }

        if (!previouslyLoadedCurrentHost) {
          this.recentConversations = [];
          this.recentConversationTotalCount = 0;
          this.recentConversationsLoadedHostId = activeHostId;
          this.renderMenu();
        }
      } finally {
        if (requestId === this.recentConversationsRequestId) {
          this.recentConversationsLoadingHostId = null;
          this.recentConversationsLoadingPromise = null;
          this.renderMenu();
        }
      }
    })();

    this.recentConversationsLoadingPromise = loadPromise;
    await loadPromise;
  }
}

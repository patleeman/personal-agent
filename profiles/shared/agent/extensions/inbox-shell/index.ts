import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext, Theme } from '@mariozechner/pi-coding-agent';
import {
  listProfileActivityEntries,
  listWorkstreamIds,
  readWorkstreamPlan,
  readWorkstreamSummary,
  resolveWorkstreamPaths,
} from '@personal-agent/core';
import { matchesKey, truncateToWidth, visibleWidth } from '@mariozechner/pi-tui';

const STATUS_KEY = 'inbox-shell';
const WIDGET_KEY = 'inbox-shell-summary';
const CONTEXT_WIDGET_KEY = 'inbox-shell-context';
const PROFILE_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9-_]*$/;
const REFRESH_INTERVAL_MS = 10_000;
const MAX_WIDGET_WIDTH = 72;
const MAX_ACTIVITY_ITEMS = 5;
const MAX_WORKSTREAM_ITEMS = 5;

export interface InboxShellActivityItem {
  id: string;
  createdAt: string;
  kind: string;
  summary: string;
  notificationState: string;
}

export interface InboxShellWorkstreamItem {
  id: string;
  updatedAt: string;
  objective: string;
  status: string;
  blockers: string;
  completedSteps: number;
  totalSteps: number;
  taskRecordCount: number;
  artifactCount: number;
}

export interface InboxShellSnapshot {
  profile: string;
  repoRoot: string;
  activityCount: number;
  activities: InboxShellActivityItem[];
  workstreamCount: number;
  workstreams: InboxShellWorkstreamItem[];
  latestWorkstream?: InboxShellWorkstreamItem;
}

function sanitizeProfileName(raw: string | undefined): string | undefined {
  if (!raw) {
    return undefined;
  }

  const normalized = raw.trim();
  return PROFILE_NAME_PATTERN.test(normalized) ? normalized : undefined;
}

export function resolveInboxShellRepoRoot(): string {
  const explicit = process.env.PERSONAL_AGENT_REPO_ROOT?.trim();
  if (explicit && explicit.length > 0) {
    return resolve(explicit);
  }

  const extensionDir = dirname(fileURLToPath(import.meta.url));
  return resolve(extensionDir, '../../../../../..');
}

export function resolveInboxShellProfile(): string {
  const candidates = [
    process.env.PERSONAL_AGENT_ACTIVE_PROFILE,
    process.env.PERSONAL_AGENT_PROFILE,
  ];

  for (const candidate of candidates) {
    const sanitized = sanitizeProfileName(candidate);
    if (sanitized) {
      return sanitized;
    }
  }

  return 'shared';
}

function stripMarkdownListMarker(value: string | undefined): string {
  if (!value) {
    return 'None';
  }

  return value
    .split('\n')[0]!
    .replace(/^-\s+/, '')
    .trim() || 'None';
}

function countDirectoryMarkdownFiles(path: string): number {
  if (!existsSync(path)) {
    return 0;
  }

  return readdirSync(path, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .length;
}

export function loadInboxShellSnapshot(repoRoot = resolveInboxShellRepoRoot(), profile = resolveInboxShellProfile()): InboxShellSnapshot {
  const activities = listProfileActivityEntries({ repoRoot, profile })
    .slice(0, MAX_ACTIVITY_ITEMS)
    .map(({ entry }) => ({
      id: entry.id,
      createdAt: entry.createdAt,
      kind: entry.kind,
      summary: entry.summary,
      notificationState: entry.notificationState ?? 'none',
    }));

  const workstreams = listWorkstreamIds({ repoRoot, profile })
    .map((workstreamId) => {
      try {
        const paths = resolveWorkstreamPaths({ repoRoot, profile, workstreamId });
        const summary = readWorkstreamSummary(paths.summaryFile);
        const plan = readWorkstreamPlan(paths.planFile);
        const completedSteps = plan.steps.filter((step) => step.completed).length;

        return {
          id: workstreamId,
          updatedAt: summary.updatedAt,
          objective: summary.objective,
          status: stripMarkdownListMarker(summary.status),
          blockers: stripMarkdownListMarker(summary.blockers),
          completedSteps,
          totalSteps: plan.steps.length,
          taskRecordCount: countDirectoryMarkdownFiles(paths.tasksDir),
          artifactCount: countDirectoryMarkdownFiles(paths.artifactsDir),
        } satisfies InboxShellWorkstreamItem;
      } catch {
        return undefined;
      }
    })
    .filter((item): item is InboxShellWorkstreamItem => item !== undefined)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, MAX_WORKSTREAM_ITEMS);

  return {
    profile,
    repoRoot,
    activityCount: listProfileActivityEntries({ repoRoot, profile }).length,
    activities,
    workstreamCount: workstreams.length,
    workstreams,
    latestWorkstream: workstreams[0],
  };
}

function truncateLine(text: string, maxWidth = MAX_WIDGET_WIDTH): string {
  return truncateToWidth(text, maxWidth);
}

export function buildInboxWidgetLines(snapshot: InboxShellSnapshot): string[] {
  const lines: string[] = [];
  lines.push(truncateLine(`📥 Inbox ${snapshot.activityCount} · 🗂 ${snapshot.workstreamCount} workstreams`));

  if (snapshot.activities.length === 0) {
    lines.push(truncateLine('• No activity yet.'));
  } else {
    for (const activity of snapshot.activities.slice(0, 2)) {
      lines.push(truncateLine(`• ${activity.summary}`));
    }
  }

  return lines;
}

export function buildContextWidgetLines(snapshot: InboxShellSnapshot): string[] {
  const workstream = snapshot.latestWorkstream;

  if (!workstream) {
    return [truncateLine('🧭 No workstream context yet.')];
  }

  return [
    truncateLine(`🧭 ${workstream.id} — ${workstream.status}`),
    truncateLine(`plan ${workstream.completedSteps}/${workstream.totalSteps} · tasks ${workstream.taskRecordCount} · artifacts ${workstream.artifactCount}`),
  ];
}

function applyInboxShellUi(ctx: ExtensionContext, snapshot: InboxShellSnapshot): void {
  if (!ctx.hasUI) {
    return;
  }

  ctx.ui.setStatus(STATUS_KEY, `📥 ${snapshot.activityCount}`);
  ctx.ui.setWidget(WIDGET_KEY, buildInboxWidgetLines(snapshot));
  ctx.ui.setWidget(CONTEXT_WIDGET_KEY, buildContextWidgetLines(snapshot), { placement: 'belowEditor' });
}

function clearInboxShellUi(ctx: ExtensionContext): void {
  if (!ctx.hasUI) {
    return;
  }

  ctx.ui.setStatus(STATUS_KEY, undefined);
  ctx.ui.setWidget(WIDGET_KEY, undefined);
  ctx.ui.setWidget(CONTEXT_WIDGET_KEY, undefined, { placement: 'belowEditor' });
}

function refreshInboxShell(ctx: ExtensionContext): void {
  try {
    const snapshot = loadInboxShellSnapshot();
    applyInboxShellUi(ctx, snapshot);
  } catch {
    clearInboxShellUi(ctx);
  }
}

class InboxPanelComponent {
  constructor(
    private theme: Theme,
    private done: () => void,
    private readSnapshot: () => InboxShellSnapshot,
  ) {}

  handleInput(data: string): void {
    if (matchesKey(data, 'escape') || matchesKey(data, 'ctrl+c') || matchesKey(data, 'q')) {
      this.done();
    }
  }

  render(width: number): string[] {
    const snapshot = this.readSnapshot();
    const innerWidth = Math.max(10, width - 2);
    const lines: string[] = [];
    const border = this.theme.fg('border', '│');

    const row = (content: string): string => {
      const truncated = truncateToWidth(content, innerWidth, '…', true);
      const padding = ' '.repeat(Math.max(0, innerWidth - visibleWidth(truncated)));
      return `${border}${truncated}${padding}${border}`;
    };

    lines.push(this.theme.fg('border', `╭${'─'.repeat(innerWidth)}╮`));
    lines.push(row(this.theme.fg('accent', ' Inbox / Context Panel')));
    lines.push(row(`Profile: ${snapshot.profile}`));
    lines.push(row(`Inbox: ${snapshot.activityCount} · Workstreams: ${snapshot.workstreamCount}`));
    lines.push(row(''));
    lines.push(row(this.theme.fg('accent', ' Inbox')));

    if (snapshot.activities.length === 0) {
      lines.push(row(' • No activity yet.'));
    } else {
      for (const activity of snapshot.activities) {
        lines.push(row(` • ${activity.summary}`));
      }
    }

    lines.push(row(''));
    lines.push(row(this.theme.fg('accent', ' Workstreams')));

    if (snapshot.workstreams.length === 0) {
      lines.push(row(' • No workstreams yet.'));
    } else {
      for (const workstream of snapshot.workstreams) {
        lines.push(row(` • ${workstream.id} — ${workstream.status}`));
      }
    }

    const latest = snapshot.latestWorkstream;
    lines.push(row(''));
    lines.push(row(this.theme.fg('accent', ' Latest context')));
    if (!latest) {
      lines.push(row(' No current workstream context.'));
    } else {
      lines.push(row(` ID: ${latest.id}`));
      lines.push(row(` Objective: ${latest.objective}`));
      lines.push(row(` Status: ${latest.status}`));
      lines.push(row(` Blockers: ${latest.blockers}`));
      lines.push(row(` Plan: ${latest.completedSteps}/${latest.totalSteps}`));
      lines.push(row(` Tasks: ${latest.taskRecordCount} · Artifacts: ${latest.artifactCount}`));
    }

    lines.push(row(''));
    lines.push(row(this.theme.fg('dim', ' Esc/Q close')));
    lines.push(this.theme.fg('border', `╰${'─'.repeat(innerWidth)}╯`));
    return lines;
  }

  invalidate(): void {}
  dispose(): void {}
}

export default function inboxShellExtension(pi: ExtensionAPI): void {
  let activeCtx: ExtensionContext | undefined;
  let refreshTimer: NodeJS.Timeout | undefined;

  const bindContext = (ctx: ExtensionContext): void => {
    activeCtx = ctx;
    refreshInboxShell(ctx);

    if (!refreshTimer) {
      refreshTimer = setInterval(() => {
        if (activeCtx) {
          refreshInboxShell(activeCtx);
        }
      }, REFRESH_INTERVAL_MS);
    }
  };

  const unbindContext = (): void => {
    activeCtx = undefined;
    if (refreshTimer) {
      clearInterval(refreshTimer);
      refreshTimer = undefined;
    }
  };

  pi.on('session_start', async (_event, ctx) => {
    bindContext(ctx);
  });

  pi.on('session_switch', async (_event, ctx) => {
    bindContext(ctx);
  });

  pi.on('session_fork', async (_event, ctx) => {
    bindContext(ctx);
  });

  pi.on('turn_end', async (_event, ctx) => {
    bindContext(ctx);
  });

  pi.on('agent_end', async (_event, ctx) => {
    bindContext(ctx);
  });

  pi.on('session_shutdown', async () => {
    unbindContext();
  });

  pi.registerCommand('inbox-refresh', {
    description: 'Refresh inbox/context widgets from durable activity and workstreams',
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      bindContext(ctx);
      ctx.ui.notify('Inbox/context refreshed.', 'info');
    },
  });

  pi.registerCommand('inbox-panel', {
    description: 'Open the inbox/context side panel',
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      bindContext(ctx);
      await ctx.ui.custom<void>((_tui, theme, _kb, done) => new InboxPanelComponent(theme, done, () => loadInboxShellSnapshot()), {
        overlay: true,
        overlayOptions: {
          anchor: 'right-center',
          width: '33%',
          minWidth: 38,
          maxWidth: 60,
          margin: { right: 1 },
          visible: (termWidth) => termWidth >= 100,
        },
      });
    },
  });
}

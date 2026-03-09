import type { ExtensionAPI, ExtensionContext, SessionEntry } from '@mariozechner/pi-coding-agent';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const PA_TUI_DIRECT_ENV = 'PERSONAL_AGENT_TUI_DIRECT';
const PA_TMUX_WORKSPACE_ENV = 'PERSONAL_AGENT_TMUX_WORKSPACE';
const DEFAULT_SHORTCUT = 'ctrl+shift+f';
const FORK_PANE_TITLE = 'fork';

function resolvePaPaneCommand(): { command: string; argsPrefix: string[] } {
  const repoRoot = process.env.PERSONAL_AGENT_REPO_ROOT?.trim();
  if (repoRoot && repoRoot.length > 0) {
    const cliEntry = join(repoRoot, 'packages', 'cli', 'dist', 'index.js');
    if (existsSync(cliEntry)) {
      return {
        command: process.execPath,
        argsPrefix: [cliEntry],
      };
    }
  }

  return {
    command: 'pa',
    argsPrefix: [],
  };
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function formatShellCommand(args: string[]): string {
  return args.map((arg) => shellQuote(arg)).join(' ');
}

function createEntryId(existingIds: Set<string>): string {
  for (let index = 0; index < 100; index += 1) {
    const nextId = randomUUID().slice(0, 8);
    if (!existingIds.has(nextId)) {
      return nextId;
    }
  }

  return randomUUID();
}

function createForkedSessionFile(ctx: ExtensionContext, sourceSessionFile: string, leafId: string): string {
  const header = ctx.sessionManager.getHeader();
  if (!header) {
    throw new Error('Current session header is unavailable.');
  }

  const branch = ctx.sessionManager.getBranch(leafId);
  if (branch.length === 0) {
    throw new Error('Current conversation branch is empty.');
  }

  const branchWithoutLabels = branch.filter((entry) => entry.type !== 'label');
  const timestamp = new Date().toISOString();
  const sessionId = randomUUID();
  const sessionFile = join(ctx.sessionManager.getSessionDir(), `${timestamp.replace(/[:.]/g, '-')}_${sessionId}.jsonl`);
  const usedIds = new Set(branchWithoutLabels.map((entry) => entry.id));
  const labelEntries: SessionEntry[] = [];

  let labelParentId = branchWithoutLabels[branchWithoutLabels.length - 1]?.id ?? null;
  for (const entry of branchWithoutLabels) {
    const label = ctx.sessionManager.getLabel(entry.id);
    if (!label) {
      continue;
    }

    const labelEntry: SessionEntry = {
      type: 'label',
      id: createEntryId(usedIds),
      parentId: labelParentId,
      timestamp: new Date().toISOString(),
      targetId: entry.id,
      label,
    };

    usedIds.add(labelEntry.id);
    labelEntries.push(labelEntry);
    labelParentId = labelEntry.id;
  }

  const entries = [
    {
      type: 'session' as const,
      version: header.version ?? 3,
      id: sessionId,
      timestamp,
      cwd: header.cwd,
      parentSession: sourceSessionFile,
    },
    ...branchWithoutLabels,
    ...labelEntries,
  ];

  writeFileSync(sessionFile, `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`);
  return sessionFile;
}

function openForkPane(profileName: string, sessionFile: string): { paneId?: string } {
  const targetPane = process.env.TMUX_PANE?.trim();
  if (!targetPane) {
    throw new Error('TMUX_PANE is not available in this workspace.');
  }

  const paneCommand = resolvePaPaneCommand();
  const command = formatShellCommand([
    'env',
    `${PA_TUI_DIRECT_ENV}=1`,
    paneCommand.command,
    ...paneCommand.argsPrefix,
    'tui',
    '--profile',
    profileName,
    '--session',
    sessionFile,
  ]);

  const result = spawnSync('tmux', ['split-window', '-h', '-P', '-F', '#{pane_id}', '-t', targetPane, command], {
    encoding: 'utf-8',
    env: process.env,
  });

  if (result.error) {
    throw result.error;
  }

  if ((result.status ?? 1) !== 0) {
    const detail = `${result.stderr ?? ''}\n${result.stdout ?? ''}`.trim() || 'unknown tmux error';
    throw new Error(`tmux split-window failed: ${detail}`);
  }

  const paneId = (result.stdout ?? '').trim();
  if (paneId.length > 0) {
    const titleResult = spawnSync('tmux', ['select-pane', '-t', paneId, '-T', FORK_PANE_TITLE], {
      encoding: 'utf-8',
      env: process.env,
    });

    if ((titleResult.status ?? 1) !== 0 && !titleResult.error) {
      // Non-fatal.
    }
  }

  return {
    paneId: paneId.length > 0 ? paneId : undefined,
  };
}

async function forkIntoPane(ctx: ExtensionContext): Promise<void> {
  if (!ctx.hasUI) {
    return;
  }

  if (process.env[PA_TMUX_WORKSPACE_ENV] !== '1' || !process.env.TMUX) {
    ctx.ui.notify('Fork pane is only available inside pa tui workspace mode.', 'warning');
    return;
  }

  if (!ctx.isIdle()) {
    ctx.ui.notify('Wait for the agent to finish before opening a forked pane.', 'warning');
    return;
  }

  const sessionFile = ctx.sessionManager.getSessionFile();
  if (!sessionFile) {
    ctx.ui.notify('Fork pane requires a persisted session file path.', 'warning');
    return;
  }

  const leafId = ctx.sessionManager.getLeafId();
  if (!leafId) {
    ctx.ui.notify('No conversation is available to fork yet.', 'warning');
    return;
  }

  const profileName = process.env.PERSONAL_AGENT_ACTIVE_PROFILE?.trim();
  if (!profileName) {
    ctx.ui.notify('Active profile is unavailable in this session.', 'warning');
    return;
  }

  try {
    const forkedSessionFile = createForkedSessionFile(ctx, sessionFile, leafId);
    const pane = openForkPane(profileName, forkedSessionFile);
    const paneLabel = pane.paneId ? ` in pane ${pane.paneId}` : '';
    ctx.ui.notify(`Forked current conversation${paneLabel}.`, 'info');
  } catch (error) {
    ctx.ui.notify(`Failed to fork into pane: ${(error as Error).message}`, 'error');
  }
}

export default function forkPaneExtension(pi: ExtensionAPI): void {
  pi.registerCommand('fork-pane', {
    description: 'Clone the current conversation into a new PA workspace pane',
    handler: async (_args, ctx) => {
      await forkIntoPane(ctx);
    },
  });

  pi.registerShortcut(DEFAULT_SHORTCUT, {
    description: 'Clone the current conversation into a new pane',
    handler: async (ctx) => {
      await forkIntoPane(ctx);
    },
  });
}

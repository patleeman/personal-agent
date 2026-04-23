#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { access, readFile, readdir, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const AGENT_BROWSER_DIR = path.join(os.homedir(), '.agent-browser');

function printUsage(exitCode = 1) {
  const out = exitCode === 0 ? console.log : console.error;
  out(`Usage:
  node scripts/agent-browser-session.mjs run --session <name> --command <shell>
  node scripts/agent-browser-session.mjs cleanup [--older-than-hours <hours>] [--dry-run]

Examples:
  node scripts/agent-browser-session.mjs run --session kb-check --command 'ab open http://127.0.0.1:3741/knowledge && ab wait 1500 && ab snapshot -i'
  node scripts/agent-browser-session.mjs cleanup --older-than-hours 6
`);
  process.exit(exitCode);
}

function parseArgs(argv) {
  const [subcommand, ...rest] = argv;
  if (!subcommand || subcommand === '--help' || subcommand === '-h') {
    printUsage(subcommand ? 0 : 1);
  }

  const args = { _: [] };
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (token === '--') {
      args._.push(...rest.slice(i + 1));
      break;
    }
    if (!token.startsWith('--')) {
      args._.push(token);
      continue;
    }
    const key = token;
    const next = rest[i + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    i += 1;
  }
  return { subcommand, args };
}

function generateSessionName() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const suffix = Math.random().toString(36).slice(2, 8);
  return `pa-${timestamp}-${suffix}`;
}

function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function runCommand(command, args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      env: { ...process.env, ...env },
    });
    child.on('error', reject);
    child.on('exit', (code, signal) => resolve({ code, signal }));
  });
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function removeIfPresent(filePath) {
  await rm(filePath, { force: true }).catch(() => undefined);
}

async function closeSession(session, pid) {
  const closeResult = await runCommand('agent-browser', ['--session', session, 'close']);
  if (closeResult.code === 0) {
    return { method: 'close', closed: true };
  }

  if (isPidAlive(pid)) {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // Ignore and fall through to the cleanup result below.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  if (isPidAlive(pid)) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // Ignore and let the caller inspect the final state.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  return { method: isPidAlive(pid) ? 'failed' : 'signal', closed: !isPidAlive(pid) };
}

async function runSession(args) {
  const session = typeof args['--session'] === 'string' ? args['--session'] : generateSessionName();
  const command = typeof args['--command'] === 'string'
    ? args['--command']
    : args._.length > 0
      ? args._.join(' ')
      : null;
  const keepOpen = args['--keep-open'] === true;

  if (!command) {
    console.error('Missing required --command argument.');
    printUsage(1);
  }

  console.error(`[agent-browser] session=${session}${keepOpen ? ' keep-open=1' : ''}`);
  const shell = `set -euo pipefail
cleanup() {
  if [[ "\${AB_KEEP_OPEN:-0}" != "1" ]]; then
    agent-browser --session "$AB_SESSION" close >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT INT TERM
ab() { agent-browser --session "$AB_SESSION" "$@"; }
eval "$AB_COMMAND"
`;

  const result = await runCommand('bash', ['-lc', shell], {
    AB_SESSION: session,
    AB_COMMAND: command,
    AB_KEEP_OPEN: keepOpen ? '1' : '0',
  });

  if (typeof result.code === 'number') {
    process.exit(result.code);
  }
  if (result.signal) {
    process.kill(process.pid, result.signal);
    return;
  }
  process.exit(1);
}

async function cleanupSessions(args) {
  const olderThanHoursRaw = args['--older-than-hours'];
  const olderThanHours = olderThanHoursRaw === undefined ? 6 : Number(olderThanHoursRaw);
  if (!Number.isFinite(olderThanHours) || olderThanHours < 0) {
    throw new Error(`Invalid --older-than-hours value: ${olderThanHoursRaw}`);
  }
  const dryRun = args['--dry-run'] === true;
  const thresholdMs = olderThanHours * 60 * 60 * 1000;
  const now = Date.now();

  const entries = (await readdir(AGENT_BROWSER_DIR).catch(() => []))
    .filter((name) => name.endsWith('.pid'))
    .sort((left, right) => left.localeCompare(right));

  let removedDead = 0;
  let closedStale = 0;
  let skippedRecent = 0;
  let failed = 0;

  for (const entry of entries) {
    const session = entry.slice(0, -4);
    const pidPath = path.join(AGENT_BROWSER_DIR, `${session}.pid`);
    const sockPath = path.join(AGENT_BROWSER_DIR, `${session}.sock`);
    const stats = await stat(pidPath).catch(() => null);
    if (!stats) {
      continue;
    }

    const ageHours = (now - stats.mtimeMs) / (60 * 60 * 1000);
    const pidRaw = (await readFile(pidPath, 'utf8').catch(() => '')).trim();
    const pid = Number.parseInt(pidRaw, 10);
    const alive = isPidAlive(pid);

    if (!alive) {
      console.log(`${dryRun ? 'would remove' : 'remove'} dead session ${session} pid=${pidRaw || '?'} age=${ageHours.toFixed(1)}h`);
      if (!dryRun) {
        await removeIfPresent(pidPath);
        await removeIfPresent(sockPath);
      }
      removedDead += 1;
      continue;
    }

    if (thresholdMs > 0 && (now - stats.mtimeMs) < thresholdMs) {
      skippedRecent += 1;
      continue;
    }

    console.log(`${dryRun ? 'would close' : 'close'} stale session ${session} pid=${pid} age=${ageHours.toFixed(1)}h`);
    if (dryRun) {
      closedStale += 1;
      continue;
    }

    const result = await closeSession(session, pid);
    if (result.closed) {
      await removeIfPresent(pidPath);
      await removeIfPresent(sockPath);
      closedStale += 1;
      continue;
    }

    failed += 1;
    console.error(`failed to close session ${session} pid=${pid} method=${result.method}`);
  }

  console.log(`summary: removed-dead=${removedDead} closed-stale=${closedStale} skipped-recent=${skippedRecent} failed=${failed}`);
}

async function main() {
  const { subcommand, args } = parseArgs(process.argv.slice(2));
  if (subcommand === 'run') {
    await runSession(args);
    return;
  }
  if (subcommand === 'cleanup') {
    await cleanupSessions(args);
    return;
  }
  printUsage(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

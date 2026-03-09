#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import { ensureConversationMaintenanceIndexPath } from './paths.mjs';

function printUsage() {
  console.error(`Usage:
  node scripts/conversation-maintenance/list-unprocessed-sessions.mjs --profile <assistant|datadog> [options]

Options:
  --profile <name>            Profile name (required)
  --index <path>              Processed index JSON path (default: <state-root>/conversation-maintenance/<profile>/processed-conversations.json)
  --sessions-root <path>      Sessions root (default: ~/.local/state/personal-agent/pi-agent/sessions)
  --days <n>                  Rolling window size in days (default: 7)
  --timezone <IANA tz>        Timezone for date windowing (default: America/New_York)
  --help                      Show this help
`);
}

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    if (key === 'help') {
      args.help = true;
      continue;
    }
    const value = argv[i + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for --${key}`);
    }
    args[key] = value;
    i += 1;
  }
  return args;
}

function expandHome(inputPath) {
  if (!inputPath) return inputPath;
  if (inputPath === '~') return os.homedir();
  if (inputPath.startsWith('~/')) return path.join(os.homedir(), inputPath.slice(2));
  return inputPath;
}

function asAbsolute(inputPath) {
  const expanded = expandHome(inputPath);
  return path.isAbsolute(expanded) ? expanded : path.resolve(process.cwd(), expanded);
}

function localDateString(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;

  if (!year || !month || !day) {
    throw new Error(`Failed to format date for timezone ${timeZone}`);
  }

  return `${year}-${month}-${day}`;
}

function shiftDate(dateStr, deltaDays) {
  const date = new Date(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid date string: ${dateStr}`);
  }
  date.setUTCDate(date.getUTCDate() + deltaDays);
  return date.toISOString().slice(0, 10);
}

async function listJsonlFiles(rootDir) {
  const files = [];

  async function walk(current) {
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
        return;
      }
      throw error;
    }

    await Promise.all(
      entries.map(async (entry) => {
        const fullPath = path.join(current, entry.name);
        if (entry.isDirectory()) {
          await walk(fullPath);
          return;
        }
        if (entry.isFile() && entry.name.endsWith('.jsonl')) {
          files.push(fullPath);
        }
      }),
    );
  }

  await walk(rootDir);
  return files;
}

async function readSessionHeader(sessionFile) {
  const content = await fs.readFile(sessionFile, 'utf8');
  const firstLine = content.split('\n').find((line) => line.trim().length > 0);
  if (!firstLine) {
    throw new Error('empty file');
  }

  let parsed;
  try {
    parsed = JSON.parse(firstLine);
  } catch {
    throw new Error('invalid first JSON line');
  }

  if (!parsed || parsed.type !== 'session') {
    throw new Error('first JSON line is not a session record');
  }

  const sessionId = typeof parsed.id === 'string' ? parsed.id.trim() : '';
  const timestamp = typeof parsed.timestamp === 'string' ? parsed.timestamp.trim() : '';

  if (!sessionId) {
    throw new Error('missing session id');
  }
  if (!timestamp) {
    throw new Error('missing session timestamp');
  }
  if (Number.isNaN(new Date(timestamp).getTime())) {
    throw new Error('invalid session timestamp');
  }

  return {
    sessionId,
    sessionTimestamp: timestamp,
  };
}

async function loadProcessedIndex(indexPath) {
  try {
    const raw = await fs.readFile(indexPath, 'utf8');
    const parsed = JSON.parse(raw);

    const records = Array.isArray(parsed?.conversations)
      ? parsed.conversations.filter(
          (item) => item && typeof item.sessionId === 'string' && item.sessionId.trim().length > 0,
        )
      : [];

    const processedSet = new Set(records.map((item) => item.sessionId.trim()));

    return {
      exists: true,
      records,
      processedSet,
      parseError: null,
    };
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
    if (code === 'ENOENT') {
      return {
        exists: false,
        records: [],
        processedSet: new Set(),
        parseError: null,
      };
    }

    return {
      exists: true,
      records: [],
      processedSet: new Set(),
      parseError: error instanceof Error ? error.message : String(error),
    };
  }
}

function compareByTimestampThenId(a, b) {
  const aMs = new Date(a.sessionTimestamp).getTime();
  const bMs = new Date(b.sessionTimestamp).getTime();
  if (aMs !== bMs) return aMs - bMs;
  return a.sessionId.localeCompare(b.sessionId);
}

async function main() {
  const args = parseArgs(process.argv);

  if (args.help) {
    printUsage();
    process.exit(0);
  }

  const profile = typeof args.profile === 'string' ? args.profile.trim() : '';
  if (!profile) {
    printUsage();
    throw new Error('--profile is required');
  }

  const days = Number.parseInt(args.days ?? '7', 10);
  if (!Number.isFinite(days) || days <= 0) {
    throw new Error('--days must be a positive integer');
  }

  const timezone = typeof args.timezone === 'string' ? args.timezone.trim() : 'America/New_York';
  const resolvedIndex = args.index
    ? {
        indexPath: asAbsolute(args.index),
        migratedFrom: null,
      }
    : await ensureConversationMaintenanceIndexPath(profile);
  const indexPath = resolvedIndex.indexPath;
  const sessionsRoot = asAbsolute(args['sessions-root'] ?? '~/.local/state/personal-agent/pi-agent/sessions');

  const now = new Date();
  const todayLocal = localDateString(now, timezone);
  const windowStart = shiftDate(todayLocal, -(days - 1));
  const windowEnd = todayLocal;

  const sessionFiles = await listJsonlFiles(sessionsRoot);
  const scanErrors = [];
  const candidates = [];

  for (const sessionFile of sessionFiles) {
    try {
      const header = await readSessionHeader(sessionFile);
      const sessionDateLocal = localDateString(new Date(header.sessionTimestamp), timezone);
      if (sessionDateLocal < windowStart || sessionDateLocal > windowEnd) {
        continue;
      }

      candidates.push({
        sessionId: header.sessionId,
        sessionFile,
        sessionTimestamp: header.sessionTimestamp,
        sessionDateLocal,
      });
    } catch (error) {
      scanErrors.push({
        sessionFile,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  candidates.sort(compareByTimestampThenId);

  const processedIndex = await loadProcessedIndex(indexPath);
  const processedInWindow = [];
  const unprocessed = [];

  for (const candidate of candidates) {
    if (processedIndex.processedSet.has(candidate.sessionId)) {
      processedInWindow.push(candidate);
    } else {
      unprocessed.push(candidate);
    }
  }

  const result = {
    profile,
    timezone,
    windowDays: days,
    now: now.toISOString(),
    window: {
      start: windowStart,
      end: windowEnd,
    },
    sessionsRoot,
    indexPath,
    index: {
      exists: processedIndex.exists,
      parseError: processedIndex.parseError,
      storedRecords: processedIndex.records.length,
      migratedFrom: resolvedIndex.migratedFrom,
    },
    counts: {
      sessionFilesScanned: sessionFiles.length,
      candidatesInWindow: candidates.length,
      processedInWindow: processedInWindow.length,
      unprocessedInWindow: unprocessed.length,
      scanErrors: scanErrors.length,
    },
    unprocessed,
    processedInWindow,
    scanErrors,
  };

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

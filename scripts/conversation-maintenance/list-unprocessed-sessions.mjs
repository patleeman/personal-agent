#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import yaml from 'js-yaml';

import {
  ensureConversationMaintenanceIndexPath,
  getPiAgentSessionsRoot,
  getProfilesRoot,
  getStateRoot,
} from './paths.mjs';

function printUsage() {
  console.error(`Usage:
  node scripts/conversation-maintenance/list-unprocessed-sessions.mjs --profile <assistant|datadog> [options]

Options:
  --profile <name>            Profile name (required)
  --index <path>              Processed index JSON path (default: <state-root>/conversation-maintenance/<profile>/processed-conversations.json)
  --sessions-root <path>      Sessions root (default: <state-root>/pi-agent/sessions)
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

function normalizeWhitespace(value) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
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

async function listFilesWithSuffix(rootDir, suffix) {
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
        if (entry.isFile() && entry.name.endsWith(suffix)) {
          files.push(fullPath);
        }
      }),
    );
  }

  await walk(rootDir);
  return files;
}

function extractTextFromContent(content) {
  if (typeof content === 'string') {
    return content;
  }

  if (!Array.isArray(content)) {
    return '';
  }

  return content
    .map((item) => {
      if (typeof item === 'string') {
        return item;
      }
      if (item && typeof item === 'object' && item.type === 'text' && typeof item.text === 'string') {
        return item.text;
      }
      return '';
    })
    .join('\n');
}

async function readSessionMetadata(sessionFile) {
  const content = await fs.readFile(sessionFile, 'utf8');
  const lines = content.split('\n');
  const firstLine = lines.find((line) => line.trim().length > 0);
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

  let firstUserPrompt = '';
  for (const line of lines) {
    if (!line.trim()) continue;

    let record;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }

    if (record?.type !== 'message' || record?.message?.role !== 'user') {
      continue;
    }

    firstUserPrompt = normalizeWhitespace(extractTextFromContent(record.message.content));
    break;
  }

  return {
    sessionId,
    sessionTimestamp: timestamp,
    firstUserPrompt,
  };
}

function extractMarkdownBody(raw) {
  const frontmatterMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!frontmatterMatch) {
    return null;
  }

  return {
    frontmatter: frontmatterMatch[1],
    body: frontmatterMatch[2],
  };
}

async function loadScheduledTaskPromptIndex(profilesRoot) {
  const taskFiles = await listFilesWithSuffix(profilesRoot, '.task.md');
  const promptIndex = new Map();

  for (const taskFile of taskFiles) {
    let raw;
    try {
      raw = await fs.readFile(taskFile, 'utf8');
    } catch {
      continue;
    }

    const parsedDoc = extractMarkdownBody(raw);
    if (!parsedDoc) {
      continue;
    }

    let frontmatter;
    try {
      frontmatter = yaml.load(parsedDoc.frontmatter);
    } catch {
      continue;
    }

    const normalizedPrompt = normalizeWhitespace(parsedDoc.body);
    if (!normalizedPrompt) {
      continue;
    }

    const inferredTaskId = path.basename(taskFile, '.task.md');
    const taskId = typeof frontmatter?.id === 'string' && frontmatter.id.trim().length > 0
      ? frontmatter.id.trim()
      : inferredTaskId;

    const existing = promptIndex.get(normalizedPrompt) ?? [];
    existing.push({
      taskId,
      taskFile,
    });
    promptIndex.set(normalizedPrompt, existing);
  }

  return promptIndex;
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
  const stateRoot = getStateRoot();
  const profilesRoot = getProfilesRoot();
  const sessionsRoot = asAbsolute(args['sessions-root'] ?? getPiAgentSessionsRoot());

  const now = new Date();
  const todayLocal = localDateString(now, timezone);
  const windowStart = shiftDate(todayLocal, -(days - 1));
  const windowEnd = todayLocal;

  const [sessionFiles, scheduledTaskPromptIndex] = await Promise.all([
    listFilesWithSuffix(sessionsRoot, '.jsonl'),
    loadScheduledTaskPromptIndex(profilesRoot),
  ]);

  const scanErrors = [];
  const rawCandidates = [];

  for (const sessionFile of sessionFiles) {
    try {
      const metadata = await readSessionMetadata(sessionFile);
      const sessionDateLocal = localDateString(new Date(metadata.sessionTimestamp), timezone);
      if (sessionDateLocal < windowStart || sessionDateLocal > windowEnd) {
        continue;
      }

      rawCandidates.push({
        sessionId: metadata.sessionId,
        sessionFile,
        sessionTimestamp: metadata.sessionTimestamp,
        sessionDateLocal,
        firstUserPrompt: metadata.firstUserPrompt,
      });
    } catch (error) {
      scanErrors.push({
        sessionFile,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  rawCandidates.sort(compareByTimestampThenId);

  const excludedScheduledTaskRuns = [];
  const candidates = [];

  for (const candidate of rawCandidates) {
    const matchedTasks = scheduledTaskPromptIndex.get(candidate.firstUserPrompt);
    if (matchedTasks && matchedTasks.length > 0) {
      excludedScheduledTaskRuns.push({
        sessionId: candidate.sessionId,
        sessionFile: candidate.sessionFile,
        sessionTimestamp: candidate.sessionTimestamp,
        sessionDateLocal: candidate.sessionDateLocal,
        firstUserPrompt: candidate.firstUserPrompt,
        matchedTaskIds: matchedTasks.map((task) => task.taskId),
        matchedTaskFiles: matchedTasks.map((task) => task.taskFile),
      });
      continue;
    }

    candidates.push({
      sessionId: candidate.sessionId,
      sessionFile: candidate.sessionFile,
      sessionTimestamp: candidate.sessionTimestamp,
      sessionDateLocal: candidate.sessionDateLocal,
    });
  }

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
    stateRoot,
    profilesRoot,
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
      rawCandidatesInWindow: rawCandidates.length,
      excludedScheduledTaskRuns: excludedScheduledTaskRuns.length,
      candidatesInWindow: candidates.length,
      processedInWindow: processedInWindow.length,
      unprocessedInWindow: unprocessed.length,
      scanErrors: scanErrors.length,
    },
    excludedScheduledTaskRuns,
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

import { homedir } from 'os';
import { basename, join, resolve } from 'path';
import { parseDocument } from 'yaml';

const FRONTMATTER_DELIMITER = '---';
const DEFAULT_PROFILE = 'shared';
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

interface ParsedCronField {
  values: Set<number>;
  wildcard: boolean;
}

export interface ParsedCronExpression {
  raw: string;
  minute: ParsedCronField;
  hour: ParsedCronField;
  dayOfMonth: ParsedCronField;
  month: ParsedCronField;
  dayOfWeek: ParsedCronField;
}

export interface CronTaskSchedule {
  type: 'cron';
  expression: string;
  parsed: ParsedCronExpression;
}

export interface AtTaskSchedule {
  type: 'at';
  at: string;
  atMs: number;
}

export type ParsedTaskSchedule = CronTaskSchedule | AtTaskSchedule;

export interface ParsedTaskDefinition {
  key: string;
  filePath: string;
  fileName: string;
  id: string;
  title?: string;
  enabled: boolean;
  schedule: ParsedTaskSchedule;
  prompt: string;
  profile: string;
  modelRef?: string;
  thinkingLevel?: string;
  cwd?: string;
  timeoutSeconds: number;
}

interface ParseTaskDefinitionOptions {
  filePath: string;
  rawContent: string;
  defaultTimeoutSeconds: number;
}

interface FrontmatterSection {
  attributes: Record<string, unknown>;
  body: string;
}

function expandHome(path: string): string {
  if (path === '~') {
    return homedir();
  }

  if (path.startsWith('~/')) {
    return join(homedir(), path.slice(2));
  }

  return path;
}

function normalizeIsoTimestamp(raw: string): string | undefined {
  const normalized = raw.trim();
  if (!ISO_TIMESTAMP_PATTERN.test(normalized)) {
    return undefined;
  }

  const parsed = Date.parse(normalized);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }

  return new Date(parsed).toISOString();
}

function toTaskIdFromFile(filePath: string): string {
  const fileName = basename(filePath);
  const withoutExtension = fileName.endsWith('.task.md')
    ? fileName.slice(0, fileName.length - '.task.md'.length)
    : fileName.endsWith('.md')
      ? fileName.slice(0, fileName.length - '.md'.length)
      : fileName;

  const normalized = withoutExtension
    .replace(/[^a-zA-Z0-9-_]+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');

  if (normalized.length > 0) {
    return normalized;
  }

  return 'task';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseFrontmatterYaml(rawFrontmatter: string): Record<string, unknown> {
  const document = parseDocument(rawFrontmatter, {
    prettyErrors: true,
    uniqueKeys: true,
  });

  if (document.errors.length > 0) {
    const firstError = document.errors[0];
    throw new Error(`Invalid YAML frontmatter: ${firstError?.message ?? 'unknown parse error'}`);
  }

  const parsed = document.toJS({ mapAsMap: false }) as unknown;

  if (!isRecord(parsed)) {
    throw new Error('YAML frontmatter must evaluate to an object');
  }

  return parsed;
}

function splitFrontmatter(content: string): FrontmatterSection {
  const normalized = content.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');

  if (lines.length === 0 || lines[0]?.trim() !== FRONTMATTER_DELIMITER) {
    throw new Error('Task markdown must start with YAML frontmatter');
  }

  let endIndex = -1;
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index]?.trim() === FRONTMATTER_DELIMITER) {
      endIndex = index;
      break;
    }
  }

  if (endIndex === -1) {
    throw new Error('Missing closing YAML frontmatter delimiter');
  }

  const rawFrontmatter = lines.slice(1, endIndex).join('\n');
  const body = lines.slice(endIndex + 1).join('\n').trim();

  return {
    attributes: parseFrontmatterYaml(rawFrontmatter),
    body,
  };
}

function getAttribute(attributes: Record<string, unknown>, key: string): unknown {
  if (Object.prototype.hasOwnProperty.call(attributes, key)) {
    return attributes[key];
  }

  const lowerKey = key.toLowerCase();
  if (Object.prototype.hasOwnProperty.call(attributes, lowerKey)) {
    return attributes[lowerKey];
  }

  return undefined;
}

function readOptionalString(attributes: Record<string, unknown>, key: string): string | undefined {
  const raw = getAttribute(attributes, key);

  if (raw === undefined || raw === null) {
    return undefined;
  }

  if (typeof raw === 'number' || typeof raw === 'bigint') {
    const asString = String(raw).trim();
    return asString.length > 0 ? asString : undefined;
  }

  if (typeof raw !== 'string') {
    throw new Error(`Frontmatter key ${key} must be a string`);
  }

  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readEnabled(attributes: Record<string, unknown>): boolean {
  const raw = getAttribute(attributes, 'enabled');

  if (raw === undefined) {
    return true;
  }

  if (typeof raw === 'boolean') {
    return raw;
  }

  if (typeof raw === 'string') {
    const normalized = raw.trim().toLowerCase();
    if (normalized === 'true') {
      return true;
    }

    if (normalized === 'false') {
      return false;
    }
  }

  throw new Error('Frontmatter key enabled must be a boolean');
}

function readTimeoutSeconds(attributes: Record<string, unknown>, defaultTimeoutSeconds: number): number {
  const raw = getAttribute(attributes, 'timeoutSeconds');

  if (raw === undefined || raw === null || raw === '') {
    return defaultTimeoutSeconds;
  }

  if (typeof raw === 'number') {
    if (!Number.isSafeInteger(raw) || raw <= 0) {
      throw new Error('Frontmatter key timeoutSeconds must be a positive integer');
    }

    return raw;
  }

  if (typeof raw === 'string' && /^\d+$/.test(raw.trim())) {
    const parsed = Number.parseInt(raw.trim(), 10);
    if (!Number.isSafeInteger(parsed) || parsed <= 0) {
      throw new Error('Frontmatter key timeoutSeconds must be a positive integer');
    }

    return parsed;
  }

  throw new Error('Frontmatter key timeoutSeconds must be a positive integer');
}

function parseCronNumber(raw: string, min: number, max: number, label: string, allowSunday7 = false): number {
  if (!/^\d+$/.test(raw)) {
    throw new Error(`Invalid ${label} value: ${raw}`);
  }

  const value = Number.parseInt(raw, 10);
  const maxValue = allowSunday7 ? Math.max(max, 7) : max;

  if (value < min || value > maxValue) {
    throw new Error(`Invalid ${label} value: ${raw}`);
  }

  return value;
}

function parseStep(raw: string, label: string): number {
  if (!/^\d+$/.test(raw)) {
    throw new Error(`Invalid ${label} step value: ${raw}`);
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${label} step value: ${raw}`);
  }

  return parsed;
}

function normalizeCronValue(value: number, allowSunday7: boolean): number {
  if (allowSunday7 && value === 7) {
    return 0;
  }

  return value;
}

function parseCronField(raw: string, min: number, max: number, label: string, allowSunday7 = false): ParsedCronField {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new Error(`Cron ${label} field cannot be empty`);
  }

  const values = new Set<number>();
  const tokens = trimmed.split(',');

  for (const token of tokens) {
    const part = token.trim();
    if (part.length === 0) {
      throw new Error(`Cron ${label} field has empty list item`);
    }

    const stepParts = part.split('/');
    if (stepParts.length > 2) {
      throw new Error(`Cron ${label} field has invalid step syntax: ${part}`);
    }

    const rangePart = stepParts[0] ?? '';
    const step = stepParts[1] ? parseStep(stepParts[1], label) : 1;

    let start: number;
    let end: number;

    if (rangePart === '*') {
      start = min;
      end = max;
    } else if (rangePart.includes('-')) {
      const [startRaw, endRaw] = rangePart.split('-', 2);
      if (!startRaw || !endRaw) {
        throw new Error(`Cron ${label} field has invalid range: ${rangePart}`);
      }

      start = parseCronNumber(startRaw, min, max, label, allowSunday7);
      end = parseCronNumber(endRaw, min, max, label, allowSunday7);
    } else {
      start = parseCronNumber(rangePart, min, max, label, allowSunday7);
      end = start;
    }

    if (start > end) {
      throw new Error(`Cron ${label} field has descending range: ${rangePart}`);
    }

    for (let value = start; value <= end; value += step) {
      values.add(normalizeCronValue(value, allowSunday7));
    }
  }

  return {
    values,
    wildcard: trimmed === '*',
  };
}

export function parseCronExpression(rawExpression: string): ParsedCronExpression {
  const expression = rawExpression.trim();
  const fields = expression.split(/\s+/);

  if (fields.length !== 5) {
    throw new Error(`Cron expression must have 5 fields: ${rawExpression}`);
  }

  return {
    raw: expression,
    minute: parseCronField(fields[0] ?? '', 0, 59, 'minute'),
    hour: parseCronField(fields[1] ?? '', 0, 23, 'hour'),
    dayOfMonth: parseCronField(fields[2] ?? '', 1, 31, 'day-of-month'),
    month: parseCronField(fields[3] ?? '', 1, 12, 'month'),
    dayOfWeek: parseCronField(fields[4] ?? '', 0, 6, 'day-of-week', true),
  };
}

export function cronMatches(expression: ParsedCronExpression, at: Date): boolean {
  const minute = at.getMinutes();
  const hour = at.getHours();
  const dayOfMonth = at.getDate();
  const month = at.getMonth() + 1;
  const dayOfWeek = at.getDay();

  if (!expression.minute.values.has(minute)) {
    return false;
  }

  if (!expression.hour.values.has(hour)) {
    return false;
  }

  if (!expression.month.values.has(month)) {
    return false;
  }

  const domMatch = expression.dayOfMonth.values.has(dayOfMonth);
  const dowMatch = expression.dayOfWeek.values.has(dayOfWeek);

  const dayMatches = expression.dayOfMonth.wildcard && expression.dayOfWeek.wildcard
    ? true
    : expression.dayOfMonth.wildcard
      ? dowMatch
      : expression.dayOfWeek.wildcard
        ? domMatch
        : (domMatch || dowMatch);

  return dayMatches;
}

export function parseTaskDefinition(options: ParseTaskDefinitionOptions): ParsedTaskDefinition {
  const section = splitFrontmatter(options.rawContent);

  if (section.body.length === 0) {
    throw new Error('Task markdown body cannot be empty');
  }

  const fileName = basename(options.filePath);

  const id = readOptionalString(section.attributes, 'id') ?? toTaskIdFromFile(options.filePath);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9-_]*$/.test(id)) {
    throw new Error(`Invalid task id: ${id}`);
  }

  const enabled = readEnabled(section.attributes);
  const title = readOptionalString(section.attributes, 'title');

  const cron = readOptionalString(section.attributes, 'cron');
  const at = readOptionalString(section.attributes, 'at');

  if (cron && at) {
    throw new Error('Task frontmatter must define only one schedule key: cron or at');
  }

  if (!cron && !at) {
    throw new Error('Task frontmatter must define one schedule key: cron or at');
  }

  const schedule: ParsedTaskSchedule = cron
    ? {
      type: 'cron',
      expression: cron,
      parsed: parseCronExpression(cron),
    }
    : (() => {
      const atValue = at as string;
      const normalizedAt = normalizeIsoTimestamp(atValue);
      if (!normalizedAt) {
        throw new Error(`Invalid at timestamp: ${atValue}`);
      }

      return {
        type: 'at' as const,
        at: normalizedAt,
        atMs: Date.parse(normalizedAt),
      };
    })();

  const profile = readOptionalString(section.attributes, 'profile') ?? DEFAULT_PROFILE;

  const provider = readOptionalString(section.attributes, 'provider');
  const model = readOptionalString(section.attributes, 'model');

  let modelRef: string | undefined;
  if (provider && model) {
    modelRef = `${provider}/${model}`;
  } else if (provider && !model) {
    throw new Error('Frontmatter key model is required when provider is set');
  } else if (!provider && model) {
    modelRef = model;
  }

  const thinkingLevel = readOptionalString(section.attributes, 'thinking');
  const cwdRaw = readOptionalString(section.attributes, 'cwd');
  const cwd = cwdRaw ? resolve(expandHome(cwdRaw)) : undefined;

  return {
    key: resolve(options.filePath),
    filePath: resolve(options.filePath),
    fileName,
    id,
    title,
    enabled,
    schedule,
    prompt: section.body,
    profile,
    modelRef,
    thinkingLevel,
    cwd,
    timeoutSeconds: readTimeoutSeconds(section.attributes, options.defaultTimeoutSeconds),
  };
}

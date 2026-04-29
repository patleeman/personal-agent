import * as chrono from 'chrono-node';

export interface ParsedHumanDateTime {
  input: string;
  dueAt: string;
  date: Date;
  interpretation: string;
}

export interface HumanDateTimeParseOptions {
  now?: Date;
}

const RELATIVE_EXPRESSION_PATTERN = /^now\s*([+-])\s*(\d+)\s*([smhdw])(?:\s*@\s*(.+))?$/i;
const TIME_OF_DAY_PATTERN = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i;

function resolveValidNow(input?: Date): Date {
  return input instanceof Date && Number.isFinite(input.getTime()) ? input : new Date();
}

function normalizeInput(input: string): string {
  return input.trim().replace(/\s+/g, ' ');
}

function formatLocalDateTime(date: Date): string {
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });
}

function addRelativeTime(now: Date, sign: string, amount: number, unit: string): Date {
  const direction = sign === '-' ? -1 : 1;
  const date = new Date(now.getTime());
  switch (unit.toLowerCase()) {
    case 's':
      date.setSeconds(date.getSeconds() + direction * amount);
      break;
    case 'm':
      date.setMinutes(date.getMinutes() + direction * amount);
      break;
    case 'h':
      date.setHours(date.getHours() + direction * amount);
      break;
    case 'd':
      date.setDate(date.getDate() + direction * amount);
      break;
    case 'w':
      date.setDate(date.getDate() + direction * amount * 7);
      break;
    default:
      throw new Error(`Unsupported relative time unit: ${unit}`);
  }
  return date;
}

function applyTimeOfDay(date: Date, rawTime: string): Date | null {
  const match = normalizeInput(rawTime).match(TIME_OF_DAY_PATTERN);
  if (!match) {
    return null;
  }

  let hour = Number(match[1]);
  const minute = match[2] ? Number(match[2]) : 0;
  const meridiem = match[3]?.toLowerCase();
  if (!Number.isSafeInteger(hour) || !Number.isSafeInteger(minute) || minute < 0 || minute > 59) {
    return null;
  }

  if (meridiem) {
    if (hour < 1 || hour > 12) {
      return null;
    }
    if (meridiem === 'pm' && hour !== 12) {
      hour += 12;
    }
    if (meridiem === 'am' && hour === 12) {
      hour = 0;
    }
  } else if (hour < 0 || hour > 23) {
    return null;
  }

  const next = new Date(date.getTime());
  next.setHours(hour, minute, 0, 0);
  return next;
}

function parseRelativeExpression(input: string, now: Date): Date | null {
  const match = input.match(RELATIVE_EXPRESSION_PATTERN);
  if (!match) {
    return null;
  }

  const amount = Number(match[2]);
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    return null;
  }

  const relativeDate = addRelativeTime(now, match[1] ?? '+', amount, match[3] ?? '');
  const timeOfDay = match[4]?.trim();
  if (!timeOfDay) {
    return relativeDate;
  }

  return applyTimeOfDay(relativeDate, timeOfDay);
}

export function parseHumanDateTime(input: string, options: HumanDateTimeParseOptions = {}): ParsedHumanDateTime | null {
  const normalized = normalizeInput(input);
  if (!normalized) {
    return null;
  }

  const now = resolveValidNow(options.now);
  const relativeDate = parseRelativeExpression(normalized, now);
  const date = relativeDate ?? chrono.casual.parseDate(normalized, now, { forwardDate: true });
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) {
    return null;
  }

  return {
    input: normalized,
    date,
    dueAt: date.toISOString(),
    interpretation: formatLocalDateTime(date),
  };
}

export function parseFutureHumanDateTime(input: string, options: HumanDateTimeParseOptions = {}): ParsedHumanDateTime {
  const now = resolveValidNow(options.now);
  const parsed = parseHumanDateTime(input, { now });
  if (!parsed) {
    throw new Error('Invalid time expression. Use forms like now+1d, now+1d@20:00, tomorrow 8pm, or an ISO-8601 timestamp.');
  }

  if (parsed.date.getTime() <= now.getTime()) {
    throw new Error(`Time expression must resolve to the future: ${parsed.input} -> ${parsed.interpretation}.`);
  }

  return parsed;
}

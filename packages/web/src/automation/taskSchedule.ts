export const WEEKDAY_OPTIONS = [
  { value: 0, shortLabel: 'Sun', longLabel: 'Sunday' },
  { value: 1, shortLabel: 'Mon', longLabel: 'Monday' },
  { value: 2, shortLabel: 'Tue', longLabel: 'Tuesday' },
  { value: 3, shortLabel: 'Wed', longLabel: 'Wednesday' },
  { value: 4, shortLabel: 'Thu', longLabel: 'Thursday' },
  { value: 5, shortLabel: 'Fri', longLabel: 'Friday' },
  { value: 6, shortLabel: 'Sat', longLabel: 'Saturday' },
] as const;

export type EasyTaskCadence = 'hourly' | 'interval' | 'daily' | 'weekdays' | 'weekly' | 'monthly';

export interface EasyTaskSchedule {
  cadence: EasyTaskCadence;
  minute: number;
  hour: number;
  intervalHours: number;
  weekdays: number[];
  dayOfMonth: number;
}

export interface CronEditorState {
  mode: 'builder' | 'raw';
  builder: EasyTaskSchedule;
  rawCron: string;
  supported: boolean;
}

const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function clamp(value: number, min: number, max: number): number {
  if (!Number.isSafeInteger(value)) {
    return min;
  }

  return Math.min(max, Math.max(min, Math.floor(value)));
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function parseNumberField(value: string, min: number, max: number): number | null {
  if (!/^\d+$/.test(value)) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    return null;
  }

  return parsed;
}

function normalizeWeekday(value: number): number {
  return value === 7 ? 0 : value;
}

function sortUniqueWeekdays(values: number[]): number[] {
  return [...new Set(values.map(normalizeWeekday))].sort((left, right) => left - right);
}

function serializeWeekdays(values: number[]): string {
  const normalized = sortUniqueWeekdays(values).filter((value) => value >= 0 && value <= 6);
  if (normalized.length === 0) {
    return '1';
  }

  const isWeekdays = normalized.length === 5 && normalized.every((value, index) => value === index + 1);
  if (isWeekdays) {
    return '1-5';
  }

  return normalized.join(',');
}

function parseWeekdayField(field: string): number[] | null {
  const values: number[] = [];

  for (const segment of field.split(',')) {
    const trimmed = segment.trim();
    if (!trimmed) {
      return null;
    }

    const rangeMatch = trimmed.match(/^(\d+)-(\d+)$/);
    if (rangeMatch) {
      const start = parseNumberField(rangeMatch[1] ?? '', 0, 7);
      const end = parseNumberField(rangeMatch[2] ?? '', 0, 7);
      if (start === null || end === null || end < start) {
        return null;
      }

      for (let current = start; current <= end; current += 1) {
        values.push(normalizeWeekday(current));
      }
      continue;
    }

    const day = parseNumberField(trimmed, 0, 7);
    if (day === null) {
      return null;
    }

    values.push(normalizeWeekday(day));
  }

  return sortUniqueWeekdays(values);
}

function formatTime(hour: number, minute: number): string {
  return `${pad2(hour)}:${pad2(minute)}`;
}

function formatWeekdayList(values: number[]): string {
  const labels = sortUniqueWeekdays(values)
    .map((value) => WEEKDAY_OPTIONS.find((option) => option.value === value)?.shortLabel)
    .filter((value): value is NonNullable<(typeof WEEKDAY_OPTIONS)[number]['shortLabel']> => value !== undefined);

  if (labels.length === 0) {
    return 'Mon';
  }

  return labels.join(', ');
}

function createDefaultEasyTaskSchedule(): EasyTaskSchedule {
  return {
    cadence: 'daily',
    minute: 0,
    hour: 9,
    intervalHours: 4,
    weekdays: [1],
    dayOfMonth: 1,
  };
}

function parseCronToEasyTaskSchedule(cron: string): EasyTaskSchedule | null {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) {
    return null;
  }

  const [minuteField, hourField, dayOfMonthField, monthField, dayOfWeekField] = parts;
  const minute = parseNumberField(minuteField ?? '', 0, 59);
  if (minute === null) {
    return null;
  }

  if (dayOfMonthField === '*' && monthField === '*' && dayOfWeekField === '*') {
    if (hourField === '*') {
      return {
        cadence: 'hourly',
        minute,
        hour: 0,
        intervalHours: 1,
        weekdays: [1],
        dayOfMonth: 1,
      };
    }

    const intervalMatch = hourField?.match(/^\*\/(\d+)$/);
    if (intervalMatch) {
      const intervalHours = parseNumberField(intervalMatch[1] ?? '', 1, 23);
      if (intervalHours === null) {
        return null;
      }

      return {
        cadence: 'interval',
        minute,
        hour: 0,
        intervalHours,
        weekdays: [1],
        dayOfMonth: 1,
      };
    }

    const hour = parseNumberField(hourField ?? '', 0, 23);
    if (hour === null) {
      return null;
    }

    return {
      cadence: 'daily',
      minute,
      hour,
      intervalHours: 4,
      weekdays: [1],
      dayOfMonth: 1,
    };
  }

  if (dayOfMonthField === '*' && monthField === '*') {
    const hour = parseNumberField(hourField ?? '', 0, 23);
    if (hour === null) {
      return null;
    }

    if (dayOfWeekField === '1-5') {
      return {
        cadence: 'weekdays',
        minute,
        hour,
        intervalHours: 4,
        weekdays: [1, 2, 3, 4, 5],
        dayOfMonth: 1,
      };
    }

    const weekdays = parseWeekdayField(dayOfWeekField ?? '');
    if (!weekdays || weekdays.length === 0) {
      return null;
    }

    return {
      cadence: 'weekly',
      minute,
      hour,
      intervalHours: 4,
      weekdays,
      dayOfMonth: 1,
    };
  }

  if (monthField === '*' && dayOfWeekField === '*') {
    const hour = parseNumberField(hourField ?? '', 0, 23);
    const dayOfMonth = parseNumberField(dayOfMonthField ?? '', 1, 31);
    if (hour === null || dayOfMonth === null) {
      return null;
    }

    return {
      cadence: 'monthly',
      minute,
      hour,
      intervalHours: 4,
      weekdays: [1],
      dayOfMonth,
    };
  }

  return null;
}

export function createCronEditorState(cron?: string): CronEditorState {
  const rawCron = cron?.trim() ?? '';
  if (!rawCron) {
    return {
      mode: 'builder',
      builder: createDefaultEasyTaskSchedule(),
      rawCron: '',
      supported: true,
    };
  }

  const builder = parseCronToEasyTaskSchedule(rawCron);
  return {
    mode: builder ? 'builder' : 'raw',
    builder: builder ?? createDefaultEasyTaskSchedule(),
    rawCron,
    supported: Boolean(builder),
  };
}

export function buildCronFromEasyTaskSchedule(schedule: EasyTaskSchedule): string {
  const minute = clamp(schedule.minute, 0, 59);
  const hour = clamp(schedule.hour, 0, 23);
  const intervalHours = clamp(schedule.intervalHours, 1, 23);
  const dayOfMonth = clamp(schedule.dayOfMonth, 1, 31);

  switch (schedule.cadence) {
    case 'hourly':
      return `${minute} * * * *`;
    case 'interval':
      return `${minute} */${intervalHours} * * *`;
    case 'daily':
      return `${minute} ${hour} * * *`;
    case 'weekdays':
      return `${minute} ${hour} * * 1-5`;
    case 'weekly':
      return `${minute} ${hour} * * ${serializeWeekdays(schedule.weekdays)}`;
    case 'monthly':
      return `${minute} ${hour} ${dayOfMonth} * *`;
    default:
      return `${minute} ${hour} * * *`;
  }
}

function humanizeCronExpression(cron: string): string {
  const parsed = parseCronToEasyTaskSchedule(cron);
  if (!parsed) {
    return cron;
  }

  switch (parsed.cadence) {
    case 'hourly':
      return parsed.minute === 0 ? 'every hour on the hour' : `every hour at :${pad2(parsed.minute)}`;
    case 'interval':
      return parsed.minute === 0 ? `every ${parsed.intervalHours}h on the hour` : `every ${parsed.intervalHours}h at :${pad2(parsed.minute)}`;
    case 'daily':
      return `daily at ${formatTime(parsed.hour, parsed.minute)}`;
    case 'weekdays':
      return `weekdays at ${formatTime(parsed.hour, parsed.minute)}`;
    case 'weekly':
      return `${formatWeekdayList(parsed.weekdays)} at ${formatTime(parsed.hour, parsed.minute)}`;
    case 'monthly':
      return `day ${parsed.dayOfMonth} at ${formatTime(parsed.hour, parsed.minute)}`;
    default:
      return cron;
  }
}

function formatOneTimeTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

export function formatTaskSchedule(task: { cron?: string; at?: string }): string {
  if (task.at) {
    return `once on ${formatOneTimeTimestamp(task.at)}`;
  }

  if (task.cron) {
    return humanizeCronExpression(task.cron);
  }

  return 'unscheduled';
}

interface ParsedCronField {
  values: Set<number>;
  wildcard: boolean;
}

interface ParsedCronExpression {
  minute: ParsedCronField;
  hour: ParsedCronField;
  dayOfMonth: ParsedCronField;
  month: ParsedCronField;
  dayOfWeek: ParsedCronField;
}

function parseCronFieldForNextRun(raw: string, min: number, max: number, allowSunday7 = false): ParsedCronField | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }

  const values = new Set<number>();
  for (const token of trimmed.split(',')) {
    const part = token.trim();
    if (!part) {
      return null;
    }

    const stepParts = part.split('/');
    if (stepParts.length > 2) {
      return null;
    }

    const stepRaw = stepParts[1]?.trim();
    const step = stepRaw ? (/^\d+$/.test(stepRaw) ? Number.parseInt(stepRaw, 10) : Number.NaN) : 1;
    if (!Number.isSafeInteger(step) || step < 1) {
      return null;
    }

    const rangePart = stepParts[0] ?? '';
    let start: number;
    let end: number;

    if (rangePart === '*') {
      start = min;
      end = max;
    } else if (rangePart.includes('-')) {
      const [startRaw, endRaw] = rangePart.split('-', 2);
      start = /^\d+$/.test((startRaw ?? '').trim()) ? Number.parseInt((startRaw ?? '').trim(), 10) : Number.NaN;
      end = /^\d+$/.test((endRaw ?? '').trim()) ? Number.parseInt((endRaw ?? '').trim(), 10) : Number.NaN;
    } else {
      start = /^\d+$/.test(rangePart.trim()) ? Number.parseInt(rangePart.trim(), 10) : Number.NaN;
      end = start;
    }

    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < min || end > max || start > end) {
      if (!allowSunday7 || start !== 7 || end !== 7) {
        return null;
      }
    }

    for (let value = start; value <= end; value += step) {
      values.add(allowSunday7 && value === 7 ? 0 : value);
    }
  }

  return { values, wildcard: trimmed === '*' };
}

function parseCronForNextRun(cron: string): ParsedCronExpression | null {
  const fields = cron.trim().split(/\s+/);
  if (fields.length !== 5) {
    return null;
  }

  const minute = parseCronFieldForNextRun(fields[0] ?? '', 0, 59);
  const hour = parseCronFieldForNextRun(fields[1] ?? '', 0, 23);
  const dayOfMonth = parseCronFieldForNextRun(fields[2] ?? '', 1, 31);
  const month = parseCronFieldForNextRun(fields[3] ?? '', 1, 12);
  const dayOfWeek = parseCronFieldForNextRun(fields[4] ?? '', 0, 7, true);

  if (!minute || !hour || !dayOfMonth || !month || !dayOfWeek) {
    return null;
  }

  return { minute, hour, dayOfMonth, month, dayOfWeek };
}

function cronMatchesNextRun(expression: ParsedCronExpression, at: Date): boolean {
  if (!expression.minute.values.has(at.getMinutes())) return false;
  if (!expression.hour.values.has(at.getHours())) return false;
  if (!expression.month.values.has(at.getMonth() + 1)) return false;

  const domMatch = expression.dayOfMonth.values.has(at.getDate());
  const dowMatch = expression.dayOfWeek.values.has(at.getDay());
  if (expression.dayOfMonth.wildcard && expression.dayOfWeek.wildcard) return true;
  if (expression.dayOfMonth.wildcard) return dowMatch;
  if (expression.dayOfWeek.wildcard) return domMatch;
  return domMatch || dowMatch;
}

function nextMinuteAfter(nowMs: number): Date {
  const next = new Date(nowMs);
  next.setSeconds(0, 0);
  next.setMinutes(next.getMinutes() + 1);
  return next;
}

export function getNextTaskRunAt(task: { enabled?: boolean; cron?: string; at?: string }, nowMs = Date.now()): Date | null {
  if (task.enabled === false) {
    return null;
  }

  if (!Number.isSafeInteger(nowMs)) {
    return null;
  }

  if (task.at) {
    const normalizedAt = task.at.trim();
    const atMs = ISO_TIMESTAMP_PATTERN.test(normalizedAt) ? Date.parse(normalizedAt) : Number.NaN;
    return Number.isFinite(atMs) && atMs > nowMs ? new Date(atMs) : null;
  }

  if (!task.cron) {
    return null;
  }

  const parsed = parseCronForNextRun(task.cron);
  if (!parsed) {
    return null;
  }

  const cursor = nextMinuteAfter(nowMs);
  const limitMs = nowMs + 366 * 24 * 60 * 60 * 1000;
  while (cursor.getTime() <= limitMs) {
    if (cronMatchesNextRun(parsed, cursor)) {
      return new Date(cursor);
    }
    cursor.setMinutes(cursor.getMinutes() + 1);
  }

  return null;
}

export function formatTaskNextRunCountdown(nextRunAt: Date, nowMs = Date.now()): string {
  if (!Number.isSafeInteger(nextRunAt.getTime()) || !Number.isSafeInteger(nowMs)) {
    return 'now';
  }

  const totalSeconds = Math.max(0, Math.ceil((nextRunAt.getTime() - nowMs) / 1000));
  if (totalSeconds <= 0) {
    return 'now';
  }
  if (totalSeconds < 60) {
    return totalSeconds === 1 ? 'in 1s' : `in ${totalSeconds}s`;
  }

  const totalMinutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (totalMinutes < 60) {
    return seconds > 0 ? `in ${totalMinutes}m ${seconds}s` : `in ${totalMinutes}m`;
  }

  const totalHours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (totalHours < 24) {
    return minutes > 0 ? `in ${totalHours}h ${minutes}m` : `in ${totalHours}h`;
  }

  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  return hours > 0 ? `in ${days}d ${hours}h` : `in ${days}d`;
}

export function formatTimeInputValue(hour: number, minute: number): string {
  return formatTime(clamp(hour, 0, 23), clamp(minute, 0, 59));
}

export function parseTimeInputValue(value: string): { hour: number; minute: number } | null {
  const match = value.match(/^(\d{2}):(\d{2})$/);
  if (!match) {
    return null;
  }

  const hour = parseNumberField(match[1] ?? '', 0, 23);
  const minute = parseNumberField(match[2] ?? '', 0, 59);
  if (hour === null || minute === null) {
    return null;
  }

  return { hour, minute };
}

export function toDateTimeLocalValue(value?: string): string {
  if (!value) {
    return '';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}T${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

export function fromDateTimeLocalValue(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString();
}

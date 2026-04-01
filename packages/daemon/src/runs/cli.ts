/**
 * CLI commands for the unified run system.
 *
 * Provides: pa run <target> [--defer|--cron|--at] [options]
 */

export interface RunCLIInput {
  target: string;
  trigger?: {
    type: 'now' | 'defer' | 'cron' | 'at';
    value?: string; // delay for defer, expression for cron, timestamp for at
  };
  profile?: string;
  model?: string;
  cwd?: string;
}

export interface RunCLIResult {
  runId: string;
  triggerType: string;
  targetType: string;
  status: string;
}

/**
 * Parse delay string to milliseconds.
 */
export function parseDelay(delay: string): number | null {
  const match = delay.match(/^(\d+(?:\.\d+)?)([smhd])$/i);
  if (!match) return null;

  const value = parseFloat(match[1]);
  const unit = match[2].toLowerCase();

  const multipliers: Record<string, number> = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  };

  return Math.round(value * (multipliers[unit] ?? 0));
}

/**
 * Format milliseconds to human-readable string.
 */
export function formatDelay(ms: number): string {
  if (ms < 60 * 1000) return `${ms / 1000}s`;
  if (ms < 60 * 60 * 1000) return `${ms / (60 * 1000)}m`;
  if (ms < 24 * 60 * 60 * 1000) return `${ms / (60 * 60 * 1000)}h`;
  return `${ms / (24 * 60 * 60 * 1000)}d`;
}

/**
 * Validate cron expression (basic validation).
 */
export function isValidCron(expression: string): boolean {
  const parts = expression.trim().split(/\s+/);
  return parts.length === 5;
}

/**
 * Validate timestamp.
 */
export function isValidTimestamp(value: string): boolean {
  const date = new Date(value);
  return !isNaN(date.getTime());
}

/**
 * Build scheduleRun input from CLI arguments.
 */
export function buildScheduleInput(input: RunCLIInput): {
  trigger: { type: 'now' } | { type: 'defer'; delay: string } | { type: 'cron'; expression: string } | { type: 'at'; at: Date };
  target: { type: 'agent'; prompt: string; profile?: string; model?: string };
} {
  // Build trigger
  let trigger: { type: 'now' } | { type: 'defer'; delay: string } | { type: 'cron'; expression: string } | { type: 'at'; at: Date };

  if (!input.trigger || input.trigger.type === 'now') {
    trigger = { type: 'now' };
  } else if (input.trigger.type === 'defer') {
    const delay = input.trigger.value ?? '1h';
    trigger = { type: 'defer', delay };
  } else if (input.trigger.type === 'cron') {
    const expression = input.trigger.value ?? '';
    trigger = { type: 'cron', expression };
  } else if (input.trigger.type === 'at') {
    const at = new Date(input.trigger.value ?? '');
    trigger = { type: 'at', at };
  } else {
    trigger = { type: 'now' };
  }

  // Build target
  const target: { type: 'agent'; prompt: string; profile?: string; model?: string } = {
    type: 'agent',
    prompt: input.target,
  };

  if (input.profile) {
    target.profile = input.profile;
  }
  if (input.model) {
    target.model = input.model;
  }

  return { trigger, target };
}

/**
 * Parse CLI arguments for the run command.
 */
export function parseRunArgs(args: string[]): {
  input: RunCLIInput;
  errors: string[];
} {
  const errors: string[] = [];
  const input: RunCLIInput = {
    target: '',
  };

  let i = 0;
  while (i < args.length) {
    const arg = args[i];

    if (arg === '--defer') {
      const value = args[i + 1];
      if (!value || value.startsWith('-')) {
        errors.push('--defer requires a delay argument (e.g., 1h, 30m)');
        i++;
        continue;
      }
      const delayMs = parseDelay(value);
      if (delayMs === null) {
        errors.push(`Invalid delay format: ${value}. Use: 30s, 10m, 2h, 1d`);
        i += 2;
        continue;
      }
      input.trigger = { type: 'defer', value };
      i += 2;
      continue;
    }

    if (arg === '--cron') {
      const expression = args[i + 1];
      if (!expression || expression.startsWith('-')) {
        errors.push('--cron requires a cron expression');
        i++;
        continue;
      }
      if (!isValidCron(expression)) {
        errors.push(`Invalid cron expression: ${expression}`);
        i += 2;
        continue;
      }
      input.trigger = { type: 'cron', value: expression };
      i += 2;
      continue;
    }

    if (arg === '--at') {
      const timestamp = args[i + 1];
      if (!timestamp || timestamp.startsWith('-')) {
        errors.push('--at requires a timestamp');
        i++;
        continue;
      }
      if (!isValidTimestamp(timestamp)) {
        errors.push(`Invalid timestamp: ${timestamp}`);
        i += 2;
        continue;
      }
      input.trigger = { type: 'at', value: timestamp };
      i += 2;
      continue;
    }

    if (arg === '--profile' || arg === '-p') {
      const profile = args[i + 1];
      if (!profile || profile.startsWith('-')) {
        errors.push('--profile requires a profile name');
        i++;
        continue;
      }
      input.profile = profile;
      i += 2;
      continue;
    }

    if (arg === '--model' || arg === '-m') {
      const model = args[i + 1];
      if (!model || model.startsWith('-')) {
        errors.push('--model requires a model name');
        i++;
        continue;
      }
      input.model = model;
      i += 2;
      continue;
    }

    if (arg === '--cwd' || arg === '-C') {
      const cwd = args[i + 1];
      if (!cwd || cwd.startsWith('-')) {
        errors.push('--cwd requires a directory path');
        i++;
        continue;
      }
      input.cwd = cwd;
      i += 2;
      continue;
    }

    // Target is the first non-flag argument
    if (!arg.startsWith('-')) {
      input.target = arg;
      i++;
      // Remaining args could be additional prompt text
      while (i < args.length && !args[i].startsWith('-')) {
        input.target += ' ' + args[i];
        i++;
      }
      continue;
    }

    errors.push(`Unknown option: ${arg}`);
    i++;
  }

  // Validate target
  if (!input.target.trim()) {
    errors.push('Target prompt is required');
  }

  return { input, errors };
}

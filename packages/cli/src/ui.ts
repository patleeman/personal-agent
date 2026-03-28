import chalk from 'chalk';

type Tone = 'success' | 'error' | 'warning' | 'info' | 'muted' | 'accent';

interface UiConfig {
  plain: boolean;
}

const DEFAULT_CONFIG: UiConfig = {
  plain: false,
};

let uiConfig: UiConfig = { ...DEFAULT_CONFIG };

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const PLAIN_SPINNER_FRAMES = ['-', '\\', '|', '/'];

const SECTION_RULE_WIDTH = 44;
const KEY_ALIGN_WIDTH = 28;
const HELP_ALIGN_MIN_WIDTH = 18;
const HELP_ALIGN_MAX_WIDTH = 42;

function applyTone(text: string, tone: Tone): string {
  if (uiConfig.plain) {
    return text;
  }

  if (tone === 'success') {
    return chalk.green(text);
  }

  if (tone === 'error') {
    return chalk.red(text);
  }

  if (tone === 'warning') {
    return chalk.yellow(text);
  }

  if (tone === 'info') {
    return chalk.cyan(text);
  }

  if (tone === 'accent') {
    return chalk.blueBright(text);
  }

  return chalk.gray(text);
}

export function configureUi(options: { plain?: boolean } = {}): void {
  uiConfig = {
    plain: options.plain ?? DEFAULT_CONFIG.plain,
  };
}

export function isPlainOutput(): boolean {
  return uiConfig.plain;
}

export function isInteractiveOutput(): boolean {
  return process.stdin.isTTY && process.stdout.isTTY;
}

export function bold(text: string): string {
  if (uiConfig.plain) {
    return text;
  }

  return chalk.bold(text);
}

export function dim(text: string): string {
  return applyTone(text, 'muted');
}

export function accent(text: string): string {
  return applyTone(text, 'accent');
}

export function command(text: string): string {
  if (uiConfig.plain) {
    return text;
  }

  return chalk.cyan(text);
}

export function section(title: string): string {
  if (uiConfig.plain) {
    return `--- ${title} ---`;
  }

  const marker = chalk.blueBright('◆');
  const ruleLen = Math.max(2, SECTION_RULE_WIDTH - title.length - 2);
  const rule = chalk.gray('─'.repeat(ruleLen));

  return `${marker} ${chalk.bold(title)} ${rule}`;
}

export function divider(width = SECTION_RULE_WIDTH): string {
  if (uiConfig.plain) {
    return '-'.repeat(width);
  }

  return chalk.gray('─'.repeat(width));
}

export function success(label: string, value?: string | number | boolean): string {
  const icon = applyTone('✔', 'success');
  const title = bold(label);

  if (value === undefined) {
    return `${icon} ${title}`;
  }

  return `${icon} ${title}: ${value}`;
}

export function warning(message: string): string {
  const icon = applyTone('⚠', 'warning');
  return `${icon} ${message}`;
}

export function error(label: string, message?: string): string {
  const icon = applyTone('✕', 'error');
  const title = bold(label);

  if (!message) {
    return `${icon} ${title}`;
  }

  return `${icon} ${title}: ${message}`;
}

export function info(message: string): string {
  const icon = applyTone('▸', 'info');
  return `${icon} ${message}`;
}

export function pending(message: string): string {
  const icon = applyTone('◌', 'warning');
  return `${icon} ${message}`;
}

export function keyValue(key: string, value: string | number | boolean, indent = 2): string {
  const prefix = ' '.repeat(Math.max(0, indent));

  if (uiConfig.plain) {
    return `${prefix}${key}: ${value}`;
  }

  const renderedKey = bold(key);
  const dotsNeeded = Math.max(2, KEY_ALIGN_WIDTH - key.length);
  const leader = chalk.gray(' ' + '·'.repeat(dotsNeeded) + ' ');

  return `${prefix}${renderedKey}${leader}${value}`;
}

export function bullet(message: string, indent = 2): string {
  const prefix = ' '.repeat(Math.max(0, indent));

  if (uiConfig.plain) {
    return `${prefix}- ${message}`;
  }

  const marker = applyTone('▸', 'accent');
  return `${prefix}${marker} ${message}`;
}

export interface DenseHelpEntry {
  usage: string;
  description?: string;
}

function resolveDenseHelpWidth(entries: DenseHelpEntry[]): number {
  if (entries.length === 0) {
    return HELP_ALIGN_MIN_WIDTH;
  }

  const longest = entries.reduce((max, entry) => Math.max(max, entry.usage.length), 0);
  return Math.max(HELP_ALIGN_MIN_WIDTH, Math.min(HELP_ALIGN_MAX_WIDTH, longest + 2));
}

export function printDenseHeading(title: string): void {
  console.log(uiConfig.plain ? `${title}:` : `${bold(title)}:`);
}

export function printDenseUsage(usage: string): void {
  console.log(`Usage: ${command(usage)}`);
}

export function printDenseParagraph(text: string): void {
  console.log(text);
}

export function printDenseLines(title: string, lines: string[]): void {
  if (lines.length === 0) {
    return;
  }

  printDenseHeading(title);
  for (const line of lines) {
    console.log(`  ${line}`);
  }
}

export function printDenseCommandList(title: string, entries: DenseHelpEntry[]): void {
  if (entries.length === 0) {
    return;
  }

  printDenseHeading(title);
  const width = resolveDenseHelpWidth(entries);

  for (const entry of entries) {
    if (!entry.description || entry.description.trim().length === 0) {
      console.log(`  ${command(entry.usage)}`);
      continue;
    }

    if (entry.usage.length > width) {
      console.log(`  ${command(entry.usage)}`);
      console.log(`  ${' '.repeat(width + 2)}${entry.description}`);
      continue;
    }

    console.log(`  ${command(entry.usage.padEnd(width))}${entry.description}`);
  }
}

export function statusChip(status: 'running' | 'stopped' | 'active' | 'completed' | 'disabled' | 'pending' | 'error'): string {
  if (uiConfig.plain) {
    return `[${status}]`;
  }

  if (status === 'running' || status === 'active') {
    return `${chalk.green('●')} ${chalk.green(status)}`;
  }

  if (status === 'completed') {
    return `${chalk.green('✓')} ${chalk.green(status)}`;
  }

  if (status === 'pending') {
    return `${chalk.yellow('◌')} ${chalk.yellow(status)}`;
  }

  if (status === 'error' || status === 'stopped') {
    return `${chalk.red('●')} ${chalk.red(status)}`;
  }

  return `${chalk.gray('○')} ${chalk.gray(status)}`;
}

export function progressBar(completed: number, total: number, width = 20): string {
  const safeTotal = Math.max(0, total);
  const safeCompleted = Math.max(0, Math.min(completed, safeTotal));

  if (safeTotal === 0) {
    if (uiConfig.plain) {
      return `[${'─'.repeat(width)}] 0%`;
    }

    return `${chalk.gray('━'.repeat(width))} 0%`;
  }

  const percent = Math.round((safeCompleted / safeTotal) * 100);
  const filledCount = Math.round((percent / 100) * width);
  const emptyCount = width - filledCount;

  if (uiConfig.plain) {
    return `[${'#'.repeat(filledCount)}${'-'.repeat(emptyCount)}] ${percent}%`;
  }

  const fill = '━'.repeat(filledCount);
  const empty = '━'.repeat(emptyCount);

  const coloredFill = percent > 66
    ? chalk.green(fill)
    : percent > 33
      ? chalk.yellow(fill)
      : chalk.red(fill);

  return `${coloredFill}${chalk.gray(empty)} ${percent}%`;
}

function clearCurrentLine(): void {
  if (!process.stdout.isTTY) {
    return;
  }

  process.stdout.write('\r\x1b[2K');
}

export interface Spinner {
  start(): void;
  update(message: string): void;
  succeed(message?: string): void;
  fail(message?: string): void;
  stop(): void;
}

class TerminalSpinner implements Spinner {
  private timer?: ReturnType<typeof setInterval>;

  private frame = 0;

  private active = false;

  constructor(private text: string) {}

  private get animated(): boolean {
    return !uiConfig.plain && isInteractiveOutput();
  }

  private render(): void {
    const frames = uiConfig.plain ? PLAIN_SPINNER_FRAMES : SPINNER_FRAMES;
    const frame = frames[this.frame % frames.length];
    this.frame += 1;

    const prefix = applyTone(frame, 'info');
    process.stdout.write(`\r${prefix} ${this.text}`);
  }

  start(): void {
    if (this.active) {
      return;
    }

    this.active = true;

    if (!this.animated) {
      console.log(info(this.text));
      return;
    }

    this.render();
    this.timer = setInterval(() => {
      this.render();
    }, 80);
  }

  update(message: string): void {
    this.text = message;

    if (!this.active) {
      return;
    }

    if (!this.animated) {
      return;
    }

    this.render();
  }

  private finish(symbol: string, tone: Tone, message?: string): void {
    const text = message ?? this.text;

    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }

    if (this.animated) {
      clearCurrentLine();
      process.stdout.write(`${applyTone(symbol, tone)} ${text}\n`);
    } else {
      if (tone === 'success') {
        console.log(success(text));
      } else if (tone === 'error') {
        console.log(error('Operation failed', text));
      } else {
        console.log(info(text));
      }
    }

    this.active = false;
  }

  succeed(message?: string): void {
    this.finish('✔', 'success', message);
  }

  fail(message?: string): void {
    this.finish('✕', 'error', message);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }

    if (this.animated) {
      clearCurrentLine();
    }

    this.active = false;
  }
}

export function spinner(message: string): Spinner {
  return new TerminalSpinner(message);
}

export function formatHint(text: string): string {
  return `${dim('hint:')} ${command(text)}`;
}

export function formatNextStep(text: string): string {
  return `${accent('→')} ${command(text)}`;
}

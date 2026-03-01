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

export function success(label: string, value?: string | number | boolean): string {
  const icon = applyTone('✓', 'success');
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
  const icon = applyTone('✗', 'error');
  const title = bold(label);

  if (!message) {
    return `${icon} ${title}`;
  }

  return `${icon} ${title}: ${message}`;
}

export function info(message: string): string {
  const icon = applyTone('•', 'info');
  return `${icon} ${message}`;
}

export function pending(message: string): string {
  const icon = applyTone('⏳', 'warning');
  return `${icon} ${message}`;
}

export function section(title: string): string {
  return bold(title);
}

export function keyValue(key: string, value: string | number | boolean, indent = 2): string {
  const prefix = ' '.repeat(Math.max(0, indent));
  const renderedKey = bold(key);
  return `${prefix}${renderedKey}: ${value}`;
}

export function bullet(message: string, indent = 2): string {
  const prefix = ' '.repeat(Math.max(0, indent));
  const dot = applyTone('•', 'info');
  return `${prefix}${dot} ${message}`;
}

export function statusChip(status: 'running' | 'stopped' | 'active' | 'disabled' | 'pending' | 'error'): string {
  if (status === 'running' || status === 'active') {
    return applyTone(status, 'success');
  }

  if (status === 'pending') {
    return applyTone(status, 'warning');
  }

  if (status === 'error' || status === 'stopped') {
    return applyTone(status, 'error');
  }

  return dim(status);
}

export function progressBar(completed: number, total: number, width = 22): string {
  const safeTotal = Math.max(0, total);
  const safeCompleted = Math.max(0, Math.min(completed, safeTotal));

  if (safeTotal === 0) {
    const empty = uiConfig.plain
      ? '-'.repeat(width)
      : '░'.repeat(width);
    return `[${empty}] 0%`;
  }

  const percent = Math.round((safeCompleted / safeTotal) * 100);
  const filledCount = Math.round((percent / 100) * width);
  const fill = uiConfig.plain
    ? '#'.repeat(filledCount)
    : '█'.repeat(filledCount);
  const empty = uiConfig.plain
    ? '-'.repeat(width - filledCount)
    : '░'.repeat(width - filledCount);

  return `[${fill}${empty}] ${percent}%`;
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
    this.finish('✓', 'success', message);
  }

  fail(message?: string): void {
    this.finish('✗', 'error', message);
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
  return `${dim('Hint:')} ${command(text)}`;
}

export function formatNextStep(text: string): string {
  return `${accent('Next:')} ${command(text)}`;
}

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  bold,
  bullet,
  command,
  configureUi,
  dim,
  divider,
  error,
  formatHint,
  formatNextStep,
  info,
  isInteractiveOutput,
  isPlainOutput,
  keyValue,
  pending,
  progressBar,
  section,
  spinner,
  statusChip,
  success,
  warning,
} from './ui.js';

const stdinTtyDescriptor = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
const stdoutTtyDescriptor = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');

afterEach(() => {
  configureUi({ plain: false });
  vi.useRealTimers();
  vi.restoreAllMocks();

  if (stdinTtyDescriptor) {
    Object.defineProperty(process.stdin, 'isTTY', stdinTtyDescriptor);
  }

  if (stdoutTtyDescriptor) {
    Object.defineProperty(process.stdout, 'isTTY', stdoutTtyDescriptor);
  }
});

describe('cli ui helpers', () => {
  it('renders deterministic plain output helpers', () => {
    configureUi({ plain: true });

    expect(isPlainOutput()).toBe(true);
    expect(bold('hello')).toBe('hello');
    expect(command('pa doctor')).toBe('pa doctor');
    expect(section('Doctor checks')).toBe('--- Doctor checks ---');
    expect(divider(6)).toBe('------');
    expect(success('Ready')).toBe('✔ Ready');
    expect(success('Ready', 'ok')).toBe('✔ Ready: ok');
    expect(warning('Heads up')).toBe('⚠ Heads up');
    expect(error('Failure')).toBe('✕ Failure');
    expect(error('Failure', 'details')).toBe('✕ Failure: details');
    expect(info('Step')).toBe('▸ Step');
    expect(pending('Waiting')).toBe('◌ Waiting');
    expect(keyValue('Socket', '/tmp/socket')).toBe('  Socket: /tmp/socket');
    expect(bullet('next')).toBe('  - next');
    expect(statusChip('running')).toBe('[running]');
    expect(progressBar(3, 6, 10)).toBe('[#####-----] 50%');
    expect(progressBar(0, 0, 4)).toBe('[────] 0%');
    expect(formatHint('pa daemon start')).toBe('hint: pa daemon start');
    expect(formatNextStep('pa doctor')).toBe('→ pa doctor');
  });

  it('supports rich output helpers when plain mode is disabled', () => {
    configureUi({ plain: false });

    const rendered = [
      bold('hello'),
      dim('muted'),
      section('Checks'),
      divider(4),
      keyValue('Key', 'Value'),
      bullet('Item'),
      statusChip('completed'),
      progressBar(9, 10, 10),
    ].join('\n');

    expect(rendered).toContain('hello');
    expect(rendered).toContain('Checks');
    expect(rendered).toContain('Key');
    expect(rendered).toContain('completed');
    expect(rendered).toContain('90%');
  });

  it('reports interactivity from tty state', () => {
    Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: true });
    Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: true });
    expect(isInteractiveOutput()).toBe(true);

    Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: false });
    expect(isInteractiveOutput()).toBe(false);
  });

  it('runs spinner in non-interactive mode with info/success/error logs', () => {
    configureUi({ plain: true });

    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((line?: unknown) => {
      logs.push(String(line ?? ''));
    });

    const s = spinner('Syncing');
    s.start();
    s.update('Still syncing');
    s.succeed('Done');

    const failing = spinner('Upload');
    failing.start();
    failing.fail('Network down');

    expect(logs.some((line) => line.includes('▸ Syncing'))).toBe(true);
    expect(logs.some((line) => line.includes('✔ Done'))).toBe(true);
    expect(logs.some((line) => line.includes('✕ Operation failed: Network down'))).toBe(true);
  });

  it('renders and stops spinner in interactive mode', () => {
    vi.useFakeTimers();
    configureUi({ plain: false });

    Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: true });
    Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: true });

    const writes: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      writes.push(String(chunk));
      return true;
    });

    const s = spinner('Booting');
    s.start();

    vi.advanceTimersByTime(100);
    s.update('Booting modules');
    s.succeed('Boot complete');

    const stopped = spinner('Stopping');
    stopped.start();
    stopped.stop();

    expect(writes.some((line) => line.includes('Booting'))).toBe(true);
    expect(writes.some((line) => line.includes('Boot complete'))).toBe(true);
    expect(writes.some((line) => line.includes('\u001b[2K'))).toBe(true);
  });
});

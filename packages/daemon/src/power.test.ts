import { EventEmitter } from 'events';
import { describe, expect, it, vi } from 'vitest';
import { DaemonPowerController } from './power.js';

class FakeChild extends EventEmitter {
  killed = false;
  unref = vi.fn();
  kill = vi.fn(() => {
    this.killed = true;
    return true;
  });
}

describe('DaemonPowerController', () => {
  it('starts and stops caffeinate on macOS when keepAwake changes', () => {
    const child = new FakeChild();
    const spawnCaffeinate = vi.fn(() => child as never);
    const controller = new DaemonPowerController({ platform: 'darwin', spawnCaffeinate });

    expect(controller.setKeepAwake(true)).toEqual({ keepAwake: true, supported: true, active: true });
    expect(spawnCaffeinate).toHaveBeenCalledTimes(1);
    expect(child.unref).toHaveBeenCalledTimes(1);

    expect(controller.setKeepAwake(true)).toEqual({ keepAwake: true, supported: true, active: true });
    expect(spawnCaffeinate).toHaveBeenCalledTimes(1);

    expect(controller.setKeepAwake(false)).toEqual({ keepAwake: false, supported: true, active: false });
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('reports unsupported platforms without spawning caffeinate', () => {
    const spawnCaffeinate = vi.fn();
    const controller = new DaemonPowerController({ platform: 'linux', spawnCaffeinate });

    expect(controller.setKeepAwake(true)).toEqual({
      keepAwake: true,
      supported: false,
      active: false,
      error: 'Keeping the daemon awake is only supported on macOS.',
    });
    expect(spawnCaffeinate).not.toHaveBeenCalled();
  });

  it('marks caffeine inactive when the child exits unexpectedly', () => {
    const child = new FakeChild();
    const warn = vi.fn();
    const controller = new DaemonPowerController({
      platform: 'darwin',
      spawnCaffeinate: () => child as never,
      logger: { warn },
    });

    controller.setKeepAwake(true);
    child.emit('exit', 1, null);

    expect(controller.getStatus()).toEqual({
      keepAwake: true,
      supported: true,
      active: false,
      error: 'caffeinate exited unexpectedly (code 1)',
    });
    expect(warn).toHaveBeenCalledWith('caffeinate exited unexpectedly (code 1)');
  });
});

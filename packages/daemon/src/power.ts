import { spawn, type ChildProcess } from 'child_process';

export interface DaemonPowerStatus {
  keepAwake: boolean;
  supported: boolean;
  active: boolean;
  error?: string;
}

export interface DaemonPowerControllerOptions {
  platform?: NodeJS.Platform;
  spawnCaffeinate?: () => ChildProcess;
  logger?: {
    warn(message: string): void;
    info?(message: string): void;
  };
}

export class DaemonPowerController {
  private readonly platform: NodeJS.Platform;
  private readonly spawnCaffeinate: () => ChildProcess;
  private readonly logger?: DaemonPowerControllerOptions['logger'];
  private keepAwake = false;
  private child: ChildProcess | null = null;
  private error: string | undefined;

  constructor(options: DaemonPowerControllerOptions = {}) {
    this.platform = options.platform ?? process.platform;
    this.spawnCaffeinate = options.spawnCaffeinate ?? (() => spawn('/usr/bin/caffeinate', ['-i'], { stdio: 'ignore' }));
    this.logger = options.logger;
  }

  getStatus(): DaemonPowerStatus {
    return {
      keepAwake: this.keepAwake,
      supported: this.isSupported(),
      active: this.child !== null,
      ...(this.error ? { error: this.error } : {}),
    };
  }

  setKeepAwake(enabled: boolean): DaemonPowerStatus {
    this.keepAwake = enabled;
    this.error = undefined;

    if (!enabled) {
      this.stopCaffeinate();
      return this.getStatus();
    }

    if (!this.isSupported()) {
      this.error = 'Keeping the daemon awake is only supported on macOS.';
      return this.getStatus();
    }

    if (!this.child) {
      this.startCaffeinate();
    }

    return this.getStatus();
  }

  stop(): void {
    this.keepAwake = false;
    this.error = undefined;
    this.stopCaffeinate();
  }

  private isSupported(): boolean {
    return this.platform === 'darwin';
  }

  private startCaffeinate(): void {
    try {
      const child = this.spawnCaffeinate();
      this.child = child;

      child.once('error', (error) => {
        if (this.child === child) {
          this.child = null;
          this.error = error.message;
        }
        this.logger?.warn(`caffeinate failed: ${error.message}`);
      });

      child.once('exit', (code, signal) => {
        if (this.child !== child) {
          return;
        }

        this.child = null;
        if (this.keepAwake) {
          const detail = signal ? `signal ${signal}` : `code ${String(code)}`;
          this.error = `caffeinate exited unexpectedly (${detail})`;
          this.logger?.warn(this.error);
        }
      });

      child.unref?.();
    } catch (error) {
      this.child = null;
      this.error = error instanceof Error ? error.message : String(error);
      this.logger?.warn(`caffeinate failed: ${this.error}`);
    }
  }

  private stopCaffeinate(): void {
    const child = this.child;
    this.child = null;
    if (!child || child.killed) {
      return;
    }

    child.kill('SIGTERM');
  }
}

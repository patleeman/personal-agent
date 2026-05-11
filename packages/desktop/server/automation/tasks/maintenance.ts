import { readdirSync, rmSync, statSync } from 'fs';
import { join } from 'path';

import type { MaintenanceModuleConfig } from '../../config.js';
import type { DaemonModule } from '../daemon/types.js';

interface MaintenanceModuleState {
  cleanedFiles: number;
  lastRunAt?: string;
  lastError?: string;
}

const LOG_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export function createMaintenanceModule(config: MaintenanceModuleConfig): DaemonModule {
  const state: MaintenanceModuleState = {
    cleanedFiles: 0,
  };

  return {
    name: 'maintenance',
    enabled: config.enabled,
    subscriptions: ['timer.maintenance.cleanup'],
    timers: [
      {
        name: 'maintenance-cleanup',
        eventType: 'timer.maintenance.cleanup',
        intervalMs: Math.max(60_000, config.cleanupIntervalMinutes * 60_000),
      },
    ],

    async start(): Promise<void> {
      // No startup work required in scaffold.
    },

    async handleEvent(event, context): Promise<void> {
      if (event.type !== 'timer.maintenance.cleanup') {
        return;
      }

      const now = Date.now();
      let cleaned = 0;

      try {
        const entries = readdirSync(context.paths.logDir, { withFileTypes: true });

        for (const entry of entries) {
          if (!entry.isFile() || !entry.name.endsWith('.log')) {
            continue;
          }

          const filePath = join(context.paths.logDir, entry.name);
          const stats = statSync(filePath);

          if (now - stats.mtimeMs > LOG_RETENTION_MS) {
            rmSync(filePath, { force: true });
            cleaned += 1;
          }
        }

        state.cleanedFiles += cleaned;
        state.lastRunAt = new Date().toISOString();
        state.lastError = undefined;

        context.publish('maintenance.cleanup.completed', {
          cleaned,
          at: state.lastRunAt,
        });
      } catch (error) {
        state.lastError = (error as Error).message;
        context.logger.warn(`maintenance cleanup failed: ${state.lastError}`);
      }
    },

    getStatus(): Record<string, unknown> {
      return {
        cleanedFiles: state.cleanedFiles,
        lastRunAt: state.lastRunAt,
        lastError: state.lastError,
      };
    },
  };
}

import type { DaemonConfig } from '../config.js';
import type { DaemonModule } from './types.js';
import { createDeferredFollowUpsModule } from './deferred-followups.js';
import { createMaintenanceModule } from './maintenance.js';
import { createTasksModule } from './tasks.js';

export function createBuiltinModules(config: DaemonConfig): DaemonModule[] {
  return [
    createMaintenanceModule(config.modules.maintenance),
    createTasksModule(config.modules.tasks),
    createDeferredFollowUpsModule(config.modules.deferredFollowUps),
  ];
}

export type { DaemonModule, DaemonModuleContext, ModuleLogger } from './types.js';

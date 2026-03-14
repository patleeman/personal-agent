import { getDefaultSyncModuleConfig, type DaemonConfig } from '../config.js';
import type { DaemonModule } from './types.js';
import { createDeferredResumeModule } from './deferred-resume.js';
import { createMaintenanceModule } from './maintenance.js';
import { createSyncModule } from './sync.js';
import { createTasksModule } from './tasks.js';

export function createBuiltinModules(config: DaemonConfig): DaemonModule[] {
  return [
    createMaintenanceModule(config.modules.maintenance),
    createTasksModule(config.modules.tasks),
    createDeferredResumeModule(),
    createSyncModule(config.modules.sync ?? getDefaultSyncModuleConfig()),
  ];
}

export type { DaemonModule, DaemonModuleContext, ModuleLogger } from './types.js';

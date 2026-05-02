import type { DaemonConfig } from '../config.js';
import { createDeferredResumeModule } from './deferred-resume.js';
import { createMaintenanceModule } from './maintenance.js';
import { createTasksModule } from './tasks.js';
import type { DaemonModule } from './types.js';

export function createBuiltinModules(config: DaemonConfig): DaemonModule[] {
  return [createMaintenanceModule(config.modules.maintenance), createTasksModule(config.modules.tasks), createDeferredResumeModule()];
}

export type { DaemonModule, DaemonModuleContext, ModuleLogger } from './types.js';

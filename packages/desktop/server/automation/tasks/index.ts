import type { DaemonConfig } from '../../config.js';
import { createDeferredResumeModule } from './deferred-resume.js';
import { createMaintenanceModule } from './maintenance.js';
import { createTasksModule } from './tasks.js';
import type { DaemonModule } from '../daemon/types.js';

export function createBuiltinModules(config: DaemonConfig): DaemonModule[] {
  return [createMaintenanceModule(config.modules.maintenance), createTasksModule(config.modules.tasks), createDeferredResumeModule()];
}

export type { DaemonModule, DaemonModuleContext } from '../daemon/types.js';

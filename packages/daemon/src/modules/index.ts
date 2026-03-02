import type { DaemonConfig } from '../config.js';
import type { DaemonModule } from './types.js';
import { createMaintenanceModule } from './maintenance.js';
import { createMemoryModule } from './memory.js';
import { createTasksModule } from './tasks.js';

export function createBuiltinModules(config: DaemonConfig): DaemonModule[] {
  return [
    createMemoryModule(config.modules.memory),
    createMaintenanceModule(config.modules.maintenance),
    createTasksModule(config.modules.tasks),
  ];
}

export type { DaemonModule, DaemonModuleContext, ModuleLogger } from './types.js';

import type { DaemonConfig } from '../config.js';
import type { DaemonModule } from './types.js';
import { createMaintenanceModule } from './maintenance.js';
import { createMemoryModule } from './memory.js';

export function createBuiltinModules(config: DaemonConfig): DaemonModule[] {
  return [
    createMemoryModule(config.modules.memory),
    createMaintenanceModule(config.modules.maintenance),
  ];
}

export type { DaemonModule, DaemonModuleContext, ModuleLogger } from './types.js';

import { createDeferredResumeModule } from './deferred-resume.js';
import { createMaintenanceModule } from './maintenance.js';
import { createTasksModule } from './tasks.js';
export function createBuiltinModules(config) {
    return [createMaintenanceModule(config.modules.maintenance), createTasksModule(config.modules.tasks), createDeferredResumeModule()];
}

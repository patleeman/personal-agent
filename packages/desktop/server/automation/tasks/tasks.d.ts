import type { TasksModuleConfig } from '../config.js';
import { type TaskRunRequest, type TaskRunResult } from './tasks-runner.js';
import type { DaemonModule } from './types.js';
export interface TasksModuleDependencies {
  now?: () => Date;
  runTask?: (request: TaskRunRequest) => Promise<TaskRunResult>;
}
export declare function createTasksModule(config: TasksModuleConfig, dependencies?: TasksModuleDependencies): DaemonModule;

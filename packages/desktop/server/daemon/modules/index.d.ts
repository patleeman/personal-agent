import type { DaemonConfig } from '../config.js';
import type { DaemonModule } from './types.js';
export declare function createBuiltinModules(config: DaemonConfig): DaemonModule[];
export type { DaemonModule, DaemonModuleContext } from './types.js';

import type { DaemonModule } from './types.js';
export interface DeferredResumeModuleDependencies {
  now?: () => Date;
}
export declare function createDeferredResumeModule(dependencies?: DeferredResumeModuleDependencies): DaemonModule;

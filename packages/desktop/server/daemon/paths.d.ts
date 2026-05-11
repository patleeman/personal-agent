import type { DaemonPaths } from './types.js';
export declare function resolveDaemonPaths(explicitSocketPath?: string): DaemonPaths;
export declare function ensureDaemonDirectories(paths: DaemonPaths): void;

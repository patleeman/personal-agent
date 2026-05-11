import type { DaemonConfig } from '../config.js';
import type { CompanionRuntime, CompanionRuntimeProvider } from './types.js';
export declare function setCompanionRuntimeProvider(provider: CompanionRuntimeProvider | undefined): void;
export declare function getCompanionRuntimeProvider(): CompanionRuntimeProvider | undefined;
export declare function resolveCompanionRuntime(config: DaemonConfig): Promise<CompanionRuntime | null>;

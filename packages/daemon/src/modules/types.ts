import type { DaemonConfig } from '../config.js';
import type { DaemonEvent, DaemonPaths, EventPayload, TimerDefinition } from '../types.js';

export interface ModuleLogger {
  debug: (message: string) => void;
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
}

export interface DaemonModuleContext {
  config: DaemonConfig;
  paths: DaemonPaths;
  publish: (type: string, payload?: EventPayload) => boolean;
  logger: ModuleLogger;
}

export interface DaemonModule {
  name: string;
  enabled: boolean;
  subscriptions: string[];
  timers: TimerDefinition[];
  start: (context: DaemonModuleContext) => Promise<void>;
  handleEvent: (event: DaemonEvent, context: DaemonModuleContext) => Promise<void>;
  stop?: (context: DaemonModuleContext) => Promise<void>;
  getStatus?: () => Record<string, unknown>;
}

import type { DaemonEvent, DaemonEventInput } from './types.js';
export declare const DAEMON_EVENT_VERSION = 1;
export declare function createDaemonEvent(input: DaemonEventInput): DaemonEvent;
export declare function isDaemonEvent(value: unknown): value is DaemonEvent;

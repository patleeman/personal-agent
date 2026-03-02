#!/usr/bin/env node

import { fileURLToPath } from 'url';
import { resolve } from 'path';
import { runDaemonProcess } from './server.js';

export { createDaemonEvent, isDaemonEvent, DAEMON_EVENT_VERSION } from './events.js';
export { loadDaemonConfig, getDefaultDaemonConfig, getDaemonConfigFilePath, type DaemonConfig } from './config.js';
export { resolveDaemonPaths } from './paths.js';
export { getDaemonStatus, pingDaemon, stopDaemon, emitDaemonEvent, emitDaemonEventNonFatal } from './client.js';
export { startDaemonDetached, stopDaemonGracefully, daemonStatusJson, readDaemonPid } from './manage.js';
export { parseTaskDefinition } from './modules/tasks-parser.js';
export type { ParsedTaskDefinition } from './modules/tasks-parser.js';
export type { DaemonEvent, DaemonEventInput, DaemonStatus, DaemonModuleStatus } from './types.js';

export async function runDaemonCli(argv: string[] = process.argv.slice(2)): Promise<number> {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log('personal-agentd\n\nRuns the personal-agent daemon in the foreground.');
    return 0;
  }

  await runDaemonProcess();
  return 0;
}

const entryFile = process.argv[1] ? resolve(process.argv[1]) : undefined;
const moduleFile = resolve(fileURLToPath(import.meta.url));

if (entryFile === moduleFile) {
  runDaemonCli().catch((error) => {
    console.error((error as Error).message);
    process.exit(1);
  });
}

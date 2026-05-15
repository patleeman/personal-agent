#!/usr/bin/env node

import { resolve } from 'node:path';
import { spawn } from 'node:child_process';

const tsxPath = resolve(process.cwd(), 'node_modules/.bin/tsx');
const cliSourcePath = resolve(process.cwd(), 'packages/desktop/server/protocolCli.ts');

const child = spawn(tsxPath, [cliSourcePath, ...process.argv.slice(2)], {
  stdio: 'inherit',
  cwd: process.cwd(),
  env: process.env,
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});

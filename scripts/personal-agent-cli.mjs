#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const cliDistPath = resolve(process.cwd(), 'packages/desktop/dist/server/protocolCli.js');
const cliSourcePath = resolve(process.cwd(), 'packages/desktop/server/protocolCli.ts');
const tsxPath = resolve(process.cwd(), 'node_modules/.bin/tsx');

function canUseBuiltCli() {
  if (!existsSync(cliDistPath)) return false;
  try {
    require.resolve('@personal-agent/core');
    require.resolve('@personal-agent/extensions');
    require.resolve('@personal-agent/desktop');
    require.resolve('@personal-agent/daemon');
    return true;
  } catch {
    return false;
  }
}

const command = canUseBuiltCli() ? process.execPath : tsxPath;
const args = canUseBuiltCli() ? [cliDistPath, ...process.argv.slice(2)] : [cliSourcePath, ...process.argv.slice(2)];

const child = spawn(command, args, {
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

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';

const SSH_TIMEOUT_SECONDS = '10';

function baseSshOptions(): string[] {
  return [
    '-o', 'BatchMode=yes',
    '-o', `ConnectTimeout=${SSH_TIMEOUT_SECONDS}`,
    '-o', 'ServerAliveInterval=30',
  ];
}

export function runSshCommand(target: string, command: string): string {
  const result = spawnSync('ssh', [...baseSshOptions(), target, command], {
    env: process.env,
    encoding: 'utf-8',
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    const rendered = `${result.stderr ?? ''}${result.stdout ?? ''}`.trim();
    throw new Error(rendered || `ssh ${target} failed with exit code ${String(result.status)}`);
  }

  return result.stdout;
}

export function spawnSshTunnel(input: { target: string; localPort: number; remotePort: number }): ChildProcess {
  return spawn('ssh', [
    '-N',
    '-o', 'BatchMode=yes',
    '-o', 'ExitOnForwardFailure=yes',
    '-o', `ConnectTimeout=${SSH_TIMEOUT_SECONDS}`,
    '-o', 'ServerAliveInterval=30',
    '-L', `${String(input.localPort)}:127.0.0.1:${String(input.remotePort)}`,
    input.target,
  ], {
    env: process.env,
    stdio: ['ignore', 'ignore', 'ignore'],
  });
}

export function uploadFileOverScp(input: { target: string; localPath: string; remotePath: string }): void {
  const result = spawnSync('scp', [
    '-q',
    '-o', 'BatchMode=yes',
    '-o', `ConnectTimeout=${SSH_TIMEOUT_SECONDS}`,
    input.localPath,
    `${input.target}:${input.remotePath}`,
  ], {
    env: process.env,
    encoding: 'utf-8',
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    const rendered = `${result.stderr ?? ''}${result.stdout ?? ''}`.trim();
    throw new Error(rendered || `scp upload to ${input.target}:${input.remotePath} failed with exit code ${String(result.status)}`);
  }
}

export function downloadFileOverScp(input: { target: string; remotePath: string; localPath: string }): void {
  const result = spawnSync('scp', [
    '-q',
    '-o', 'BatchMode=yes',
    '-o', `ConnectTimeout=${SSH_TIMEOUT_SECONDS}`,
    `${input.target}:${input.remotePath}`,
    input.localPath,
  ], {
    env: process.env,
    encoding: 'utf-8',
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    const rendered = `${result.stderr ?? ''}${result.stdout ?? ''}`.trim();
    throw new Error(rendered || `scp download from ${input.target}:${input.remotePath} failed with exit code ${String(result.status)}`);
  }
}

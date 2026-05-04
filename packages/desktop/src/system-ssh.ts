import { type ChildProcess, spawn } from 'node:child_process';

const SSH_TIMEOUT_SECONDS = '10';

function baseSshOptions(): string[] {
  return ['-o', 'BatchMode=yes', '-o', `ConnectTimeout=${SSH_TIMEOUT_SECONDS}`, '-o', 'ServerAliveInterval=30'];
}

function runProcess(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];

    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      const renderedStdout = Buffer.concat(stdout).toString('utf-8');
      const renderedStderr = Buffer.concat(stderr).toString('utf-8');
      if (code === 0) {
        resolve(renderedStdout);
        return;
      }

      const rendered = `${renderedStderr}${renderedStdout}`.trim();
      reject(new Error(rendered || `${command} ${args.join(' ')} failed with exit code ${String(code)}`));
    });
  });
}

export function runSshCommand(target: string, command: string): Promise<string> {
  return runProcess('ssh', [...baseSshOptions(), target, command]);
}

export function spawnSshTunnel(input: { target: string; localPort: number; remotePort: number }): ChildProcess {
  return spawn(
    'ssh',
    [
      '-N',
      '-o',
      'BatchMode=yes',
      '-o',
      'ExitOnForwardFailure=yes',
      '-o',
      `ConnectTimeout=${SSH_TIMEOUT_SECONDS}`,
      '-o',
      'ServerAliveInterval=30',
      '-L',
      `${String(input.localPort)}:127.0.0.1:${String(input.remotePort)}`,
      input.target,
    ],
    {
      env: process.env,
      stdio: ['ignore', 'ignore', 'ignore'],
    },
  );
}

export function uploadFileOverScp(input: { target: string; localPath: string; remotePath: string }): Promise<void> {
  return runProcess('scp', [
    '-q',
    '-o',
    'BatchMode=yes',
    '-o',
    `ConnectTimeout=${SSH_TIMEOUT_SECONDS}`,
    input.localPath,
    `${input.target}:${input.remotePath}`,
  ]).then(() => undefined);
}

export function uploadDirectoryOverScp(input: { target: string; localPath: string; remotePath: string }): Promise<void> {
  return runProcess('scp', [
    '-qr',
    '-o',
    'BatchMode=yes',
    '-o',
    `ConnectTimeout=${SSH_TIMEOUT_SECONDS}`,
    input.localPath,
    `${input.target}:${input.remotePath}`,
  ]).then(() => undefined);
}

export function downloadFileOverScp(input: { target: string; remotePath: string; localPath: string }): Promise<void> {
  return runProcess('scp', [
    '-q',
    '-o',
    'BatchMode=yes',
    '-o',
    `ConnectTimeout=${SSH_TIMEOUT_SECONDS}`,
    `${input.target}:${input.remotePath}`,
    input.localPath,
  ]).then(() => undefined);
}

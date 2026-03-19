#!/usr/bin/env node
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { spawn } from 'node:child_process';

const REMOTE_EXECUTION_RESULT_FILE = 'remote-execution.json';
const REMOTE_EXECUTION_SESSION_FILE = 'remote-session.jsonl';

function quoteShellArg(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function readRequiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required.`);
  }

  return value;
}

function runProcess(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      stdout += text;
      process.stdout.write(text);
    });

    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;
      process.stderr.write(text);
    });

    child.on('error', (error) => reject(error));
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      reject(new Error(stderr.trim() || stdout.trim() || `${command} exited with code ${String(code ?? -1)}`));
    });

    if (options.stdinFilePath) {
      createReadStream(options.stdinFilePath)
        .on('error', reject)
        .pipe(child.stdin);
      return;
    }

    child.stdin.end();
  });
}

function sshArgs(target, remoteCommand) {
  return [target.sshDestination, 'sh', '-lc', remoteCommand];
}

async function runSsh(target, remoteCommand, options = {}) {
  return runProcess(target.sshCommand || 'ssh', sshArgs(target, remoteCommand), options);
}

async function createRemoteTempDir(target) {
  const { stdout } = await runSsh(target, 'mktemp -d');
  const remoteTempDir = stdout.trim();
  if (!remoteTempDir) {
    throw new Error('Remote target did not return a temporary directory path.');
  }

  return remoteTempDir;
}

async function uploadFile(target, localPath, remotePath) {
  const remoteCommand = `mkdir -p ${quoteShellArg(remotePath.split('/').slice(0, -1).join('/') || '/')} && cat > ${quoteShellArg(remotePath)}`;
  await runSsh(target, remoteCommand, { stdinFilePath: localPath });
}

async function downloadFile(target, remotePath, localPath) {
  await mkdir(localPath.split('/').slice(0, -1).join('/'), { recursive: true });
  const child = spawn(target.sshCommand || 'ssh', sshArgs(target, `cat ${quoteShellArg(remotePath)}`), {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const out = createWriteStream(localPath, { encoding: 'utf-8' });
  let stderr = '';

  child.stderr.on('data', (chunk) => {
    const text = chunk.toString();
    stderr += text;
    process.stderr.write(text);
  });

  child.stdout.pipe(out);

  await new Promise((resolve, reject) => {
    child.on('error', reject);
    out.on('error', reject);
    child.on('close', (code) => {
      out.end();
      if (code === 0) {
        resolve(undefined);
        return;
      }

      reject(new Error(stderr.trim() || `ssh exited with code ${String(code ?? -1)}`));
    });
  });
}

async function findRemoteSessionPath(target, remoteSessionsDir) {
  const { stdout } = await runSsh(
    target,
    `find ${quoteShellArg(remoteSessionsDir)} -type f -name '*.jsonl' | sort | tail -n 1`,
  );
  const remoteSessionPath = stdout.trim();
  if (!remoteSessionPath) {
    throw new Error('Remote execution did not produce a persisted session transcript.');
  }

  return remoteSessionPath;
}

function buildRemoteRunCommand(bundle, remoteTempDir) {
  const remoteSessionsDir = `${remoteTempDir}/sessions`;
  const remoteBootstrapPath = `${remoteTempDir}/bootstrap-session.jsonl`;
  const profileArg = bundle.target.profile ? ` --profile ${quoteShellArg(bundle.target.profile)}` : '';
  const commandPrefix = bundle.target.commandPrefix ? `${bundle.target.commandPrefix} && ` : '';
  const remotePaCommand = bundle.target.remotePaCommand || 'pa';
  const promptArg = quoteShellArg(bundle.prompt);

  return {
    remoteBootstrapPath,
    remoteSessionsDir,
    command: [
      'set -euo pipefail',
      `mkdir -p ${quoteShellArg(remoteSessionsDir)}`,
      `cd ${quoteShellArg(bundle.remoteCwd)}`,
      `${commandPrefix}${remotePaCommand}${profileArg} --fork ${quoteShellArg(remoteBootstrapPath)} --session-dir ${quoteShellArg(remoteSessionsDir)} -p ${promptArg}`,
    ].join(' && '),
  };
}

async function main() {
  const bundlePath = process.argv[2];
  if (!bundlePath) {
    throw new Error('Expected the remote execution request bundle path as argv[2].');
  }

  if (!existsSync(bundlePath)) {
    throw new Error(`Remote execution request bundle not found: ${bundlePath}`);
  }

  const runRoot = readRequiredEnv('PERSONAL_AGENT_RUN_ROOT');
  await mkdir(runRoot, { recursive: true });

  const rawBundle = await readFile(bundlePath, 'utf-8');
  const bundle = JSON.parse(rawBundle);
  const remoteTempDir = await createRemoteTempDir(bundle.target);
  const sessionCopyPath = join(runRoot, REMOTE_EXECUTION_SESSION_FILE);
  const resultPath = join(runRoot, REMOTE_EXECUTION_RESULT_FILE);

  try {
    const runCommand = buildRemoteRunCommand(bundle, remoteTempDir);
    await uploadFile(bundle.target, bundle.bootstrapSessionFile, runCommand.remoteBootstrapPath);
    await runSsh(bundle.target, runCommand.command);
    const remoteSessionPath = await findRemoteSessionPath(bundle.target, runCommand.remoteSessionsDir);
    await downloadFile(bundle.target, remoteSessionPath, sessionCopyPath);

    await writeFile(resultPath, `${JSON.stringify({
      version: 1,
      targetId: bundle.target.id,
      targetLabel: bundle.target.label,
      transport: 'ssh',
      sshDestination: bundle.target.sshDestination,
      conversationId: bundle.conversationId,
      localCwd: bundle.localCwd,
      remoteCwd: bundle.remoteCwd,
      prompt: bundle.prompt,
      submittedAt: bundle.submittedAt,
      completedAt: new Date().toISOString(),
      bootstrapLeafId: bundle.bootstrapLeafId ?? null,
      bootstrapEntryCount: bundle.bootstrapEntryCount,
      remoteSessionPath,
    }, null, 2)}\n`);
  } finally {
    try {
      await runSsh(bundle.target, `rm -rf ${quoteShellArg(remoteTempDir)}`);
    } catch (error) {
      console.error(`Failed to clean up remote temp dir ${remoteTempDir}:`, error instanceof Error ? error.message : String(error));
    }
  }

  const bundleDir = join(bundlePath, '..');
  try {
    await writeFile(join(bundleDir, 'completed.ok'), 'ok\n');
  } catch {
    // Ignore staging cleanup markers.
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

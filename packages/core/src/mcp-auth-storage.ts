import { readdirSync } from 'node:fs';
import fs from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import { resolveStatePaths } from './runtime/paths.js';

const MCP_AUTH_SCHEMA_VERSION = 'v1';

export interface LockfileData {
  pid: number;
  port: number;
  timestamp: number;
}

function getLegacyMcpRemoteBaseDir(): string {
  const explicit = process.env.MCP_REMOTE_CONFIG_DIR?.trim();
  if (explicit) {
    return resolve(explicit);
  }

  return join(homedir(), '.mcp-auth');
}

function getPersonalAgentMcpBaseDir(): string {
  const explicit = process.env.PERSONAL_AGENT_MCP_AUTH_DIR?.trim();
  if (explicit) {
    return resolve(explicit);
  }

  return join(resolveStatePaths().auth, 'mcp');
}

function getMcpAuthConfigDir(): string {
  return join(getPersonalAgentMcpBaseDir(), MCP_AUTH_SCHEMA_VERSION);
}

function getLegacyConfigDirs(): string[] {
  const baseDir = getLegacyMcpRemoteBaseDir();

  try {
    return readdirSync(baseDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith('mcp-remote-'))
      .map((entry) => join(baseDir, entry.name))
      .sort((left, right) => right.localeCompare(left));
  } catch {
    return [];
  }
}

async function ensureConfigDir(): Promise<void> {
  await fs.mkdir(getMcpAuthConfigDir(), { recursive: true });
}

function assertSafeFileSegment(value: string): string {
  if (!value || value.includes('/') || value.includes('\\') || value === '.' || value === '..') {
    throw new Error(`Invalid MCP auth file segment: ${value}`);
  }
  return value;
}

function getMcpAuthFilePath(serverUrlHash: string, filename: string): string {
  const safeHash = assertSafeFileSegment(serverUrlHash);
  const safeFilename = assertSafeFileSegment(filename);
  return join(getMcpAuthConfigDir(), `${safeHash}_${safeFilename}`);
}

function getLegacyMcpAuthFilePaths(serverUrlHash: string, filename: string): string[] {
  const safeHash = assertSafeFileSegment(serverUrlHash);
  const safeFilename = assertSafeFileSegment(filename);
  return getLegacyConfigDirs().map((dir) => join(dir, `${safeHash}_${safeFilename}`));
}

async function readExistingFile(filePaths: string[]): Promise<string | undefined> {
  for (const filePath of filePaths) {
    try {
      return await fs.readFile(filePath, 'utf-8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }

  return undefined;
}

export async function readJsonFile<T>(
  serverUrlHash: string,
  filename: string,
  schema: { parseAsync: (value: unknown) => Promise<T> },
): Promise<T | undefined> {
  const content = await readExistingFile([
    getMcpAuthFilePath(serverUrlHash, filename),
    ...getLegacyMcpAuthFilePaths(serverUrlHash, filename),
  ]);

  if (!content) {
    return undefined;
  }

  try {
    return await schema.parseAsync(JSON.parse(content));
  } catch {
    return undefined;
  }
}

export async function writeJsonFile(serverUrlHash: string, filename: string, data: unknown): Promise<void> {
  await ensureConfigDir();
  await fs.writeFile(getMcpAuthFilePath(serverUrlHash, filename), `${JSON.stringify(data, null, 2)}\n`, {
    encoding: 'utf-8',
    mode: 0o600,
  });
}

export async function readTextFile(serverUrlHash: string, filename: string): Promise<string | undefined> {
  return readExistingFile([getMcpAuthFilePath(serverUrlHash, filename), ...getLegacyMcpAuthFilePaths(serverUrlHash, filename)]);
}

export async function writeTextFile(serverUrlHash: string, filename: string, text: string): Promise<void> {
  await ensureConfigDir();
  await fs.writeFile(getMcpAuthFilePath(serverUrlHash, filename), text, {
    encoding: 'utf-8',
    mode: 0o600,
  });
}

export async function deleteConfigFile(serverUrlHash: string, filename: string): Promise<void> {
  try {
    await fs.unlink(getMcpAuthFilePath(serverUrlHash, filename));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
}

export async function createLockfile(serverUrlHash: string, pid: number, port: number): Promise<void> {
  const lockfile: LockfileData = {
    pid,
    port,
    timestamp: Date.now(),
  };

  await writeJsonFile(serverUrlHash, 'lock.json', lockfile);
}

export async function checkLockfile(serverUrlHash: string): Promise<LockfileData | null> {
  const lockfile = await readJsonFile<LockfileData>(serverUrlHash, 'lock.json', {
    async parseAsync(value: unknown): Promise<LockfileData> {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('Invalid lockfile');
      }

      const record = value as Record<string, unknown>;
      if (typeof record.pid !== 'number' || typeof record.port !== 'number' || typeof record.timestamp !== 'number') {
        throw new Error('Invalid lockfile');
      }

      return {
        pid: record.pid,
        port: record.port,
        timestamp: record.timestamp,
      };
    },
  });

  return lockfile ?? null;
}

export async function deleteLockfile(serverUrlHash: string): Promise<void> {
  await deleteConfigFile(serverUrlHash, 'lock.json');
}

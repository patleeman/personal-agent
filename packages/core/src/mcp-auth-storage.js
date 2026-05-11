import { readdirSync } from 'node:fs';
import fs from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { resolveStatePaths } from './runtime/paths.js';
const MCP_AUTH_SCHEMA_VERSION = 'v1';
function getLegacyMcpRemoteBaseDir() {
    const explicit = process.env.MCP_REMOTE_CONFIG_DIR?.trim();
    if (explicit) {
        return resolve(explicit);
    }
    return join(homedir(), '.mcp-auth');
}
function getPersonalAgentMcpBaseDir() {
    const explicit = process.env.PERSONAL_AGENT_MCP_AUTH_DIR?.trim();
    if (explicit) {
        return resolve(explicit);
    }
    return join(resolveStatePaths().auth, 'mcp');
}
function getMcpAuthConfigDir() {
    return join(getPersonalAgentMcpBaseDir(), MCP_AUTH_SCHEMA_VERSION);
}
function getLegacyConfigDirs() {
    const baseDir = getLegacyMcpRemoteBaseDir();
    try {
        return readdirSync(baseDir, { withFileTypes: true })
            .filter((entry) => entry.isDirectory() && entry.name.startsWith('mcp-remote-'))
            .map((entry) => join(baseDir, entry.name))
            .sort((left, right) => right.localeCompare(left));
    }
    catch {
        return [];
    }
}
async function ensureConfigDir() {
    await fs.mkdir(getMcpAuthConfigDir(), { recursive: true });
}
function getMcpAuthFilePath(serverUrlHash, filename) {
    return join(getMcpAuthConfigDir(), `${serverUrlHash}_${filename}`);
}
function getLegacyMcpAuthFilePaths(serverUrlHash, filename) {
    return getLegacyConfigDirs().map((dir) => join(dir, `${serverUrlHash}_${filename}`));
}
async function readExistingFile(filePaths) {
    for (const filePath of filePaths) {
        try {
            return await fs.readFile(filePath, 'utf-8');
        }
        catch (error) {
            if (error.code !== 'ENOENT') {
                throw error;
            }
        }
    }
    return undefined;
}
export async function readJsonFile(serverUrlHash, filename, schema) {
    const content = await readExistingFile([
        getMcpAuthFilePath(serverUrlHash, filename),
        ...getLegacyMcpAuthFilePaths(serverUrlHash, filename),
    ]);
    if (!content) {
        return undefined;
    }
    try {
        return await schema.parseAsync(JSON.parse(content));
    }
    catch {
        return undefined;
    }
}
export async function writeJsonFile(serverUrlHash, filename, data) {
    await ensureConfigDir();
    await fs.writeFile(getMcpAuthFilePath(serverUrlHash, filename), `${JSON.stringify(data, null, 2)}\n`, {
        encoding: 'utf-8',
        mode: 0o600,
    });
}
export async function readTextFile(serverUrlHash, filename) {
    return readExistingFile([getMcpAuthFilePath(serverUrlHash, filename), ...getLegacyMcpAuthFilePaths(serverUrlHash, filename)]);
}
export async function writeTextFile(serverUrlHash, filename, text) {
    await ensureConfigDir();
    await fs.writeFile(getMcpAuthFilePath(serverUrlHash, filename), text, {
        encoding: 'utf-8',
        mode: 0o600,
    });
}
export async function deleteConfigFile(serverUrlHash, filename) {
    try {
        await fs.unlink(getMcpAuthFilePath(serverUrlHash, filename));
    }
    catch (error) {
        if (error.code !== 'ENOENT') {
            throw error;
        }
    }
}
export async function createLockfile(serverUrlHash, pid, port) {
    const lockfile = {
        pid,
        port,
        timestamp: Date.now(),
    };
    await writeJsonFile(serverUrlHash, 'lock.json', lockfile);
}
export async function checkLockfile(serverUrlHash) {
    const lockfile = await readJsonFile(serverUrlHash, 'lock.json', {
        async parseAsync(value) {
            if (!value || typeof value !== 'object' || Array.isArray(value)) {
                throw new Error('Invalid lockfile');
            }
            const record = value;
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
export async function deleteLockfile(serverUrlHash) {
    await deleteConfigFile(serverUrlHash, 'lock.json');
}

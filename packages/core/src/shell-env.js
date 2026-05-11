import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { basename, delimiter } from 'node:path';
const ENV_CAPTURE_START = '__PERSONAL_AGENT_ENV_START__';
const ENV_CAPTURE_END = '__PERSONAL_AGENT_ENV_END__';
const ENV_CAPTURE_COMMAND = `printf '%s\\0' '${ENV_CAPTURE_START}'; env -0; printf '%s\\0' '${ENV_CAPTURE_END}'`;
const ENV_CAPTURE_TIMEOUT_MS = 5_000;
const ENV_CAPTURE_MAX_BUFFER = 4 * 1024 * 1024;
let cachedShellEnvSignature = null;
let cachedShellEnv = null;
function normalizeEnvValue(value) {
    return typeof value === 'string' ? value : '';
}
function buildShellEnvSignature(baseEnv) {
    return [
        process.platform,
        normalizeEnvValue(baseEnv.SHELL),
        normalizeEnvValue(baseEnv.HOME),
        normalizeEnvValue(baseEnv.USER),
        normalizeEnvValue(baseEnv.LOGNAME),
    ].join('\0');
}
function findPathKey(...envs) {
    for (const env of envs) {
        if (!env) {
            continue;
        }
        for (const key of Object.keys(env)) {
            if (key.toLowerCase() === 'path') {
                return key;
            }
        }
    }
    return 'PATH';
}
function mergePathValues(preferred, fallback) {
    const entries = [];
    const seen = new Set();
    for (const value of [preferred, fallback]) {
        if (!value) {
            continue;
        }
        for (const entry of value.split(delimiter)) {
            const trimmed = entry.trim();
            if (!trimmed) {
                continue;
            }
            const normalized = process.platform === 'win32' ? trimmed.toLowerCase() : trimmed;
            if (seen.has(normalized)) {
                continue;
            }
            seen.add(normalized);
            entries.push(trimmed);
        }
    }
    return entries.length > 0 ? entries.join(delimiter) : undefined;
}
function readPathValue(env) {
    if (!env) {
        return undefined;
    }
    return env[findPathKey(env)];
}
function setNormalizedPathValue(env, pathKey, value) {
    for (const key of Object.keys(env)) {
        if (key !== pathKey && key.toLowerCase() === 'path') {
            delete env[key];
        }
    }
    env[pathKey] = value;
}
function resolveShellCaptureArgSets(shellPath) {
    const shellName = basename(shellPath).toLowerCase();
    if (shellName === 'zsh') {
        return [
            ['-ilc', ENV_CAPTURE_COMMAND],
            ['-ic', ENV_CAPTURE_COMMAND],
        ];
    }
    if (shellName === 'bash' || shellName === 'fish' || shellName === 'ksh') {
        return [['-ic', ENV_CAPTURE_COMMAND]];
    }
    return null;
}
function parseCapturedEnvironment(stdout) {
    const text = stdout.toString('utf-8');
    const startToken = `${ENV_CAPTURE_START}\0`;
    const startIndex = text.indexOf(startToken);
    if (startIndex === -1) {
        return null;
    }
    const remaining = text.slice(startIndex + startToken.length);
    const endToken = `${ENV_CAPTURE_END}\0`;
    const endIndex = remaining.indexOf(endToken);
    const payload = endIndex === -1 ? remaining : remaining.slice(0, endIndex);
    const env = {};
    for (const entry of payload.split('\0')) {
        if (!entry) {
            continue;
        }
        const equalsIndex = entry.indexOf('=');
        if (equalsIndex <= 0) {
            continue;
        }
        const key = entry.slice(0, equalsIndex);
        env[key] = entry.slice(equalsIndex + 1);
    }
    return Object.keys(env).length > 0 ? env : null;
}
function captureInteractiveShellEnvironment(baseEnv) {
    if (process.platform === 'win32') {
        return null;
    }
    const shellPath = baseEnv.SHELL?.trim();
    if (!shellPath || !existsSync(shellPath)) {
        return null;
    }
    const argSets = resolveShellCaptureArgSets(shellPath);
    if (!argSets) {
        return null;
    }
    for (const args of argSets) {
        const result = spawnSync(shellPath, args, {
            env: baseEnv,
            encoding: 'buffer',
            maxBuffer: ENV_CAPTURE_MAX_BUFFER,
            timeout: ENV_CAPTURE_TIMEOUT_MS,
            windowsHide: true,
        });
        if (result.error || result.status !== 0 || !Buffer.isBuffer(result.stdout) || result.stdout.length === 0) {
            continue;
        }
        const parsed = parseCapturedEnvironment(result.stdout);
        if (parsed) {
            return parsed;
        }
    }
    return null;
}
function getCachedInteractiveShellEnvironment(baseEnv) {
    const signature = buildShellEnvSignature(baseEnv);
    if (cachedShellEnvSignature === signature) {
        return cachedShellEnv;
    }
    cachedShellEnvSignature = signature;
    cachedShellEnv = captureInteractiveShellEnvironment(baseEnv);
    return cachedShellEnv;
}
function mergeResolvedEnvironment(baseEnv, shellEnv) {
    const mergedEnv = {
        ...baseEnv,
        ...(shellEnv ?? {}),
    };
    const pathKey = findPathKey(shellEnv, baseEnv);
    const mergedPath = mergePathValues(readPathValue(shellEnv), readPathValue(baseEnv));
    if (mergedPath) {
        setNormalizedPathValue(mergedEnv, pathKey, mergedPath);
    }
    return mergedEnv;
}
export function resolveChildProcessEnv(overrides = {}, baseEnv = process.env) {
    const shellEnv = getCachedInteractiveShellEnvironment(baseEnv);
    const mergedEnv = mergeResolvedEnvironment(baseEnv, shellEnv);
    const pathKey = findPathKey(overrides, mergedEnv);
    const resolvedPath = mergePathValues(readPathValue(overrides), readPathValue(mergedEnv));
    const resolvedEnv = {
        ...mergedEnv,
        ...overrides,
    };
    if (resolvedPath) {
        setNormalizedPathValue(resolvedEnv, pathKey, resolvedPath);
    }
    return resolvedEnv;
}
export function hydrateProcessEnvFromShell(targetEnv = process.env) {
    const resolvedEnv = resolveChildProcessEnv({}, targetEnv);
    const targetPathKey = findPathKey(targetEnv, resolvedEnv);
    const resolvedPathKey = findPathKey(resolvedEnv, targetEnv);
    for (const [key, value] of Object.entries(resolvedEnv)) {
        if (typeof value !== 'string' || key.toLowerCase() === 'path') {
            continue;
        }
        targetEnv[key] = value;
    }
    const resolvedPath = resolvedEnv[resolvedPathKey];
    if (typeof resolvedPath === 'string' && resolvedPath.length > 0) {
        setNormalizedPathValue(targetEnv, targetPathKey, resolvedPath);
    }
    return targetEnv;
}
export function clearResolvedChildProcessEnvCache() {
    cachedShellEnvSignature = null;
    cachedShellEnv = null;
}

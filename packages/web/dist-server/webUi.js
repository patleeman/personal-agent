import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, statSync, writeFileSync, } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { findBadWebUiRelease, getWebUiServiceStatus, installWebUiService, listBadWebUiReleases, markWebUiReleaseBad, resolveWebUiTailscaleUrl, restartWebUiService, rollbackWebUiDeployment, startWebUiService, stopWebUiService, syncWebUiTailscaleServe, uninstallWebUiService, } from '@personal-agent/gateway';
const WEB_REPO_ROOT = process.env.PERSONAL_AGENT_REPO_ROOT ?? process.cwd();
const DEFAULT_WEB_UI_PORT = 3741;
const DEFAULT_RESUME_FALLBACK_PROMPT = 'Continue from where you left off.';
function normalizeWebUiConfigPort(value, fallback = DEFAULT_WEB_UI_PORT) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return fallback;
    }
    const parsed = Math.floor(value);
    return parsed > 0 && parsed <= 65535 ? parsed : fallback;
}
function parseWebUiConfigBool(value) {
    if (value === true || value === 'true') {
        return true;
    }
    if (value === false || value === 'false') {
        return false;
    }
    return undefined;
}
function normalizeResumeFallbackPrompt(value) {
    if (typeof value !== 'string') {
        return DEFAULT_RESUME_FALLBACK_PROMPT;
    }
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : DEFAULT_RESUME_FALLBACK_PROMPT;
}
function resolveWebUiConfigFilePath() {
    const explicit = process.env.PERSONAL_AGENT_WEB_CONFIG_FILE;
    if (explicit && explicit.trim().length > 0) {
        return resolve(explicit);
    }
    return join(homedir(), '.config', 'personal-agent', 'web.json');
}
export function readWebUiConfig() {
    const filePath = resolveWebUiConfigFilePath();
    const fromEnv = parseWebUiConfigBool(process.env.PERSONAL_AGENT_WEB_TAILSCALE_SERVE);
    if (!existsSync(filePath)) {
        return {
            port: DEFAULT_WEB_UI_PORT,
            useTailscaleServe: fromEnv ?? false,
            resumeFallbackPrompt: DEFAULT_RESUME_FALLBACK_PROMPT,
        };
    }
    try {
        const parsed = JSON.parse(readFileSync(filePath, 'utf-8'));
        return {
            port: normalizeWebUiConfigPort(parsed.port),
            useTailscaleServe: fromEnv ?? parseWebUiConfigBool(parsed.useTailscaleServe) ?? false,
            resumeFallbackPrompt: normalizeResumeFallbackPrompt(parsed.resumeFallbackPrompt),
        };
    }
    catch {
        return {
            port: DEFAULT_WEB_UI_PORT,
            useTailscaleServe: fromEnv ?? false,
            resumeFallbackPrompt: DEFAULT_RESUME_FALLBACK_PROMPT,
        };
    }
}
export function writeWebUiConfig(input) {
    const filePath = resolveWebUiConfigFilePath();
    const raw = readWebUiConfig();
    const updated = {
        ...raw,
        useTailscaleServe: input.useTailscaleServe === undefined ? raw.useTailscaleServe : input.useTailscaleServe,
        resumeFallbackPrompt: input.resumeFallbackPrompt === undefined
            ? raw.resumeFallbackPrompt
            : normalizeResumeFallbackPrompt(input.resumeFallbackPrompt),
    };
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, `${JSON.stringify(updated, null, 2)}\n`, 'utf-8');
    return updated;
}
export function syncConfiguredWebUiTailscaleServe(enabled) {
    const config = readWebUiConfig();
    syncWebUiTailscaleServe({
        enabled,
        port: config.port,
    });
}
function readTailLines(filePath, maxLines = 60, maxBytes = 64 * 1024) {
    if (!filePath || !existsSync(filePath)) {
        return [];
    }
    let fd;
    try {
        const stats = statSync(filePath);
        const readLength = Math.min(maxBytes, stats.size);
        if (readLength <= 0) {
            return [];
        }
        const buffer = Buffer.alloc(readLength);
        fd = openSync(filePath, 'r');
        readSync(fd, buffer, 0, readLength, stats.size - readLength);
        const text = buffer.toString('utf-8');
        return text
            .split(/\r?\n/)
            .map((line) => line.trimEnd())
            .filter((line) => line.length > 0)
            .slice(-maxLines);
    }
    catch {
        return [];
    }
    finally {
        if (fd !== undefined) {
            closeSync(fd);
        }
    }
}
function toDeploymentSummary(summary) {
    if (!summary) {
        return undefined;
    }
    return {
        stablePort: summary.stablePort,
        activeSlot: summary.activeSlot,
        activeRelease: summary.activeRelease,
        inactiveRelease: summary.inactiveRelease,
        activeReleaseBad: findBadWebUiRelease({ release: summary.activeRelease, stablePort: summary.stablePort }),
        inactiveReleaseBad: findBadWebUiRelease({ release: summary.inactiveRelease, stablePort: summary.stablePort }),
        badReleases: listBadWebUiReleases({ stablePort: summary.stablePort }),
    };
}
function readWebUiServiceSummary() {
    const config = readWebUiConfig();
    const tailscaleUrl = config.useTailscaleServe ? resolveWebUiTailscaleUrl() : undefined;
    try {
        const status = getWebUiServiceStatus({ repoRoot: WEB_REPO_ROOT });
        return {
            platform: status.platform,
            identifier: status.identifier,
            manifestPath: status.manifestPath,
            installed: status.installed,
            running: status.running,
            logFile: status.logFile,
            repoRoot: status.repoRoot,
            port: status.port,
            url: status.url,
            tailscaleServe: config.useTailscaleServe,
            tailscaleUrl,
            resumeFallbackPrompt: config.resumeFallbackPrompt,
            deployment: toDeploymentSummary(status.deployment),
        };
    }
    catch (error) {
        return {
            platform: process.platform,
            identifier: 'personal-agent-web-ui',
            manifestPath: '',
            installed: false,
            running: false,
            repoRoot: process.cwd(),
            port: DEFAULT_WEB_UI_PORT,
            url: `http://localhost:${DEFAULT_WEB_UI_PORT}`,
            tailscaleServe: config.useTailscaleServe,
            tailscaleUrl,
            resumeFallbackPrompt: config.resumeFallbackPrompt,
            error: error instanceof Error ? error.message : String(error),
        };
    }
}
export function readWebUiState() {
    const service = readWebUiServiceSummary();
    const warnings = [];
    if (service.error) {
        warnings.push(`Could not inspect web UI service status: ${service.error}`);
    }
    else if (service.installed && !service.running) {
        warnings.push('Web UI service is installed but not running.');
    }
    else if (!service.installed) {
        warnings.push('Web UI service is not installed. Install it from this page or run `pa ui service install`.');
    }
    if (service.installed && !service.deployment?.activeRelease) {
        warnings.push('No active blue/green web UI release is staged yet. Reinstall the web UI service to materialize one.');
    }
    if (service.tailscaleServe && !service.tailscaleUrl) {
        warnings.push('Tailscale Serve is enabled, but a Tailnet URL could not be resolved from `tailscale status --json`. Ensure Tailscale is running and authenticated on this machine.');
    }
    if (service.deployment?.activeReleaseBad) {
        warnings.push(`Active web UI release ${service.deployment.activeReleaseBad.revision} is marked bad.${service.deployment.activeReleaseBad.reason ? ` Reason: ${service.deployment.activeReleaseBad.reason}` : ''}`);
    }
    return {
        warnings,
        service,
        log: {
            path: service.logFile,
            lines: readTailLines(service.logFile),
        },
    };
}
export function installWebUiServiceAndReadState() {
    installWebUiService({ repoRoot: WEB_REPO_ROOT });
    return readWebUiState();
}
export function startWebUiServiceAndReadState() {
    startWebUiService({ repoRoot: WEB_REPO_ROOT });
    return readWebUiState();
}
export function restartWebUiServiceAndReadState() {
    restartWebUiService({ repoRoot: WEB_REPO_ROOT });
    return readWebUiState();
}
export function rollbackWebUiServiceAndReadState(input = {}) {
    const service = getWebUiServiceStatus({ repoRoot: WEB_REPO_ROOT });
    if (!service.installed) {
        throw new Error('Managed web UI service is not installed. Install it before rolling back.');
    }
    rollbackWebUiDeployment({
        stablePort: service.port,
        reason: input.reason,
    });
    installWebUiService({ repoRoot: WEB_REPO_ROOT, port: service.port });
    return readWebUiState();
}
export function markBadWebUiReleaseAndReadState(input = {}) {
    const service = getWebUiServiceStatus({ repoRoot: WEB_REPO_ROOT });
    markWebUiReleaseBad({
        slot: input.slot,
        stablePort: service.port,
        reason: input.reason,
    });
    return readWebUiState();
}
export function stopWebUiServiceAndReadState() {
    stopWebUiService({ repoRoot: WEB_REPO_ROOT });
    return readWebUiState();
}
export function uninstallWebUiServiceAndReadState() {
    uninstallWebUiService({ repoRoot: WEB_REPO_ROOT });
    return readWebUiState();
}

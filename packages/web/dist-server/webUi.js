import { closeSync, existsSync, openSync, readSync, statSync, } from 'node:fs';
import { findBadWebUiRelease, getWebUiServiceStatus, installWebUiService, listBadWebUiReleases, markWebUiReleaseBad, restartWebUiService, rollbackWebUiDeployment, startWebUiService, stopWebUiService, uninstallWebUiService, } from '@personal-agent/gateway';
const WEB_REPO_ROOT = process.env.PERSONAL_AGENT_REPO_ROOT ?? process.cwd();
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
            port: 3741,
            url: 'http://localhost:3741',
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

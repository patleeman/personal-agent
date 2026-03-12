import { closeSync, existsSync, openSync, readSync, statSync, } from 'node:fs';
import { getDaemonStatus, loadDaemonConfig, pingDaemon, resolveDaemonPaths, } from '@personal-agent/daemon';
import { getManagedDaemonServiceStatus, installManagedDaemonService, restartManagedDaemonServiceIfInstalled, startManagedDaemonService, stopManagedDaemonService, uninstallManagedDaemonService, } from '@personal-agent/gateway';
function resolveDaemonServicePlatform() {
    if (process.platform === 'darwin') {
        return 'launchd';
    }
    if (process.platform === 'linux') {
        return 'systemd';
    }
    return process.platform;
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
function readDaemonServiceSummary(defaultLogFile) {
    try {
        const status = getManagedDaemonServiceStatus();
        return {
            platform: resolveDaemonServicePlatform(),
            identifier: status.identifier,
            manifestPath: status.manifestPath,
            installed: status.installed,
            running: status.running,
            logFile: status.logFile ?? defaultLogFile,
        };
    }
    catch (error) {
        return {
            platform: resolveDaemonServicePlatform(),
            identifier: 'personal-agent-daemon',
            manifestPath: '',
            installed: false,
            running: false,
            logFile: defaultLogFile,
            error: error instanceof Error ? error.message : String(error),
        };
    }
}
export async function readDaemonState() {
    const config = loadDaemonConfig();
    const paths = resolveDaemonPaths(config.ipc.socketPath);
    const service = readDaemonServiceSummary(paths.logFile);
    const runtime = {
        running: false,
        socketPath: paths.socketPath,
        moduleCount: 0,
    };
    let runtimeInspectionError;
    try {
        if (await pingDaemon(config)) {
            const status = await getDaemonStatus(config);
            runtime.running = true;
            runtime.socketPath = status.socketPath;
            runtime.pid = status.pid;
            runtime.startedAt = status.startedAt;
            runtime.moduleCount = status.modules.length;
            runtime.queueDepth = status.queue.currentDepth;
            runtime.maxQueueDepth = status.queue.maxDepth;
        }
    }
    catch (error) {
        runtimeInspectionError = error instanceof Error ? error.message : String(error);
    }
    const warnings = [];
    if (service.error) {
        warnings.push(`Could not inspect daemon service status: ${service.error}`);
    }
    else if (service.installed && !service.running) {
        warnings.push('Daemon service is installed but not running.');
    }
    else if (!service.installed && !runtime.running) {
        warnings.push('Daemon service is not installed. Install it from this page or run `pa daemon service install`.');
    }
    if (runtimeInspectionError) {
        warnings.push(`Could not inspect daemon runtime: ${runtimeInspectionError}`);
    }
    else if (service.installed && !runtime.running) {
        warnings.push('Daemon runtime is not responding on the local socket.');
    }
    const logPath = service.logFile ?? paths.logFile;
    return {
        warnings,
        service,
        runtime,
        log: {
            path: logPath,
            lines: readTailLines(logPath),
        },
    };
}
export async function installDaemonServiceAndReadState() {
    installManagedDaemonService();
    return readDaemonState();
}
export async function startDaemonServiceAndReadState() {
    startManagedDaemonService();
    return readDaemonState();
}
export async function restartDaemonServiceAndReadState() {
    const restarted = restartManagedDaemonServiceIfInstalled();
    if (!restarted) {
        throw new Error('Daemon service is not installed. Install it from this page or run `pa daemon service install`.');
    }
    return readDaemonState();
}
export async function stopDaemonServiceAndReadState() {
    stopManagedDaemonService();
    return readDaemonState();
}
export async function uninstallDaemonServiceAndReadState() {
    uninstallManagedDaemonService();
    return readDaemonState();
}

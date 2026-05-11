import { spawnSync } from 'child_process';
function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
function normalizePort(port) {
    if (!Number.isInteger(port)) {
        throw new Error(`Invalid Tailscale Serve port: ${String(port)}`);
    }
    if (port <= 0 || port > 65535) {
        throw new Error(`Invalid Tailscale Serve port: ${String(port)}`);
    }
    return port;
}
function normalizeServePath(path) {
    const trimmed = typeof path === 'string' ? path.trim() : '';
    if (!trimmed || trimmed === '/') {
        return '/';
    }
    return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}
function normalizeDnsName(value) {
    if (typeof value !== 'string') {
        return undefined;
    }
    const trimmed = value.trim();
    if (trimmed.length === 0) {
        return undefined;
    }
    return trimmed.endsWith('.') ? trimmed.slice(0, -1) : trimmed;
}
function normalizeDnsHostSegment(value) {
    if (typeof value !== 'string') {
        return undefined;
    }
    const trimmed = value.trim().replace(/\.+$/, '');
    return trimmed.length > 0 ? trimmed : undefined;
}
function normalizeDnsSuffix(value) {
    if (typeof value !== 'string') {
        return undefined;
    }
    const trimmed = value.trim().replace(/^\.+/, '').replace(/\.+$/, '');
    return trimmed.length > 0 ? trimmed : undefined;
}
function buildTailscaleServeArgs(input) {
    const args = ['serve', '--bg', `--set-path=${normalizeServePath(input.path)}`, `localhost:${input.port}`];
    if (!input.enabled) {
        args.push('off');
    }
    return args;
}
function formatCommand(command, args) {
    return `${command} ${args.join(' ')}`.trim();
}
function renderTailscaleCommandFailure(execution) {
    const status = execution.result.status ?? 1;
    return (execution.result.stderr ?? '').trim() || (execution.result.stdout ?? '').trim() || `exit code ${status}`;
}
function resolveTailscaleCommandCandidates() {
    const explicit = process.env.PERSONAL_AGENT_TAILSCALE_BIN;
    const candidates = [
        explicit,
        'tailscale',
        '/opt/homebrew/bin/tailscale',
        '/usr/local/bin/tailscale',
        '/Applications/Tailscale.app/Contents/MacOS/Tailscale',
        '/usr/bin/tailscale',
        '/snap/bin/tailscale',
    ]
        .filter((candidate) => typeof candidate === 'string' && candidate.trim().length > 0)
        .map((candidate) => candidate.trim());
    return [...new Set(candidates)];
}
function runTailscaleCommand(args) {
    const commands = resolveTailscaleCommandCandidates();
    for (const command of commands) {
        const result = spawnSync(command, args, { encoding: 'utf-8' });
        if (result.error) {
            const error = result.error;
            if (error.code === 'ENOENT') {
                continue;
            }
            throw new Error(`Failed to run \`${formatCommand(command, args)}\`: ${error.message}`);
        }
        return {
            command,
            result,
        };
    }
    throw new Error('Could not run `tailscale`. Install the Tailscale CLI and authenticate this machine (`tailscale up`) before enabling Tailscale Serve.');
}
function readTailscaleServeStatusPayload() {
    let execution;
    try {
        execution = runTailscaleCommand(['serve', 'status', '--json']);
    }
    catch (error) {
        return {
            error: error instanceof Error ? error.message : String(error),
        };
    }
    if ((execution.result.status ?? 1) !== 0) {
        return {
            error: `Could not read \`tailscale serve status --json\`: ${renderTailscaleCommandFailure(execution)}`,
        };
    }
    const raw = execution.result.stdout ?? '';
    if (!raw.trim()) {
        return { payload: {} };
    }
    try {
        return {
            payload: JSON.parse(raw),
        };
    }
    catch (error) {
        return {
            error: `Could not parse \`tailscale serve status --json\`: ${error instanceof Error ? error.message : String(error)}`,
        };
    }
}
function readTailscaleStatusPayload() {
    let execution;
    try {
        execution = runTailscaleCommand(['status', '--json']);
    }
    catch (error) {
        return {
            error: error instanceof Error ? error.message : String(error),
        };
    }
    if ((execution.result.status ?? 1) !== 0) {
        return {
            error: `Could not read \`tailscale status --json\`: ${renderTailscaleCommandFailure(execution)}`,
        };
    }
    const raw = execution.result.stdout ?? '';
    if (!raw.trim()) {
        return { payload: {} };
    }
    try {
        return {
            payload: JSON.parse(raw),
        };
    }
    catch (error) {
        return {
            error: `Could not parse \`tailscale status --json\`: ${error instanceof Error ? error.message : String(error)}`,
        };
    }
}
function renderExpectedLocalProxyTarget(port) {
    return `http://localhost:${String(port)}`;
}
function findServeProxyTarget(payload, path) {
    if (!isRecord(payload.Web)) {
        return undefined;
    }
    for (const service of Object.values(payload.Web)) {
        if (!isRecord(service) || !isRecord(service.Handlers)) {
            continue;
        }
        const handler = service.Handlers[path];
        if (!isRecord(handler)) {
            continue;
        }
        const proxy = typeof handler.Proxy === 'string' ? handler.Proxy.trim() : '';
        if (proxy.length > 0) {
            return proxy;
        }
    }
    return undefined;
}
function proxyTargetMatchesLoopbackPort(proxyTarget, port) {
    const normalized = proxyTarget.includes('://') ? proxyTarget : `http://${proxyTarget}`;
    try {
        const url = new URL(normalized);
        const hostname = url.hostname.replace(/^\[/, '').replace(/\]$/, '');
        const resolvedPort = url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80;
        return ['localhost', '127.0.0.1', '::1'].includes(hostname) && resolvedPort === port;
    }
    catch {
        return false;
    }
}
export function readTailscaleServeProxyState(input) {
    const normalizedPath = normalizeServePath(input.path);
    const normalizedPort = normalizePort(input.port);
    const expectedProxyTarget = renderExpectedLocalProxyTarget(normalizedPort);
    if (!input.enabled) {
        return {
            status: 'disabled',
            path: normalizedPath,
            expectedProxyTarget,
            message: 'Tailnet publishing is disabled.',
        };
    }
    const status = readTailscaleServeStatusPayload();
    if (!status.payload) {
        return {
            status: 'unavailable',
            path: normalizedPath,
            expectedProxyTarget,
            message: status.error ?? 'Could not verify Tailscale Serve state.',
        };
    }
    const proxyTarget = findServeProxyTarget(status.payload, normalizedPath);
    if (!proxyTarget) {
        return {
            status: 'missing',
            path: normalizedPath,
            expectedProxyTarget,
            message: `Tailscale Serve does not currently expose ${normalizedPath} -> localhost:${String(normalizedPort)}.`,
        };
    }
    if (!proxyTargetMatchesLoopbackPort(proxyTarget, normalizedPort)) {
        return {
            status: 'mismatch',
            path: normalizedPath,
            expectedProxyTarget,
            actualProxyTarget: proxyTarget,
            message: `Tailscale Serve exposes ${normalizedPath}, but it points to ${proxyTarget} instead of localhost:${String(normalizedPort)}.`,
        };
    }
    return {
        status: 'published',
        path: normalizedPath,
        expectedProxyTarget,
        actualProxyTarget: proxyTarget,
        message: `Tailscale Serve exposes ${normalizedPath} -> localhost:${String(normalizedPort)}.`,
    };
}
function verifyTailscaleServeProxyState(input) {
    const normalizedPath = normalizeServePath(input.path);
    const normalizedPort = normalizePort(input.port);
    if (!input.enabled) {
        const status = readTailscaleServeStatusPayload();
        if (!status.payload) {
            throw new Error(status.error ?? 'Could not verify Tailscale Serve state.');
        }
        const proxyTarget = findServeProxyTarget(status.payload, normalizedPath);
        if (proxyTarget) {
            throw new Error(`Tailscale Serve still exposes ${normalizedPath} -> ${proxyTarget} after disabling it.`);
        }
        return;
    }
    const state = readTailscaleServeProxyState({
        enabled: true,
        port: normalizedPort,
        path: normalizedPath,
    });
    if (state.status === 'published') {
        return;
    }
    throw new Error(state.message ?? 'Could not verify Tailscale Serve state.');
}
function resolveDnsNameFromStatus(payload) {
    const directDnsName = normalizeDnsName(payload.Self?.DNSName);
    if (directDnsName) {
        return directDnsName;
    }
    const hostName = normalizeDnsHostSegment(payload.Self?.HostName);
    const suffix = normalizeDnsSuffix(payload.MagicDNSSuffix);
    if (!hostName || !suffix) {
        return undefined;
    }
    return `${hostName}.${suffix}`;
}
export function syncTailscaleServeProxy(input) {
    const normalizedPort = normalizePort(input.port);
    const normalizedPath = normalizeServePath(input.path);
    const execution = runTailscaleCommand(buildTailscaleServeArgs({
        enabled: input.enabled,
        port: normalizedPort,
        path: normalizedPath,
    }));
    const status = execution.result.status ?? 1;
    if (status !== 0) {
        throw new Error(`Could not ${input.enabled ? 'enable' : 'disable'} Tailscale Serve for ${normalizedPath} -> localhost:${normalizedPort}: ${renderTailscaleCommandFailure(execution)}`);
    }
    verifyTailscaleServeProxyState({
        enabled: input.enabled,
        port: normalizedPort,
        path: normalizedPath,
    });
}
export function syncCompanionTailscaleServe(input) {
    syncTailscaleServeProxy({
        ...input,
        path: '/companion',
    });
}
export function resolveTailscaleServeBaseUrl() {
    const status = readTailscaleStatusPayload();
    if (!status.payload) {
        return undefined;
    }
    const dnsName = resolveDnsNameFromStatus(status.payload);
    return dnsName ? `https://${dnsName}` : undefined;
}

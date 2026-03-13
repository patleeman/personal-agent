import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearMonitoredServiceAttentionSuppression, createServiceAttentionMonitor, suppressMonitoredServiceAttention, } from './internalAttention.js';
function createDaemonState(input) {
    const running = input.running ?? true;
    return {
        warnings: input.warnings ?? [],
        service: {
            platform: 'launchd',
            identifier: 'personal-agent-daemon',
            manifestPath: '/tmp/daemon.plist',
            installed: input.installed ?? true,
            running,
            ...(input.error ? { error: input.error } : {}),
        },
        runtime: {
            running,
            socketPath: '/tmp/personal-agentd.sock',
            moduleCount: running ? 3 : 0,
        },
        log: {
            path: '/tmp/daemon.log',
            lines: [],
        },
    };
}
function createGatewayState(input) {
    return {
        provider: 'telegram',
        currentProfile: 'datadog',
        configuredProfile: 'datadog',
        configFilePath: '/tmp/gateway.json',
        envOverrideKeys: [],
        warnings: input.warnings ?? [],
        service: {
            provider: 'telegram',
            platform: 'launchd',
            identifier: 'personal-agent-telegram-gateway',
            manifestPath: '/tmp/gateway.plist',
            installed: input.installed ?? true,
            running: input.running ?? true,
            ...(input.error ? { error: input.error } : {}),
        },
        access: {
            tokenConfigured: true,
            tokenSource: 'plain',
            allowlistChatIds: [],
            allowedUserIds: [],
            blockedUserIds: [],
        },
        conversations: [],
        pendingMessages: [],
        gatewayLog: {
            path: '/tmp/gateway.log',
            lines: [],
        },
    };
}
afterEach(() => {
    clearMonitoredServiceAttentionSuppression();
    vi.useRealTimers();
});
describe('createServiceAttentionMonitor', () => {
    it('records daemon outage and recovery after the baseline tick', async () => {
        let daemonState = createDaemonState({ running: true });
        const writes = [];
        const nowValues = [
            new Date('2026-03-13T16:00:00.000Z'),
            new Date('2026-03-13T16:01:00.000Z'),
            new Date('2026-03-13T16:02:00.000Z'),
        ];
        const monitor = createServiceAttentionMonitor({
            repoRoot: '/repo',
            getCurrentProfile: () => 'datadog',
            readDaemonState: async () => daemonState,
            readGatewayState: () => createGatewayState({ running: true }),
            writeEntry: (entry) => {
                writes.push({ summary: entry.summary, details: entry.details });
            },
            now: () => nowValues.shift() ?? new Date('2026-03-13T16:03:00.000Z'),
        });
        await monitor.tick();
        expect(writes).toHaveLength(0);
        daemonState = createDaemonState({
            running: false,
            warnings: ['Daemon service is installed but not running.', 'Daemon runtime is not responding on the local socket.'],
        });
        await monitor.tick();
        daemonState = createDaemonState({ running: true });
        await monitor.tick();
        expect(writes).toHaveLength(2);
        expect(writes[0]?.summary).toBe('Daemon is offline.');
        expect(writes[0]?.details).toContain('State: offline');
        expect(writes[1]?.summary).toBe('Daemon recovered.');
        expect(writes[1]?.details).toContain('Previous state: offline');
    });
    it('records gateway token misconfiguration after the baseline tick', async () => {
        let gatewayState = createGatewayState({ running: true });
        const writes = [];
        const monitor = createServiceAttentionMonitor({
            repoRoot: '/repo',
            getCurrentProfile: () => 'datadog',
            readDaemonState: async () => createDaemonState({ running: true }),
            readGatewayState: () => gatewayState,
            writeEntry: (entry) => {
                writes.push({ summary: entry.summary, details: entry.details });
            },
            now: () => new Date('2026-03-13T16:10:00.000Z'),
        });
        await monitor.tick();
        gatewayState = createGatewayState({
            running: true,
            warnings: ['Telegram bot token is not configured. Save it below or run `pa gateway telegram setup`.'],
        });
        await monitor.tick();
        expect(writes).toHaveLength(1);
        expect(writes[0]?.summary).toBe('Gateway is not configured.');
        expect(writes[0]?.details).toContain('State: token missing');
    });
    it('suppresses transitions during explicit service-action windows', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-03-13T16:20:00.000Z'));
        let gatewayState = createGatewayState({ running: true });
        const writes = [];
        const monitor = createServiceAttentionMonitor({
            repoRoot: '/repo',
            getCurrentProfile: () => 'datadog',
            readDaemonState: async () => createDaemonState({ running: true }),
            readGatewayState: () => gatewayState,
            writeEntry: (entry) => {
                writes.push({ summary: entry.summary });
            },
            now: () => new Date(Date.now()),
        });
        await monitor.tick();
        suppressMonitoredServiceAttention('gateway', 60_000);
        gatewayState = createGatewayState({
            running: false,
            warnings: ['Gateway service is installed but not running.'],
        });
        await monitor.tick();
        gatewayState = createGatewayState({ running: true });
        await monitor.tick();
        expect(writes).toHaveLength(0);
    });
});

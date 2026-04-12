import { loadDesktopConfig, saveDesktopConfig } from '../state/desktop-config.js';
import {
  clearDesktopRemoteHostAuth,
  readDesktopRemoteHostAuthState,
  writeDesktopRemoteHostAuth,
} from '../state/remote-host-auth.js';
import type {
  DesktopConfig,
  DesktopConnectionsState,
  DesktopEnvironmentState,
  DesktopHostRecord,
  HostController,
} from './types.js';
import { LocalHostController } from './local-host-controller.js';
import { SshHostController } from './ssh-host-controller.js';
import { WebHostController } from './web-host-controller.js';

export class HostManager {
  private config: DesktopConfig;
  private activeHostId: string;
  private controllers = new Map<string, HostController>();

  constructor() {
    this.config = loadDesktopConfig();
    this.activeHostId = this.config.defaultHostId;
  }

  getConfig(): DesktopConfig {
    return this.config;
  }

  getActiveHostId(): string {
    return this.activeHostId;
  }

  async ensureActiveHostRunning(): Promise<void> {
    await this.ensureHostRunning(this.activeHostId);
  }

  async ensureHostRunning(hostId: string): Promise<void> {
    await this.getController(this.getHostRecordById(hostId)).ensureRunning();
  }

  async getActiveHostBaseUrl(): Promise<string> {
    return this.getHostBaseUrl(this.activeHostId);
  }

  async getHostBaseUrl(hostId: string): Promise<string> {
    return this.getController(this.getHostRecordById(hostId)).getBaseUrl();
  }

  async openNewConversation(): Promise<string> {
    return this.openNewConversationForHost(this.activeHostId);
  }

  async openNewConversationForHost(hostId: string): Promise<string> {
    return this.getController(this.getHostRecordById(hostId)).openNewConversation();
  }

  async restartActiveHost(): Promise<void> {
    await this.restartHost(this.activeHostId);
  }

  async restartHost(hostId: string): Promise<void> {
    await this.getController(this.getHostRecordById(hostId)).restart();
  }

  async switchHost(hostId: string): Promise<void> {
    if (!this.config.hosts.some((host) => host.id === hostId)) {
      throw new Error(`Unknown desktop host: ${hostId}`);
    }

    if (hostId === this.activeHostId) {
      return;
    }

    const nextController = this.getController(this.getHostRecordById(hostId));
    await nextController.ensureRunning();
    await this.getActiveHostController().dispose();
    this.activeHostId = hostId;
  }

  async switchRelativeHost(direction: -1 | 1): Promise<DesktopHostRecord> {
    const hostIds = this.config.hosts.map((host) => host.id);
    const currentIndex = hostIds.indexOf(this.activeHostId);
    if (currentIndex === -1 || hostIds.length === 0) {
      throw new Error(`Unknown desktop host: ${this.activeHostId}`);
    }

    const nextIndex = (currentIndex + direction + hostIds.length) % hostIds.length;
    await this.switchHost(hostIds[nextIndex]);
    return this.getActiveHostRecord();
  }

  async saveHost(record: DesktopHostRecord): Promise<void> {
    if (record.kind === 'local') {
      throw new Error('The local desktop host is managed automatically and cannot be edited here.');
    }

    const existing = this.config.hosts.find((host) => host.id === record.id);
    const nextDefaultHostId = record.autoConnect
      ? record.id
      : this.config.defaultHostId === record.id
        ? 'local'
        : this.config.defaultHostId;
    const nextHosts = existing
      ? this.config.hosts.map((host) => {
          if (host.id === record.id) {
            return record;
          }

          if (host.kind === 'local') {
            return host;
          }

          return {
            ...host,
            autoConnect: record.autoConnect ? false : host.autoConnect,
          };
        })
      : [
          ...this.config.hosts.map((host) => host.kind === 'local' ? host : {
            ...host,
            autoConnect: record.autoConnect ? false : host.autoConnect,
          }),
          record,
        ];

    this.config = {
      ...this.config,
      defaultHostId: nextDefaultHostId,
      hosts: nextHosts,
    };

    if (existing) {
      if (
        existing.kind === 'web'
        && (
          record.kind !== 'web'
          || existing.baseUrl.trim() !== record.baseUrl.trim()
        )
      ) {
        clearDesktopRemoteHostAuth(record.id);
      }
      await this.disposeController(record.id);
    }

    saveDesktopConfig(this.config);
  }

  async deleteHost(hostId: string): Promise<void> {
    if (hostId === 'local') {
      throw new Error('The local desktop host cannot be deleted.');
    }

    const existing = this.config.hosts.find((host) => host.id === hostId);
    if (!existing) {
      return;
    }

    if (this.activeHostId === hostId) {
      await this.getActiveHostController().dispose();
      this.activeHostId = 'local';
    } else {
      await this.disposeController(hostId);
    }

    this.config = {
      ...this.config,
      defaultHostId: this.activeHostId,
      hosts: this.config.hosts.filter((host) => host.id !== hostId),
    };
    clearDesktopRemoteHostAuth(hostId);
    saveDesktopConfig(this.config);
  }

  readHostAuthState(hostId: string) {
    const record = this.getHostRecordById(hostId);
    if (record.kind !== 'web') {
      return {
        hostId: record.id,
        hasBearerToken: false,
      };
    }

    return readDesktopRemoteHostAuthState(record.id);
  }

  async pairHost(hostId: string, input: { code: string; deviceLabel?: string }): Promise<ReturnType<HostManager['readHostAuthState']>> {
    const record = this.getHostRecordById(hostId);
    if (record.kind !== 'web') {
      throw new Error('Only direct web hosts support bearer-token pairing.');
    }

    const baseUrl = new URL('/api/remote-access/device-token', record.baseUrl).toString();
    const response = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: input.code,
        ...(typeof input.deviceLabel === 'string' && input.deviceLabel.trim().length > 0
          ? { deviceLabel: input.deviceLabel.trim() }
          : {}),
      }),
    });

    let payload: {
      error?: string;
      bearerToken?: string;
      session?: { id?: string; deviceLabel?: string; createdAt?: string; expiresAt?: string };
    } | null = null;
    try {
      payload = await response.json() as {
        error?: string;
        bearerToken?: string;
        session?: { id?: string; deviceLabel?: string; createdAt?: string; expiresAt?: string };
      };
    } catch {
      payload = null;
    }

    if (!response.ok) {
      throw new Error(payload?.error?.trim() || `${response.status} ${response.statusText}`);
    }

    const bearerToken = payload?.bearerToken?.trim() ?? '';
    if (!bearerToken) {
      throw new Error('Remote host pairing did not return a bearer token.');
    }

    writeDesktopRemoteHostAuth({
      hostId: record.id,
      bearerToken,
      session: payload?.session,
    });
    await this.disposeController(record.id);
    return this.readHostAuthState(record.id);
  }

  async clearHostAuth(hostId: string): Promise<ReturnType<HostManager['readHostAuthState']>> {
    const record = this.getHostRecordById(hostId);
    await this.disposeController(record.id);
    return clearDesktopRemoteHostAuth(record.id);
  }

  getActiveHostRecord(): DesktopHostRecord {
    return this.getHostRecordById(this.activeHostId);
  }

  getHostRecord(hostId: string): DesktopHostRecord {
    return this.getHostRecordById(hostId);
  }

  getActiveHostController(): HostController {
    return this.getController(this.getActiveHostRecord());
  }

  getHostController(hostId: string): HostController {
    return this.getController(this.getHostRecordById(hostId));
  }

  getConnectionsState(): DesktopConnectionsState {
    return {
      activeHostId: this.activeHostId,
      defaultHostId: this.config.defaultHostId,
      hosts: this.config.hosts,
    };
  }

  async getDesktopEnvironment(): Promise<DesktopEnvironmentState> {
    return this.getDesktopEnvironmentForHost(this.activeHostId);
  }

  async getDesktopEnvironmentForHost(hostId: string): Promise<DesktopEnvironmentState> {
    const controller = this.getHostController(hostId);
    const status = await controller.getStatus();
    return {
      isElectron: true,
      activeHostId: controller.id,
      activeHostLabel: controller.label,
      activeHostKind: controller.kind,
      activeHostSummary: status.summary,
      canManageConnections: true,
    };
  }

  async dispose(): Promise<void> {
    await Promise.all([...this.controllers.values()].map((controller) => controller.dispose()));
  }

  private getHostRecordById(hostId: string): DesktopHostRecord {
    const record = this.config.hosts.find((host) => host.id === hostId);
    if (!record) {
      throw new Error(`Unknown desktop host: ${hostId}`);
    }

    return record;
  }

  private async disposeController(hostId: string): Promise<void> {
    const controller = this.controllers.get(hostId);
    if (!controller) {
      return;
    }

    await controller.dispose();
    this.controllers.delete(hostId);
  }

  private getController(record: DesktopHostRecord): HostController {
    const existing = this.controllers.get(record.id);
    if (existing) {
      return existing;
    }

    let controller: HostController;
    if (record.kind === 'local') {
      controller = new LocalHostController(record);
    } else if (record.kind === 'ssh') {
      controller = new SshHostController(record);
    } else {
      controller = new WebHostController(record);
    }

    this.controllers.set(record.id, controller);
    return controller;
  }
}

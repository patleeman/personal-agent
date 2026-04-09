import { loadDesktopConfig, saveDesktopConfig } from '../state/desktop-config.js';
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

  async ensureActiveHostRunning(): Promise<void> {
    const controller = this.getActiveHostController();
    await controller.ensureRunning();
  }

  async getActiveHostBaseUrl(): Promise<string> {
    return this.getActiveHostController().getBaseUrl();
  }

  async openNewConversation(): Promise<string> {
    return this.getActiveHostController().openNewConversation();
  }

  async restartActiveHost(): Promise<void> {
    await this.getActiveHostController().restart();
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
    this.config = {
      ...this.config,
      defaultHostId: hostId,
    };
    saveDesktopConfig(this.config);
  }

  async saveHost(record: DesktopHostRecord): Promise<void> {
    if (record.kind === 'local') {
      throw new Error('The local desktop host is managed automatically and cannot be edited here.');
    }

    const existing = this.config.hosts.find((host) => host.id === record.id);
    this.config = {
      ...this.config,
      defaultHostId: record.autoConnect ? record.id : this.config.defaultHostId,
      hosts: existing
        ? this.config.hosts.map((host) => (host.id === record.id ? record : host))
        : [...this.config.hosts, record],
    };

    if (existing) {
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
    saveDesktopConfig(this.config);
  }

  getActiveHostRecord(): DesktopHostRecord {
    return this.getHostRecordById(this.activeHostId);
  }

  getActiveHostController(): HostController {
    return this.getController(this.getActiveHostRecord());
  }

  getConnectionsState(): DesktopConnectionsState {
    return {
      activeHostId: this.activeHostId,
      defaultHostId: this.config.defaultHostId,
      hosts: this.config.hosts,
    };
  }

  async getDesktopEnvironment(): Promise<DesktopEnvironmentState> {
    const controller = this.getActiveHostController();
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

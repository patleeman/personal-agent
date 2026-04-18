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
import { resolveDesktopLaunchPresentation } from '../launch-mode.js';

export class HostManager {
  private config: DesktopConfig;
  private controllers = new Map<string, HostController>();

  constructor() {
    this.config = loadDesktopConfig();
  }

  getConfig(): DesktopConfig {
    return this.config;
  }

  getActiveHostId(): string {
    return 'local';
  }

  async ensureActiveHostRunning(): Promise<void> {
    await this.ensureHostRunning('local');
  }

  async ensureHostRunning(hostId: string): Promise<void> {
    await this.getHostController(hostId).ensureRunning();
  }

  async getActiveHostBaseUrl(): Promise<string> {
    return this.getHostBaseUrl('local');
  }

  async getHostBaseUrl(hostId: string): Promise<string> {
    return this.getHostController(hostId).getBaseUrl();
  }

  async openNewConversation(): Promise<string> {
    return this.getActiveHostController().openNewConversation();
  }

  async openNewConversationForHost(hostId: string): Promise<string> {
    return this.getHostController(hostId).openNewConversation();
  }

  async restartActiveHost(): Promise<void> {
    await this.getActiveHostController().restart();
  }

  async restartHost(hostId: string): Promise<void> {
    await this.getHostController(hostId).restart();
  }

  async saveHost(record: DesktopHostRecord): Promise<void> {
    if (record.kind !== 'ssh') {
      throw new Error('Only SSH remotes can be saved here.');
    }

    const existing = this.config.hosts.find((host) => host.id === record.id);
    this.config = {
      ...this.config,
      hosts: existing
        ? this.config.hosts.map((host) => host.id === record.id ? record : host)
        : [...this.config.hosts, record],
    };

    if (existing) {
      await this.disposeController(record.id);
    }

    saveDesktopConfig(this.config);
    this.config = loadDesktopConfig();
  }

  async deleteHost(hostId: string): Promise<void> {
    const existing = this.config.hosts.find((host) => host.id === hostId);
    if (!existing) {
      return;
    }

    await this.disposeController(hostId);
    this.config = {
      ...this.config,
      hosts: this.config.hosts.filter((host) => host.id !== hostId),
    };
    saveDesktopConfig(this.config);
    this.config = loadDesktopConfig();
  }

  getHostRecord(hostId: string): DesktopHostRecord {
    if (hostId === 'local') {
      return { id: 'local', label: 'Local', kind: 'local' };
    }

    const record = this.config.hosts.find((host) => host.id === hostId);
    if (!record) {
      throw new Error(`Unknown desktop host: ${hostId}`);
    }

    return record;
  }

  getActiveHostRecord(): DesktopHostRecord {
    return this.getHostRecord('local');
  }

  getActiveHostController(): HostController {
    return this.getHostController('local');
  }

  getHostController(hostId: string): HostController {
    const existing = this.controllers.get(hostId);
    if (existing) {
      return existing;
    }

    const record = this.getHostRecord(hostId);
    const controller = record.kind === 'local'
      ? new LocalHostController(record)
      : new SshHostController(record);
    this.controllers.set(hostId, controller);
    return controller;
  }

  getConnectionsState(): DesktopConnectionsState {
    return {
      hosts: this.config.hosts.filter((host): host is Extract<DesktopHostRecord, { kind: 'ssh' }> => host.kind === 'ssh'),
    };
  }

  async getDesktopEnvironment(): Promise<DesktopEnvironmentState> {
    const controller = this.getActiveHostController();
    const status = await controller.getStatus();
    const launchPresentation = resolveDesktopLaunchPresentation();
    return {
      isElectron: true,
      activeHostId: 'local',
      activeHostLabel: 'Local',
      activeHostKind: 'local',
      activeHostSummary: status.summary,
      launchMode: launchPresentation.mode,
      launchLabel: launchPresentation.launchLabel,
    };
  }

  async getDesktopEnvironmentForHost(_hostId: string): Promise<DesktopEnvironmentState> {
    return this.getDesktopEnvironment();
  }

  async dispose(): Promise<void> {
    await Promise.all([...this.controllers.values()].map((controller) => controller.dispose()));
  }

  private async disposeController(hostId: string): Promise<void> {
    const controller = this.controllers.get(hostId);
    if (!controller) {
      return;
    }

    await controller.dispose();
    this.controllers.delete(hostId);
  }
}

import { resolveDesktopLaunchPresentation } from '../launch-mode.js';
import { loadDesktopConfig } from '../state/desktop-config.js';
import { LocalHostController } from './local-host-controller.js';
import type { DesktopConfig, DesktopEnvironmentState, DesktopHostRecord, HostController } from './types.js';

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

  getHostRecord(hostId: string): DesktopHostRecord {
    if (hostId === 'local') {
      return { id: 'local', label: 'Local', kind: 'local' };
    }

    throw new Error(`Unknown desktop host: ${hostId}`);
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
    const controller = new LocalHostController(record);
    this.controllers.set(hostId, controller);
    return controller;
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
}

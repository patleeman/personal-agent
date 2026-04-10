import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { LocalBackendProcesses } from '../backend/local-backend-processes.js';
import type {
  ConversationBootstrapRequest,
  DesktopHostRecord,
  HostController,
  HostStatus,
} from './types.js';

interface ConversationBootstrapModule {
  readConversationBootstrapState(input: {
    conversationId: string;
    profile: string;
    tailBlocks?: number;
    knownSessionSignature?: string;
    knownBlockOffset?: number;
    knownTotalBlocks?: number;
    knownLastBlockId?: string;
  }): Promise<{
    state: {
      sessionDetail: unknown | null;
      sessionDetailUnchanged?: boolean;
      sessionDetailAppendOnly?: unknown;
      liveSession: { live: boolean };
    };
  }>;
  isMissingConversationBootstrapState(state: {
    sessionDetail: unknown | null;
    sessionDetailUnchanged?: boolean;
    sessionDetailAppendOnly?: unknown;
    liveSession: { live: boolean };
  }): boolean;
}

let conversationBootstrapModulePromise: Promise<ConversationBootstrapModule> | null = null;

function getCurrentDesktopProfile(): string {
  return process.env.PERSONAL_AGENT_ACTIVE_PROFILE?.trim()
    || process.env.PERSONAL_AGENT_PROFILE?.trim()
    || 'assistant';
}

function loadConversationBootstrapModule(): Promise<ConversationBootstrapModule> {
  if (!conversationBootstrapModulePromise) {
    const currentDir = dirname(fileURLToPath(import.meta.url));
    const moduleUrl = pathToFileURL(resolve(currentDir, '../../../web/dist-server/conversations/conversationBootstrap.js')).href;
    conversationBootstrapModulePromise = import(moduleUrl) as Promise<ConversationBootstrapModule>;
  }

  return conversationBootstrapModulePromise;
}

export class LocalHostController implements HostController {
  readonly id: string;
  readonly label: string;
  readonly kind = 'local' as const;

  constructor(
    record: Extract<DesktopHostRecord, { kind: 'local' }>,
    private readonly backend = new LocalBackendProcesses(),
  ) {
    this.id = record.id;
    this.label = record.label;
  }

  async ensureRunning(): Promise<void> {
    await this.backend.ensureStarted();
  }

  async getBaseUrl(): Promise<string> {
    return this.backend.ensureStarted();
  }

  async getStatus(): Promise<HostStatus> {
    const status = await this.backend.getStatus();
    return {
      reachable: status.daemonHealthy && status.webHealthy,
      mode: 'local-child-process',
      summary: status.daemonHealthy && status.webHealthy ? 'Local backend is healthy.' : 'Local backend is starting or unavailable.',
      webUrl: status.baseUrl,
      daemonHealthy: status.daemonHealthy,
      webHealthy: status.webHealthy,
    };
  }

  async openNewConversation(): Promise<string> {
    const baseUrl = await this.getBaseUrl();
    return new URL('/conversations/new', baseUrl).toString();
  }

  async readConversationBootstrap(conversationId: string, options?: ConversationBootstrapRequest): Promise<unknown> {
    const module = await loadConversationBootstrapModule();
    const result = await module.readConversationBootstrapState({
      conversationId,
      profile: getCurrentDesktopProfile(),
      ...options,
    });

    if (module.isMissingConversationBootstrapState(result.state)) {
      throw new Error('Conversation not found');
    }

    return result.state;
  }

  async restart(): Promise<void> {
    await this.backend.restart();
  }

  async stop(): Promise<void> {
    await this.backend.stop();
  }

  async dispose(): Promise<void> {
    await this.stop();
  }
}

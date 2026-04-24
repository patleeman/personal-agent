import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import type {
  CompanionAttachmentAssetInput,
  CompanionAttachmentCreateInput,
  CompanionAttachmentUpdateInput,
  CompanionBinaryAsset,
  CompanionConversationAbortInput,
  CompanionConversationBlockImageInput,
  CompanionConversationBootstrapInput,
  CompanionConversationCheckpointCreateInput,
  CompanionConversationCreateInput,
  CompanionConversationCwdChangeInput,
  CompanionConversationDuplicateInput,
  CompanionConversationExecutionTargetChangeInput,
  CompanionConversationModelPreferencesUpdateInput,
  CompanionConversationParallelJobInput,
  CompanionConversationPromptInput,
  CompanionConversationQueueRestoreInput,
  CompanionConversationRenameInput,
  CompanionConversationResumeInput,
  CompanionConversationSubscriptionInput,
  CompanionConversationTabsUpdateInput,
  CompanionConversationTakeoverInput,
  CompanionDurableRunLogInput,
  CompanionKnowledgeImportInput,
  CompanionRemoteDirectoryInput,
  CompanionRuntime,
  CompanionScheduledTaskInput,
  CompanionScheduledTaskUpdateInput,
  CompanionSshTargetSaveInput,
  CompanionSshTargetTestInput,
  CompanionSurfaceType,
} from '@personal-agent/daemon';
import type { DesktopApiStreamEvent } from '../hosts/types.js';
import type { HostManager } from '../hosts/host-manager.js';
import { parseApiDispatchResult, readApiDispatchError } from '../hosts/api-dispatch.js';
import { continueConversationInHost, dispatchConversationExecutionRequest, subscribeConversationExecutionApiStream } from '../conversation-execution.js';

function toQuery(params: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === 'string' && value.length > 0) {
      search.set(key, value);
    }
  }
  const query = search.toString();
  return query.length > 0 ? `?${query}` : '';
}

function toInternalSurfaceType(surfaceType: CompanionSurfaceType | undefined): 'desktop_web' | 'mobile_web' | undefined {
  if (surfaceType === 'desktop_ui') {
    return 'desktop_web';
  }

  if (surfaceType === 'ios_native') {
    return 'mobile_web';
  }

  return undefined;
}

async function dispatchDesktopApi(
  hostManager: HostManager,
  input: {
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    path: string;
    body?: unknown;
    headers?: Record<string, string>;
  },
) {
  const targeted = await dispatchConversationExecutionRequest(hostManager, input);
  if (targeted) {
    return targeted;
  }

  return hostManager.getHostController('local').dispatchApiRequest(input);
}

async function invokeDesktopApi<T = unknown>(
  hostManager: HostManager,
  input: {
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    path: string;
    body?: unknown;
    headers?: Record<string, string>;
  },
): Promise<T> {
  const response = await dispatchDesktopApi(hostManager, input);
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(readApiDispatchError(response));
  }

  return parseApiDispatchResult<T>(response);
}

async function subscribeDesktopApiStream(
  hostManager: HostManager,
  path: string,
  onEvent: (event: DesktopApiStreamEvent) => void,
): Promise<() => void> {
  const targeted = await subscribeConversationExecutionApiStream(hostManager, path, onEvent);
  if (targeted) {
    return targeted;
  }

  return hostManager.getHostController('local').subscribeApiStream(path, onEvent);
}

const DEFAULT_COMPANION_TAIL_BLOCKS = 120;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseDataUrlAsset(input: unknown): CompanionBinaryAsset {
  const candidate = input && typeof input === 'object'
    ? input as { dataUrl?: unknown; mimeType?: unknown; fileName?: unknown }
    : {};
  const dataUrl = typeof candidate.dataUrl === 'string' ? candidate.dataUrl.trim() : '';
  const mimeType = typeof candidate.mimeType === 'string' && candidate.mimeType.trim().length > 0
    ? candidate.mimeType.trim()
    : 'application/octet-stream';
  const fileName = typeof candidate.fileName === 'string' && candidate.fileName.trim().length > 0
    ? candidate.fileName.trim()
    : undefined;

  const match = /^data:([^;,]+)?(?:;charset=[^;,]+)?;base64,(.*)$/i.exec(dataUrl);
  if (!match) {
    throw new Error('Attachment asset payload is malformed.');
  }

  return {
    data: Buffer.from(match[2] || '', 'base64'),
    mimeType,
    ...(fileName ? { fileName } : {}),
    disposition: mimeType.startsWith('image/') ? 'inline' : 'attachment',
  };
}

function buildCompanionConversationBlockImagePath(conversationId: string, blockId: string, imageIndex?: number): string {
  const encodedConversationId = encodeURIComponent(conversationId);
  const encodedBlockId = encodeURIComponent(blockId);
  return typeof imageIndex === 'number'
    ? `/companion/v1/conversations/${encodedConversationId}/blocks/${encodedBlockId}/images/${String(imageIndex)}`
    : `/companion/v1/conversations/${encodedConversationId}/blocks/${encodedBlockId}/image`;
}

function normalizeConversationBlockForCompanion(conversationId: string, block: unknown): unknown {
  if (!isRecord(block)) {
    return block;
  }

  const blockType = typeof block.type === 'string' ? block.type : '';
  const blockId = typeof block.id === 'string' ? block.id.trim() : '';

  if (blockType === 'user' && Array.isArray(block.images) && blockId) {
    return {
      ...block,
      images: block.images.map((image, imageIndex) => isRecord(image)
        ? { ...image, src: buildCompanionConversationBlockImagePath(conversationId, blockId, imageIndex) }
        : image),
    };
  }

  if (blockType === 'image' && blockId) {
    return {
      ...block,
      src: buildCompanionConversationBlockImagePath(conversationId, blockId),
    };
  }

  return block;
}

function normalizeConversationBlocksForCompanion(conversationId: string, blocks: unknown): unknown {
  if (!Array.isArray(blocks)) {
    return blocks;
  }

  return blocks.map((block) => normalizeConversationBlockForCompanion(conversationId, block));
}

function normalizeConversationBootstrapForCompanion(conversationId: string, envelope: unknown): unknown {
  if (!isRecord(envelope) || !isRecord(envelope.bootstrap)) {
    return envelope;
  }

  const bootstrap = envelope.bootstrap;
  const sessionDetail = isRecord(bootstrap.sessionDetail)
    ? {
        ...bootstrap.sessionDetail,
        blocks: normalizeConversationBlocksForCompanion(conversationId, bootstrap.sessionDetail.blocks),
      }
    : bootstrap.sessionDetail;
  const sessionDetailAppendOnly = isRecord(bootstrap.sessionDetailAppendOnly)
    ? {
        ...bootstrap.sessionDetailAppendOnly,
        blocks: normalizeConversationBlocksForCompanion(conversationId, bootstrap.sessionDetailAppendOnly.blocks),
      }
    : bootstrap.sessionDetailAppendOnly;

  return {
    ...envelope,
    bootstrap: {
      ...bootstrap,
      sessionDetail,
      sessionDetailAppendOnly,
    },
  };
}

function normalizeConversationEventForCompanion(conversationId: string, event: unknown): unknown {
  if (!isRecord(event)) {
    return event;
  }

  if (event.type === 'snapshot') {
    return {
      ...event,
      blocks: normalizeConversationBlocksForCompanion(conversationId, event.blocks),
    };
  }

  if (event.type === 'user_message' && isRecord(event.block)) {
    return {
      ...event,
      block: normalizeConversationBlockForCompanion(conversationId, event.block),
    };
  }

  return event;
}

function buildExecutionTargets(hostManager: HostManager) {
  const connections = hostManager.getConnectionsState();
  return [
    { id: 'local', label: 'Local', kind: 'local' as const },
    ...connections.hosts.map((host) => ({
      id: host.id,
      label: host.label,
      kind: 'ssh' as const,
    })),
  ];
}

async function buildConversationListState(hostManager: HostManager) {
  const localController = hostManager.getHostController('local');
  const [sessions, ordering] = await Promise.all([
    localController.readSessions?.() ?? Promise.resolve([]),
    localController.readOpenConversationTabs?.() ?? Promise.resolve({
      sessionIds: [],
      pinnedSessionIds: [],
      archivedSessionIds: [],
      workspacePaths: [],
    }),
  ]);

  return {
    sessions,
    ordering,
    executionTargets: buildExecutionTargets(hostManager),
  };
}

async function restoreConversationToSharedLayout(
  localController: Pick<ReturnType<HostManager['getHostController']>, 'readOpenConversationTabs' | 'updateOpenConversationTabs'>,
  conversationId: string,
): Promise<void> {
  const currentLayout = await localController.readOpenConversationTabs?.().catch(() => null);
  if (!localController.updateOpenConversationTabs || !isRecord(currentLayout)) {
    return;
  }

  const sessionIds = Array.isArray(currentLayout.sessionIds) ? currentLayout.sessionIds.filter((id): id is string => typeof id === 'string') : [];
  const pinnedSessionIds = Array.isArray(currentLayout.pinnedSessionIds) ? currentLayout.pinnedSessionIds.filter((id): id is string => typeof id === 'string') : [];
  const archivedSessionIds = Array.isArray(currentLayout.archivedSessionIds) ? currentLayout.archivedSessionIds.filter((id): id is string => typeof id === 'string' && id !== conversationId) : [];
  const workspacePaths = Array.isArray(currentLayout.workspacePaths) ? currentLayout.workspacePaths.filter((path): path is string => typeof path === 'string') : [];

  await localController.updateOpenConversationTabs({
    sessionIds: [conversationId, ...sessionIds.filter((id) => id !== conversationId)],
    pinnedSessionIds,
    archivedSessionIds,
    workspacePaths,
  }).catch(() => undefined);
}

export function createDesktopCompanionRuntime(hostManager: HostManager): CompanionRuntime {
  return {
    async listConversations() {
      return buildConversationListState(hostManager);
    },

    async updateConversationTabs(input: CompanionConversationTabsUpdateInput) {
      const localController = hostManager.getHostController('local');
      if (!localController.updateOpenConversationTabs) {
        throw new Error('Conversation layout updates are unavailable.');
      }

      return localController.updateOpenConversationTabs(input);
    },

    async duplicateConversation(input: CompanionConversationDuplicateInput) {
      return invokeDesktopApi(hostManager, {
        method: 'POST',
        path: `/api/conversations/${encodeURIComponent(input.conversationId)}/duplicate`,
      });
    },

    async listExecutionTargets() {
      return {
        executionTargets: buildExecutionTargets(hostManager),
      };
    },

    async readModels() {
      const localController = hostManager.getHostController('local');
      if (localController.readModels) {
        return localController.readModels();
      }

      return invokeDesktopApi(hostManager, {
        method: 'GET',
        path: '/api/models',
      });
    },

    async listSshTargets() {
      return hostManager.getConnectionsState();
    },

    async saveSshTarget(input: CompanionSshTargetSaveInput) {
      const id = input.id?.trim() || `ssh-${randomUUID().slice(0, 8)}`;
      const record = {
        id,
        label: input.label.trim(),
        kind: 'ssh' as const,
        sshTarget: input.sshTarget.trim(),
      };
      await hostManager.saveHost(record);
      return hostManager.getConnectionsState();
    },

    async deleteSshTarget(targetId: string) {
      await hostManager.deleteHost(targetId);
      return hostManager.getConnectionsState();
    },

    async testSshTarget(input: CompanionSshTargetTestInput) {
      return hostManager.testSshConnection(input);
    },

    async readRemoteDirectory(input: CompanionRemoteDirectoryInput) {
      const controller = hostManager.getHostController(input.executionTargetId);
      if (!controller.readDirectory) {
        throw new Error('Remote directory browsing is unavailable for this execution target.');
      }
      return controller.readDirectory(input.path);
    },

    async readConversationBootstrap(input: CompanionConversationBootstrapInput) {
      const localController = hostManager.getHostController('local');
      const query = toQuery({
        ...(typeof input.tailBlocks === 'number' ? { tailBlocks: String(input.tailBlocks) } : {}),
        ...(input.knownSessionSignature ? { knownSessionSignature: input.knownSessionSignature } : {}),
        ...(typeof input.knownBlockOffset === 'number' ? { knownBlockOffset: String(input.knownBlockOffset) } : {}),
        ...(typeof input.knownTotalBlocks === 'number' ? { knownTotalBlocks: String(input.knownTotalBlocks) } : {}),
        ...(input.knownLastBlockId ? { knownLastBlockId: input.knownLastBlockId } : {}),
      });

      const [bootstrap, sessionMeta, attachments, executionTargets] = await Promise.all([
        invokeDesktopApi(hostManager, {
          method: 'GET',
          path: `/api/conversations/${encodeURIComponent(input.conversationId)}/bootstrap${query}`,
        }),
        localController.readSessionMeta?.(input.conversationId).catch(() => null) ?? Promise.resolve(null),
        localController.readConversationAttachments?.(input.conversationId).catch(() => null) ?? Promise.resolve(null),
        Promise.resolve(buildExecutionTargets(hostManager)),
      ]);

      return normalizeConversationBootstrapForCompanion(input.conversationId, {
        bootstrap,
        sessionMeta,
        attachments,
        executionTargets,
      });
    },

    async createConversation(input: CompanionConversationCreateInput) {
      const localController = hostManager.getHostController('local');
      if (!localController.createLiveSession) {
        throw new Error('Local conversation creation is unavailable.');
      }

      const created = await localController.createLiveSession({
        cwd: input.cwd,
        ...(input.model !== undefined ? { model: input.model } : {}),
        ...(input.thinkingLevel !== undefined ? { thinkingLevel: input.thinkingLevel } : {}),
        ...(input.serviceTier !== undefined ? { serviceTier: input.serviceTier } : {}),
      });

      const conversationId = created.id;
      if (input.executionTargetId && input.executionTargetId !== 'local') {
        await continueConversationInHost(hostManager, {
          conversationId,
          hostId: input.executionTargetId,
        });
      }

      if (input.prompt && (input.prompt.text?.trim() || (input.prompt.images?.length ?? 0) > 0)) {
        await this.promptConversation({
          conversationId,
          text: input.prompt.text,
          behavior: input.prompt.behavior,
          images: input.prompt.images,
          attachmentRefs: input.prompt.attachmentRefs,
          contextMessages: input.prompt.contextMessages,
          surfaceId: input.prompt.surfaceId,
        });
      }

      await restoreConversationToSharedLayout(localController, conversationId);

      return this.readConversationBootstrap({ conversationId, tailBlocks: DEFAULT_COMPANION_TAIL_BLOCKS });
    },

    async resumeConversation(input: CompanionConversationResumeInput) {
      const localController = hostManager.getHostController('local');
      if (!localController.resumeLiveSession) {
        throw new Error('Local conversation resume is unavailable.');
      }

      const resumed = await localController.resumeLiveSession({
        sessionFile: input.sessionFile,
        ...(input.cwd ? { cwd: input.cwd } : {}),
      });

      if (input.executionTargetId && input.executionTargetId !== 'local') {
        await continueConversationInHost(hostManager, {
          conversationId: resumed.id,
          hostId: input.executionTargetId,
        });
      }

      await restoreConversationToSharedLayout(localController, resumed.id);

      return this.readConversationBootstrap({ conversationId: resumed.id, tailBlocks: DEFAULT_COMPANION_TAIL_BLOCKS });
    },

    async promptConversation(input: CompanionConversationPromptInput) {
      return invokeDesktopApi(hostManager, {
        method: 'POST',
        path: `/api/live-sessions/${encodeURIComponent(input.conversationId)}/prompt`,
        body: {
          ...(input.text !== undefined ? { text: input.text } : {}),
          ...(input.behavior ? { behavior: input.behavior } : {}),
          ...(input.images ? { images: input.images } : {}),
          ...(input.attachmentRefs ? { attachmentRefs: input.attachmentRefs } : {}),
          ...(input.contextMessages ? { contextMessages: input.contextMessages } : {}),
          ...(input.surfaceId ? { surfaceId: input.surfaceId } : {}),
        },
      });
    },

    async parallelPromptConversation(input: CompanionConversationPromptInput) {
      const localController = hostManager.getHostController('local');
      if (localController.submitLiveSessionParallelPrompt) {
        return localController.submitLiveSessionParallelPrompt({
          conversationId: input.conversationId,
          ...(input.text !== undefined ? { text: input.text } : {}),
          ...(input.images ? { images: input.images } : {}),
          ...(input.attachmentRefs ? { attachmentRefs: input.attachmentRefs } : {}),
          ...(input.contextMessages ? { contextMessages: input.contextMessages } : {}),
          ...(input.surfaceId ? { surfaceId: input.surfaceId } : {}),
        });
      }

      return invokeDesktopApi(hostManager, {
        method: 'POST',
        path: `/api/live-sessions/${encodeURIComponent(input.conversationId)}/parallel-prompt`,
        body: {
          ...(input.text !== undefined ? { text: input.text } : {}),
          ...(input.images ? { images: input.images } : {}),
          ...(input.attachmentRefs ? { attachmentRefs: input.attachmentRefs } : {}),
          ...(input.contextMessages ? { contextMessages: input.contextMessages } : {}),
          ...(input.surfaceId ? { surfaceId: input.surfaceId } : {}),
        },
      });
    },

    async restoreConversationQueuePrompt(input: CompanionConversationQueueRestoreInput) {
      const localController = hostManager.getHostController('local');
      if (localController.restoreQueuedLiveSessionMessage) {
        return localController.restoreQueuedLiveSessionMessage(input);
      }

      return invokeDesktopApi(hostManager, {
        method: 'POST',
        path: `/api/live-sessions/${encodeURIComponent(input.conversationId)}/dequeue`,
        body: {
          behavior: input.behavior,
          index: input.index,
          ...(input.previewId ? { previewId: input.previewId } : {}),
          ...(input.surfaceId ? { surfaceId: input.surfaceId } : {}),
        },
      });
    },

    async manageConversationParallelJob(input: CompanionConversationParallelJobInput) {
      const localController = hostManager.getHostController('local');
      if (localController.manageLiveSessionParallelJob) {
        return localController.manageLiveSessionParallelJob(input);
      }

      return invokeDesktopApi(hostManager, {
        method: 'POST',
        path: `/api/live-sessions/${encodeURIComponent(input.conversationId)}/parallel-jobs/${encodeURIComponent(input.jobId)}`,
        body: {
          action: input.action,
          ...(input.surfaceId ? { surfaceId: input.surfaceId } : {}),
        },
      });
    },

    async cancelConversationDeferredResume(input: { conversationId: string; resumeId: string }) {
      const localController = hostManager.getHostController('local');
      if (localController.cancelConversationDeferredResume) {
        return localController.cancelConversationDeferredResume(input);
      }

      return invokeDesktopApi(hostManager, {
        method: 'DELETE',
        path: `/api/conversations/${encodeURIComponent(input.conversationId)}/deferred-resumes/${encodeURIComponent(input.resumeId)}`,
      });
    },

    async fireConversationDeferredResume(input: { conversationId: string; resumeId: string }) {
      const localController = hostManager.getHostController('local');
      if (localController.fireConversationDeferredResume) {
        return localController.fireConversationDeferredResume(input);
      }

      return invokeDesktopApi(hostManager, {
        method: 'POST',
        path: `/api/conversations/${encodeURIComponent(input.conversationId)}/deferred-resumes/${encodeURIComponent(input.resumeId)}/fire`,
      });
    },

    async abortConversation(input: CompanionConversationAbortInput) {
      return invokeDesktopApi(hostManager, {
        method: 'POST',
        path: `/api/live-sessions/${encodeURIComponent(input.conversationId)}/abort`,
      });
    },

    async takeOverConversation(input: CompanionConversationTakeoverInput) {
      return invokeDesktopApi(hostManager, {
        method: 'POST',
        path: `/api/live-sessions/${encodeURIComponent(input.conversationId)}/takeover`,
        body: { surfaceId: input.surfaceId },
      });
    },

    async renameConversation(input: CompanionConversationRenameInput) {
      return invokeDesktopApi(hostManager, {
        method: 'PATCH',
        path: `/api/conversations/${encodeURIComponent(input.conversationId)}/title`,
        body: {
          name: input.name,
          ...(input.surfaceId ? { surfaceId: input.surfaceId } : {}),
        },
      });
    },

    async changeConversationCwd(input: CompanionConversationCwdChangeInput) {
      return invokeDesktopApi(hostManager, {
        method: 'POST',
        path: `/api/conversations/${encodeURIComponent(input.conversationId)}/cwd`,
        body: {
          cwd: input.cwd,
          ...(input.surfaceId ? { surfaceId: input.surfaceId } : {}),
        },
      });
    },

    async readConversationAutoMode(conversationId: string) {
      return invokeDesktopApi(hostManager, {
        method: 'GET',
        path: `/api/conversations/${encodeURIComponent(conversationId)}/auto-mode`,
      });
    },

    async updateConversationAutoMode(input: { conversationId: string; enabled: boolean; surfaceId?: string }) {
      return invokeDesktopApi(hostManager, {
        method: 'PATCH',
        path: `/api/conversations/${encodeURIComponent(input.conversationId)}/auto-mode`,
        body: {
          enabled: input.enabled,
          ...(input.surfaceId ? { surfaceId: input.surfaceId } : {}),
        },
      });
    },

    async readConversationModelPreferences(conversationId: string) {
      const localController = hostManager.getHostController('local');
      if (localController.readConversationModelPreferences) {
        return localController.readConversationModelPreferences({ conversationId });
      }

      return invokeDesktopApi(hostManager, {
        method: 'GET',
        path: `/api/conversations/${encodeURIComponent(conversationId)}/model-preferences`,
      });
    },

    async updateConversationModelPreferences(input: CompanionConversationModelPreferencesUpdateInput) {
      const localController = hostManager.getHostController('local');
      if (localController.updateConversationModelPreferences) {
        return localController.updateConversationModelPreferences(input);
      }

      return invokeDesktopApi(hostManager, {
        method: 'PATCH',
        path: `/api/conversations/${encodeURIComponent(input.conversationId)}/model-preferences`,
        body: {
          ...(input.model !== undefined ? { model: input.model } : {}),
          ...(input.thinkingLevel !== undefined ? { thinkingLevel: input.thinkingLevel } : {}),
          ...(input.serviceTier !== undefined ? { serviceTier: input.serviceTier } : {}),
          ...(input.surfaceId ? { surfaceId: input.surfaceId } : {}),
        },
      });
    },

    async createConversationCheckpoint(input: CompanionConversationCheckpointCreateInput) {
      const localController = hostManager.getHostController('local');
      if (!localController.createConversationCheckpoint) {
        throw new Error('Conversation checkpoint creation is unavailable.');
      }
      return localController.createConversationCheckpoint({
        conversationId: input.conversationId,
        message: input.message,
        paths: input.paths,
      });
    },

    async listConversationArtifacts(conversationId: string) {
      const localController = hostManager.getHostController('local');
      if (!localController.readConversationArtifacts) {
        throw new Error('Conversation artifacts are unavailable.');
      }

      return localController.readConversationArtifacts(conversationId);
    },

    async readConversationArtifact(input: { conversationId: string; artifactId: string }) {
      const localController = hostManager.getHostController('local');
      if (!localController.readConversationArtifact) {
        throw new Error('Conversation artifacts are unavailable.');
      }

      return localController.readConversationArtifact(input);
    },

    async listConversationCheckpoints(conversationId: string) {
      const localController = hostManager.getHostController('local');
      if (!localController.readConversationCheckpoints) {
        throw new Error('Conversation checkpoints are unavailable.');
      }

      return localController.readConversationCheckpoints(conversationId);
    },

    async readConversationCheckpoint(input: { conversationId: string; checkpointId: string }) {
      const localController = hostManager.getHostController('local');
      if (!localController.readConversationCheckpoint) {
        throw new Error('Conversation checkpoints are unavailable.');
      }

      return localController.readConversationCheckpoint(input);
    },

    async changeConversationExecutionTarget(input: CompanionConversationExecutionTargetChangeInput) {
      await continueConversationInHost(hostManager, {
        conversationId: input.conversationId,
        hostId: input.executionTargetId,
        ...(input.cwd !== undefined ? { cwd: input.cwd } : {}),
      });
      return this.readConversationBootstrap({ conversationId: input.conversationId, tailBlocks: DEFAULT_COMPANION_TAIL_BLOCKS });
    },

    async readConversationBlockImage(input: CompanionConversationBlockImageInput): Promise<CompanionBinaryAsset> {
      const response = await dispatchDesktopApi(hostManager, {
        method: 'GET',
        path: typeof input.imageIndex === 'number'
          ? `/api/sessions/${encodeURIComponent(input.conversationId)}/blocks/${encodeURIComponent(input.blockId)}/images/${String(input.imageIndex)}`
          : `/api/sessions/${encodeURIComponent(input.conversationId)}/blocks/${encodeURIComponent(input.blockId)}/image`,
      });
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw new Error(readApiDispatchError(response));
      }

      const mimeType = typeof response.headers['content-type'] === 'string' && response.headers['content-type'].trim().length > 0
        ? response.headers['content-type'].trim().split(';')[0] ?? 'application/octet-stream'
        : 'application/octet-stream';

      return {
        data: response.body,
        mimeType,
        disposition: 'inline',
      };
    },

    async listConversationAttachments(conversationId: string) {
      const localController = hostManager.getHostController('local');
      if (!localController.readConversationAttachments) {
        throw new Error('Conversation attachments are unavailable.');
      }

      return localController.readConversationAttachments(conversationId);
    },

    async readConversationAttachment(input: { conversationId: string; attachmentId: string }) {
      const localController = hostManager.getHostController('local');
      if (!localController.readConversationAttachment) {
        throw new Error('Conversation attachment reads are unavailable.');
      }

      return localController.readConversationAttachment(input);
    },

    async createConversationAttachment(input: CompanionAttachmentCreateInput) {
      const localController = hostManager.getHostController('local');
      if (!localController.createConversationAttachment) {
        throw new Error('Conversation attachments are unavailable.');
      }

      return localController.createConversationAttachment(input);
    },

    async updateConversationAttachment(input: CompanionAttachmentUpdateInput) {
      const localController = hostManager.getHostController('local');
      if (!localController.updateConversationAttachment) {
        throw new Error('Conversation attachments are unavailable.');
      }

      return localController.updateConversationAttachment(input);
    },

    async readConversationAttachmentAsset(input: CompanionAttachmentAssetInput): Promise<CompanionBinaryAsset> {
      const localController = hostManager.getHostController('local');
      if (!localController.readConversationAttachmentAsset) {
        throw new Error('Conversation attachment assets are unavailable.');
      }

      return parseDataUrlAsset(await localController.readConversationAttachmentAsset(input));
    },

    async listKnowledgeEntries(directoryId?: string | null) {
      return invokeDesktopApi(hostManager, {
        method: 'GET',
        path: `/api/vault/tree${directoryId ? `?dir=${encodeURIComponent(directoryId)}` : ''}`,
      });
    },

    async searchKnowledge(input: { query?: string | null; limit?: number | null }) {
      const query = input.query?.trim() ?? '';
      const limit = Math.min(50, Math.max(1, Number(input.limit ?? 20) || 20));
      const params = new URLSearchParams({ limit: String(limit) });
      if (query) {
        params.set('q', query);
      }
      return invokeDesktopApi(hostManager, {
        method: 'GET',
        path: `/api/vault/note-search?${params.toString()}`,
      });
    },

    async readKnowledgeFile(fileId: string) {
      return invokeDesktopApi(hostManager, {
        method: 'GET',
        path: `/api/vault/file?id=${encodeURIComponent(fileId)}`,
      });
    },

    async writeKnowledgeFile(input: { fileId: string; content: string }) {
      return invokeDesktopApi(hostManager, {
        method: 'PUT',
        path: '/api/vault/file',
        body: {
          id: input.fileId,
          content: input.content,
        },
      });
    },

    async createKnowledgeFolder(folderId: string) {
      return invokeDesktopApi(hostManager, {
        method: 'POST',
        path: '/api/vault/folder',
        body: {
          id: folderId,
        },
      });
    },

    async renameKnowledgeEntry(input: { id: string; newName: string }) {
      return invokeDesktopApi(hostManager, {
        method: 'POST',
        path: '/api/vault/rename',
        body: input,
      });
    },

    async deleteKnowledgeEntry(id: string) {
      return invokeDesktopApi(hostManager, {
        method: 'DELETE',
        path: `/api/vault/file?id=${encodeURIComponent(id)}`,
      });
    },

    async createKnowledgeImageAsset(input: { fileName?: string | null; mimeType?: string | null; dataBase64: string }) {
      const safeFileName = input.fileName?.trim() || 'image.png';
      const mimeType = input.mimeType?.trim() || 'image/png';
      return invokeDesktopApi(hostManager, {
        method: 'POST',
        path: '/api/vault/image',
        body: {
          filename: safeFileName,
          dataUrl: `data:${mimeType};base64,${input.dataBase64.trim()}`,
        },
      });
    },

    async importKnowledge(input: CompanionKnowledgeImportInput) {
      return invokeDesktopApi(hostManager, {
        method: 'POST',
        path: '/api/vault/share-import',
        body: input,
      });
    },

    async listScheduledTasks() {
      const localController = hostManager.getHostController('local');
      if (!localController.readScheduledTasks) {
        throw new Error('Scheduled tasks are unavailable.');
      }

      return localController.readScheduledTasks();
    },

    async readScheduledTask(taskId: string) {
      const localController = hostManager.getHostController('local');
      if (!localController.readScheduledTaskDetail) {
        throw new Error('Scheduled tasks are unavailable.');
      }

      return localController.readScheduledTaskDetail(taskId);
    },

    async readScheduledTaskLog(taskId: string) {
      const localController = hostManager.getHostController('local');
      if (!localController.readScheduledTaskLog) {
        throw new Error('Scheduled task logs are unavailable.');
      }

      return localController.readScheduledTaskLog(taskId);
    },

    async createScheduledTask(input: CompanionScheduledTaskInput) {
      const localController = hostManager.getHostController('local');
      if (!localController.createScheduledTask) {
        throw new Error('Scheduled tasks are unavailable.');
      }

      return localController.createScheduledTask(input);
    },

    async updateScheduledTask(input: CompanionScheduledTaskUpdateInput) {
      const localController = hostManager.getHostController('local');
      if (!localController.updateScheduledTask) {
        throw new Error('Scheduled tasks are unavailable.');
      }

      return localController.updateScheduledTask(input);
    },

    async deleteScheduledTask(taskId: string) {
      const localController = hostManager.getHostController('local');
      if (!localController.deleteScheduledTask) {
        throw new Error('Scheduled tasks are unavailable.');
      }

      return localController.deleteScheduledTask(taskId);
    },

    async runScheduledTask(taskId: string) {
      const localController = hostManager.getHostController('local');
      if (!localController.runScheduledTask) {
        throw new Error('Scheduled tasks are unavailable.');
      }

      return localController.runScheduledTask(taskId);
    },

    async listDurableRuns() {
      const localController = hostManager.getHostController('local');
      if (!localController.readDurableRuns) {
        throw new Error('Durable runs are unavailable.');
      }

      return localController.readDurableRuns();
    },

    async readDurableRun(runId: string) {
      const localController = hostManager.getHostController('local');
      if (!localController.readDurableRun) {
        throw new Error('Durable runs are unavailable.');
      }

      return localController.readDurableRun(runId);
    },

    async readDurableRunLog(input: CompanionDurableRunLogInput) {
      const localController = hostManager.getHostController('local');
      if (!localController.readDurableRunLog) {
        throw new Error('Durable run logs are unavailable.');
      }

      return localController.readDurableRunLog(input);
    },

    async cancelDurableRun(runId: string) {
      const localController = hostManager.getHostController('local');
      if (!localController.cancelDurableRun) {
        throw new Error('Durable runs are unavailable.');
      }

      return localController.cancelDurableRun(runId);
    },

    async subscribeApp(onEvent: (event: unknown) => void) {
      const localController = hostManager.getHostController('local');
      if (!localController.subscribeDesktopAppEvents) {
        throw new Error('Desktop app event subscriptions are unavailable.');
      }

      onEvent({ type: 'open' });
      return localController.subscribeDesktopAppEvents(async (event) => {
        if (event.type === 'error') {
          onEvent({ type: 'error', message: event.message });
          return;
        }

        if (event.type === 'close') {
          onEvent({ type: 'close' });
          return;
        }

        if (event.type === 'open') {
          onEvent({ type: 'open' });
          return;
        }

        onEvent({
          type: 'conversation_list_changed',
          sourceEvent: event.event,
        });
      });
    },

    async subscribeConversation(input: CompanionConversationSubscriptionInput, onEvent: (event: unknown) => void) {
      const query = toQuery({
        ...(input.surfaceId ? { surfaceId: input.surfaceId } : {}),
        ...(toInternalSurfaceType(input.surfaceType) ? { surfaceType: toInternalSurfaceType(input.surfaceType) } : {}),
        ...(typeof input.tailBlocks === 'number' ? { tailBlocks: String(input.tailBlocks) } : {}),
      });

      return subscribeDesktopApiStream(
        hostManager,
        `/api/live-sessions/${encodeURIComponent(input.conversationId)}/events${query}`,
        (event) => {
          if (event.type === 'message') {
            try {
              const payload = JSON.parse(event.data || 'null') as unknown;
              onEvent(normalizeConversationEventForCompanion(input.conversationId, payload));
            } catch (error) {
              onEvent({ type: 'error', message: error instanceof Error ? error.message : String(error) });
            }
            return;
          }

          if (event.type === 'error') {
            onEvent({ type: 'error', message: event.message });
            return;
          }

          if (event.type === 'close') {
            onEvent({ type: 'close' });
          }
        },
      );
    },
  };
}

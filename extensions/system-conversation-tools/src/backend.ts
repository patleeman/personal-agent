import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import type { ExtensionBackendContext } from '@personal-agent/extensions';
import {
  buildLiveSessionExtensionFactoriesForRuntime,
  buildLiveSessionResourceOptionsForRuntime,
  requestConversationWorkingDirectoryChange,
} from '@personal-agent/extensions/backend/conversations';

import { createAskUserQuestionAgentExtension } from './askUserQuestionAgentExtension.js';
import { createChangeWorkingDirectoryAgentExtension } from './changeWorkingDirectoryAgentExtension.js';
import { createConversationInspectAgentExtension } from './conversationInspectAgentExtension.js';
import { createConversationTitleAgentExtension } from './conversationTitleAgentExtension.js';

type ConversationContextMenuInput = { conversationId?: string; sessionTitle?: string; cwd?: string };

type ActivityTreeStyleInput = {
  items?: Array<{
    id?: string;
    kind?: string;
    metadata?: { conversationId?: unknown };
  }>;
};

const THREAD_COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#a855f7'];
const THREAD_COLOR_STORAGE_PREFIX = 'thread-color:';

export async function duplicateConversation(input: ConversationContextMenuInput, ctx: ExtensionBackendContext) {
  ctx.log.info('context menu: duplicate conversation', {
    conversationId: input.conversationId,
    title: input.sessionTitle,
  });
  return { ok: true, conversationId: input.conversationId };
}

export async function copyWorkingDirectory(input: ConversationContextMenuInput, ctx: ExtensionBackendContext) {
  ctx.log.info('context menu: copy working directory', {
    conversationId: input.conversationId,
    title: input.sessionTitle,
  });
  return { ok: true, cwd: input.cwd };
}

export async function copyConversationId(input: ConversationContextMenuInput, ctx: ExtensionBackendContext) {
  ctx.log.info('context menu: copy conversation id', {
    conversationId: input.conversationId,
    title: input.sessionTitle,
  });
  return { ok: true, conversationId: input.conversationId };
}

export async function copyDeeplink(input: ConversationContextMenuInput, ctx: ExtensionBackendContext) {
  ctx.log.info('context menu: copy deeplink', {
    conversationId: input.conversationId,
    title: input.sessionTitle,
  });
  return { ok: true, conversationId: input.conversationId };
}

export async function cycleThreadColor(input: ConversationContextMenuInput, ctx: ExtensionBackendContext) {
  const conversationId = normalizeConversationId(input.conversationId);
  if (!conversationId) return { ok: false, error: 'conversationId is required' };

  const key = `${THREAD_COLOR_STORAGE_PREFIX}${conversationId}`;
  const current = await ctx.storage.get<string>(key);
  const nextColor = THREAD_COLORS[(THREAD_COLORS.indexOf(current ?? '') + 1) % THREAD_COLORS.length];
  await ctx.storage.put(key, nextColor);
  ctx.ui.invalidate(['sessions']);
  return { ok: true, conversationId, color: nextColor };
}

export async function clearThreadColor(input: ConversationContextMenuInput, ctx: ExtensionBackendContext) {
  const conversationId = normalizeConversationId(input.conversationId);
  if (!conversationId) return { ok: false, error: 'conversationId is required' };

  await ctx.storage.delete(`${THREAD_COLOR_STORAGE_PREFIX}${conversationId}`);
  ctx.ui.invalidate(['sessions']);
  return { ok: true, conversationId };
}

export async function getThreadColorStyles(input: ActivityTreeStyleInput, ctx: ExtensionBackendContext) {
  const conversationIds = [...new Set((input.items ?? []).map((item) => getActivityTreeConversationId(item)).filter(Boolean))];
  const colors = await Promise.all(
    conversationIds.map(
      async (conversationId) => [conversationId, await ctx.storage.get<string>(`${THREAD_COLOR_STORAGE_PREFIX}${conversationId}`)] as const,
    ),
  );
  const colorByConversationId = new Map(colors.filter((entry): entry is readonly [string, string] => Boolean(entry[1])));

  return (input.items ?? [])
    .map((item) => {
      const conversationId = getActivityTreeConversationId(item);
      const color = conversationId ? colorByConversationId.get(conversationId) : null;
      if (!item.id || !color) return null;
      return {
        id: item.id,
        accentColor: color,
        backgroundColor: `color-mix(in srgb, ${color} 12%, transparent)`,
        tooltip: 'Colored thread',
      };
    })
    .filter(Boolean);
}

function getActivityTreeConversationId(item: NonNullable<ActivityTreeStyleInput['items']>[number]): string | null {
  if (typeof item.metadata?.conversationId === 'string' && item.metadata.conversationId.trim()) {
    return item.metadata.conversationId.trim();
  }
  if (item.kind === 'conversation' && typeof item.id === 'string' && item.id.startsWith('conversation:')) {
    return item.id.slice('conversation:'.length);
  }
  return null;
}

function normalizeConversationId(value: string | undefined): string | null {
  const conversationId = value?.trim();
  return conversationId ? conversationId : null;
}

export function createConversationToolsAgentExtension(): (pi: ExtensionAPI) => void {
  return (pi) => {
    createAskUserQuestionAgentExtension()(pi);
    createConversationInspectAgentExtension()(pi);
    createConversationTitleAgentExtension()(pi);
    createChangeWorkingDirectoryAgentExtension({
      requestConversationWorkingDirectoryChange: (input) =>
        requestConversationWorkingDirectoryChange(input, {
          ...buildLiveSessionResourceOptionsForRuntime(),
          extensionFactories: buildLiveSessionExtensionFactoriesForRuntime(),
        }),
    })(pi);
  };
}

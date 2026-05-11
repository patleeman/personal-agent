import type { CompanionRuntime } from '@personal-agent/daemon';
import type { HostManager } from '../hosts/host-manager.js';

/** Minimal companion runtime for task-runner callback delivery. */
export function createDesktopCompanionRuntime(hostManager: HostManager): CompanionRuntime {
  return {
    async createConversation(input) {
      return hostManager.getHostController('local').dispatchApiRequest({
        method: 'POST', path: '/api/live-sessions', body: input,
      } as never);
    },

    async resumeConversation(input) {
      return hostManager.getHostController('local').dispatchApiRequest({
        method: 'POST', path: '/api/live-sessions/resume', body: input,
      } as never);
    },

    async promptConversation(input) {
      return hostManager.getHostController('local').dispatchApiRequest({
        method: 'POST',
        path: `/api/live-sessions/${encodeURIComponent(input.conversationId)}/prompt`,
        body: { text: input.text, behavior: input.behavior ?? 'followUp' },
      } as never);
    },

    async subscribeConversation(input, onEvent) {
      const path = `/api/live-sessions/${encodeURIComponent(input.conversationId)}/events`;
      return hostManager.getHostController('local').subscribeApiStream(path, (event) => {
        if (event.type === 'message') {
          try { onEvent(JSON.parse(event.data || 'null')); } catch { /* ignore */ }
        }
      });
    },

    async readConversationBootstrap(input) {
      const query = input.tailBlocks ? `?tailBlocks=${input.tailBlocks}` : '';
      return hostManager.getHostController('local').dispatchApiRequest({
        method: 'GET',
        path: `/api/conversations/${encodeURIComponent(input.conversationId)}/bootstrap${query}`,
      } as never);
    },

    async abortConversation(input) {
      return hostManager.getHostController('local').dispatchApiRequest({
        method: 'POST',
        path: `/api/live-sessions/${encodeURIComponent(input.conversationId)}/abort`,
      } as never);
    },

    async updateConversationModelPreferences(input) {
      return hostManager.getHostController('local').dispatchApiRequest({
        method: 'PATCH',
        path: `/api/conversations/${encodeURIComponent(input.conversationId)}/model-preferences`,
        body: { model: input.model, thinkingLevel: input.thinkingLevel, serviceTier: input.serviceTier },
      } as never);
    },
  };
}

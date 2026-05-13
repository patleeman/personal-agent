import type { ExtensionBackendContext } from '@personal-agent/extensions/backend';

import { setExtensionEnabled } from '../../../packages/desktop/server/extensions/extensionRegistry.js';

const ONBOARDING_STATE_KEY = 'onboarding:v1';

interface OnboardingState {
  completed: boolean;
  conversationId?: string;
  completedAt: string;
}

interface EnsureResult {
  created: boolean;
  conversationId?: string;
  skipped?: string;
}

const ensureInFlightByProfile = new Map<string, Promise<EnsureResult>>();

const onboardingMessage = `Welcome to Personal Agent. This first conversation is here to get you unstuck before the app becomes a very expensive blank text box.

Start here:

1. Open **Settings** and configure your model provider first. PA needs a provider before normal agent conversations can run.
2. PA is extension-based. Most product features live as extensions, including tools, panels, automations, browser features, artifacts, and workflow helpers.
3. Open **Settings → Extensions** to enable, disable, inspect, or manage extensions. System extensions ship with the app; user extensions are where your own workflows belong.
4. After your provider is configured, start a new conversation and ask PA to help with a real task. The app works best when you give it a concrete objective and let it use tools.

Recommended first move: configure your provider, then come back and ask “what can you do in this repo?”`;

function disableOnboarding(ctx: ExtensionBackendContext): void {
  setExtensionEnabled(ctx.extensionId, false);
  ctx.ui.invalidate(['extensions']);
}

async function ensureOnce(ctx: ExtensionBackendContext): Promise<EnsureResult> {
  const existingState = await ctx.storage.get<OnboardingState>(ONBOARDING_STATE_KEY);
  if (existingState?.completed) {
    disableOnboarding(ctx);
    return { created: false, conversationId: existingState.conversationId, skipped: 'completed' };
  }

  const created = (await ctx.conversations.create({ cwd: ctx.runtime.getRepoRoot() })) as { id: string };
  await ctx.conversations.setTitle(created.id, 'Welcome to Personal Agent');
  await ctx.conversations.appendVisibleCustomMessage(created.id, 'onboarding_intro', onboardingMessage, { source: ctx.extensionId });

  await ctx.storage.put(ONBOARDING_STATE_KEY, {
    completed: true,
    conversationId: created.id,
    completedAt: new Date().toISOString(),
  } satisfies OnboardingState);
  disableOnboarding(ctx);

  return { created: true, conversationId: created.id };
}

export async function ensure(_input: unknown, ctx: ExtensionBackendContext): Promise<EnsureResult> {
  const existingTask = ensureInFlightByProfile.get(ctx.profile);
  if (existingTask) {
    return existingTask;
  }

  const task = ensureOnce(ctx).finally(() => {
    if (ensureInFlightByProfile.get(ctx.profile) === task) {
      ensureInFlightByProfile.delete(ctx.profile);
    }
  });
  ensureInFlightByProfile.set(ctx.profile, task);
  return task;
}

import type { ExtensionBackendContext } from '@personal-agent/extensions/backend';

const ONBOARDING_STATE_KEY = 'onboarding:v1';

interface OnboardingState {
  completed: boolean;
  conversationId?: string;
  completedAt: string;
  openedInUi?: boolean;
}

interface EnsureInput {
  source?: string;
}

interface EnsureResult {
  created: boolean;
  conversationId?: string;
  skipped?: string;
  shouldOpen?: boolean;
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
  ctx.extensions.setEnabled(ctx.extensionId, false);
  ctx.ui.invalidate(['extensions']);
}

async function ensureOnce(input: EnsureInput | undefined, ctx: ExtensionBackendContext): Promise<EnsureResult> {
  const frontendRequest = input?.source === 'frontend';
  const existingState = await ctx.storage.get<OnboardingState>(ONBOARDING_STATE_KEY);
  if (existingState?.completed) {
    if (frontendRequest && existingState.conversationId && !existingState.openedInUi) {
      await ctx.storage.put(ONBOARDING_STATE_KEY, {
        ...existingState,
        openedInUi: true,
      } satisfies OnboardingState);
      disableOnboarding(ctx);
      return {
        created: false,
        conversationId: existingState.conversationId,
        skipped: 'completed',
        shouldOpen: true,
      };
    }

    disableOnboarding(ctx);
    return {
      created: false,
      conversationId: existingState.conversationId,
      skipped: 'completed',
      shouldOpen: false,
    };
  }

  const created = (await ctx.conversations.create({ cwd: ctx.runtime.getRepoRoot() })) as { id: string };
  await ctx.conversations.setTitle(created.id, 'Welcome to Personal Agent');
  await ctx.conversations.appendVisibleCustomMessage(created.id, 'onboarding_intro', onboardingMessage, { source: ctx.extensionId });

  await ctx.storage.put(ONBOARDING_STATE_KEY, {
    completed: true,
    conversationId: created.id,
    completedAt: new Date().toISOString(),
    openedInUi: frontendRequest,
  } satisfies OnboardingState);
  disableOnboarding(ctx);

  return { created: true, conversationId: created.id, shouldOpen: frontendRequest };
}

export async function ensure(input: unknown, ctx: ExtensionBackendContext): Promise<EnsureResult> {
  const existingTask = ensureInFlightByProfile.get(ctx.profile);
  if (existingTask) {
    return existingTask;
  }

  const normalizedInput = input && typeof input === 'object' ? (input as EnsureInput) : undefined;
  const task = ensureOnce(normalizedInput, ctx).finally(() => {
    if (ensureInFlightByProfile.get(ctx.profile) === task) {
      ensureInFlightByProfile.delete(ctx.profile);
    }
  });
  ensureInFlightByProfile.set(ctx.profile, task);
  return task;
}

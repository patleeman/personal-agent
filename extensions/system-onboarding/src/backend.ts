import type { ExtensionBackendContext } from '@personal-agent/extensions/backend';

const ONBOARDING_STATE_KEY = 'onboarding:v1';

interface OnboardingState {
  completed: boolean;
  conversationId?: string;
  completedAt: string;
  reason: 'created' | 'existing-conversations';
}

function isSessionList(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

function hasExistingConversations(value: unknown): boolean {
  if (isSessionList(value)) return value.length > 0;
  if (value && typeof value === 'object' && Array.isArray((value as { sessions?: unknown }).sessions)) {
    return (value as { sessions: unknown[] }).sessions.length > 0;
  }
  return false;
}

const onboardingMessage = `Welcome to Personal Agent. This first conversation is here to get you unstuck before the app becomes a very expensive blank text box.

Start here:

1. Open **Settings** and configure your model provider first. PA needs a provider before normal agent conversations can run.
2. PA is extension-based. Most product features live as extensions, including tools, panels, automations, browser features, artifacts, and workflow helpers.
3. Open **Settings → Extensions** to enable, disable, inspect, or manage extensions. System extensions ship with the app; user extensions are where your own workflows belong.
4. After your provider is configured, start a new conversation and ask PA to help with a real task. The app works best when you give it a concrete objective and let it use tools.

Recommended first move: configure your provider, then come back and ask “what can you do in this repo?”`;

export async function ensure(
  _input: unknown,
  ctx: ExtensionBackendContext,
): Promise<{ created: boolean; conversationId?: string; skipped?: string }> {
  const existingState = await ctx.storage.get<OnboardingState>(ONBOARDING_STATE_KEY);
  if (existingState?.completed) {
    return { created: false, conversationId: existingState.conversationId, skipped: 'already-completed' };
  }

  const conversations = await ctx.conversations.list();
  if (hasExistingConversations(conversations)) {
    await ctx.storage.put(ONBOARDING_STATE_KEY, {
      completed: true,
      completedAt: new Date().toISOString(),
      reason: 'existing-conversations',
    } satisfies OnboardingState);
    return { created: false, skipped: 'existing-conversations' };
  }

  const created = (await ctx.conversations.create({ cwd: ctx.runtime.getRepoRoot() })) as { id: string };
  await ctx.conversations.setTitle(created.id, 'Welcome to Personal Agent');
  await ctx.conversations.appendVisibleCustomMessage(created.id, 'onboarding_intro', onboardingMessage, { source: ctx.extensionId });

  await ctx.storage.put(ONBOARDING_STATE_KEY, {
    completed: true,
    conversationId: created.id,
    completedAt: new Date().toISOString(),
    reason: 'created',
  } satisfies OnboardingState);

  return { created: true, conversationId: created.id };
}

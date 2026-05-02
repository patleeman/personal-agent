import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DESKTOP_PROVIDER_OAUTH_EVENT } from './desktopBridge';
import { subscribeDesktopProviderOAuthLogin } from './desktopProviderOAuth';

describe('subscribeDesktopProviderOAuthLogin', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('subscribes through the desktop bridge and forwards matching login state updates', async () => {
    const subscribeProviderOAuthLogin = vi.fn().mockResolvedValue({ subscriptionId: 'oauth-sub-1' });
    const unsubscribeProviderOAuthLogin = vi.fn().mockResolvedValue(undefined);
    const eventTarget = new EventTarget();
    const fakeWindow = {
      personalAgentDesktop: {
        subscribeProviderOAuthLogin,
        unsubscribeProviderOAuthLogin,
      },
      addEventListener: eventTarget.addEventListener.bind(eventTarget),
      removeEventListener: eventTarget.removeEventListener.bind(eventTarget),
      dispatchEvent: eventTarget.dispatchEvent.bind(eventTarget),
    } as unknown as Window & typeof globalThis;

    vi.stubGlobal('window', fakeWindow);
    vi.stubGlobal('CustomEvent', class CustomEvent<T = unknown> extends Event {
      readonly detail: T;

      constructor(type: string, init?: { detail?: T }) {
        super(type);
        this.detail = init?.detail as T;
      }
    });

    const onState = vi.fn();
    const unsubscribe = await subscribeDesktopProviderOAuthLogin('login-1', onState);

    fakeWindow.dispatchEvent(new CustomEvent(DESKTOP_PROVIDER_OAUTH_EVENT, {
      detail: {
        subscriptionId: 'other',
        state: { id: 'login-1', provider: 'openrouter', providerName: 'OpenRouter', status: 'running' },
      },
    }));
    fakeWindow.dispatchEvent(new CustomEvent(DESKTOP_PROVIDER_OAUTH_EVENT, {
      detail: {
        subscriptionId: 'oauth-sub-1',
        state: { id: 'login-1', provider: 'openrouter', providerName: 'OpenRouter', status: 'running' },
      },
    }));

    expect(subscribeProviderOAuthLogin).toHaveBeenCalledWith('login-1');
    expect(onState).toHaveBeenCalledTimes(1);
    expect(onState).toHaveBeenCalledWith({
      id: 'login-1',
      provider: 'openrouter',
      providerName: 'OpenRouter',
      status: 'running',
    });

    unsubscribe();
    expect(unsubscribeProviderOAuthLogin).toHaveBeenCalledWith('oauth-sub-1');
  });
});

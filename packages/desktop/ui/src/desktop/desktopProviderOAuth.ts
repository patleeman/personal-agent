import type { ProviderOAuthLoginState } from '../shared/types';
import { DESKTOP_PROVIDER_OAUTH_EVENT, getDesktopBridge } from './desktopBridge';

interface DesktopProviderOAuthEnvelope {
  subscriptionId: string;
  event: ProviderOAuthLoginState;
}

export async function subscribeDesktopProviderOAuthLogin(
  loginId: string,
  onState: (state: ProviderOAuthLoginState) => void,
): Promise<() => void> {
  const bridge = getDesktopBridge();
  if (!bridge) {
    throw new Error('Desktop provider OAuth subscriptions require the desktop bridge.');
  }

  let subscriptionId: string | null = null;
  let closed = false;

  const handleEvent = (event: Event) => {
    const customEvent = event as CustomEvent<DesktopProviderOAuthEnvelope>;
    const detail = customEvent.detail;
    if (!detail || detail.subscriptionId !== subscriptionId) {
      return;
    }

    onState(detail.event);
  };

  window.addEventListener(DESKTOP_PROVIDER_OAUTH_EVENT, handleEvent as EventListener);

  try {
    const result = await bridge.subscribeProviderOAuthLogin(loginId);
    if (closed) {
      void bridge.unsubscribeProviderOAuthLogin(result.subscriptionId).catch(() => {
        // Ignore best-effort teardown failures after early close.
      });
      return () => {};
    }

    subscriptionId = result.subscriptionId;
  } catch (error) {
    window.removeEventListener(DESKTOP_PROVIDER_OAUTH_EVENT, handleEvent as EventListener);
    throw error;
  }

  return () => {
    if (closed) {
      return;
    }

    closed = true;
    window.removeEventListener(DESKTOP_PROVIDER_OAUTH_EVENT, handleEvent as EventListener);
    if (subscriptionId) {
      void bridge.unsubscribeProviderOAuthLogin(subscriptionId).catch(() => {
        // Ignore best-effort teardown failures.
      });
    }
  };
}

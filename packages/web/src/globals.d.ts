import type { PersonalAgentDesktopBridge } from './desktop/desktopBridge';

declare global {
  interface Window {
    personalAgentDesktop?: PersonalAgentDesktopBridge;
  }
}

export {};

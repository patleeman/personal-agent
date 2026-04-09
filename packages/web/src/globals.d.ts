import type { PersonalAgentDesktopBridge } from './desktopBridge';

declare global {
  interface Window {
    personalAgentDesktop?: PersonalAgentDesktopBridge;
  }
}

export {};

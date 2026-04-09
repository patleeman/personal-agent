import { createContext, useContext } from 'react';

export interface DesktopRightRailControl {
  railOpen: boolean;
  toggleRail: () => void;
}

export interface DesktopChromeContextValue {
  setRightRailControl: (control: DesktopRightRailControl | null) => void;
}

export const DesktopChromeContext = createContext<DesktopChromeContextValue>({
  setRightRailControl: () => {},
});

export function useDesktopChrome() {
  return useContext(DesktopChromeContext);
}

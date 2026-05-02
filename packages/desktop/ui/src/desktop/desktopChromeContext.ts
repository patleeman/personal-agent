import { createContext, useContext } from 'react';

export interface DesktopRightRailControl {
  railOpen: boolean;
  toggleRail: () => void;
}

interface DesktopChromeContextValue {
  setRightRailControl: (control: DesktopRightRailControl | null) => void;
}

export const DesktopChromeContext = createContext<DesktopChromeContextValue>({
  setRightRailControl: () => {},
});

function useDesktopChrome() {
  return useContext(DesktopChromeContext);
}

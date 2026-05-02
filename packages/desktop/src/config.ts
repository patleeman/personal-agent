export type {
  DesktopConfig,
  DesktopConnectionsState,
  DesktopEnvironmentState,
  DesktopHostRecord,
  HostController,
  HostStatus,
} from './hosts/types.js';
export { createDefaultDesktopConfig, loadDesktopConfig, saveDesktopConfig, updateDesktopWindowState } from './state/desktop-config.js';

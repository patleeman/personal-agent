export { WorkbenchBrowserTab } from '../components/workbench/WorkbenchBrowserTab';
export { WorkspaceExplorer, WorkspaceFileDocument } from '../components/workspace/WorkspaceExplorer';
export { getDesktopBridge } from '../desktop/desktopBridge';
export {
  type BrowserTabsState,
  createNewTab,
  getAdjacentTabId,
  getTabSessionKey,
  readBrowserTabsState,
  writeBrowserTabsState,
} from '../local/workbenchBrowserTabs';

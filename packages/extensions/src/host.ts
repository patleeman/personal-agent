export type { ExtensionSurfaceProps } from './index.js';

export type HostComponent = (...args: never[]) => unknown;
export type BrowserTabsState = unknown;
export type MentionItem = unknown;
export type MemoryDocItem = unknown;
export type VaultFileSummary = unknown;

export declare const AppPageIntro: HostComponent;
export declare const AppPageLayout: HostComponent;
export declare const AppPageSection: HostComponent;
export declare const AppPageToc: HostComponent;
export declare const Pill: HostComponent;
export declare const ToolbarButton: HostComponent;
export declare const WorkbenchBrowserTab: HostComponent;
export declare const WorkspaceExplorer: HostComponent;
export declare const WorkspaceFileDocument: HostComponent;
export declare const VaultEditor: HostComponent;
export declare const SettingsPage: HostComponent;
export declare function cx(...values: Array<unknown>): string;
export declare function getDesktopBridge(...args: never[]): unknown;
export declare function navigateKnowledgeFile(...args: never[]): unknown;
export declare function lazyRouteWithRecovery(...args: never[]): unknown;
export declare function createNewTab(...args: never[]): unknown;
export declare function getAdjacentTabId(...args: never[]): unknown;
export declare function getTabSessionKey(...args: never[]): unknown;
export declare function readBrowserTabsState(...args: never[]): unknown;
export declare function writeBrowserTabsState(...args: never[]): unknown;

export type { ExtensionSurfaceProps } from './index.js';

export type HostComponent = (...args: never[]) => unknown;

export declare const AppPageIntro: HostComponent;
export declare const AppPageLayout: HostComponent;
export declare const AppPageSection: HostComponent;
export declare const AppPageToc: HostComponent;
export declare const ErrorState: HostComponent;
export declare const LoadingState: HostComponent;
export declare const Pill: HostComponent;
export declare const ToolbarButton: HostComponent;
export declare function cx(...values: Array<unknown>): string;
export declare function lazyRouteWithRecovery(...args: never[]): unknown;

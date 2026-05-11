export interface ResourceLayer {
    name: string;
    agentDir: string;
}
export interface ResolvedRuntimeResources {
    name: string;
    repoRoot: string;
    vaultRoot: string;
    runtimeConfigRoot: string;
    layers: ResourceLayer[];
    extensionDirs: string[];
    extensionEntries: string[];
    skillDirs: string[];
    promptDirs: string[];
    promptEntries: string[];
    themeDirs: string[];
    themeEntries: string[];
    agentsFiles: string[];
    appendSystemFiles: string[];
    systemPromptFile?: string;
    settingsFiles: string[];
    modelsFiles: string[];
}
export interface ResolveResourceOptions {
    repoRoot?: string;
    vaultRoot?: string;
    localProfileDir?: string;
    runtimeConfigRoot?: string;
}
export type PackageInstallTarget = 'local';
export interface ConfiguredPackageSource {
    source: string;
    filtered: boolean;
}
export interface PackageSourceTargetState {
    target: PackageInstallTarget;
    settingsPath: string;
    packages: ConfiguredPackageSource[];
}
export interface InstallPackageSourceOptions extends ResolveResourceOptions {
    source: string;
    target: PackageInstallTarget;
    sourceBaseDir?: string;
}
export interface InstallPackageSourceResult {
    installed: boolean;
    alreadyPresent: boolean;
    source: string;
    target: PackageInstallTarget;
    settingsPath: string;
}
export declare function resolveLocalProfileDir(options?: ResolveResourceOptions): string;
export declare function resolveLocalProfileSettingsFilePath(options?: ResolveResourceOptions): string;
export declare function resolveRuntimeSettingsFilePath(runtimeScope: string, options?: ResolveResourceOptions): string;
export declare function resolveRuntimeModelsFilePath(runtimeScope: string, options?: ResolveResourceOptions): string;
export declare function readConfiguredPackageSources(settingsPath: string): ConfiguredPackageSource[];
export declare function readPackageSourceTargetState(target: PackageInstallTarget, options?: ResolveResourceOptions): PackageSourceTargetState;
export declare function installPackageSource(options: InstallPackageSourceOptions): InstallPackageSourceResult;
export declare function getRepoRoot(explicitRepoRoot?: string): string;
export declare function getRepoDefaultsAgentDir(explicitRepoRoot?: string): string;
export declare function listRuntimeScopes(options?: ResolveResourceOptions): string[];
export declare function resolveRuntimeResources(name: string, options?: ResolveResourceOptions): ResolvedRuntimeResources;
export declare function mergeJsonFiles(paths: string[]): Record<string, unknown>;
export interface MaterializeRuntimeResourcesResult {
    agentDir: string;
    writtenFiles: string[];
}
export declare function materializeRuntimeResourcesToAgentDir(resources: ResolvedRuntimeResources, agentDir: string): MaterializeRuntimeResourcesResult;
export interface BuildPiArgsOptions {
    includeNoDiscoveryFlags?: boolean;
}
export declare function getExtensionDependencyDirs(resources: ResolvedRuntimeResources): string[];
export declare function buildPiResourceArgs(resources: ResolvedRuntimeResources, options?: BuildPiArgsOptions): string[];
export { getPromptCatalogRoot, readPromptCatalogEntry, renderPromptCatalogTemplate, requirePromptCatalogEntry } from './prompt-catalog.js';

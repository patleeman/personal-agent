interface McpServersDocument {
  mcpServers: Record<string, unknown>;
}
export interface BundledSkillMcpManifest {
  skillName: string;
  skillDir: string;
  manifestPath: string;
  serverNames: string[];
}
export interface BundledMcpConfigBuildResult {
  baseConfigPath: string;
  baseConfigExists: boolean;
  baseServerNames: string[];
  searchedPaths: string[];
  bundledServerCount: number;
  manifestPaths: string[];
  document: McpServersDocument;
}
export declare function readBundledSkillMcpManifests(skillDirs: readonly string[]): BundledSkillMcpManifest[];
export declare function readBundledSkillMcpServers(skillDirs: readonly string[]): {
  servers: Record<string, unknown>;
  manifestPaths: string[];
};
export declare function buildMergedMcpConfigDocument(options: {
  cwd?: string;
  configPath?: string;
  env?: NodeJS.ProcessEnv;
  skillDirs?: readonly string[];
}): BundledMcpConfigBuildResult;
export declare function writeMergedMcpConfigFile(options: {
  outputPath: string;
  cwd?: string;
  configPath?: string;
  env?: NodeJS.ProcessEnv;
  skillDirs?: readonly string[];
}): BundledMcpConfigBuildResult;
export {};

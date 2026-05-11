export interface ResolveMemoryDocsOptions {
  vaultRoot?: string;
}
export interface LegacyMemoryMigrationRecord {
  from: string;
  to: string;
}
export interface LegacyMemoryMigrationResult {
  memoryDir: string;
  migratedFiles: LegacyMemoryMigrationRecord[];
}
export declare function getMemoryDocsDir(options?: ResolveMemoryDocsOptions): string;
export declare function migrateLegacyProfileMemoryDirs(options?: ResolveMemoryDocsOptions): LegacyMemoryMigrationResult;

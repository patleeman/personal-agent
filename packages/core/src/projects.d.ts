export interface ResolveProjectOptions {
  repoRoot?: string;
  profile: string;
}
export interface ProjectPaths {
  repoRoot: string;
  profile: string;
  projectsDir: string;
  projectDir: string;
  projectFile: string;
  documentFile: string;
  tasksDir: string;
  filesDir: string;
  attachmentsDir: string;
  artifactsDir: string;
}
export interface ResolveProjectPathsOptions extends ResolveProjectOptions {
  projectId: string;
}
export interface ResolveProjectTaskPathOptions extends ResolveProjectPathsOptions {
  taskId: string;
}
export interface CreateProjectScaffoldOptions extends ResolveProjectPathsOptions {
  title: string;
  description: string;
  overwrite?: boolean;
  now?: Date;
}
export interface CreateProjectScaffoldResult {
  paths: ProjectPaths;
  writtenFiles: string[];
}
export interface ResolveProjectRepoRootOptions {
  repoRoot?: string;
  projectRepoRoot?: string;
}
export declare function resolveProjectRepoRoot(options: ResolveProjectRepoRootOptions): string | undefined;
export interface ListResolvedProjectRepoRootsOptions extends ResolveProjectOptions {
  projectIds: string[];
}
export declare function listResolvedProjectRepoRoots(options: ListResolvedProjectRepoRootsOptions): string[];
export declare function validateProjectId(projectId: string): void;
export declare function validateTaskId(taskId: string): void;
export declare function resolveProfileProjectsDir(options: ResolveProjectOptions): string;
export declare function resolveProjectPaths(options: ResolveProjectPathsOptions): ProjectPaths;
export declare function listAllProjectIds(_options?: { repoRoot?: string }): string[];
export declare function readProjectOwnerProfile(options: { repoRoot?: string; projectId: string }): string;
export declare function listProjectIds(options: ResolveProjectOptions): string[];
export declare function resolveProjectTaskPath(options: ResolveProjectTaskPathOptions): string;
export declare function createProjectScaffold(options: CreateProjectScaffoldOptions): CreateProjectScaffoldResult;
export declare function projectExists(options: ResolveProjectPathsOptions): boolean;

import { existsSync, mkdirSync, readdirSync, statSync } from 'fs';
import { join, resolve } from 'path';
import {
  createInitialProjectDocument,
  createInitialProjectPlan,
  writeProjectDocument,
  writeProjectPlan,
} from './project-artifacts.js';

const PROFILE_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9-_]*$/;
const PROJECT_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9-_]*$/;
const PROJECT_TASK_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9-_]*$/;

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
  planFile: string;
  tasksDir: string;
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
  objective: string;
  overwrite?: boolean;
  now?: Date;
}

export interface CreateProjectScaffoldResult {
  paths: ProjectPaths;
  writtenFiles: string[];
}

function getRepoRoot(repoRoot?: string): string {
  return resolve(repoRoot ?? process.env.PERSONAL_AGENT_REPO_ROOT ?? process.cwd());
}

function validateProfileName(profile: string): void {
  if (!PROFILE_NAME_PATTERN.test(profile)) {
    throw new Error(
      `Invalid profile name "${profile}". Profile names may only include letters, numbers, dashes, and underscores.`,
    );
  }
}

export function validateProjectId(projectId: string): void {
  if (!PROJECT_ID_PATTERN.test(projectId)) {
    throw new Error(
      `Invalid project id "${projectId}". Project ids may only include letters, numbers, dashes, and underscores.`,
    );
  }
}

export function validateProjectTaskId(taskId: string): void {
  if (!PROJECT_TASK_ID_PATTERN.test(taskId)) {
    throw new Error(
      `Invalid project task id "${taskId}". Project task ids may only include letters, numbers, dashes, and underscores.`,
    );
  }
}

function formatIsoTimestamp(date: Date): string {
  return date.toISOString();
}

export function resolveProfileProjectsDir(options: ResolveProjectOptions): string {
  validateProfileName(options.profile);
  const repoRoot = getRepoRoot(options.repoRoot);
  return join(repoRoot, 'profiles', options.profile, 'agent', 'projects');
}

export function resolveProjectPaths(options: ResolveProjectPathsOptions): ProjectPaths {
  validateProfileName(options.profile);
  validateProjectId(options.projectId);

  const repoRoot = getRepoRoot(options.repoRoot);
  const projectsDir = resolveProfileProjectsDir({
    repoRoot,
    profile: options.profile,
  });
  const projectDir = join(projectsDir, options.projectId);

  return {
    repoRoot,
    profile: options.profile,
    projectsDir,
    projectDir,
    projectFile: join(projectDir, 'project.md'),
    planFile: join(projectDir, 'plan.md'),
    tasksDir: join(projectDir, 'tasks'),
    artifactsDir: join(projectDir, 'artifacts'),
  };
}

export function listProjectIds(options: ResolveProjectOptions): string[] {
  const projectsDir = resolveProfileProjectsDir(options);

  if (!existsSync(projectsDir)) {
    return [];
  }

  const entries = readdirSync(projectsDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && PROJECT_ID_PATTERN.test(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
}

export function resolveProjectTaskFilePath(options: ResolveProjectTaskPathOptions): string {
  const paths = resolveProjectPaths(options);
  validateProjectTaskId(options.taskId);
  return join(paths.tasksDir, `${options.taskId}.md`);
}

export function resolveProjectTaskSummaryFilePath(options: ResolveProjectTaskPathOptions): string {
  const paths = resolveProjectPaths(options);
  validateProjectTaskId(options.taskId);
  return join(paths.tasksDir, `${options.taskId}.summary.md`);
}

export function listProjectTaskIds(options: ResolveProjectPathsOptions): string[] {
  const paths = resolveProjectPaths(options);

  if (!existsSync(paths.tasksDir)) {
    return [];
  }

  return readdirSync(paths.tasksDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md') && !entry.name.endsWith('.summary.md'))
    .map((entry) => entry.name.slice(0, -'.md'.length))
    .filter((taskId) => PROJECT_TASK_ID_PATTERN.test(taskId))
    .sort((left, right) => left.localeCompare(right));
}

function assertProjectCanBeCreated(paths: ProjectPaths, overwrite: boolean): void {
  if (overwrite) {
    return;
  }

  const existingTargets = [paths.projectFile, paths.planFile].filter((path) => existsSync(path));

  if (existingTargets.length > 0) {
    throw new Error(
      `Project already exists at ${paths.projectDir}. Existing files: ${existingTargets.join(', ')}`,
    );
  }

  if (existsSync(paths.projectDir) && readdirSync(paths.projectDir).length > 0) {
    throw new Error(`Project directory already exists and is not empty: ${paths.projectDir}`);
  }
}

export function createProjectScaffold(
  options: CreateProjectScaffoldOptions,
): CreateProjectScaffoldResult {
  const title = options.title.trim();
  const objective = options.objective.trim();

  if (title.length === 0) {
    throw new Error('Project title must not be empty.');
  }

  if (objective.length === 0) {
    throw new Error('Project objective must not be empty.');
  }

  const paths = resolveProjectPaths(options);
  const overwrite = options.overwrite ?? false;
  assertProjectCanBeCreated(paths, overwrite);

  const timestamp = formatIsoTimestamp(options.now ?? new Date());
  const writtenFiles: string[] = [];

  mkdirSync(paths.projectDir, { recursive: true });
  mkdirSync(paths.tasksDir, { recursive: true });
  mkdirSync(paths.artifactsDir, { recursive: true });

  writeProjectDocument(
    paths.projectFile,
    createInitialProjectDocument({
      id: options.projectId,
      title,
      objective,
      createdAt: timestamp,
      updatedAt: timestamp,
    }),
  );
  writtenFiles.push(paths.projectFile);

  writeProjectPlan(
    paths.planFile,
    createInitialProjectPlan({
      id: options.projectId,
      objective,
      updatedAt: timestamp,
    }),
  );
  writtenFiles.push(paths.planFile);

  return {
    paths,
    writtenFiles,
  };
}

export function projectExists(options: ResolveProjectPathsOptions): boolean {
  const paths = resolveProjectPaths(options);
  return existsSync(paths.projectDir) && statSync(paths.projectDir).isDirectory();
}

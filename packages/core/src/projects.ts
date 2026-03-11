import { existsSync, mkdirSync, readdirSync, statSync } from 'fs';
import { join, resolve } from 'path';
import {
  createInitialProject,
  writeProject,
} from './project-artifacts.js';

const PROFILE_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9-_]*$/;
const PROJECT_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9-_]*$/;
const TASK_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9-_]*$/;

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

export function validateTaskId(taskId: string): void {
  if (!TASK_ID_PATTERN.test(taskId)) {
    throw new Error(
      `Invalid task id "${taskId}". Task ids may only include letters, numbers, dashes, and underscores.`,
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
    projectFile: join(projectDir, 'PROJECT.yaml'),
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

export function resolveProjectTaskPath(options: ResolveProjectTaskPathOptions): string {
  const paths = resolveProjectPaths(options);
  validateTaskId(options.taskId);
  return join(paths.tasksDir, `${options.taskId}.yaml`);
}

function assertProjectCanBeCreated(paths: ProjectPaths, overwrite: boolean): void {
  if (overwrite) {
    return;
  }

  if (existsSync(paths.projectFile)) {
    throw new Error(`Project already exists at ${paths.projectDir}. Existing file: ${paths.projectFile}`);
  }

  if (existsSync(paths.projectDir) && readdirSync(paths.projectDir).length > 0) {
    throw new Error(`Project directory already exists and is not empty: ${paths.projectDir}`);
  }
}

export function createProjectScaffold(
  options: CreateProjectScaffoldOptions,
): CreateProjectScaffoldResult {
  const objective = options.objective.trim();

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

  writeProject(
    paths.projectFile,
    createInitialProject({
      id: options.projectId,
      description: objective,
      createdAt: timestamp,
      updatedAt: timestamp,
    }),
  );
  writtenFiles.push(paths.projectFile);

  return {
    paths,
    writtenFiles,
  };
}

export function projectExists(options: ResolveProjectPathsOptions): boolean {
  const paths = resolveProjectPaths(options);
  return existsSync(paths.projectDir) && statSync(paths.projectDir).isDirectory();
}

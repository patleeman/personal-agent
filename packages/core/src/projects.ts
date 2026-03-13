import { existsSync, mkdirSync, readdirSync, statSync } from 'fs';
import { homedir } from 'os';
import { join, resolve } from 'path';
import {
  createInitialProject,
  readProject,
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
  briefFile: string;
  tasksDir: string;
  notesDir: string;
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

function getRepoRoot(repoRoot?: string): string {
  return resolve(repoRoot ?? process.env.PERSONAL_AGENT_REPO_ROOT ?? process.cwd());
}

function expandHome(pathValue: string): string {
  if (pathValue === '~') {
    return homedir();
  }

  if (pathValue.startsWith('~/')) {
    return join(homedir(), pathValue.slice(2));
  }

  return pathValue;
}

export interface ResolveProjectRepoRootOptions {
  repoRoot?: string;
  projectRepoRoot?: string;
}

export function resolveProjectRepoRoot(options: ResolveProjectRepoRootOptions): string | undefined {
  const projectRepoRoot = options.projectRepoRoot?.trim();
  if (!projectRepoRoot) {
    return undefined;
  }

  return resolve(getRepoRoot(options.repoRoot), expandHome(projectRepoRoot));
}

export interface ListResolvedProjectRepoRootsOptions extends ResolveProjectOptions {
  projectIds: string[];
}

export function listResolvedProjectRepoRoots(options: ListResolvedProjectRepoRootsOptions): string[] {
  const resolvedRepoRoots: string[] = [];
  const seen = new Set<string>();

  for (const projectId of options.projectIds) {
    try {
      const project = readProject(resolveProjectPaths({
        repoRoot: options.repoRoot,
        profile: options.profile,
        projectId,
      }).projectFile);
      const projectRepoRoot = resolveProjectRepoRoot({
        repoRoot: options.repoRoot,
        projectRepoRoot: project.repoRoot,
      });

      if (!projectRepoRoot || seen.has(projectRepoRoot)) {
        continue;
      }

      seen.add(projectRepoRoot);
      resolvedRepoRoots.push(projectRepoRoot);
    } catch {
      // Ignore missing or invalid referenced projects when deriving cwd.
    }
  }

  return resolvedRepoRoots;
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
    briefFile: join(projectDir, 'BRIEF.md'),
    tasksDir: join(projectDir, 'tasks'),
    notesDir: join(projectDir, 'notes'),
    attachmentsDir: join(projectDir, 'attachments'),
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
  const title = options.title.trim();
  const description = options.description.trim();

  if (title.length === 0) {
    throw new Error('Project title must not be empty.');
  }

  if (description.length === 0) {
    throw new Error('Project description must not be empty.');
  }

  const paths = resolveProjectPaths(options);
  const overwrite = options.overwrite ?? false;
  assertProjectCanBeCreated(paths, overwrite);

  const timestamp = formatIsoTimestamp(options.now ?? new Date());
  const writtenFiles: string[] = [];

  mkdirSync(paths.projectDir, { recursive: true });
  mkdirSync(paths.tasksDir, { recursive: true });
  mkdirSync(paths.notesDir, { recursive: true });
  mkdirSync(paths.attachmentsDir, { recursive: true });
  mkdirSync(paths.artifactsDir, { recursive: true });

  writeProject(
    paths.projectFile,
    createInitialProject({
      id: options.projectId,
      title,
      description,
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

import { existsSync, mkdirSync, readdirSync, statSync } from 'fs';
import { join, resolve } from 'path';
import {
  createInitialWorkstreamPlan,
  createInitialWorkstreamSummary,
  writeWorkstreamPlan,
  writeWorkstreamSummary,
} from './workstream-artifacts.js';

const PROFILE_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9-_]*$/;
const WORKSTREAM_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9-_]*$/;
const TODO_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9-_]*$/;

export interface ResolveWorkstreamOptions {
  repoRoot?: string;
  profile: string;
}

export interface WorkstreamPaths {
  repoRoot: string;
  profile: string;
  workstreamsDir: string;
  workstreamDir: string;
  summaryFile: string;
  planFile: string;
  todosDir: string;
  artifactsDir: string;
}

export interface ResolveWorkstreamPathsOptions extends ResolveWorkstreamOptions {
  workstreamId: string;
}

export interface ResolveWorkstreamTodoPathOptions extends ResolveWorkstreamPathsOptions {
  todoId: string;
}

export interface CreateWorkstreamScaffoldOptions extends ResolveWorkstreamPathsOptions {
  objective: string;
  overwrite?: boolean;
  now?: Date;
}

export interface CreateWorkstreamScaffoldResult {
  paths: WorkstreamPaths;
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

export function validateWorkstreamId(workstreamId: string): void {
  if (!WORKSTREAM_ID_PATTERN.test(workstreamId)) {
    throw new Error(
      `Invalid workstream id "${workstreamId}". Workstream ids may only include letters, numbers, dashes, and underscores.`,
    );
  }
}

export function validateTodoId(todoId: string): void {
  if (!TODO_ID_PATTERN.test(todoId)) {
    throw new Error(
      `Invalid todo id "${todoId}". Todo ids may only include letters, numbers, dashes, and underscores.`,
    );
  }
}

function formatIsoTimestamp(date: Date): string {
  return date.toISOString();
}

export function resolveProfileWorkstreamsDir(options: ResolveWorkstreamOptions): string {
  validateProfileName(options.profile);
  const repoRoot = getRepoRoot(options.repoRoot);
  return join(repoRoot, 'profiles', options.profile, 'agent', 'workstreams');
}

export function resolveWorkstreamPaths(options: ResolveWorkstreamPathsOptions): WorkstreamPaths {
  validateProfileName(options.profile);
  validateWorkstreamId(options.workstreamId);

  const repoRoot = getRepoRoot(options.repoRoot);
  const workstreamsDir = resolveProfileWorkstreamsDir({
    repoRoot,
    profile: options.profile,
  });
  const workstreamDir = join(workstreamsDir, options.workstreamId);

  return {
    repoRoot,
    profile: options.profile,
    workstreamsDir,
    workstreamDir,
    summaryFile: join(workstreamDir, 'summary.md'),
    planFile: join(workstreamDir, 'plan.md'),
    todosDir: join(workstreamDir, 'todos'),
    artifactsDir: join(workstreamDir, 'artifacts'),
  };
}

export function listWorkstreamIds(options: ResolveWorkstreamOptions): string[] {
  const workstreamsDir = resolveProfileWorkstreamsDir(options);

  if (!existsSync(workstreamsDir)) {
    return [];
  }

  const entries = readdirSync(workstreamsDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && WORKSTREAM_ID_PATTERN.test(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
}

export function resolveWorkstreamTodoPath(options: ResolveWorkstreamTodoPathOptions): string {
  const paths = resolveWorkstreamPaths(options);
  validateTodoId(options.todoId);
  return join(paths.todosDir, `${options.todoId}.md`);
}

function assertWorkstreamCanBeCreated(paths: WorkstreamPaths, overwrite: boolean): void {
  if (overwrite) {
    return;
  }

  const existingTargets = [paths.summaryFile, paths.planFile].filter((path) => existsSync(path));

  if (existingTargets.length > 0) {
    throw new Error(
      `Workstream already exists at ${paths.workstreamDir}. Existing files: ${existingTargets.join(', ')}`,
    );
  }

  if (existsSync(paths.workstreamDir) && readdirSync(paths.workstreamDir).length > 0) {
    throw new Error(`Workstream directory already exists and is not empty: ${paths.workstreamDir}`);
  }
}

export function createWorkstreamScaffold(
  options: CreateWorkstreamScaffoldOptions,
): CreateWorkstreamScaffoldResult {
  const objective = options.objective.trim();

  if (objective.length === 0) {
    throw new Error('Workstream objective must not be empty.');
  }

  const paths = resolveWorkstreamPaths(options);
  const overwrite = options.overwrite ?? false;
  assertWorkstreamCanBeCreated(paths, overwrite);

  const timestamp = formatIsoTimestamp(options.now ?? new Date());
  const writtenFiles: string[] = [];

  mkdirSync(paths.workstreamDir, { recursive: true });
  mkdirSync(paths.todosDir, { recursive: true });
  mkdirSync(paths.artifactsDir, { recursive: true });

  writeWorkstreamSummary(
    paths.summaryFile,
    createInitialWorkstreamSummary({
      id: options.workstreamId,
      objective,
      createdAt: timestamp,
      updatedAt: timestamp,
    }),
  );
  writtenFiles.push(paths.summaryFile);

  writeWorkstreamPlan(
    paths.planFile,
    createInitialWorkstreamPlan({
      id: options.workstreamId,
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

export function workstreamExists(options: ResolveWorkstreamPathsOptions): boolean {
  const paths = resolveWorkstreamPaths(options);
  return existsSync(paths.workstreamDir) && statSync(paths.workstreamDir).isDirectory();
}

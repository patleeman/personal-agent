import { existsSync, mkdirSync, readdirSync, statSync } from 'fs';
import { homedir } from 'os';
import { join, resolve } from 'path';
import {
  createUnifiedNode,
  findUnifiedNodeById,
  loadUnifiedNodes,
  migrateLegacyNodes,
  resolveUnifiedNodesDir,
} from './nodes.js';
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
  documentFile: string;
  tasksDir: string;
  notesDir: string;
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

interface DurableProjectPaths {
  repoRoot: string;
  projectsDir: string;
  projectDir: string;
  projectFile: string;
  documentFile: string;
  tasksDir: string;
  notesDir: string;
  filesDir: string;
  attachmentsDir: string;
  artifactsDir: string;
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

function extractTagValue(tags: string[], key: string): string | undefined {
  return tags
    .map((tag) => tag.match(new RegExp(`^${key}:(.+)$`, 'i'))?.[1]?.trim())
    .find((value): value is string => typeof value === 'string' && value.length > 0);
}

function loadProjectNodes() {
  migrateLegacyNodes();
  return loadUnifiedNodes().nodes.filter((node) => node.kinds.includes('project'));
}

function readProjectNode(projectId: string) {
  return findUnifiedNodeById(loadProjectNodes(), projectId);
}

function readProjectRepoRoot(projectId: string, repoRoot?: string): string | undefined {
  const projectNode = readProjectNode(projectId);
  const taggedRepoRoot = extractTagValue(projectNode.tags, 'cwd');
  if (taggedRepoRoot) {
    return taggedRepoRoot;
  }

  const paths = resolveDurableProjectPaths(repoRoot, projectId);
  if (existsSync(paths.projectFile)) {
    try {
      return readProject(paths.projectFile).repoRoot;
    } catch {
      // Ignore invalid compatibility state when deriving cwd.
    }
  }

  return undefined;
}

export interface ListResolvedProjectRepoRootsOptions extends ResolveProjectOptions {
  projectIds: string[];
}

export function listResolvedProjectRepoRoots(options: ListResolvedProjectRepoRootsOptions): string[] {
  const resolvedRepoRoots: string[] = [];
  const seen = new Set<string>();

  for (const projectId of options.projectIds) {
    try {
      const resolvedProjectRepoRoot = resolveProjectRepoRoot({
        repoRoot: options.repoRoot,
        projectRepoRoot: readProjectRepoRoot(projectId, options.repoRoot),
      });

      if (!resolvedProjectRepoRoot || seen.has(resolvedProjectRepoRoot)) {
        continue;
      }

      seen.add(resolvedProjectRepoRoot);
      resolvedRepoRoots.push(resolvedProjectRepoRoot);
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
  return resolveUnifiedNodesDir();
}

function resolveDurableProjectPaths(repoRoot?: string, projectId?: string): DurableProjectPaths {
  if (projectId) {
    validateProjectId(projectId);
  }

  const normalizedRepoRoot = getRepoRoot(repoRoot);
  const projectsDir = resolveUnifiedNodesDir();
  const projectDir = projectId ? join(projectsDir, projectId) : projectsDir;
  const preferredProjectFile = join(projectDir, 'state.yaml');
  const legacyProjectFile = join(projectDir, 'documents', 'legacy-state.yaml');

  return {
    repoRoot: normalizedRepoRoot,
    projectsDir,
    projectDir,
    projectFile: existsSync(preferredProjectFile) ? preferredProjectFile : (existsSync(legacyProjectFile) ? legacyProjectFile : preferredProjectFile),
    documentFile: join(projectDir, 'INDEX.md'),
    tasksDir: join(projectDir, 'tasks'),
    notesDir: join(projectDir, 'notes'),
    filesDir: join(projectDir, 'files'),
    attachmentsDir: join(projectDir, 'attachments'),
    artifactsDir: join(projectDir, 'artifacts'),
  };
}

export function resolveProjectPaths(options: ResolveProjectPathsOptions): ProjectPaths {
  validateProfileName(options.profile);

  const paths = resolveDurableProjectPaths(options.repoRoot, options.projectId);

  return {
    ...paths,
    profile: options.profile,
  };
}

export function listAllProjectIds(_options: { repoRoot?: string } = {}): string[] {
  return loadProjectNodes()
    .map((node) => node.id)
    .sort((left, right) => left.localeCompare(right));
}

export function readProjectOwnerProfile(options: { repoRoot?: string; projectId: string }): string {
  const projectNode = readProjectNode(options.projectId);
  return extractTagValue(projectNode.tags, 'profile') ?? 'shared';
}

export function listProjectIds(options: ResolveProjectOptions): string[] {
  resolveProfileProjectsDir(options);

  return listAllProjectIds({ repoRoot: options.repoRoot })
    .filter((projectId) => {
      try {
        return readProjectOwnerProfile({
          repoRoot: options.repoRoot,
          projectId,
        }) === options.profile;
      } catch {
        return true;
      }
    });
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

  if (existsSync(paths.documentFile)) {
    throw new Error(`Project already exists at ${paths.projectDir}. Existing file: ${paths.documentFile}`);
  }

  if (existsSync(paths.projectDir) && readdirSync(paths.projectDir).length > 0) {
    throw new Error(`Project directory already exists and is not empty: ${paths.projectDir}`);
  }
}

function buildProjectNodeBody(title: string, description: string): string {
  return [
    `# ${title}`,
    '',
    description,
    '',
    '## Goal',
    '',
    description,
  ].join('\n');
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
  migrateLegacyNodes();
  const existingNode = loadUnifiedNodes().nodes.find((node) => node.id === options.projectId);
  if (existingNode && !existingNode.kinds.includes('project')) {
    throw new Error(`A non-project node already exists at ${paths.projectDir}.`);
  }
  assertProjectCanBeCreated(paths, overwrite);

  const timestamp = formatIsoTimestamp(options.now ?? new Date());
  const writtenFiles: string[] = [];

  mkdirSync(paths.projectDir, { recursive: true });
  mkdirSync(join(paths.projectDir, 'documents'), { recursive: true });
  mkdirSync(paths.tasksDir, { recursive: true });
  mkdirSync(paths.notesDir, { recursive: true });
  mkdirSync(paths.filesDir, { recursive: true });
  mkdirSync(paths.attachmentsDir, { recursive: true });
  mkdirSync(paths.artifactsDir, { recursive: true });

  writeProject(
    paths.projectFile,
    createInitialProject({
      id: options.projectId,
      ownerProfile: options.profile,
      title,
      description,
      createdAt: timestamp,
      updatedAt: timestamp,
    }),
  );
  writtenFiles.push(paths.projectFile);

  createUnifiedNode({
    id: options.projectId,
    title,
    summary: description,
    status: 'active',
    tags: [`type:project`, `profile:${options.profile}`],
    body: buildProjectNodeBody(title, description),
    createdAt: timestamp,
    updatedAt: timestamp,
    force: true,
  });
  writtenFiles.push(paths.documentFile);

  return {
    paths,
    writtenFiles,
  };
}

export function projectExists(options: ResolveProjectPathsOptions): boolean {
  const paths = resolveProjectPaths(options);
  if (!(existsSync(paths.projectDir) && statSync(paths.projectDir).isDirectory())) {
    return false;
  }

  try {
    return readProjectOwnerProfile({ repoRoot: options.repoRoot, projectId: options.projectId }) === options.profile;
  } catch {
    return false;
  }
}

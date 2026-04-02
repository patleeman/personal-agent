import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  createInitialProject,
  deleteUnifiedNode,
  findUnifiedNodeById,
  getDurableProjectsDir,
  loadUnifiedNodes,
  migrateLegacyNodes,
  updateUnifiedNode,
  type ProjectDocument,
  type ProjectMilestoneDocument,
  type ProjectTaskDocument,
  type ProjectPlanDocument,
} from '@personal-agent/core';
import {
  listProjectFiles,
  migrateLegacyProjectPages,
  readProjectDocument,
  saveProjectDocument,
  type ProjectDocumentRecord,
  type ProjectFileRecord,
} from './projectResources.js';

export interface ProjectLinkedConversation {
  conversationId: string;
  title: string;
  file?: string;
  cwd?: string;
  lastActivityAt?: string;
  isRunning: boolean;
  needsAttention: boolean;
  snippet?: string;
}

export interface ProjectTimelineEntry {
  id: string;
  kind: 'project' | 'document' | 'task' | 'page' | 'file' | 'conversation' | 'activity';
  createdAt: string;
  title: string;
  href?: string;
}

export interface ProjectChildPageRecord {
  id: string;
  kind: 'note' | 'project' | 'skill';
  kinds: string[];
  title: string;
  summary: string;
  description?: string;
  status: string;
  createdAt?: string;
  updatedAt?: string;
  path: string;
  tags: string[];
  parent: string;
  body: string;
}

export interface ProjectDetail {
  project: ProjectDocument;
  taskCount: number;
  childPageCount: number;
  fileCount: number;
  attachmentCount: number;
  artifactCount: number;
  tasks: ProjectTaskDocument[];
  document: ProjectDocumentRecord | null;
  childPages: ProjectChildPageRecord[];
  files: ProjectFileRecord[];
  attachments: ProjectFileRecord[];
  artifacts: ProjectFileRecord[];
  linkedConversations: ProjectLinkedConversation[];
  timeline: ProjectTimelineEntry[];
}

export interface InvalidProjectRecord {
  projectId: string;
  path: string;
  error: string;
}

export interface ProjectIndexRecord {
  projects: ProjectDocument[];
  invalidProjects: InvalidProjectRecord[];
}

export interface CreateProjectRecordInput {
  repoRoot?: string;
  profile: string;
  projectId?: string;
  title: string;
  description?: string;
  documentContent?: string;
  projectRepoRoot?: string | null;
  summary?: string;
  goal?: string;
  acceptanceCriteria?: string[];
  planSummary?: string;
  completionSummary?: string | null;
  status?: string;
  currentFocus?: string | null;
  blockers?: string[];
  recentProgress?: string[];
}

export interface UpdateProjectRecordInput {
  repoRoot?: string;
  profile: string;
  projectId: string;
  title?: string;
  description?: string;
  projectRepoRoot?: string | null;
  summary?: string;
  goal?: string;
  acceptanceCriteria?: string[];
  planSummary?: string | null;
  completionSummary?: string | null;
  status?: string;
  currentFocus?: string | null;
  currentMilestoneId?: string | null;
  blockers?: string[];
  recentProgress?: string[];
}

export interface DeleteProjectRecordInput {
  repoRoot?: string;
  profile: string;
  projectId: string;
}

export interface DeleteProjectRecordResult {
  ok: true;
  deletedProjectId: string;
}

export interface SetProjectArchivedStateInput {
  repoRoot?: string;
  profile: string;
  projectId: string;
  archived: boolean;
}

export interface AddProjectMilestoneInput {
  repoRoot?: string;
  profile: string;
  projectId: string;
  id?: string;
  title: string;
  status: string;
  summary?: string;
  makeCurrent?: boolean;
}

export interface UpdateProjectMilestoneInput {
  repoRoot?: string;
  profile: string;
  projectId: string;
  milestoneId: string;
  title?: string;
  status?: string;
  summary?: string | null;
  makeCurrent?: boolean;
}

export interface CreateProjectTaskRecordInput {
  repoRoot?: string;
  profile: string;
  projectId: string;
  taskId?: string;
  title: string;
  status: string;
  milestoneId?: string | null;
}

export interface UpdateProjectTaskRecordInput {
  repoRoot?: string;
  profile: string;
  projectId: string;
  taskId: string;
  title?: string;
  status?: string;
  milestoneId?: string | null;
}

export interface DeleteProjectMilestoneInput {
  repoRoot?: string;
  profile: string;
  projectId: string;
  milestoneId: string;
}

export interface MoveProjectMilestoneInput {
  repoRoot?: string;
  profile: string;
  projectId: string;
  milestoneId: string;
  direction: 'up' | 'down';
}

export interface DeleteProjectTaskRecordInput {
  repoRoot?: string;
  profile: string;
  projectId: string;
  taskId: string;
}

export interface MoveProjectTaskRecordInput {
  repoRoot?: string;
  profile: string;
  projectId: string;
  taskId: string;
  direction: 'up' | 'down';
}

export interface SaveProjectSourceInput {
  repoRoot?: string;
  profile: string;
  projectId: string;
  content: string;
}

export interface ProjectNodePaths {
  repoRoot: string;
  profile: string;
  projectId: string;
  nodesDir: string;
  projectDir: string;
  projectFile: string;
  documentFile: string;
  filesDir: string;
  attachmentsDir: string;
  artifactsDir: string;
}

interface ParsedProjectBody {
  headingTitle?: string;
  intro: string;
  order: string[];
  sections: Record<string, string>;
}

const PROJECT_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9-_]*$/;
const MAX_AUTO_GENERATED_ID_LENGTH = 36;
const MAX_AUTO_GENERATED_ID_SEGMENTS = 6;
const PROJECT_DOCUMENT_FILE = 'project-document.md';
const CANONICAL_SECTION_ORDER = [
  'Goal',
  'Acceptance Criteria',
  'Status',
  'Tasks',
  'Milestones',
  'Blockers',
  'Progress',
  'Plan Summary',
  'Completion Summary',
] as const;
const KNOWN_SECTION_SET = new Set<string>(CANONICAL_SECTION_ORDER);

function nowIso(): string {
  return new Date().toISOString();
}

function readRequiredString(value: string | undefined, label: string): string {
  const normalized = value?.trim();
  if (!normalized) {
    throw new Error(`${label} must not be empty.`);
  }
  return normalized;
}

function readOptionalString(value: string | null | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : undefined;
}

function readStringList(values: string[] | undefined, label: string): string[] {
  if (!values) {
    return [];
  }
  return values.map((value, index) => readRequiredString(value, `${label}[${index}]`));
}

function validateProjectId(projectId: string): void {
  if (!PROJECT_ID_PATTERN.test(projectId)) {
    throw new Error(`Invalid project id "${projectId}".`);
  }
}

function resolveProjectRepoRoot(projectRepoRoot: string | null | undefined, repoRoot?: string): string | undefined {
  const normalized = readOptionalString(projectRepoRoot);
  return normalized ? resolve(repoRoot ?? process.cwd(), normalized) : undefined;
}

function extractTagValue(tags: string[], key: string): string | undefined {
  return tags
    .map((tag) => tag.match(new RegExp(`^${key}:(.+)$`, 'i'))?.[1]?.trim())
    .find((value): value is string => typeof value === 'string' && value.length > 0);
}

function extractTagValues(tags: string[], key: string): string[] {
  return tags
    .map((tag) => tag.match(new RegExp(`^${key}:(.+)$`, 'i'))?.[1]?.trim())
    .filter((value): value is string => typeof value === 'string' && value.length > 0);
}

function matchesProjectProfile(tags: string[], profile: string): boolean {
  const profileTags = extractTagValues(tags, 'profile');
  if (profileTags.length === 0) {
    return profile === 'shared';
  }
  return profileTags.includes(profile);
}

function isNodeVisibleInProfile(node: ReturnType<typeof loadUnifiedNodes>['nodes'][number], profile: string): boolean {
  return node.profiles.length === 0 || node.profiles.includes(profile);
}

function resolveProjectChildPageKind(node: Pick<ReturnType<typeof loadUnifiedNodes>['nodes'][number], 'type' | 'kinds'>): 'note' | 'project' | 'skill' {
  if (node.type === 'project' || node.kinds.includes('project')) {
    return 'project';
  }
  if (node.type === 'skill' || node.kinds.includes('skill')) {
    return 'skill';
  }
  return 'note';
}

function listProjectChildPages(options: { repoRoot?: string; profile: string; ownerProfile: string; projectId: string }): ProjectChildPageRecord[] {
  migrateLegacyProjectPages({ ...options, profile: options.ownerProfile });
  const loaded = loadUnifiedNodes();

  return loaded.nodes
    .filter((node) => node.id !== options.projectId)
    .filter((node) => node.links.parent === options.projectId)
    .filter((node) => isNodeVisibleInProfile(node, options.profile))
    .map((node) => ({
      id: node.id,
      kind: resolveProjectChildPageKind(node),
      kinds: [...node.kinds],
      title: node.title,
      summary: node.summary,
      ...(node.description ? { description: node.description } : {}),
      status: node.status,
      createdAt: node.createdAt,
      updatedAt: node.updatedAt,
      path: node.filePath,
      tags: [...node.tags],
      parent: options.projectId,
      body: node.body,
    }))
    .sort((left, right) => (right.updatedAt ?? '').localeCompare(left.updatedAt ?? '') || left.title.localeCompare(right.title) || left.id.localeCompare(right.id));
}

export function resolveProjectNodePaths(options: { repoRoot?: string; profile: string; projectId: string }): ProjectNodePaths {
  validateProjectId(options.projectId);
  const nodesDir = getDurableProjectsDir();
  const projectDir = join(nodesDir, options.projectId);
  return {
    repoRoot: options.repoRoot ?? process.cwd(),
    profile: options.profile,
    projectId: options.projectId,
    nodesDir,
    projectDir,
    projectFile: join(projectDir, 'project.md'),
    documentFile: join(projectDir, 'project.md'),
    filesDir: join(projectDir, 'files'),
    attachmentsDir: join(projectDir, 'attachments'),
    artifactsDir: join(projectDir, 'artifacts'),
  };
}

function splitBodySections(body: string): ParsedProjectBody {
  const normalized = body.replace(/\r\n/g, '\n').trim();
  const lines = normalized.split('\n');
  const sections: Record<string, string> = {};
  const order: string[] = [];
  let headingTitle: string | undefined;
  let introLines: string[] = [];
  let currentSection: string | null = null;
  let sectionLines: string[] = [];

  function flushSection(): void {
    if (!currentSection) {
      return;
    }
    sections[currentSection] = sectionLines.join('\n').trim();
    order.push(currentSection);
    sectionLines = [];
  }

  for (const line of lines) {
    const headingMatch = line.match(/^#\s+(.+)$/);
    if (headingMatch && !headingTitle) {
      headingTitle = headingMatch[1]?.trim() || undefined;
      continue;
    }
    const sectionMatch = line.match(/^##\s+(.+)$/);
    if (sectionMatch) {
      flushSection();
      currentSection = sectionMatch[1]?.trim() || null;
      continue;
    }
    if (currentSection) {
      sectionLines.push(line);
    } else {
      introLines.push(line);
    }
  }
  flushSection();

  return {
    headingTitle,
    intro: introLines.join('\n').trim(),
    order,
    sections,
  };
}

function listFromSection(sectionBody: string | undefined): string[] {
  if (!sectionBody) {
    return [];
  }
  return sectionBody
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^-\s+/.test(line))
    .map((line) => line.replace(/^-\s+/, '').trim())
    .filter((line) => line.length > 0);
}

function parseTasks(sectionBody: string | undefined): ProjectTaskDocument[] {
  if (!sectionBody) {
    return [];
  }
  const tasks: ProjectTaskDocument[] = [];
  for (const line of sectionBody.split('\n').map((value) => value.trim()).filter((value) => value.length > 0)) {
    const match = line.match(/^- \[([ xX])\] (.+)$/);
    if (!match) {
      continue;
    }
    let remainder = match[2]?.trim() || '';
    const idMatch = remainder.match(/\s*\(id:\s*([^()]+)\)\s*$/i);
    let explicitId: string | undefined;
    if (idMatch) {
      explicitId = idMatch[1]?.trim();
      remainder = remainder.slice(0, remainder.length - idMatch[0].length).trim();
    }
    const statusMatch = remainder.match(/\s*\(status:\s*([^()]+)\)\s*$/i);
    let explicitStatus: string | undefined;
    if (statusMatch) {
      explicitStatus = statusMatch[1]?.trim();
      remainder = remainder.slice(0, remainder.length - statusMatch[0].length).trim();
    }
    const milestoneMatch = remainder.match(/\s*\(milestone:\s*([^()]+)\)\s*$/i);
    let milestoneId: string | undefined;
    if (milestoneMatch) {
      milestoneId = milestoneMatch[1]?.trim();
      remainder = remainder.slice(0, remainder.length - milestoneMatch[0].length).trim();
    }
    const title = remainder.trim();
    if (!title || title.toLowerCase() === 'no tasks yet') {
      continue;
    }
    const idBase = explicitId || slugifyIdentifier(title) || 'task';
    const status = explicitStatus || ((match[1] === 'x' || match[1] === 'X') ? 'done' : 'pending');
    tasks.push({ id: generateUniqueId(idBase, tasks.map((task) => task.id), 'task'), title, status, ...(milestoneId ? { milestoneId } : {}) });
  }
  return tasks;
}

function parseMilestones(sectionBody: string | undefined): ProjectMilestoneDocument[] {
  if (!sectionBody) {
    return [];
  }
  const milestones: ProjectMilestoneDocument[] = [];
  for (const line of sectionBody.split('\n').map((value) => value.trim()).filter((value) => value.length > 0)) {
    if (!line.startsWith('- ')) {
      continue;
    }
    const raw = line.replace(/^-\s+/, '').trim();
    const idMatch = raw.match(/\s*\(id:\s*([^()]+)\)\s*$/i);
    const rawWithoutId = idMatch ? raw.slice(0, raw.length - idMatch[0].length).trim() : raw;
    const match = rawWithoutId.match(/^([^:]+):\s*(.+?)(?:\s+—\s+(.+))?$/);
    const status = match?.[1]?.trim() || 'pending';
    const title = match?.[2]?.trim() || rawWithoutId;
    const summary = match?.[3]?.trim();
    if (!title || title.toLowerCase() === 'no milestones yet') {
      continue;
    }
    const idBase = idMatch?.[1]?.trim() || slugifyIdentifier(title) || 'milestone';
    milestones.push({ id: generateUniqueId(idBase, milestones.map((milestone) => milestone.id), 'milestone'), title, status, ...(summary ? { summary } : {}) });
  }
  return milestones;
}

function buildTaskLine(task: ProjectTaskDocument): string {
  const done = task.status === 'done' || task.status === 'completed';
  const milestoneSuffix = task.milestoneId ? ` (milestone: ${task.milestoneId})` : '';
  const statusSuffix = (!done && task.status !== 'pending' && task.status !== 'todo') ? ` (status: ${task.status})` : '';
  return `- [${done ? 'x' : ' '}] ${task.title}${milestoneSuffix}${statusSuffix} (id: ${task.id})`;
}

function buildMilestoneLine(milestone: ProjectMilestoneDocument): string {
  return `- ${milestone.status}: ${milestone.title}${milestone.summary ? ` — ${milestone.summary}` : ''} (id: ${milestone.id})`;
}

function sectionBlock(title: string, body: string | undefined): string {
  const normalized = body?.trim();
  if (!normalized) {
    return '';
  }
  return `## ${title}\n\n${normalized}`;
}

function serializeProjectBody(project: ProjectDocument, existingBody?: string): string {
  const parsed = splitBodySections(existingBody ?? '');
  const intro = readOptionalString(project.description) ?? parsed.intro;
  const sectionContent = new Map<string, string | undefined>();

  const acceptanceCriteria = project.requirements.acceptanceCriteria.length > 0
    ? project.requirements.acceptanceCriteria.map((item) => `- ${item}`).join('\n')
    : '';
  const blockers = project.blockers.length > 0 ? project.blockers.map((item) => `- ${item}`).join('\n') : '';
  const progress = project.recentProgress.length > 0 ? project.recentProgress.map((item) => `- ${item}`).join('\n') : '';
  const tasks = project.plan.tasks.length > 0 ? project.plan.tasks.map(buildTaskLine).join('\n') : '';
  const milestones = project.plan.milestones.length > 0 ? project.plan.milestones.map(buildMilestoneLine).join('\n') : '';

  sectionContent.set('Goal', project.requirements.goal);
  sectionContent.set('Acceptance Criteria', acceptanceCriteria);
  sectionContent.set('Status', project.currentFocus || project.status);
  sectionContent.set('Tasks', tasks);
  sectionContent.set('Milestones', milestones);
  sectionContent.set('Blockers', blockers);
  sectionContent.set('Progress', progress);
  sectionContent.set('Plan Summary', project.planSummary);
  sectionContent.set('Completion Summary', project.completionSummary);

  const orderedSections = [...CANONICAL_SECTION_ORDER, ...parsed.order.filter((title) => !KNOWN_SECTION_SET.has(title))];
  const blocks: string[] = [`# ${project.title}`];
  if (intro) {
    blocks.push('', intro);
  }
  for (const title of orderedSections) {
    const body = KNOWN_SECTION_SET.has(title)
      ? sectionContent.get(title)
      : parsed.sections[title];
    const block = sectionBlock(title, body);
    if (block) {
      blocks.push('', block);
    }
  }

  return blocks.join('\n').trim();
}

function readArchivedAtFromSource(filePath: string): string | undefined {
  const raw = readFileSync(filePath, 'utf-8');
  const match = raw.match(/^archivedAt:\s*(.+)$/m);
  const value = match?.[1]?.trim();
  return value && value !== 'null' ? value.replace(/^['"]|['"]$/g, '') : undefined;
}

function parseProjectNode(node: ReturnType<typeof loadUnifiedNodes>['nodes'][number]): ProjectDocument {
  const parsedBody = splitBodySections(node.body);
  const ownerProfile = extractTagValue(node.tags, 'profile') ?? 'shared';
  const repoRoot = extractTagValue(node.tags, 'cwd');
  const archivedAt = readArchivedAtFromSource(node.filePath);
  const project = createInitialProject({
    id: node.id,
    ownerProfile,
    title: node.title,
    description: parsedBody.intro || node.summary,
    repoRoot,
    createdAt: node.createdAt ?? node.updatedAt ?? nowIso(),
    updatedAt: node.updatedAt ?? node.createdAt ?? nowIso(),
  });

  project.summary = node.summary;
  project.status = node.status;
  if (archivedAt) {
    project.archivedAt = archivedAt;
  }
  project.requirements.goal = parsedBody.sections.Goal?.trim() || node.summary;
  project.requirements.acceptanceCriteria = listFromSection(parsedBody.sections['Acceptance Criteria']);
  project.currentFocus = readOptionalString(parsedBody.sections.Status);
  project.blockers = listFromSection(parsedBody.sections.Blockers);
  project.recentProgress = listFromSection(parsedBody.sections.Progress);
  project.planSummary = readOptionalString(parsedBody.sections['Plan Summary']);
  project.completionSummary = readOptionalString(parsedBody.sections['Completion Summary']);
  project.plan = {
    currentMilestoneId: undefined,
    milestones: parseMilestones(parsedBody.sections.Milestones),
    tasks: parseTasks(parsedBody.sections.Tasks),
  } satisfies ProjectPlanDocument;

  return project;
}

function slugifyIdentifier(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

function trimTrailingHyphens(value: string): string {
  return value.replace(/-+$/g, '');
}

function buildGeneratedIdBase(title: string, fallbackBase: 'project' | 'milestone' | 'task'): string {
  const slug = slugifyIdentifier(title);
  if (!slug) {
    return fallbackBase;
  }
  const segments = slug.split('-').filter((segment) => segment.length > 0).slice(0, MAX_AUTO_GENERATED_ID_SEGMENTS);
  let base = '';
  for (const segment of segments) {
    const next = base.length > 0 ? `${base}-${segment}` : segment;
    if (next.length > MAX_AUTO_GENERATED_ID_LENGTH) {
      break;
    }
    base = next;
  }
  if (base.length > 0) {
    return base;
  }
  return trimTrailingHyphens(slug.slice(0, MAX_AUTO_GENERATED_ID_LENGTH)) || fallbackBase;
}

function generateUniqueId(title: string, existingIds: string[], fallbackBase: 'project' | 'milestone' | 'task'): string {
  const base = buildGeneratedIdBase(title, fallbackBase);
  const used = new Set(existingIds);
  if (!used.has(base)) {
    return base;
  }
  for (let index = 2; index < Number.MAX_SAFE_INTEGER; index += 1) {
    const suffix = `-${index}`;
    const trimmedBase = trimTrailingHyphens(base.slice(0, MAX_AUTO_GENERATED_ID_LENGTH - suffix.length)) || fallbackBase;
    const candidate = `${trimmedBase}${suffix}`;
    if (!used.has(candidate)) {
      return candidate;
    }
  }
  throw new Error(`Unable to generate a unique ${fallbackBase} id.`);
}

function moveArrayItem<T>(items: T[], index: number, direction: 'up' | 'down'): T[] {
  const nextIndex = direction === 'up' ? index - 1 : index + 1;
  if (index < 0 || nextIndex < 0 || nextIndex >= items.length) {
    return [...items];
  }
  const output = [...items];
  const [item] = output.splice(index, 1);
  output.splice(nextIndex, 0, item as T);
  return output;
}

function ensureProjectsMaterialized(): void {
  migrateLegacyNodes();
}

function readProjectNodeRecord(options: { repoRoot?: string; profile: string; projectId: string }): { node: ReturnType<typeof loadUnifiedNodes>['nodes'][number]; project: ProjectDocument; paths: ProjectNodePaths } {
  ensureProjectsMaterialized();
  const loaded = loadUnifiedNodes();
  const node = findUnifiedNodeById(loaded.nodes, options.projectId);
  if (!node.kinds.includes('project')) {
    throw new Error(`Project not found: ${options.projectId}`);
  }
  if (!matchesProjectProfile(node.tags, options.profile)) {
    throw new Error(`Project not found: ${options.projectId}`);
  }
  return {
    node,
    project: parseProjectNode(node),
    paths: resolveProjectNodePaths(options),
  };
}

function renderProjectNodeMarkdown(project: ProjectDocument, extraTags: string[] = [], existingBody?: string): string {
  const tags = [...new Set([
    ...extraTags,
    'type:project',
    `profile:${project.ownerProfile}`,
    `status:${project.status}`,
    ...(project.repoRoot ? [`cwd:${project.repoRoot}`] : []),
  ])].sort((left, right) => left.localeCompare(right));

  return [
    '---',
    `id: ${JSON.stringify(project.id)}`,
    `title: ${JSON.stringify(project.title)}`,
    `summary: ${JSON.stringify(project.summary)}`,
    `status: ${JSON.stringify(project.status)}`,
    `createdAt: ${JSON.stringify(project.createdAt)}`,
    `updatedAt: ${JSON.stringify(project.updatedAt)}`,
    ...(project.archivedAt ? [`archivedAt: ${JSON.stringify(project.archivedAt)}`] : []),
    'tags:',
    ...tags.map((tag) => `  - ${tag}`),
    '---',
    '',
    serializeProjectBody(project, existingBody),
    '',
  ].join('\n');
}

function writeProjectNode(project: ProjectDocument, existingBody?: string): void {
  const loaded = loadUnifiedNodes();
  const existingNode = findUnifiedNodeById(loaded.nodes, project.id);
  const extraTags = existingNode.tags.filter((tag) => !/^(type|profile|cwd|status):/i.test(tag) && !/^type:(note|skill)$/i.test(tag));
  writeFileSync(existingNode.filePath, renderProjectNodeMarkdown(project, extraTags, existingBody), 'utf-8');
}

export function listProjectIndex(options: { repoRoot?: string; profile: string }): ProjectIndexRecord {
  ensureProjectsMaterialized();
  const loaded = loadUnifiedNodes();
  const projects: ProjectDocument[] = [];
  const invalidProjects: InvalidProjectRecord[] = [];

  for (const node of loaded.nodes) {
    if (!node.kinds.includes('project')) {
      continue;
    }
    if (!matchesProjectProfile(node.tags, options.profile)) {
      continue;
    }
    try {
      projects.push(parseProjectNode(node));
    } catch (error) {
      invalidProjects.push({
        projectId: node.id,
        path: node.filePath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  projects.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  return { projects, invalidProjects };
}

export function readProjectOwnerProfile(options: { repoRoot?: string; projectId: string }): string {
  ensureProjectsMaterialized();
  const loaded = loadUnifiedNodes();
  const node = findUnifiedNodeById(loaded.nodes, options.projectId);
  if (!node.kinds.includes('project')) {
    throw new Error(`Project not found: ${options.projectId}`);
  }
  return extractTagValue(node.tags, 'profile') ?? 'shared';
}

export function projectExists(options: { repoRoot?: string; profile: string; projectId: string }): boolean {
  try {
    readProjectNodeRecord(options);
    return true;
  } catch {
    return false;
  }
}

export function sortProjectTasks(tasks: ProjectTaskDocument[]): ProjectTaskDocument[] {
  return [...tasks];
}

export function readProjectDetailFromProject(options: { repoRoot?: string; profile: string; projectId: string }): ProjectDetail {
  const { project } = readProjectNodeRecord(options);
  const tasks = sortProjectTasks(project.plan.tasks ?? []);
  const childPages = listProjectChildPages({ ...options, ownerProfile: project.ownerProfile });
  const files = listProjectFiles(options);
  const attachments = files.filter((file) => file.sourceKind !== 'artifact');
  const artifacts = files.filter((file) => file.sourceKind === 'artifact');
  const document = readProjectDocument(options);

  return {
    project,
    taskCount: tasks.length,
    childPageCount: childPages.length,
    fileCount: files.length,
    attachmentCount: attachments.length,
    artifactCount: artifacts.length,
    tasks,
    document,
    childPages,
    files,
    attachments,
    artifacts,
    linkedConversations: [],
    timeline: [],
  };
}

export function createProjectRecord(input: CreateProjectRecordInput): ProjectDetail {
  const title = readRequiredString(input.title, 'Project title');
  const description = readOptionalString(input.description) ?? title;
  const existingIds = listProjectIndex({ repoRoot: input.repoRoot, profile: input.profile }).projects.map((project) => project.id);
  const projectId = readOptionalString(input.projectId) ?? generateUniqueId(title, existingIds, 'project');
  const timestamp = nowIso();
  const project: ProjectDocument = createInitialProject({
    id: projectId,
    ownerProfile: input.profile,
    title,
    description,
    repoRoot: resolveProjectRepoRoot(input.projectRepoRoot, input.repoRoot),
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  project.summary = readOptionalString(input.summary) ?? description;
  project.requirements.goal = readOptionalString(input.goal) ?? description;
  project.requirements.acceptanceCriteria = input.acceptanceCriteria !== undefined
    ? readStringList(input.acceptanceCriteria, 'Project acceptanceCriteria')
    : [];
  project.status = readOptionalString(input.status) ?? 'active';
  project.blockers = readStringList(input.blockers, 'Project blockers');
  project.currentFocus = readOptionalString(input.currentFocus);
  project.recentProgress = readStringList(input.recentProgress, 'Project recentProgress');
  project.planSummary = readOptionalString(input.planSummary);
  project.completionSummary = readOptionalString(input.completionSummary);

  createProjectNodeRecord(project);
  if (readOptionalString(input.documentContent)) {
    saveProjectDocument({
      repoRoot: input.repoRoot,
      profile: input.profile,
      projectId,
      content: input.documentContent as string,
    });
  }

  return readProjectDetailFromProject({ repoRoot: input.repoRoot, profile: input.profile, projectId });
}

function createProjectNodeRecord(project: ProjectDocument): void {
  const paths = resolveProjectNodePaths({ profile: project.ownerProfile, projectId: project.id });
  if (existsSync(paths.projectFile)) {
    throw new Error(`Project already exists: ${project.id}`);
  }
  mkdirSync(paths.projectDir, { recursive: true });
  writeFileSync(paths.projectFile, renderProjectNodeMarkdown(project), 'utf-8');
}

export function updateProjectRecord(input: UpdateProjectRecordInput): ProjectDetail {
  const { node, project } = readProjectNodeRecord(input);
  const currentMilestoneId = input.currentMilestoneId !== undefined ? readOptionalString(input.currentMilestoneId) : project.plan.currentMilestoneId;
  const updatedProject: ProjectDocument = {
    ...project,
    ...(input.title !== undefined ? { title: readRequiredString(input.title, 'Project title') } : {}),
    ...(input.description !== undefined ? { description: readRequiredString(input.description, 'Project description') } : {}),
    ...(input.projectRepoRoot !== undefined ? { repoRoot: resolveProjectRepoRoot(input.projectRepoRoot, input.repoRoot) } : {}),
    ...(input.summary !== undefined ? { summary: readRequiredString(input.summary, 'Project summary') } : {}),
    requirements: {
      goal: input.goal !== undefined ? readRequiredString(input.goal, 'Project goal') : project.requirements.goal,
      acceptanceCriteria: input.acceptanceCriteria !== undefined
        ? readStringList(input.acceptanceCriteria, 'Project acceptanceCriteria')
        : project.requirements.acceptanceCriteria,
    },
    ...(input.status !== undefined ? { status: readRequiredString(input.status, 'Project status') } : {}),
    ...(input.currentFocus !== undefined ? { currentFocus: readOptionalString(input.currentFocus) } : {}),
    ...(input.blockers !== undefined ? { blockers: readStringList(input.blockers, 'Project blockers') } : {}),
    ...(input.recentProgress !== undefined ? { recentProgress: readStringList(input.recentProgress, 'Project recentProgress') } : {}),
    ...(input.planSummary !== undefined ? { planSummary: readOptionalString(input.planSummary) } : {}),
    ...(input.completionSummary !== undefined ? { completionSummary: readOptionalString(input.completionSummary) } : {}),
    updatedAt: nowIso(),
    plan: {
      ...project.plan,
      currentMilestoneId,
    },
  };
  writeProjectNode(updatedProject, node.body);
  return readProjectDetailFromProject(input);
}

export function deleteProjectRecord(input: DeleteProjectRecordInput): DeleteProjectRecordResult {
  ensureProjectsMaterialized();
  deleteUnifiedNode(input.projectId);
  return { ok: true, deletedProjectId: input.projectId };
}

export function setProjectArchivedState(input: SetProjectArchivedStateInput): ProjectDetail {
  const { node, project } = readProjectNodeRecord(input);
  const isArchived = Boolean(project.archivedAt);
  if (input.archived === isArchived) {
    return readProjectDetailFromProject(input);
  }
  const updatedProject: ProjectDocument = {
    ...project,
    updatedAt: nowIso(),
    ...(input.archived ? { archivedAt: nowIso() } : {}),
  };
  if (!input.archived) {
    delete updatedProject.archivedAt;
  }
  writeProjectNode(updatedProject, node.body);
  return readProjectDetailFromProject(input);
}

function assertMilestoneExists(project: ProjectDocument, milestoneId: string | undefined): void {
  if (!milestoneId) {
    return;
  }
  if (!project.plan.milestones.some((milestone) => milestone.id === milestoneId)) {
    throw new Error(`Milestone ${milestoneId} does not exist in project ${project.id}.`);
  }
}

export function addProjectMilestone(input: AddProjectMilestoneInput): ProjectDetail {
  const { node, project } = readProjectNodeRecord(input);
  const milestoneTitle = readRequiredString(input.title, 'Milestone title');
  const milestoneId = readOptionalString(input.id) ?? generateUniqueId(milestoneTitle, project.plan.milestones.map((milestone) => milestone.id), 'milestone');
  if (project.plan.milestones.some((milestone) => milestone.id === milestoneId)) {
    throw new Error(`Milestone already exists in project ${project.id}: ${milestoneId}`);
  }
  const updatedProject: ProjectDocument = {
    ...project,
    updatedAt: nowIso(),
    plan: {
      ...project.plan,
      currentMilestoneId: input.makeCurrent ? milestoneId : project.plan.currentMilestoneId,
      milestones: [...project.plan.milestones, { id: milestoneId, title: milestoneTitle, status: readRequiredString(input.status, 'Milestone status'), ...(readOptionalString(input.summary) ? { summary: readOptionalString(input.summary) } : {}) }],
    },
  };
  writeProjectNode(updatedProject, node.body);
  return readProjectDetailFromProject(input);
}

export function updateProjectMilestone(input: UpdateProjectMilestoneInput): ProjectDetail {
  const { node, project } = readProjectNodeRecord(input);
  const milestoneIndex = project.plan.milestones.findIndex((milestone) => milestone.id === input.milestoneId);
  if (milestoneIndex === -1) {
    throw new Error(`Milestone not found in project ${project.id}: ${input.milestoneId}`);
  }
  const milestones = [...project.plan.milestones];
  milestones[milestoneIndex] = {
    ...milestones[milestoneIndex],
    ...(input.title !== undefined ? { title: readRequiredString(input.title, 'Milestone title') } : {}),
    ...(input.status !== undefined ? { status: readRequiredString(input.status, 'Milestone status') } : {}),
    ...(input.summary !== undefined ? { summary: readOptionalString(input.summary) } : {}),
  } as ProjectMilestoneDocument;
  const updatedProject: ProjectDocument = {
    ...project,
    updatedAt: nowIso(),
    plan: {
      ...project.plan,
      currentMilestoneId: input.makeCurrent ? input.milestoneId : project.plan.currentMilestoneId,
      milestones,
    },
  };
  writeProjectNode(updatedProject, node.body);
  return readProjectDetailFromProject(input);
}

export function createProjectTaskRecord(input: CreateProjectTaskRecordInput): ProjectDetail {
  const { node, project } = readProjectNodeRecord(input);
  const title = readRequiredString(input.title, 'Task title');
  const milestoneId = readOptionalString(input.milestoneId);
  assertMilestoneExists(project, milestoneId);
  const taskId = readOptionalString(input.taskId) ?? generateUniqueId(title, project.plan.tasks.map((task) => task.id), 'task');
  if (project.plan.tasks.some((task) => task.id === taskId)) {
    throw new Error(`Task already exists in project ${input.projectId}: ${taskId}`);
  }
  const updatedProject: ProjectDocument = {
    ...project,
    updatedAt: nowIso(),
    plan: {
      ...project.plan,
      tasks: [...project.plan.tasks, { id: taskId, title, status: readRequiredString(input.status, 'Task status'), ...(milestoneId ? { milestoneId } : {}) }],
    },
  };
  writeProjectNode(updatedProject, node.body);
  return readProjectDetailFromProject(input);
}

export function updateProjectTaskRecord(input: UpdateProjectTaskRecordInput): ProjectDetail {
  const { node, project } = readProjectNodeRecord(input);
  const taskIndex = project.plan.tasks.findIndex((task) => task.id === input.taskId);
  if (taskIndex === -1) {
    throw new Error(`Task not found in project ${input.projectId}: ${input.taskId}`);
  }
  const milestoneId = input.milestoneId !== undefined ? readOptionalString(input.milestoneId) : project.plan.tasks[taskIndex]?.milestoneId;
  assertMilestoneExists(project, milestoneId);
  const tasks = [...project.plan.tasks];
  tasks[taskIndex] = {
    ...tasks[taskIndex],
    ...(input.title !== undefined ? { title: readRequiredString(input.title, 'Task title') } : {}),
    ...(input.status !== undefined ? { status: readRequiredString(input.status, 'Task status') } : {}),
    ...(milestoneId ? { milestoneId } : {}),
  } as ProjectTaskDocument;
  if (!milestoneId) {
    delete (tasks[taskIndex] as { milestoneId?: string }).milestoneId;
  }
  const updatedProject: ProjectDocument = {
    ...project,
    updatedAt: nowIso(),
    plan: { ...project.plan, tasks },
  };
  writeProjectNode(updatedProject, node.body);
  return readProjectDetailFromProject(input);
}

export function deleteProjectMilestone(input: DeleteProjectMilestoneInput): ProjectDetail {
  const { node, project } = readProjectNodeRecord(input);
  if (!project.plan.milestones.some((milestone) => milestone.id === input.milestoneId)) {
    throw new Error(`Milestone not found in project ${project.id}: ${input.milestoneId}`);
  }
  const nextMilestones = project.plan.milestones.filter((milestone) => milestone.id !== input.milestoneId);
  const nextTasks = project.plan.tasks.map((task) => {
    if (task.milestoneId !== input.milestoneId) return task;
    const updated = { ...task } as { milestoneId?: string } & ProjectTaskDocument;
    delete updated.milestoneId;
    return updated;
  });
  const updatedProject: ProjectDocument = {
    ...project,
    updatedAt: nowIso(),
    plan: {
      ...project.plan,
      currentMilestoneId: project.plan.currentMilestoneId === input.milestoneId ? nextMilestones[0]?.id : project.plan.currentMilestoneId,
      milestones: nextMilestones,
      tasks: nextTasks,
    },
  };
  writeProjectNode(updatedProject, node.body);
  return readProjectDetailFromProject(input);
}

export function moveProjectMilestone(input: MoveProjectMilestoneInput): ProjectDetail {
  const { node, project } = readProjectNodeRecord(input);
  const milestoneIndex = project.plan.milestones.findIndex((milestone) => milestone.id === input.milestoneId);
  if (milestoneIndex === -1) {
    throw new Error(`Milestone not found in project ${project.id}: ${input.milestoneId}`);
  }
  const updatedProject: ProjectDocument = {
    ...project,
    updatedAt: nowIso(),
    plan: {
      ...project.plan,
      milestones: moveArrayItem(project.plan.milestones, milestoneIndex, input.direction),
    },
  };
  writeProjectNode(updatedProject, node.body);
  return readProjectDetailFromProject(input);
}

export function deleteProjectTaskRecord(input: DeleteProjectTaskRecordInput): ProjectDetail {
  const { node, project } = readProjectNodeRecord(input);
  const nextTasks = project.plan.tasks.filter((task) => task.id !== input.taskId);
  if (nextTasks.length === project.plan.tasks.length) {
    throw new Error(`Task not found in project ${input.projectId}: ${input.taskId}`);
  }
  const updatedProject: ProjectDocument = {
    ...project,
    updatedAt: nowIso(),
    plan: { ...project.plan, tasks: nextTasks },
  };
  writeProjectNode(updatedProject, node.body);
  return readProjectDetailFromProject(input);
}

export function moveProjectTaskRecord(input: MoveProjectTaskRecordInput): ProjectDetail {
  const { node, project } = readProjectNodeRecord(input);
  const taskIndex = project.plan.tasks.findIndex((task) => task.id === input.taskId);
  if (taskIndex === -1) {
    throw new Error(`Task not found in project ${input.projectId}: ${input.taskId}`);
  }
  const updatedProject: ProjectDocument = {
    ...project,
    updatedAt: nowIso(),
    plan: { ...project.plan, tasks: moveArrayItem(project.plan.tasks, taskIndex, input.direction) },
  };
  writeProjectNode(updatedProject, node.body);
  return readProjectDetailFromProject(input);
}

function validateProjectNodeSource(content: string, expectedProjectId: string): void {
  const normalized = content.replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n')) {
    throw new Error('Project source must start with YAML frontmatter.');
  }
  const end = normalized.indexOf('\n---\n', 4);
  if (end === -1) {
    throw new Error('Project source is missing a closing frontmatter delimiter.');
  }
  const frontmatter = normalized.slice(4, end);
  const idMatch = frontmatter.match(/^id:\s*(.+)$/m);
  const id = idMatch?.[1]?.trim().replace(/^['\"]|['\"]$/g, '');
  if (id !== expectedProjectId) {
    throw new Error(`Project source id must match route id ${expectedProjectId}.`);
  }
  const isProject = frontmatter.includes('type:project');
  if (!isProject) {
    throw new Error('Project source must include tag type:project.');
  }
}

export function readProjectSource(options: { repoRoot?: string; profile: string; projectId: string }): { path: string; content: string } {
  const { paths } = readProjectNodeRecord(options);
  return {
    path: paths.projectFile,
    content: readFileSync(paths.projectFile, 'utf-8'),
  };
}

export function saveProjectSource(input: SaveProjectSourceInput): ProjectDetail {
  const { paths } = readProjectNodeRecord(input);
  validateProjectNodeSource(input.content, input.projectId);
  writeFileSync(paths.projectFile, input.content.replace(/\r\n/g, '\n'), 'utf-8');
  return readProjectDetailFromProject(input);
}

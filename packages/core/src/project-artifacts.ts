import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

const FRONTMATTER_DELIMITER = '---';

type FlexibleString = string & Record<never, never>;

export type ProjectStatus = 'active' | 'paused' | 'done' | 'created' | 'in_progress' | 'blocked' | 'completed' | 'cancelled';
export type ProjectMilestoneStatus = 'pending' | 'in_progress' | 'blocked' | 'completed' | 'cancelled';
export type ProjectTaskStatus = 'todo' | 'doing' | 'done' | 'pending' | 'in_progress' | 'blocked' | 'completed' | 'cancelled';

export interface ProjectMilestoneDocument {
  id: string;
  title: string;
  status: ProjectMilestoneStatus | FlexibleString;
  summary?: string;
}

export interface ProjectTaskDocument {
  id: string;
  status: ProjectTaskStatus | FlexibleString;
  title: string;
  milestoneId?: string;
}

export interface ProjectPlanDocument {
  currentMilestoneId?: string;
  milestones: ProjectMilestoneDocument[];
  tasks: ProjectTaskDocument[];
}

export interface ProjectRequirementsDocument {
  goal: string;
  acceptanceCriteria: string[];
}

export interface ProjectDocument {
  id: string;
  ownerProfile: string;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
  title: string;
  description: string;
  repoRoot?: string;
  summary: string;
  requirements: ProjectRequirementsDocument;
  status: ProjectStatus | FlexibleString;
  blockers: string[];
  currentFocus?: string;
  recentProgress: string[];
  planSummary?: string;
  completionSummary?: string;
  plan: ProjectPlanDocument;
}

export type ProjectActivityKind =
  | 'scheduled-task'
  | 'deferred-resume'
  | 'subagent-run'
  | 'background-run'
  | 'deployment'
  | 'service'
  | 'verification'
  | 'follow-up'
  | 'note';

export type ProjectActivityNotificationState = 'none' | 'queued' | 'sent' | 'failed';

export interface ProjectActivityEntryDocument {
  id: string;
  createdAt: string;
  profile: string;
  kind: ProjectActivityKind | FlexibleString;
  summary: string;
  details?: string;
  relatedProjectIds?: string[];
  notificationState?: ProjectActivityNotificationState;
}

interface FrontmatterSection {
  attributes: Record<string, string>;
  body: string;
}

function normalizeMarkdown(markdown: string): string {
  return markdown.replace(/\r\n/g, '\n');
}

function assertNonEmptyText(value: string, label: string): string {
  const trimmed = value.trim();

  if (trimmed.length === 0) {
    throw new Error(`${label} must not be empty.`);
  }

  return trimmed;
}

function normalizeOptionalText(value: string | undefined, label: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  return assertNonEmptyText(value, label);
}

function assertPlainObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be a YAML object.`);
  }

  return value as Record<string, unknown>;
}

function readYamlString(value: unknown, label: string): string {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value !== 'string') {
    throw new Error(`${label} must be a string.`);
  }

  return assertNonEmptyText(value, label);
}

function readRequiredYamlString(object: Record<string, unknown>, key: string, label: string): string {
  if (!(key in object)) {
    throw new Error(`Missing required key ${key} in ${label}.`);
  }

  return readYamlString(object[key], `${label}.${key}`);
}

function readOptionalYamlString(object: Record<string, unknown>, key: string, label: string): string | undefined {
  const value = object[key];

  if (value === undefined || value === null) {
    return undefined;
  }

  return readYamlString(value, `${label}.${key}`);
}

function readYamlStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be a YAML list.`);
  }

  return value.map((entry, index) => readYamlString(entry, `${label}[${index}]`));
}

function readOptionalYamlStringArray(
  object: Record<string, unknown>,
  key: string,
  label: string,
): string[] | undefined {
  const value = object[key];

  if (value === undefined || value === null) {
    return undefined;
  }

  return readYamlStringArray(value, `${label}.${key}`);
}

function readRequiredYamlObject(
  object: Record<string, unknown>,
  key: string,
  label: string,
): Record<string, unknown> {
  if (!(key in object)) {
    throw new Error(`Missing required key ${key} in ${label}.`);
  }

  return assertPlainObject(object[key], `${label}.${key}`);
}

function parseYamlDocument(yaml: string, label: string): Record<string, unknown> {
  const parsed = parseYaml(yaml);
  return assertPlainObject(parsed, label);
}

function stringifyYamlDocument(value: Record<string, unknown>): string {
  return stringifyYaml(value, {
    lineWidth: 0,
    indent: 2,
    minContentWidth: 0,
  }).trimEnd() + '\n';
}

function validateProjectPlan(
  milestones: ProjectMilestoneDocument[],
  tasks: ProjectTaskDocument[],
  currentMilestoneId: string | undefined,
  label: string,
): void {
  const seenMilestoneIds = new Set<string>();

  for (const milestone of milestones) {
    if (seenMilestoneIds.has(milestone.id)) {
      throw new Error(`Duplicate milestone id in ${label}: ${milestone.id}`);
    }

    seenMilestoneIds.add(milestone.id);
  }

  if (currentMilestoneId && !seenMilestoneIds.has(currentMilestoneId)) {
    throw new Error(`Current milestone id ${currentMilestoneId} does not exist in ${label}.`);
  }

  const seenTaskIds = new Set<string>();
  for (const task of tasks) {
    if (seenTaskIds.has(task.id)) {
      throw new Error(`Duplicate task id in ${label}: ${task.id}`);
    }

    seenTaskIds.add(task.id);

    if (task.milestoneId && !seenMilestoneIds.has(task.milestoneId)) {
      throw new Error(`Task ${task.id} references missing milestone ${task.milestoneId} in ${label}.`);
    }
  }
}

function parseProjectMilestone(value: unknown, label: string): ProjectMilestoneDocument {
  const object = assertPlainObject(value, label);

  return {
    id: readRequiredYamlString(object, 'id', label),
    title: readRequiredYamlString(object, 'title', label),
    status: readRequiredYamlString(object, 'status', label),
    summary: readOptionalYamlString(object, 'summary', label),
  };
}

function parseProjectTaskValue(value: unknown, label: string): ProjectTaskDocument {
  const object = assertPlainObject(value, label);

  return {
    id: readRequiredYamlString(object, 'id', label),
    status: readRequiredYamlString(object, 'status', label),
    title: readRequiredYamlString(object, 'title', label),
    milestoneId: readOptionalYamlString(object, 'milestoneId', label),
  };
}

function parseProjectRequirements(object: Record<string, unknown>, label: string): ProjectRequirementsDocument {
  return {
    goal: readRequiredYamlString(object, 'goal', label),
    acceptanceCriteria: readOptionalYamlStringArray(object, 'acceptanceCriteria', label) ?? [],
  };
}

function formatProjectPlan(plan: ProjectPlanDocument): Record<string, unknown> {
  const milestones = plan.milestones.map((milestone, index) => ({
    id: assertNonEmptyText(milestone.id, `Project milestone[${index}] id`),
    title: assertNonEmptyText(milestone.title, `Project milestone[${index}] title`),
    status: assertNonEmptyText(milestone.status, `Project milestone[${index}] status`),
    ...(normalizeOptionalText(milestone.summary, `Project milestone[${index}] summary`)
      ? { summary: normalizeOptionalText(milestone.summary, `Project milestone[${index}] summary`) }
      : {}),
  }));
  const tasks = plan.tasks.map((task, index) => ({
    id: assertNonEmptyText(task.id, `Project task[${index}] id`),
    status: assertNonEmptyText(task.status, `Project task[${index}] status`),
    title: assertNonEmptyText(task.title, `Project task[${index}] title`),
    ...(normalizeOptionalText(task.milestoneId, `Project task[${index}] milestoneId`)
      ? { milestoneId: normalizeOptionalText(task.milestoneId, `Project task[${index}] milestoneId`) }
      : {}),
  }));

  validateProjectPlan(milestones, tasks, normalizeOptionalText(plan.currentMilestoneId, 'Project plan currentMilestoneId'), 'Project plan');

  return {
    ...(normalizeOptionalText(plan.currentMilestoneId, 'Project plan currentMilestoneId')
      ? { currentMilestoneId: normalizeOptionalText(plan.currentMilestoneId, 'Project plan currentMilestoneId') }
      : {}),
    milestones,
    tasks,
  };
}

export function createInitialProject(input: {
  id: string;
  ownerProfile: string;
  title: string;
  description: string;
  repoRoot?: string;
  createdAt: string;
  updatedAt?: string;
}): ProjectDocument {
  const title = assertNonEmptyText(input.title, 'Project title');
  const description = assertNonEmptyText(input.description, 'Project description');
  const repoRoot = normalizeOptionalText(input.repoRoot, 'Project repoRoot');
  const createdAt = assertNonEmptyText(input.createdAt, 'Project createdAt');
  const updatedAt = assertNonEmptyText(input.updatedAt ?? input.createdAt, 'Project updatedAt');

  return {
    id: assertNonEmptyText(input.id, 'Project id'),
    ownerProfile: assertNonEmptyText(input.ownerProfile, 'Project ownerProfile'),
    createdAt,
    updatedAt,
    title,
    description,
    ...(repoRoot ? { repoRoot } : {}),
    summary: description,
    requirements: {
      goal: description,
      acceptanceCriteria: [],
    },
    status: 'active',
    blockers: [],
    recentProgress: [],
    plan: {
      milestones: [],
      tasks: [],
    },
  };
}

function formatProjectState(document: ProjectDocument): Record<string, unknown> {
  const plan = formatProjectPlan(document.plan);
  const archivedAt = normalizeOptionalText(document.archivedAt, 'Project archivedAt');
  const repoRoot = normalizeOptionalText(document.repoRoot, 'Project repoRoot');
  const currentFocus = normalizeOptionalText(document.currentFocus, 'Project currentFocus');
  const planSummary = normalizeOptionalText(document.planSummary, 'Project planSummary');
  const completionSummary = normalizeOptionalText(document.completionSummary, 'Project completionSummary');

  return {
    id: assertNonEmptyText(document.id, 'Project id'),
    ownerProfile: assertNonEmptyText(document.ownerProfile, 'Project ownerProfile'),
    createdAt: assertNonEmptyText(document.createdAt, 'Project createdAt'),
    updatedAt: assertNonEmptyText(document.updatedAt, 'Project updatedAt'),
    ...(archivedAt ? { archivedAt } : {}),
    title: assertNonEmptyText(document.title, 'Project title'),
    description: assertNonEmptyText(document.description, 'Project description'),
    ...(repoRoot ? { repoRoot } : {}),
    summary: assertNonEmptyText(document.summary, 'Project summary'),
    requirements: {
      goal: assertNonEmptyText(document.requirements.goal, 'Project requirements.goal'),
      acceptanceCriteria: document.requirements.acceptanceCriteria.map((criterion, index) =>
        assertNonEmptyText(criterion, `Project requirements.acceptanceCriteria[${index}]`)),
    },
    status: assertNonEmptyText(document.status, 'Project status'),
    blockers: document.blockers.map((blocker, index) => assertNonEmptyText(blocker, `Project blockers[${index}]`)),
    ...(currentFocus ? { currentFocus } : {}),
    recentProgress: document.recentProgress.map((entry, index) => assertNonEmptyText(entry, `Project recentProgress[${index}]`)),
    ...(planSummary ? { planSummary } : {}),
    ...(completionSummary ? { completionSummary } : {}),
    plan,
  };
}

function buildProjectIndexFrontmatter(document: ProjectDocument): Record<string, unknown> {
  return {
    id: assertNonEmptyText(document.id, 'Project id'),
    kind: 'project',
    title: assertNonEmptyText(document.title, 'Project title'),
    summary: assertNonEmptyText(document.summary, 'Project summary'),
    status: assertNonEmptyText(document.status, 'Project status'),
    ownerProfile: assertNonEmptyText(document.ownerProfile, 'Project ownerProfile'),
    createdAt: assertNonEmptyText(document.createdAt, 'Project createdAt'),
    updatedAt: assertNonEmptyText(document.updatedAt, 'Project updatedAt'),
  };
}

function splitMarkdownNode(markdown: string, label: string): { frontmatter: Record<string, unknown>; body: string } {
  const normalized = normalizeMarkdown(markdown);
  if (!normalized.startsWith(`${FRONTMATTER_DELIMITER}\n`)) {
    throw new Error(`${label} markdown must start with YAML frontmatter.`);
  }

  const secondDelimiterIndex = normalized.indexOf(`\n${FRONTMATTER_DELIMITER}\n`, FRONTMATTER_DELIMITER.length + 1);
  if (secondDelimiterIndex === -1) {
    throw new Error(`Missing closing frontmatter delimiter in ${label} markdown.`);
  }

  const frontmatterRaw = normalized.slice(FRONTMATTER_DELIMITER.length + 1, secondDelimiterIndex);
  const parsed = parseYaml(frontmatterRaw);
  const frontmatter = assertPlainObject(parsed, `${label} frontmatter`);
  const body = normalized.slice(secondDelimiterIndex + (`\n${FRONTMATTER_DELIMITER}\n`).length).trim();

  return { frontmatter, body };
}

function formatProjectIndex(document: ProjectDocument, body: string): string {
  const frontmatter = stringifyYamlDocument(buildProjectIndexFrontmatter(document)).trimEnd();
  const normalizedBody = normalizeMarkdown(body).trim();
  return `---\n${frontmatter}\n---\n\n${normalizedBody.length > 0 ? `${normalizedBody}\n` : ''}`;
}

function buildDefaultProjectIndexBody(document: ProjectDocument): string {
  const body: string[] = [`# ${document.title}`];
  const intro = document.description.trim() || document.summary.trim() || document.requirements.goal.trim();

  if (intro) {
    body.push('', intro);
  }

  return body.join('\n').trim();
}

function parseProjectStateDocument(
  object: Record<string, unknown>,
  baseDocument: ProjectDocument,
  label: string,
): ProjectDocument {
  const planObject = object.plan === undefined
    ? { tasks: [] }
    : readRequiredYamlObject(object, 'plan', label);
  const milestoneValues = planObject.milestones;
  const taskValues = planObject.tasks;

  let parsedMilestones: ProjectMilestoneDocument[] = [];
  if (milestoneValues !== undefined) {
    if (!Array.isArray(milestoneValues)) {
      throw new Error(`${label}.plan.milestones must be a YAML list.`);
    }

    parsedMilestones = milestoneValues.map((value, index) => parseProjectMilestone(value, `${label}.plan.milestones[${index}]`));
  }

  let parsedTasks: ProjectTaskDocument[] = [];
  if (taskValues !== undefined) {
    if (!Array.isArray(taskValues)) {
      throw new Error(`${label}.plan.tasks must be a YAML list.`);
    }

    parsedTasks = taskValues.map((value, index) => parseProjectTaskValue(value, `${label}.plan.tasks[${index}]`));
  }

  const currentMilestoneId = readOptionalYamlString(planObject, 'currentMilestoneId', `${label}.plan`);
  validateProjectPlan(parsedMilestones, parsedTasks, currentMilestoneId, `${label}.plan`);

  const description = readOptionalYamlString(object, 'description', label)
    ?? baseDocument.description
    ?? baseDocument.summary;
  const requirementsValue = object.requirements;
  const requirements = requirementsValue === undefined || requirementsValue === null
    ? {
        goal: baseDocument.requirements.goal || description,
        acceptanceCriteria: baseDocument.requirements.acceptanceCriteria,
      }
    : parseProjectRequirements(assertPlainObject(requirementsValue, `${label}.requirements`), `${label}.requirements`);

  return {
    ...baseDocument,
    id: readOptionalYamlString(object, 'id', label) ?? baseDocument.id,
    ownerProfile: readOptionalYamlString(object, 'ownerProfile', label) ?? baseDocument.ownerProfile,
    createdAt: readOptionalYamlString(object, 'createdAt', label) ?? baseDocument.createdAt,
    updatedAt: readOptionalYamlString(object, 'updatedAt', label) ?? baseDocument.updatedAt,
    archivedAt: readOptionalYamlString(object, 'archivedAt', label),
    title: readOptionalYamlString(object, 'title', label) ?? baseDocument.title,
    description,
    repoRoot: readOptionalYamlString(object, 'repoRoot', label),
    summary: readOptionalYamlString(object, 'summary', label) ?? baseDocument.summary,
    requirements,
    status: readOptionalYamlString(object, 'status', label) ?? baseDocument.status,
    blockers: readOptionalYamlStringArray(object, 'blockers', label) ?? baseDocument.blockers,
    currentFocus: readOptionalYamlString(object, 'currentFocus', label) ?? baseDocument.currentFocus,
    recentProgress: readOptionalYamlStringArray(object, 'recentProgress', label) ?? baseDocument.recentProgress,
    planSummary: readOptionalYamlString(object, 'planSummary', label) ?? baseDocument.planSummary,
    completionSummary: readOptionalYamlString(object, 'completionSummary', label) ?? baseDocument.completionSummary,
    plan: {
      currentMilestoneId,
      milestones: parsedMilestones,
      tasks: parsedTasks,
    },
  };
}

function parseLegacyProjectDocument(object: Record<string, unknown>, label: string): ProjectDocument {
  const description = readOptionalYamlString(object, 'description', label)
    ?? readOptionalYamlString(object, 'summary', label)
    ?? readRequiredYamlString(object, 'title', label);
  const requirementsValue = object.requirements;
  const requirements = requirementsValue === undefined || requirementsValue === null
    ? {
        goal: description,
        acceptanceCriteria: [],
      }
    : parseProjectRequirements(assertPlainObject(requirementsValue, `${label}.requirements`), `${label}.requirements`);

  const baseDocument: ProjectDocument = {
    id: readRequiredYamlString(object, 'id', label),
    ownerProfile: readOptionalYamlString(object, 'ownerProfile', label) ?? 'shared',
    createdAt: readRequiredYamlString(object, 'createdAt', label),
    updatedAt: readRequiredYamlString(object, 'updatedAt', label),
    archivedAt: readOptionalYamlString(object, 'archivedAt', label),
    title: readRequiredYamlString(object, 'title', label),
    description,
    repoRoot: readOptionalYamlString(object, 'repoRoot', label),
    summary: readOptionalYamlString(object, 'summary', label) ?? description,
    requirements,
    status: readOptionalYamlString(object, 'status', label) ?? 'active',
    blockers: readOptionalYamlStringArray(object, 'blockers', label) ?? [],
    currentFocus: readOptionalYamlString(object, 'currentFocus', label),
    recentProgress: readOptionalYamlStringArray(object, 'recentProgress', label) ?? [],
    planSummary: readOptionalYamlString(object, 'planSummary', label),
    completionSummary: readOptionalYamlString(object, 'completionSummary', label),
    plan: {
      milestones: [],
      tasks: [],
    },
  };

  return parseProjectStateDocument(object, baseDocument, label);
}

function readProjectNode(path: string): { document: ProjectDocument; body: string } {
  const stateContent = readFileSync(path, 'utf-8');
  const stateObject = parseYamlDocument(stateContent, 'Project state');
  const indexPath = join(dirname(path), 'INDEX.md');
  const legacyBriefPath = join(dirname(path), 'BRIEF.md');
  const existingIndexPath = existsSync(indexPath) ? indexPath : existsSync(legacyBriefPath) ? legacyBriefPath : null;

  if (!existingIndexPath) {
    return {
      document: parseLegacyProjectDocument(stateObject, 'Project state'),
      body: '',
    };
  }

  const rawIndex = readFileSync(existingIndexPath, 'utf-8');
  let index: { frontmatter: Record<string, unknown>; body: string } | null = null;
  try {
    index = splitMarkdownNode(rawIndex, 'Project index');
  } catch {
    index = null;
  }

  if (!index) {
    return {
      document: parseLegacyProjectDocument(stateObject, 'Project state'),
      body: rawIndex.trim(),
    };
  }

  const frontmatter = index.frontmatter;
  const kind = readRequiredYamlString(frontmatter, 'kind', 'Project index');
  if (kind !== 'project') {
    throw new Error(`Project index kind must be project, found ${kind}.`);
  }

  const summary = readRequiredYamlString(frontmatter, 'summary', 'Project index');
  const baseDocument: ProjectDocument = {
    id: readRequiredYamlString(frontmatter, 'id', 'Project index'),
    ownerProfile: readOptionalYamlString(frontmatter, 'ownerProfile', 'Project index') ?? 'shared',
    createdAt: readRequiredYamlString(frontmatter, 'createdAt', 'Project index'),
    updatedAt: readRequiredYamlString(frontmatter, 'updatedAt', 'Project index'),
    title: readRequiredYamlString(frontmatter, 'title', 'Project index'),
    description: summary,
    summary,
    requirements: {
      goal: summary,
      acceptanceCriteria: [],
    },
    status: readRequiredYamlString(frontmatter, 'status', 'Project index'),
    blockers: [],
    recentProgress: [],
    plan: {
      milestones: [],
      tasks: [],
    },
  };

  return {
    document: parseProjectStateDocument(stateObject, baseDocument, 'Project state'),
    body: index.body,
  };
}

export function formatProject(document: ProjectDocument): string {
  return stringifyYamlDocument(formatProjectState(document));
}

export function parseProject(yaml: string, baseDocument?: ProjectDocument): ProjectDocument {
  const object = parseYamlDocument(yaml, baseDocument ? 'Project state' : 'Project');

  if (!baseDocument) {
    return parseLegacyProjectDocument(object, 'Project');
  }

  return parseProjectStateDocument(object, baseDocument, 'Project state');
}

export function readProject(path: string): ProjectDocument {
  return readProjectNode(path).document;
}

export function readProjectIndexBody(path: string): string | null {
  const indexPath = join(dirname(path), 'INDEX.md');
  const legacyBriefPath = join(dirname(path), 'BRIEF.md');
  const existingIndexPath = existsSync(indexPath) ? indexPath : existsSync(legacyBriefPath) ? legacyBriefPath : null;
  if (!existingIndexPath) {
    return null;
  }

  const raw = readFileSync(existingIndexPath, 'utf-8');
  try {
    return splitMarkdownNode(raw, 'Project index').body;
  } catch {
    return raw.trim();
  }
}

export function writeProjectIndexBody(path: string, document: ProjectDocument, body: string): void {
  const indexPath = join(dirname(path), 'INDEX.md');
  mkdirSync(dirname(indexPath), { recursive: true });
  writeFileSync(indexPath, formatProjectIndex(document, body));
}

export function writeProject(path: string, document: ProjectDocument): void {
  mkdirSync(dirname(path), { recursive: true });
  const existingBody = readProjectIndexBody(path);
  writeFileSync(path, formatProject(document));
  writeProjectIndexBody(path, document, existingBody ?? buildDefaultProjectIndexBody(document));
}

function stripWrappingQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"'))
    || (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function splitFrontmatter(markdown: string, label: string): FrontmatterSection {
  const normalized = normalizeMarkdown(markdown);
  const lines = normalized.split('\n');

  if (lines.length === 0 || lines[0]?.trim() !== FRONTMATTER_DELIMITER) {
    throw new Error(`${label} markdown must start with YAML-like frontmatter.`);
  }

  let endIndex = -1;
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index]?.trim() === FRONTMATTER_DELIMITER) {
      endIndex = index;
      break;
    }
  }

  if (endIndex === -1) {
    throw new Error(`Missing closing frontmatter delimiter in ${label} markdown.`);
  }

  const attributes: Record<string, string> = {};

  for (const line of lines.slice(1, endIndex)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      continue;
    }

    const separatorIndex = trimmed.indexOf(':');
    if (separatorIndex <= 0) {
      throw new Error(`Invalid frontmatter line in ${label} markdown: ${line}`);
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = stripWrappingQuotes(trimmed.slice(separatorIndex + 1).trim());

    if (key.length === 0) {
      throw new Error(`Invalid frontmatter key in ${label} markdown: ${line}`);
    }

    attributes[key] = value;
  }

  return {
    attributes,
    body: lines.slice(endIndex + 1).join('\n').trim(),
  };
}

function readRequiredAttribute(attributes: Record<string, string>, key: string, label: string): string {
  const value = attributes[key];

  if (typeof value !== 'string') {
    throw new Error(`Missing required frontmatter key ${key} in ${label} markdown.`);
  }

  return assertNonEmptyText(value, `${label} frontmatter key ${key}`);
}

function formatFrontmatter(attributes: Record<string, string>): string {
  const lines = Object.entries(attributes).map(([key, value]) => `${key}: ${value}`);
  return [FRONTMATTER_DELIMITER, ...lines, FRONTMATTER_DELIMITER].join('\n');
}

function parseMarkdownSections(markdownBody: string, expectedTitle: string, label: string): Record<string, string> {
  const normalized = normalizeMarkdown(markdownBody).trim();
  const lines = normalized.split('\n');

  let index = 0;
  while (index < lines.length && lines[index]?.trim().length === 0) {
    index += 1;
  }

  const expectedHeading = `# ${expectedTitle}`;
  if (lines[index]?.trim() !== expectedHeading) {
    throw new Error(`${label} markdown must start with heading: ${expectedHeading}`);
  }

  const sections: Record<string, string[]> = {};
  let currentSection: string | undefined;

  for (index += 1; index < lines.length; index += 1) {
    const line = lines[index] as string;

    if (line.startsWith('## ')) {
      const sectionName = line.slice(3).trim();
      if (sectionName.length === 0) {
        throw new Error(`Invalid empty section heading in ${label} markdown.`);
      }
      if (Object.prototype.hasOwnProperty.call(sections, sectionName)) {
        throw new Error(`Duplicate section heading in ${label} markdown: ${sectionName}`);
      }

      currentSection = sectionName;
      sections[currentSection] = [];
      continue;
    }

    if (!currentSection) {
      if (line.trim().length === 0) {
        continue;
      }
      throw new Error(`Unexpected content before first section in ${label} markdown.`);
    }

    sections[currentSection].push(line);
  }

  const output: Record<string, string> = {};

  for (const [sectionName, sectionLines] of Object.entries(sections)) {
    output[sectionName] = sectionLines.join('\n').trim();
  }

  return output;
}

function readRequiredSection(sections: Record<string, string>, key: string, label: string): string {
  const value = sections[key];

  if (typeof value !== 'string') {
    throw new Error(`Missing required section in ${label} markdown: ${key}`);
  }

  return assertNonEmptyText(value, `${label} section ${key}`);
}

function formatMarkdownDocument(title: string, sections: Array<[string, string | undefined]>): string {
  const renderedSections = sections
    .filter(([, content]) => content !== undefined)
    .map(([heading, content]) => `## ${heading}\n\n${assertNonEmptyText(content as string, `Section ${heading}`)}`);

  return `# ${title}\n\n${renderedSections.join('\n\n')}\n`;
}

function parseOptionalListAttribute(attributes: Record<string, string>, key: string): string[] | undefined {
  const raw = attributes[key];

  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return undefined;
  }

  const values = raw
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  return values.length > 0 ? values : undefined;
}

function formatOptionalListAttribute(values?: string[]): string | undefined {
  if (!values || values.length === 0) {
    return undefined;
  }

  const normalized = values
    .map((value) => assertNonEmptyText(value, 'List attribute value'))
    .join(', ');

  return normalized.length > 0 ? normalized : undefined;
}

export function createProjectActivityEntry(input: {
  id: string;
  createdAt: string;
  profile: string;
  kind: ProjectActivityEntryDocument['kind'];
  summary: string;
  details?: string;
  relatedProjectIds?: string[];
  notificationState?: ProjectActivityNotificationState;
}): ProjectActivityEntryDocument {
  return {
    id: assertNonEmptyText(input.id, 'Activity id'),
    createdAt: assertNonEmptyText(input.createdAt, 'Activity createdAt'),
    profile: assertNonEmptyText(input.profile, 'Activity profile'),
    kind: assertNonEmptyText(input.kind, 'Activity kind'),
    summary: assertNonEmptyText(input.summary, 'Activity summary'),
    details: input.details ? assertNonEmptyText(input.details, 'Activity details') : undefined,
    relatedProjectIds: input.relatedProjectIds?.map((value) => assertNonEmptyText(value, 'Related project id')),
    notificationState: input.notificationState ?? 'none',
  };
}

export function formatProjectActivityEntry(document: ProjectActivityEntryDocument): string {
  const frontmatterAttributes: Record<string, string> = {
    id: assertNonEmptyText(document.id, 'Activity id'),
    createdAt: assertNonEmptyText(document.createdAt, 'Activity createdAt'),
    profile: assertNonEmptyText(document.profile, 'Activity profile'),
    kind: assertNonEmptyText(document.kind, 'Activity kind'),
    notificationState: document.notificationState ?? 'none',
  };

  const relatedProjectIds = formatOptionalListAttribute(document.relatedProjectIds);
  if (relatedProjectIds) {
    frontmatterAttributes.relatedProjectIds = relatedProjectIds;
  }

  const frontmatter = formatFrontmatter(frontmatterAttributes);
  const body = formatMarkdownDocument('Activity', [
    ['Summary', document.summary],
    ['Details', document.details],
  ]);

  return `${frontmatter}\n${body}`;
}

export function parseProjectActivityEntry(markdown: string): ProjectActivityEntryDocument {
  const { attributes, body } = splitFrontmatter(markdown, 'Activity');
  const sections = parseMarkdownSections(body, 'Activity', 'Activity');

  return {
    id: readRequiredAttribute(attributes, 'id', 'Activity'),
    createdAt: readRequiredAttribute(attributes, 'createdAt', 'Activity'),
    profile: readRequiredAttribute(attributes, 'profile', 'Activity'),
    kind: readRequiredAttribute(attributes, 'kind', 'Activity'),
    summary: readRequiredSection(sections, 'Summary', 'Activity'),
    details: sections.Details ? assertNonEmptyText(sections.Details, 'Activity section Details') : undefined,
    relatedProjectIds: parseOptionalListAttribute(attributes, 'relatedProjectIds'),
    notificationState: (attributes.notificationState as ProjectActivityNotificationState | undefined) ?? 'none',
  };
}

export function readProjectActivityEntry(path: string): ProjectActivityEntryDocument {
  return parseProjectActivityEntry(readFileSync(path, 'utf-8'));
}

export function writeProjectActivityEntry(path: string, document: ProjectActivityEntryDocument): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, formatProjectActivityEntry(document));
}

export function createProjectTask(input: {
  id: string;
  status: ProjectTaskDocument['status'];
  title: string;
  milestoneId?: string;
}): ProjectTaskDocument {
  const milestoneId = normalizeOptionalText(input.milestoneId, 'Task milestoneId');

  return {
    id: assertNonEmptyText(input.id, 'Task id'),
    status: assertNonEmptyText(input.status, 'Task status'),
    title: assertNonEmptyText(input.title, 'Task title'),
    ...(milestoneId ? { milestoneId } : {}),
  };
}

export function formatProjectTask(document: ProjectTaskDocument): string {
  const output: Record<string, unknown> = {
    id: assertNonEmptyText(document.id, 'Task id'),
    status: assertNonEmptyText(document.status, 'Task status'),
    title: assertNonEmptyText(document.title, 'Task title'),
    ...(normalizeOptionalText(document.milestoneId, 'Task milestoneId')
      ? { milestoneId: normalizeOptionalText(document.milestoneId, 'Task milestoneId') }
      : {}),
  };

  return stringifyYamlDocument(output);
}

export function parseProjectTask(yaml: string): ProjectTaskDocument {
  const object = parseYamlDocument(yaml, 'Task');

  return {
    id: readRequiredYamlString(object, 'id', 'Task'),
    status: readRequiredYamlString(object, 'status', 'Task'),
    title: readRequiredYamlString(object, 'title', 'Task'),
    milestoneId: readOptionalYamlString(object, 'milestoneId', 'Task'),
  };
}

export function readProjectTask(path: string): ProjectTaskDocument {
  return parseProjectTask(readFileSync(path, 'utf-8'));
}

export function writeProjectTask(path: string, document: ProjectTaskDocument): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, formatProjectTask(document));
}

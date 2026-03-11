import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname } from 'path';

const FRONTMATTER_DELIMITER = '---';

export type ProjectStatus = 'active' | 'blocked' | 'completed' | 'on-hold' | 'cancelled';

export interface ProjectDocument {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: ProjectStatus | (string & {});
  title: string;
  objective: string;
  currentStatus: string;
  blockers?: string;
  nextActions?: string;
  relatedConversationIds?: string[];
}

export interface ProjectPlanStep {
  text: string;
  completed: boolean;
}

export interface ProjectPlanDocument {
  id: string;
  updatedAt: string;
  objective: string;
  steps: ProjectPlanStep[];
}

export type ProjectTaskStatus = 'backlog' | 'ready' | 'running' | 'blocked' | 'done' | 'cancelled';

export interface ProjectTaskDocument {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: ProjectTaskStatus | (string & {});
  title: string;
  objective: string;
  acceptanceCriteria?: string[];
  dependencies?: string[];
  notes?: string;
  relatedConversationIds?: string[];
}

export type ProjectTaskCriterionStatus = 'pass' | 'fail' | 'pending';

export interface ProjectTaskCriterionValidation {
  criterion: string;
  status: ProjectTaskCriterionStatus;
  evidence: string;
}

export interface ProjectTaskSummaryDocument {
  taskId: string;
  createdAt: string;
  updatedAt: string;
  outcome: string;
  summary: string;
  criteriaValidation?: ProjectTaskCriterionValidation[];
  keyChanges?: string[];
  artifacts?: string[];
  followUps?: string[];
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

function parseChecklist(content: string): ProjectPlanStep[] {
  const steps: ProjectPlanStep[] = [];

  for (const rawLine of normalizeMarkdown(content).split('\n')) {
    const line = rawLine.trim();
    if (line.length === 0) {
      continue;
    }

    const match = /^- \[( |x)\] (.+)$/.exec(line);
    if (!match) {
      throw new Error(`Invalid checklist step: ${rawLine}`);
    }

    const text = assertNonEmptyText(match[2] ?? '', 'Plan step text');
    steps.push({
      text,
      completed: (match[1] ?? ' ') === 'x',
    });
  }

  if (steps.length === 0) {
    throw new Error('Plan must contain at least one checklist step.');
  }

  return steps;
}

function formatChecklist(steps: ProjectPlanStep[]): string {
  if (steps.length === 0) {
    throw new Error('Plan must contain at least one step.');
  }

  return steps
    .map((step) => {
      const text = assertNonEmptyText(step.text, 'Plan step text');
      return `- [${step.completed ? 'x' : ' '}] ${text}`;
    })
    .join('\n');
}

function parseBulletList(content: string, label: string): string[] {
  const items: string[] = [];

  for (const rawLine of normalizeMarkdown(content).split('\n')) {
    const line = rawLine.trim();
    if (line.length === 0) {
      continue;
    }

    const match = /^- (.+)$/.exec(line);
    if (!match) {
      throw new Error(`Invalid bullet list item in ${label}: ${rawLine}`);
    }

    items.push(assertNonEmptyText(match[1] ?? '', `${label} item`));
  }

  return items;
}

function formatBulletList(items: string[], label: string): string {
  if (items.length === 0) {
    throw new Error(`${label} must contain at least one item.`);
  }

  return items
    .map((item) => `- ${assertNonEmptyText(item, `${label} item`)}`)
    .join('\n');
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

function parseCriteriaValidation(content: string): ProjectTaskCriterionValidation[] {
  const items: ProjectTaskCriterionValidation[] = [];

  for (const rawLine of normalizeMarkdown(content).split('\n')) {
    const line = rawLine.trim();
    if (line.length === 0) {
      continue;
    }

    const match = /^- \[(pass|fail|pending)\] (.+?)(?: :: (.+))?$/.exec(line);
    if (!match) {
      throw new Error(`Invalid criteria validation item: ${rawLine}`);
    }

    items.push({
      status: match[1] as ProjectTaskCriterionStatus,
      criterion: assertNonEmptyText(match[2] ?? '', 'Criteria validation criterion'),
      evidence: (match[3] ?? '').trim(),
    });
  }

  return items;
}

function formatCriteriaValidation(items: ProjectTaskCriterionValidation[]): string {
  if (items.length === 0) {
    throw new Error('Criteria validation must contain at least one item.');
  }

  return items
    .map((item) => {
      const criterion = assertNonEmptyText(item.criterion, 'Criteria validation criterion');
      const evidence = item.evidence.trim();
      return `- [${item.status}] ${criterion}${evidence.length > 0 ? ` :: ${evidence}` : ''}`;
    })
    .join('\n');
}

export function createInitialProjectDocument(input: {
  id: string;
  title: string;
  objective: string;
  createdAt: string;
  updatedAt?: string;
}): ProjectDocument {
  const objective = assertNonEmptyText(input.objective, 'Project objective');
  const updatedAt = input.updatedAt ?? input.createdAt;

  return {
    id: assertNonEmptyText(input.id, 'Project id'),
    createdAt: assertNonEmptyText(input.createdAt, 'Project createdAt'),
    updatedAt: assertNonEmptyText(updatedAt, 'Project updatedAt'),
    status: 'active',
    title: assertNonEmptyText(input.title, 'Project title'),
    objective,
    currentStatus: 'Project created.',
    blockers: 'None.',
    nextActions: 'Break the work into tasks and start execution.',
  };
}

export function createInitialProjectPlan(input: {
  id: string;
  objective: string;
  updatedAt: string;
}): ProjectPlanDocument {
  return {
    id: assertNonEmptyText(input.id, 'Plan id'),
    updatedAt: assertNonEmptyText(input.updatedAt, 'Plan updatedAt'),
    objective: assertNonEmptyText(input.objective, 'Plan objective'),
    steps: [
      { text: 'Refine the project plan', completed: false },
      { text: 'Break the project into tasks', completed: false },
      { text: 'Execute and verify the work', completed: false },
    ],
  };
}

export function formatProjectDocument(document: ProjectDocument): string {
  const frontmatterAttributes: Record<string, string> = {
    id: assertNonEmptyText(document.id, 'Project id'),
    createdAt: assertNonEmptyText(document.createdAt, 'Project createdAt'),
    updatedAt: assertNonEmptyText(document.updatedAt, 'Project updatedAt'),
    status: assertNonEmptyText(document.status, 'Project status'),
  };

  const relatedConversationIds = formatOptionalListAttribute(document.relatedConversationIds);
  if (relatedConversationIds) {
    frontmatterAttributes.relatedConversationIds = relatedConversationIds;
  }

  const frontmatter = formatFrontmatter(frontmatterAttributes);
  const body = formatMarkdownDocument('Project', [
    ['Title', document.title],
    ['Objective', document.objective],
    ['Current status', document.currentStatus],
    ['Blockers', document.blockers],
    ['Next actions', document.nextActions],
  ]);

  return `${frontmatter}\n${body}`;
}

export function parseProjectDocument(markdown: string): ProjectDocument {
  const { attributes, body } = splitFrontmatter(markdown, 'Project');
  const sections = parseMarkdownSections(body, 'Project', 'Project');

  return {
    id: readRequiredAttribute(attributes, 'id', 'Project'),
    createdAt: readRequiredAttribute(attributes, 'createdAt', 'Project'),
    updatedAt: readRequiredAttribute(attributes, 'updatedAt', 'Project'),
    status: readRequiredAttribute(attributes, 'status', 'Project'),
    title: readRequiredSection(sections, 'Title', 'Project'),
    objective: readRequiredSection(sections, 'Objective', 'Project'),
    currentStatus: readRequiredSection(sections, 'Current status', 'Project'),
    blockers: sections.Blockers ? assertNonEmptyText(sections.Blockers, 'Project section Blockers') : undefined,
    nextActions: sections['Next actions'] ? assertNonEmptyText(sections['Next actions'], 'Project section Next actions') : undefined,
    relatedConversationIds: parseOptionalListAttribute(attributes, 'relatedConversationIds'),
  };
}

export function readProjectDocument(path: string): ProjectDocument {
  return parseProjectDocument(readFileSync(path, 'utf-8'));
}

export function writeProjectDocument(path: string, document: ProjectDocument): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, formatProjectDocument(document));
}

export function formatProjectPlan(document: ProjectPlanDocument): string {
  const frontmatter = formatFrontmatter({
    id: assertNonEmptyText(document.id, 'Plan id'),
    updatedAt: assertNonEmptyText(document.updatedAt, 'Plan updatedAt'),
  });

  const body = formatMarkdownDocument('Plan', [
    ['Objective', document.objective],
    ['Steps', formatChecklist(document.steps)],
  ]);

  return `${frontmatter}\n${body}`;
}

export function parseProjectPlan(markdown: string): ProjectPlanDocument {
  const { attributes, body } = splitFrontmatter(markdown, 'Plan');
  const sections = parseMarkdownSections(body, 'Plan', 'Plan');

  return {
    id: readRequiredAttribute(attributes, 'id', 'Plan'),
    updatedAt: readRequiredAttribute(attributes, 'updatedAt', 'Plan'),
    objective: readRequiredSection(sections, 'Objective', 'Plan'),
    steps: parseChecklist(readRequiredSection(sections, 'Steps', 'Plan')),
  };
}

export function readProjectPlan(path: string): ProjectPlanDocument {
  return parseProjectPlan(readFileSync(path, 'utf-8'));
}

export function writeProjectPlan(path: string, document: ProjectPlanDocument): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, formatProjectPlan(document));
}

export function createProjectTask(input: {
  id: string;
  createdAt: string;
  updatedAt?: string;
  status?: ProjectTaskDocument['status'];
  title: string;
  objective: string;
  acceptanceCriteria?: string[];
  dependencies?: string[];
  notes?: string;
  relatedConversationIds?: string[];
}): ProjectTaskDocument {
  return {
    id: assertNonEmptyText(input.id, 'Task id'),
    createdAt: assertNonEmptyText(input.createdAt, 'Task createdAt'),
    updatedAt: assertNonEmptyText(input.updatedAt ?? input.createdAt, 'Task updatedAt'),
    status: assertNonEmptyText(input.status ?? 'backlog', 'Task status'),
    title: assertNonEmptyText(input.title, 'Task title'),
    objective: assertNonEmptyText(input.objective, 'Task objective'),
    acceptanceCriteria: input.acceptanceCriteria?.map((value) => assertNonEmptyText(value, 'Task acceptance criterion')),
    dependencies: input.dependencies?.map((value) => assertNonEmptyText(value, 'Task dependency')),
    notes: input.notes ? assertNonEmptyText(input.notes, 'Task notes') : undefined,
    relatedConversationIds: input.relatedConversationIds?.map((value) => assertNonEmptyText(value, 'Related conversation id')),
  };
}

export function formatProjectTask(document: ProjectTaskDocument): string {
  const frontmatterAttributes: Record<string, string> = {
    id: assertNonEmptyText(document.id, 'Task id'),
    createdAt: assertNonEmptyText(document.createdAt, 'Task createdAt'),
    updatedAt: assertNonEmptyText(document.updatedAt, 'Task updatedAt'),
    status: assertNonEmptyText(document.status, 'Task status'),
  };

  const relatedConversationIds = formatOptionalListAttribute(document.relatedConversationIds);
  if (relatedConversationIds) {
    frontmatterAttributes.relatedConversationIds = relatedConversationIds;
  }

  const frontmatter = formatFrontmatter(frontmatterAttributes);
  const body = formatMarkdownDocument('Task', [
    ['Title', document.title],
    ['Objective', document.objective],
    ['Acceptance criteria', document.acceptanceCriteria && document.acceptanceCriteria.length > 0 ? formatBulletList(document.acceptanceCriteria, 'Acceptance criteria') : undefined],
    ['Dependencies', document.dependencies && document.dependencies.length > 0 ? formatBulletList(document.dependencies, 'Dependencies') : undefined],
    ['Notes', document.notes],
  ]);

  return `${frontmatter}\n${body}`;
}

export function parseProjectTask(markdown: string): ProjectTaskDocument {
  const { attributes, body } = splitFrontmatter(markdown, 'Task');
  const sections = parseMarkdownSections(body, 'Task', 'Task');

  return {
    id: readRequiredAttribute(attributes, 'id', 'Task'),
    createdAt: readRequiredAttribute(attributes, 'createdAt', 'Task'),
    updatedAt: readRequiredAttribute(attributes, 'updatedAt', 'Task'),
    status: readRequiredAttribute(attributes, 'status', 'Task'),
    title: readRequiredSection(sections, 'Title', 'Task'),
    objective: readRequiredSection(sections, 'Objective', 'Task'),
    acceptanceCriteria: sections['Acceptance criteria'] ? parseBulletList(sections['Acceptance criteria'], 'Acceptance criteria') : undefined,
    dependencies: sections.Dependencies ? parseBulletList(sections.Dependencies, 'Dependencies') : undefined,
    notes: sections.Notes ? assertNonEmptyText(sections.Notes, 'Task section Notes') : undefined,
    relatedConversationIds: parseOptionalListAttribute(attributes, 'relatedConversationIds'),
  };
}

export function readProjectTask(path: string): ProjectTaskDocument {
  return parseProjectTask(readFileSync(path, 'utf-8'));
}

export function writeProjectTask(path: string, document: ProjectTaskDocument): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, formatProjectTask(document));
}

export function createProjectTaskSummary(input: {
  taskId: string;
  createdAt: string;
  updatedAt?: string;
  outcome: string;
  summary: string;
  criteriaValidation?: ProjectTaskCriterionValidation[];
  keyChanges?: string[];
  artifacts?: string[];
  followUps?: string[];
}): ProjectTaskSummaryDocument {
  return {
    taskId: assertNonEmptyText(input.taskId, 'Task summary taskId'),
    createdAt: assertNonEmptyText(input.createdAt, 'Task summary createdAt'),
    updatedAt: assertNonEmptyText(input.updatedAt ?? input.createdAt, 'Task summary updatedAt'),
    outcome: assertNonEmptyText(input.outcome, 'Task summary outcome'),
    summary: assertNonEmptyText(input.summary, 'Task summary summary'),
    criteriaValidation: input.criteriaValidation?.map((item) => ({
      criterion: assertNonEmptyText(item.criterion, 'Criteria validation criterion'),
      status: item.status,
      evidence: item.evidence.trim(),
    })),
    keyChanges: input.keyChanges?.map((value) => assertNonEmptyText(value, 'Task summary key change')),
    artifacts: input.artifacts?.map((value) => assertNonEmptyText(value, 'Task summary artifact')),
    followUps: input.followUps?.map((value) => assertNonEmptyText(value, 'Task summary follow-up')),
  };
}

export function formatProjectTaskSummary(document: ProjectTaskSummaryDocument): string {
  const frontmatter = formatFrontmatter({
    taskId: assertNonEmptyText(document.taskId, 'Task summary taskId'),
    createdAt: assertNonEmptyText(document.createdAt, 'Task summary createdAt'),
    updatedAt: assertNonEmptyText(document.updatedAt, 'Task summary updatedAt'),
  });

  const body = formatMarkdownDocument('Task Summary', [
    ['Outcome', document.outcome],
    ['Summary', document.summary],
    ['Criteria validation', document.criteriaValidation && document.criteriaValidation.length > 0 ? formatCriteriaValidation(document.criteriaValidation) : undefined],
    ['Key changes', document.keyChanges && document.keyChanges.length > 0 ? formatBulletList(document.keyChanges, 'Key changes') : undefined],
    ['Artifacts', document.artifacts && document.artifacts.length > 0 ? formatBulletList(document.artifacts, 'Artifacts') : undefined],
    ['Follow-ups', document.followUps && document.followUps.length > 0 ? formatBulletList(document.followUps, 'Follow-ups') : undefined],
  ]);

  return `${frontmatter}\n${body}`;
}

export function parseProjectTaskSummary(markdown: string): ProjectTaskSummaryDocument {
  const { attributes, body } = splitFrontmatter(markdown, 'Task Summary');
  const sections = parseMarkdownSections(body, 'Task Summary', 'Task Summary');

  return {
    taskId: readRequiredAttribute(attributes, 'taskId', 'Task Summary'),
    createdAt: readRequiredAttribute(attributes, 'createdAt', 'Task Summary'),
    updatedAt: readRequiredAttribute(attributes, 'updatedAt', 'Task Summary'),
    outcome: readRequiredSection(sections, 'Outcome', 'Task Summary'),
    summary: readRequiredSection(sections, 'Summary', 'Task Summary'),
    criteriaValidation: sections['Criteria validation'] ? parseCriteriaValidation(sections['Criteria validation']) : undefined,
    keyChanges: sections['Key changes'] ? parseBulletList(sections['Key changes'], 'Key changes') : undefined,
    artifacts: sections.Artifacts ? parseBulletList(sections.Artifacts, 'Artifacts') : undefined,
    followUps: sections['Follow-ups'] ? parseBulletList(sections['Follow-ups'], 'Follow-ups') : undefined,
  };
}

export function readProjectTaskSummary(path: string): ProjectTaskSummaryDocument {
  return parseProjectTaskSummary(readFileSync(path, 'utf-8'));
}

export function writeProjectTaskSummary(path: string, document: ProjectTaskSummaryDocument): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, formatProjectTaskSummary(document));
}

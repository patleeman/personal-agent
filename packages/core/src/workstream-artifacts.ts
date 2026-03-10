import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname } from 'path';

const FRONTMATTER_DELIMITER = '---';

export interface WorkstreamSummaryDocument {
  id: string;
  createdAt: string;
  updatedAt: string;
  objective: string;
  currentPlan: string;
  status: string;
  blockers: string;
  completedItems?: string;
  openTasks?: string;
}

export interface WorkstreamPlanStep {
  text: string;
  completed: boolean;
}

export interface WorkstreamPlanDocument {
  id: string;
  updatedAt: string;
  objective: string;
  steps: WorkstreamPlanStep[];
}

export type WorkstreamActivityKind =
  | 'scheduled-task'
  | 'deferred-resume'
  | 'subagent-run'
  | 'background-run'
  | 'verification'
  | 'follow-up'
  | 'note';

export type WorkstreamActivityNotificationState = 'none' | 'queued' | 'sent' | 'failed';

export interface WorkstreamActivityEntryDocument {
  id: string;
  createdAt: string;
  profile: string;
  kind: WorkstreamActivityKind | (string & {});
  summary: string;
  details?: string;
  relatedWorkstreamIds?: string[];
  relatedConversationIds?: string[];
  notificationState?: WorkstreamActivityNotificationState;
}

export type WorkstreamTaskRecordStatus = 'pending' | 'running' | 'blocked' | 'completed' | 'failed' | 'cancelled';

export interface WorkstreamTaskRecordDocument {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: WorkstreamTaskRecordStatus | (string & {});
  title: string;
  summary?: string;
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

function parseChecklist(content: string): WorkstreamPlanStep[] {
  const steps: WorkstreamPlanStep[] = [];

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

function formatChecklist(steps: WorkstreamPlanStep[]): string {
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

export function createInitialWorkstreamSummary(input: {
  id: string;
  objective: string;
  createdAt: string;
  updatedAt?: string;
}): WorkstreamSummaryDocument {
  const objective = assertNonEmptyText(input.objective, 'Summary objective');
  const updatedAt = input.updatedAt ?? input.createdAt;

  return {
    id: assertNonEmptyText(input.id, 'Summary id'),
    createdAt: assertNonEmptyText(input.createdAt, 'Summary createdAt'),
    updatedAt: assertNonEmptyText(updatedAt, 'Summary updatedAt'),
    objective,
    currentPlan: 'See [plan.md](./plan.md).',
    status: '- Created',
    blockers: '- None',
    completedItems: '- None',
    openTasks: '- None',
  };
}

export function createInitialWorkstreamPlan(input: {
  id: string;
  objective: string;
  updatedAt: string;
}): WorkstreamPlanDocument {
  return {
    id: assertNonEmptyText(input.id, 'Plan id'),
    updatedAt: assertNonEmptyText(input.updatedAt, 'Plan updatedAt'),
    objective: assertNonEmptyText(input.objective, 'Plan objective'),
    steps: [
      { text: 'Refine the plan', completed: false },
      { text: 'Execute the work', completed: false },
      { text: 'Verify the result', completed: false },
    ],
  };
}

export function formatWorkstreamSummary(document: WorkstreamSummaryDocument): string {
  const frontmatter = formatFrontmatter({
    id: assertNonEmptyText(document.id, 'Summary id'),
    createdAt: assertNonEmptyText(document.createdAt, 'Summary createdAt'),
    updatedAt: assertNonEmptyText(document.updatedAt, 'Summary updatedAt'),
  });

  const body = formatMarkdownDocument('Summary', [
    ['Objective', document.objective],
    ['Current plan', document.currentPlan],
    ['Status', document.status],
    ['Blockers', document.blockers],
    ['Completed items', document.completedItems],
    ['Open tasks', document.openTasks],
  ]);

  return `${frontmatter}\n${body}`;
}

export function parseWorkstreamSummary(markdown: string): WorkstreamSummaryDocument {
  const { attributes, body } = splitFrontmatter(markdown, 'Summary');
  const sections = parseMarkdownSections(body, 'Summary', 'Summary');

  return {
    id: readRequiredAttribute(attributes, 'id', 'Summary'),
    createdAt: readRequiredAttribute(attributes, 'createdAt', 'Summary'),
    updatedAt: readRequiredAttribute(attributes, 'updatedAt', 'Summary'),
    objective: readRequiredSection(sections, 'Objective', 'Summary'),
    currentPlan: readRequiredSection(sections, 'Current plan', 'Summary'),
    status: readRequiredSection(sections, 'Status', 'Summary'),
    blockers: readRequiredSection(sections, 'Blockers', 'Summary'),
    completedItems: sections['Completed items'] ? assertNonEmptyText(sections['Completed items'], 'Summary section Completed items') : undefined,
    openTasks: sections['Open tasks'] ? assertNonEmptyText(sections['Open tasks'], 'Summary section Open tasks') : undefined,
  };
}

export function readWorkstreamSummary(path: string): WorkstreamSummaryDocument {
  return parseWorkstreamSummary(readFileSync(path, 'utf-8'));
}

export function writeWorkstreamSummary(path: string, document: WorkstreamSummaryDocument): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, formatWorkstreamSummary(document));
}

export function formatWorkstreamPlan(document: WorkstreamPlanDocument): string {
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

export function parseWorkstreamPlan(markdown: string): WorkstreamPlanDocument {
  const { attributes, body } = splitFrontmatter(markdown, 'Plan');
  const sections = parseMarkdownSections(body, 'Plan', 'Plan');

  return {
    id: readRequiredAttribute(attributes, 'id', 'Plan'),
    updatedAt: readRequiredAttribute(attributes, 'updatedAt', 'Plan'),
    objective: readRequiredSection(sections, 'Objective', 'Plan'),
    steps: parseChecklist(readRequiredSection(sections, 'Steps', 'Plan')),
  };
}

export function readWorkstreamPlan(path: string): WorkstreamPlanDocument {
  return parseWorkstreamPlan(readFileSync(path, 'utf-8'));
}

export function writeWorkstreamPlan(path: string, document: WorkstreamPlanDocument): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, formatWorkstreamPlan(document));
}

export function createWorkstreamActivityEntry(input: {
  id: string;
  createdAt: string;
  profile: string;
  kind: WorkstreamActivityEntryDocument['kind'];
  summary: string;
  details?: string;
  relatedWorkstreamIds?: string[];
  relatedConversationIds?: string[];
  notificationState?: WorkstreamActivityNotificationState;
}): WorkstreamActivityEntryDocument {
  return {
    id: assertNonEmptyText(input.id, 'Activity id'),
    createdAt: assertNonEmptyText(input.createdAt, 'Activity createdAt'),
    profile: assertNonEmptyText(input.profile, 'Activity profile'),
    kind: assertNonEmptyText(input.kind, 'Activity kind'),
    summary: assertNonEmptyText(input.summary, 'Activity summary'),
    details: input.details ? assertNonEmptyText(input.details, 'Activity details') : undefined,
    relatedWorkstreamIds: input.relatedWorkstreamIds?.map((value) => assertNonEmptyText(value, 'Related workstream id')),
    relatedConversationIds: input.relatedConversationIds?.map((value) => assertNonEmptyText(value, 'Related conversation id')),
    notificationState: input.notificationState ?? 'none',
  };
}

export function formatWorkstreamActivityEntry(document: WorkstreamActivityEntryDocument): string {
  const frontmatterAttributes: Record<string, string> = {
    id: assertNonEmptyText(document.id, 'Activity id'),
    createdAt: assertNonEmptyText(document.createdAt, 'Activity createdAt'),
    profile: assertNonEmptyText(document.profile, 'Activity profile'),
    kind: assertNonEmptyText(document.kind, 'Activity kind'),
    notificationState: document.notificationState ?? 'none',
  };

  const relatedWorkstreamIds = formatOptionalListAttribute(document.relatedWorkstreamIds);
  if (relatedWorkstreamIds) {
    frontmatterAttributes.relatedWorkstreamIds = relatedWorkstreamIds;
  }

  const relatedConversationIds = formatOptionalListAttribute(document.relatedConversationIds);
  if (relatedConversationIds) {
    frontmatterAttributes.relatedConversationIds = relatedConversationIds;
  }

  const frontmatter = formatFrontmatter(frontmatterAttributes);
  const body = formatMarkdownDocument('Activity', [
    ['Summary', document.summary],
    ['Details', document.details],
  ]);

  return `${frontmatter}\n${body}`;
}

export function parseWorkstreamActivityEntry(markdown: string): WorkstreamActivityEntryDocument {
  const { attributes, body } = splitFrontmatter(markdown, 'Activity');
  const sections = parseMarkdownSections(body, 'Activity', 'Activity');

  return {
    id: readRequiredAttribute(attributes, 'id', 'Activity'),
    createdAt: readRequiredAttribute(attributes, 'createdAt', 'Activity'),
    profile: readRequiredAttribute(attributes, 'profile', 'Activity'),
    kind: readRequiredAttribute(attributes, 'kind', 'Activity'),
    summary: readRequiredSection(sections, 'Summary', 'Activity'),
    details: sections.Details ? assertNonEmptyText(sections.Details, 'Activity section Details') : undefined,
    relatedWorkstreamIds: parseOptionalListAttribute(attributes, 'relatedWorkstreamIds'),
    relatedConversationIds: parseOptionalListAttribute(attributes, 'relatedConversationIds'),
    notificationState: (attributes.notificationState as WorkstreamActivityNotificationState | undefined) ?? 'none',
  };
}

export function readWorkstreamActivityEntry(path: string): WorkstreamActivityEntryDocument {
  return parseWorkstreamActivityEntry(readFileSync(path, 'utf-8'));
}

export function writeWorkstreamActivityEntry(path: string, document: WorkstreamActivityEntryDocument): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, formatWorkstreamActivityEntry(document));
}

export function createWorkstreamTaskRecord(input: {
  id: string;
  createdAt: string;
  updatedAt?: string;
  status: WorkstreamTaskRecordDocument['status'];
  title: string;
  summary?: string;
}): WorkstreamTaskRecordDocument {
  return {
    id: assertNonEmptyText(input.id, 'Task record id'),
    createdAt: assertNonEmptyText(input.createdAt, 'Task record createdAt'),
    updatedAt: assertNonEmptyText(input.updatedAt ?? input.createdAt, 'Task record updatedAt'),
    status: assertNonEmptyText(input.status, 'Task record status'),
    title: assertNonEmptyText(input.title, 'Task record title'),
    summary: input.summary ? assertNonEmptyText(input.summary, 'Task record summary') : undefined,
  };
}

export function formatWorkstreamTaskRecord(document: WorkstreamTaskRecordDocument): string {
  const frontmatterAttributes: Record<string, string> = {
    id: assertNonEmptyText(document.id, 'Task record id'),
    createdAt: assertNonEmptyText(document.createdAt, 'Task record createdAt'),
    updatedAt: assertNonEmptyText(document.updatedAt, 'Task record updatedAt'),
    status: assertNonEmptyText(document.status, 'Task record status'),
  };

  const frontmatter = formatFrontmatter(frontmatterAttributes);
  const body = formatMarkdownDocument('Task Record', [
    ['Title', document.title],
    ['Summary', document.summary],
  ]);

  return `${frontmatter}\n${body}`;
}

export function parseWorkstreamTaskRecord(markdown: string): WorkstreamTaskRecordDocument {
  const { attributes, body } = splitFrontmatter(markdown, 'Task Record');
  const sections = parseMarkdownSections(body, 'Task Record', 'Task Record');

  return {
    id: readRequiredAttribute(attributes, 'id', 'Task Record'),
    createdAt: readRequiredAttribute(attributes, 'createdAt', 'Task Record'),
    updatedAt: readRequiredAttribute(attributes, 'updatedAt', 'Task Record'),
    status: readRequiredAttribute(attributes, 'status', 'Task Record'),
    title: readRequiredSection(sections, 'Title', 'Task Record'),
    summary: sections.Summary ? assertNonEmptyText(sections.Summary, 'Task Record section Summary') : undefined,
  };
}

export function readWorkstreamTaskRecord(path: string): WorkstreamTaskRecordDocument {
  return parseWorkstreamTaskRecord(readFileSync(path, 'utf-8'));
}

export function writeWorkstreamTaskRecord(path: string, document: WorkstreamTaskRecordDocument): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, formatWorkstreamTaskRecord(document));
}

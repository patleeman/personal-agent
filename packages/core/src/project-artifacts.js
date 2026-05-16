import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
const FRONTMATTER_DELIMITER = '---';
function normalizeMarkdown(markdown) {
  return markdown.replace(/\r\n/g, '\n');
}
function assertNonEmptyText(value, label) {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error(`${label} must not be empty.`);
  }
  return trimmed;
}
function normalizeIsoTimestamp(value, label) {
  const normalized = assertNonEmptyText(value, label);
  const parsed = Date.parse(normalized);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid ${label}: ${normalized}`);
  }
  return new Date(parsed).toISOString();
}
function normalizeOptionalText(value, label) {
  if (value === undefined) {
    return undefined;
  }
  return assertNonEmptyText(value, label);
}
function assertPlainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be a YAML object.`);
  }
  return value;
}
function readYamlString(value, label) {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value !== 'string') {
    throw new Error(`${label} must be a string.`);
  }
  return assertNonEmptyText(value, label);
}
function readRequiredYamlString(object, key, label) {
  if (!(key in object)) {
    throw new Error(`Missing required key ${key} in ${label}.`);
  }
  return readYamlString(object[key], `${label}.${key}`);
}
function readOptionalYamlString(object, key, label) {
  const value = object[key];
  if (value === undefined || value === null) {
    return undefined;
  }
  return readYamlString(value, `${label}.${key}`);
}
function readYamlStringArray(value, label) {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be a YAML list.`);
  }
  return value.map((entry, index) => readYamlString(entry, `${label}[${index}]`));
}
function readOptionalYamlStringArray(object, key, label) {
  const value = object[key];
  if (value === undefined || value === null) {
    return undefined;
  }
  return readYamlStringArray(value, `${label}.${key}`);
}
function readRequiredYamlObject(object, key, label) {
  if (!(key in object)) {
    throw new Error(`Missing required key ${key} in ${label}.`);
  }
  return assertPlainObject(object[key], `${label}.${key}`);
}
function parseYamlDocument(yaml, label) {
  const parsed = parseYaml(yaml);
  return assertPlainObject(parsed, label);
}
function stringifyYamlDocument(value) {
  return (
    stringifyYaml(value, {
      lineWidth: 0,
      indent: 2,
      minContentWidth: 0,
    }).trimEnd() + '\n'
  );
}
function validateProjectPlan(milestones, tasks, currentMilestoneId, label) {
  const seenMilestoneIds = new Set();
  for (const milestone of milestones) {
    if (seenMilestoneIds.has(milestone.id)) {
      throw new Error(`Duplicate milestone id in ${label}: ${milestone.id}`);
    }
    seenMilestoneIds.add(milestone.id);
  }
  if (currentMilestoneId && !seenMilestoneIds.has(currentMilestoneId)) {
    throw new Error(`Current milestone id ${currentMilestoneId} does not exist in ${label}.`);
  }
  const seenTaskIds = new Set();
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
function parseProjectMilestone(value, label) {
  const object = assertPlainObject(value, label);
  return {
    id: readRequiredYamlString(object, 'id', label),
    title: readRequiredYamlString(object, 'title', label),
    status: readRequiredYamlString(object, 'status', label),
    summary: readOptionalYamlString(object, 'summary', label),
  };
}
function parseProjectTaskValue(value, label) {
  const object = assertPlainObject(value, label);
  return {
    id: readRequiredYamlString(object, 'id', label),
    status: readRequiredYamlString(object, 'status', label),
    title: readRequiredYamlString(object, 'title', label),
    milestoneId: readOptionalYamlString(object, 'milestoneId', label),
  };
}
function parseProjectRequirements(object, label) {
  return {
    goal: readRequiredYamlString(object, 'goal', label),
    acceptanceCriteria: readOptionalYamlStringArray(object, 'acceptanceCriteria', label) ?? [],
  };
}
function formatProjectPlan(plan) {
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
export function createInitialProject(input) {
  const title = assertNonEmptyText(input.title, 'Project title');
  const description = assertNonEmptyText(input.description, 'Project description');
  const repoRoot = normalizeOptionalText(input.repoRoot, 'Project repoRoot');
  const createdAt = normalizeIsoTimestamp(input.createdAt, 'Project createdAt');
  const updatedAt = normalizeIsoTimestamp(input.updatedAt ?? input.createdAt, 'Project updatedAt');
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
function formatProjectState(document) {
  const plan = formatProjectPlan(document.plan);
  const archivedAt = normalizeOptionalText(document.archivedAt, 'Project archivedAt');
  const repoRoot = normalizeOptionalText(document.repoRoot, 'Project repoRoot');
  const currentFocus = normalizeOptionalText(document.currentFocus, 'Project currentFocus');
  const planSummary = normalizeOptionalText(document.planSummary, 'Project planSummary');
  const completionSummary = normalizeOptionalText(document.completionSummary, 'Project completionSummary');
  return {
    id: assertNonEmptyText(document.id, 'Project id'),
    ownerProfile: assertNonEmptyText(document.ownerProfile, 'Project ownerProfile'),
    createdAt: normalizeIsoTimestamp(document.createdAt, 'Project createdAt'),
    updatedAt: normalizeIsoTimestamp(document.updatedAt, 'Project updatedAt'),
    ...(archivedAt ? { archivedAt } : {}),
    title: assertNonEmptyText(document.title, 'Project title'),
    description: assertNonEmptyText(document.description, 'Project description'),
    ...(repoRoot ? { repoRoot } : {}),
    summary: assertNonEmptyText(document.summary, 'Project summary'),
    requirements: {
      goal: assertNonEmptyText(document.requirements.goal, 'Project requirements.goal'),
      acceptanceCriteria: document.requirements.acceptanceCriteria.map((criterion, index) =>
        assertNonEmptyText(criterion, `Project requirements.acceptanceCriteria[${index}]`),
      ),
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
function buildProjectIndexFrontmatter(document) {
  const ownerProfile = assertNonEmptyText(document.ownerProfile, 'Project ownerProfile');
  const tags = [`type:project`, `profile:${ownerProfile}`];
  return {
    id: assertNonEmptyText(document.id, 'Project id'),
    kind: 'project',
    title: assertNonEmptyText(document.title, 'Project title'),
    summary: assertNonEmptyText(document.summary, 'Project summary'),
    status: assertNonEmptyText(document.status, 'Project status'),
    ownerProfile,
    createdAt: normalizeIsoTimestamp(document.createdAt, 'Project createdAt'),
    updatedAt: normalizeIsoTimestamp(document.updatedAt, 'Project updatedAt'),
    tags,
  };
}
function splitMarkdownNode(markdown, label) {
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
  const body = normalized.slice(secondDelimiterIndex + `\n${FRONTMATTER_DELIMITER}\n`.length).trim();
  return { frontmatter, body };
}
function formatProjectIndex(document, body) {
  const frontmatter = stringifyYamlDocument(buildProjectIndexFrontmatter(document)).trimEnd();
  const normalizedBody = normalizeMarkdown(body).trim();
  return `---\n${frontmatter}\n---\n\n${normalizedBody.length > 0 ? `${normalizedBody}\n` : ''}`;
}
function buildDefaultProjectIndexBody(document) {
  const body = [`# ${document.title}`];
  const intro = document.description.trim() || document.summary.trim() || document.requirements.goal.trim();
  if (intro) {
    body.push('', intro);
  }
  return body.join('\n').trim();
}
function parseProjectStateDocument(object, baseDocument, label) {
  const planObject = object.plan === undefined ? { tasks: [] } : readRequiredYamlObject(object, 'plan', label);
  const milestoneValues = planObject.milestones;
  const taskValues = planObject.tasks;
  let parsedMilestones = [];
  if (milestoneValues !== undefined) {
    if (!Array.isArray(milestoneValues)) {
      throw new Error(`${label}.plan.milestones must be a YAML list.`);
    }
    parsedMilestones = milestoneValues.map((value, index) => parseProjectMilestone(value, `${label}.plan.milestones[${index}]`));
  }
  let parsedTasks = [];
  if (taskValues !== undefined) {
    if (!Array.isArray(taskValues)) {
      throw new Error(`${label}.plan.tasks must be a YAML list.`);
    }
    parsedTasks = taskValues.map((value, index) => parseProjectTaskValue(value, `${label}.plan.tasks[${index}]`));
  }
  const currentMilestoneId = readOptionalYamlString(planObject, 'currentMilestoneId', `${label}.plan`);
  validateProjectPlan(parsedMilestones, parsedTasks, currentMilestoneId, `${label}.plan`);
  const description = readOptionalYamlString(object, 'description', label) ?? baseDocument.description ?? baseDocument.summary;
  const requirementsValue = object.requirements;
  const requirements =
    requirementsValue === undefined || requirementsValue === null
      ? {
          goal: baseDocument.requirements.goal || description,
          acceptanceCriteria: baseDocument.requirements.acceptanceCriteria,
        }
      : parseProjectRequirements(assertPlainObject(requirementsValue, `${label}.requirements`), `${label}.requirements`);
  return {
    ...baseDocument,
    id: readOptionalYamlString(object, 'id', label) ?? baseDocument.id,
    ownerProfile: readOptionalYamlString(object, 'ownerProfile', label) ?? baseDocument.ownerProfile,
    createdAt: normalizeIsoTimestamp(readOptionalYamlString(object, 'createdAt', label) ?? baseDocument.createdAt, 'Project createdAt'),
    updatedAt: normalizeIsoTimestamp(readOptionalYamlString(object, 'updatedAt', label) ?? baseDocument.updatedAt, 'Project updatedAt'),
    ...(readOptionalYamlString(object, 'archivedAt', label)
      ? { archivedAt: normalizeIsoTimestamp(readOptionalYamlString(object, 'archivedAt', label), 'Project archivedAt') }
      : {}),
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
function parseLegacyProjectDocument(object, label) {
  const description =
    readOptionalYamlString(object, 'description', label) ??
    readOptionalYamlString(object, 'summary', label) ??
    readRequiredYamlString(object, 'title', label);
  const requirementsValue = object.requirements;
  const requirements =
    requirementsValue === undefined || requirementsValue === null
      ? {
          goal: description,
          acceptanceCriteria: [],
        }
      : parseProjectRequirements(assertPlainObject(requirementsValue, `${label}.requirements`), `${label}.requirements`);
  const baseDocument = {
    id: readRequiredYamlString(object, 'id', label),
    ownerProfile: readOptionalYamlString(object, 'ownerProfile', label) ?? 'shared',
    createdAt: normalizeIsoTimestamp(readRequiredYamlString(object, 'createdAt', label), 'Project createdAt'),
    updatedAt: normalizeIsoTimestamp(readRequiredYamlString(object, 'updatedAt', label), 'Project updatedAt'),
    ...(readOptionalYamlString(object, 'archivedAt', label)
      ? { archivedAt: normalizeIsoTimestamp(readOptionalYamlString(object, 'archivedAt', label), 'Project archivedAt') }
      : {}),
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
function readProjectNode(path) {
  const stateContent = readFileSync(path, 'utf-8');
  const stateObject = parseYamlDocument(stateContent, 'Project state');
  const projectDocPath = join(dirname(path), 'project.md');
  const legacyIndexPath = join(dirname(path), 'INDEX.md');
  const legacyBriefPath = join(dirname(path), 'BRIEF.md');
  const existingIndexPath = existsSync(projectDocPath)
    ? projectDocPath
    : existsSync(legacyIndexPath)
      ? legacyIndexPath
      : existsSync(legacyBriefPath)
        ? legacyBriefPath
        : null;
  if (!existingIndexPath) {
    return {
      document: parseLegacyProjectDocument(stateObject, 'Project state'),
      body: '',
    };
  }
  const rawIndex = readFileSync(existingIndexPath, 'utf-8');
  let index = null;
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
  const baseDocument = {
    id: readRequiredYamlString(frontmatter, 'id', 'Project index'),
    ownerProfile: readOptionalYamlString(frontmatter, 'ownerProfile', 'Project index') ?? 'shared',
    createdAt: normalizeIsoTimestamp(readRequiredYamlString(frontmatter, 'createdAt', 'Project index'), 'Project createdAt'),
    updatedAt: normalizeIsoTimestamp(readRequiredYamlString(frontmatter, 'updatedAt', 'Project index'), 'Project updatedAt'),
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
export function formatProject(document) {
  return stringifyYamlDocument(formatProjectState(document));
}
export function parseProject(yaml, baseDocument) {
  const object = parseYamlDocument(yaml, baseDocument ? 'Project state' : 'Project');
  if (!baseDocument) {
    return parseLegacyProjectDocument(object, 'Project');
  }
  return parseProjectStateDocument(object, baseDocument, 'Project state');
}
export function readProject(path) {
  return readProjectNode(path).document;
}
export function readProjectIndexBody(path) {
  const projectDocPath = join(dirname(path), 'project.md');
  const legacyIndexPath = join(dirname(path), 'INDEX.md');
  const legacyBriefPath = join(dirname(path), 'BRIEF.md');
  const existingIndexPath = existsSync(projectDocPath)
    ? projectDocPath
    : existsSync(legacyIndexPath)
      ? legacyIndexPath
      : existsSync(legacyBriefPath)
        ? legacyBriefPath
        : null;
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
export function writeProjectIndexBody(path, document, body) {
  const projectDocPath = join(dirname(path), 'project.md');
  mkdirSync(dirname(projectDocPath), { recursive: true });
  writeFileSync(projectDocPath, formatProjectIndex(document, body));
}
export function writeProject(path, document) {
  mkdirSync(dirname(path), { recursive: true });
  const existingBody = readProjectIndexBody(path);
  writeFileSync(path, formatProject(document));
  writeProjectIndexBody(path, document, existingBody ?? buildDefaultProjectIndexBody(document));
}
function stripWrappingQuotes(value) {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}
function splitFrontmatter(markdown, label) {
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
  const attributes = {};
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
    body: lines
      .slice(endIndex + 1)
      .join('\n')
      .trim(),
  };
}
function readRequiredAttribute(attributes, key, label) {
  const value = attributes[key];
  if (typeof value !== 'string') {
    throw new Error(`Missing required frontmatter key ${key} in ${label} markdown.`);
  }
  return assertNonEmptyText(value, `${label} frontmatter key ${key}`);
}
function formatFrontmatter(attributes) {
  const lines = Object.entries(attributes).map(([key, value]) => `${key}: ${value}`);
  return [FRONTMATTER_DELIMITER, ...lines, FRONTMATTER_DELIMITER].join('\n');
}
function parseMarkdownSections(markdownBody, expectedTitle, label) {
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
  const sections = {};
  let currentSection;
  for (index += 1; index < lines.length; index += 1) {
    const line = lines[index];
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
  const output = {};
  for (const [sectionName, sectionLines] of Object.entries(sections)) {
    output[sectionName] = sectionLines.join('\n').trim();
  }
  return output;
}
function readRequiredSection(sections, key, label) {
  const value = sections[key];
  if (typeof value !== 'string') {
    throw new Error(`Missing required section in ${label} markdown: ${key}`);
  }
  return assertNonEmptyText(value, `${label} section ${key}`);
}
function formatMarkdownDocument(title, sections) {
  const renderedSections = sections
    .filter(([, content]) => content !== undefined)
    .map(([heading, content]) => `## ${heading}\n\n${assertNonEmptyText(content, `Section ${heading}`)}`);
  return `# ${title}\n\n${renderedSections.join('\n\n')}\n`;
}
function parseOptionalListAttribute(attributes, key) {
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
function normalizeStringList(values, label) {
  if (!values || values.length === 0) {
    return undefined;
  }
  const seen = new Set();
  const normalized = [];
  for (const value of values) {
    const item = assertNonEmptyText(value, label);
    if (seen.has(item)) continue;
    seen.add(item);
    normalized.push(item);
  }
  return normalized.length > 0 ? normalized : undefined;
}
function formatOptionalListAttribute(values) {
  const normalized = normalizeStringList(values, 'List attribute value');
  return normalized ? normalized.join(', ') : undefined;
}
export function createProjectActivityEntry(input) {
  return {
    id: assertNonEmptyText(input.id, 'Activity id'),
    createdAt: normalizeIsoTimestamp(input.createdAt, 'Activity createdAt'),
    profile: assertNonEmptyText(input.profile, 'Activity profile'),
    kind: assertNonEmptyText(input.kind, 'Activity kind'),
    summary: assertNonEmptyText(input.summary, 'Activity summary'),
    details: input.details ? assertNonEmptyText(input.details, 'Activity details') : undefined,
    relatedProjectIds: normalizeStringList(input.relatedProjectIds, 'Related project id'),
    notificationState: input.notificationState ?? 'none',
  };
}
export function formatProjectActivityEntry(document) {
  const frontmatterAttributes = {
    id: assertNonEmptyText(document.id, 'Activity id'),
    createdAt: normalizeIsoTimestamp(document.createdAt, 'Activity createdAt'),
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
export function parseProjectActivityEntry(markdown) {
  const { attributes, body } = splitFrontmatter(markdown, 'Activity');
  const sections = parseMarkdownSections(body, 'Activity', 'Activity');
  return {
    id: readRequiredAttribute(attributes, 'id', 'Activity'),
    createdAt: normalizeIsoTimestamp(readRequiredAttribute(attributes, 'createdAt', 'Activity'), 'Activity createdAt'),
    profile: readRequiredAttribute(attributes, 'profile', 'Activity'),
    kind: readRequiredAttribute(attributes, 'kind', 'Activity'),
    summary: readRequiredSection(sections, 'Summary', 'Activity'),
    details: sections.Details ? assertNonEmptyText(sections.Details, 'Activity section Details') : undefined,
    relatedProjectIds: parseOptionalListAttribute(attributes, 'relatedProjectIds'),
    notificationState: attributes.notificationState ?? 'none',
  };
}
export function readProjectActivityEntry(path) {
  return parseProjectActivityEntry(readFileSync(path, 'utf-8'));
}
export function writeProjectActivityEntry(path, document) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, formatProjectActivityEntry(document));
}
export function createProjectTask(input) {
  const milestoneId = normalizeOptionalText(input.milestoneId, 'Task milestoneId');
  return {
    id: assertNonEmptyText(input.id, 'Task id'),
    status: assertNonEmptyText(input.status, 'Task status'),
    title: assertNonEmptyText(input.title, 'Task title'),
    ...(milestoneId ? { milestoneId } : {}),
  };
}
export function formatProjectTask(document) {
  const output = {
    id: assertNonEmptyText(document.id, 'Task id'),
    status: assertNonEmptyText(document.status, 'Task status'),
    title: assertNonEmptyText(document.title, 'Task title'),
    ...(normalizeOptionalText(document.milestoneId, 'Task milestoneId')
      ? { milestoneId: normalizeOptionalText(document.milestoneId, 'Task milestoneId') }
      : {}),
  };
  return stringifyYamlDocument(output);
}
export function parseProjectTask(yaml) {
  const object = parseYamlDocument(yaml, 'Task');
  return {
    id: readRequiredYamlString(object, 'id', 'Task'),
    status: readRequiredYamlString(object, 'status', 'Task'),
    title: readRequiredYamlString(object, 'title', 'Task'),
    milestoneId: readOptionalYamlString(object, 'milestoneId', 'Task'),
  };
}
export function readProjectTask(path) {
  return parseProjectTask(readFileSync(path, 'utf-8'));
}
export function writeProjectTask(path, document) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, formatProjectTask(document));
}

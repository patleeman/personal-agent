import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import {
  getDurableProjectsDir,
  readProject,
  readProjectIndexBody,
  writeProject,
  writeProjectIndexBody,
} from '@personal-agent/core';

function mapProjectStatus(status) {
  switch ((status ?? '').trim()) {
    case 'done':
    case 'completed':
    case 'cancelled':
      return 'done';
    case 'paused':
    case 'blocked':
      return 'paused';
    case 'active':
    case 'created':
    case 'in_progress':
    default:
      return 'active';
  }
}

function mapTaskStatus(status) {
  switch ((status ?? '').trim()) {
    case 'done':
    case 'completed':
    case 'cancelled':
      return 'done';
    case 'doing':
    case 'in_progress':
      return 'doing';
    case 'todo':
    case 'blocked':
    case 'pending':
    default:
      return 'todo';
  }
}

function ensureTitlePrefix(title, prefix) {
  const normalizedPrefix = prefix.trim();
  const normalizedTitle = title.trim();
  if (!normalizedPrefix || !normalizedTitle) {
    return normalizedTitle;
  }

  if (normalizedTitle.toLowerCase().startsWith(`${normalizedPrefix.toLowerCase()}:`)) {
    return normalizedTitle;
  }

  return `${normalizedPrefix}: ${normalizedTitle}`;
}

function buildDocumentBody(project, existingBody, flattenedTasks) {
  const normalizedExisting = (existingBody ?? '').trim();
  if (normalizedExisting.length > 0) {
    if (normalizedExisting.startsWith('# ')) {
      return normalizedExisting;
    }

    return `# ${project.title}\n\n${normalizedExisting}`.trim();
  }

  const parts = [`# ${project.title}`];
  const intro = project.description?.trim() || project.summary?.trim() || project.requirements?.goal?.trim();
  if (intro) {
    parts.push('', intro);
  }

  const planLines = [];
  if (project.planSummary?.trim()) {
    planLines.push(project.planSummary.trim());
  }
  if (project.currentFocus?.trim()) {
    planLines.push(`Current focus: ${project.currentFocus.trim()}`);
  }
  if ((project.blockers ?? []).length > 0) {
    planLines.push('Blocked by:');
    planLines.push(...project.blockers.map((item) => `- ${item}`));
  }
  if ((project.recentProgress ?? []).length > 0) {
    planLines.push('Recent progress:');
    planLines.push(...project.recentProgress.map((item) => `- ${item}`));
  }
  if (flattenedTasks.length > 0) {
    planLines.push('Tasks:');
    planLines.push(...flattenedTasks.map((task) => `- [${task.status}] ${task.title}`));
  }
  if (planLines.length > 0) {
    parts.push('', '## Plan', '', planLines.join('\n'));
  }

  const doneLines = [];
  const acceptanceCriteria = project.requirements?.acceptanceCriteria ?? [];
  if (acceptanceCriteria.length > 0) {
    doneLines.push('Done means:');
    doneLines.push(...acceptanceCriteria.map((item) => `- ${item}`));
  }
  if (project.completionSummary?.trim()) {
    doneLines.push('', project.completionSummary.trim());
  }
  if (doneLines.length > 0) {
    parts.push('', '## Done', '', doneLines.join('\n'));
  }

  return parts.join('\n').trim();
}

function readFileMetadata(path) {
  const raw = readFileSync(path, 'utf-8');
  const parsed = JSON.parse(raw);
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
}

function writeFileMetadata(path, metadata) {
  const yaml = JSON.stringify(metadata, null, 2) + '\n';
  writeFileSync(path, yaml);
}

function uniqueTargetDir(rootDir, preferredName) {
  let candidate = preferredName;
  let index = 2;

  while (existsSync(join(rootDir, candidate))) {
    candidate = `${preferredName}-${index}`;
    index += 1;
  }

  return join(rootDir, candidate);
}

function migrateFiles(projectDir) {
  const filesDir = join(projectDir, 'files');
  mkdirSync(filesDir, { recursive: true });

  for (const sourceKind of ['attachment', 'artifact']) {
    const sourceDir = join(projectDir, `${sourceKind}s`);
    if (!existsSync(sourceDir)) {
      continue;
    }

    for (const entry of readdirSync(sourceDir)) {
      const sourceEntryDir = join(sourceDir, entry);
      if (!statSync(sourceEntryDir).isDirectory()) {
        continue;
      }

      const targetDir = uniqueTargetDir(filesDir, basename(sourceEntryDir));
      renameSync(sourceEntryDir, targetDir);

      const metadataPath = join(targetDir, 'metadata.json');
      if (existsSync(metadataPath)) {
        const metadata = readFileMetadata(metadataPath);
        metadata.sourceKind = sourceKind;
        writeFileMetadata(metadataPath, metadata);
      }
    }

    if (readdirSync(sourceDir).length === 0) {
      rmSync(sourceDir, { recursive: true, force: false });
    }
  }

  for (const entry of readdirSync(filesDir)) {
    const entryDir = join(filesDir, entry);
    if (!statSync(entryDir).isDirectory()) {
      continue;
    }

    const metadataPath = join(entryDir, 'metadata.json');
    if (!existsSync(metadataPath)) {
      continue;
    }

    const metadata = readFileMetadata(metadataPath);
    if (!metadata.sourceKind) {
      metadata.sourceKind = 'file';
      writeFileMetadata(metadataPath, metadata);
    }
  }
}

function migrateProject(projectId, projectFile, now) {
  const project = readProject(projectFile);
  const existingBody = readProjectIndexBody(projectFile) ?? '';
  const milestonesById = new Map((project.plan?.milestones ?? []).map((milestone) => [milestone.id, milestone.title]));
  const flattenedTasks = (project.plan?.tasks ?? []).map((task) => ({
    id: task.id,
    title: task.milestoneId ? ensureTitlePrefix(task.title, milestonesById.get(task.milestoneId) ?? task.milestoneId) : task.title,
    status: mapTaskStatus(task.status),
  }));

  const updatedProject = {
    ...project,
    summary: project.summary?.trim() || project.description?.trim() || project.title,
    status: mapProjectStatus(project.status),
    updatedAt: now,
    plan: {
      milestones: [],
      tasks: flattenedTasks,
    },
  };

  writeProject(projectFile, updatedProject);
  writeProjectIndexBody(projectFile, updatedProject, buildDocumentBody(project, existingBody, flattenedTasks));
  migrateFiles(join(projectsDir, projectId));
}

const projectsDir = getDurableProjectsDir();
const now = new Date().toISOString();
const migrated = [];

for (const entry of readdirSync(projectsDir, { withFileTypes: true })) {
  if (!entry.isDirectory()) {
    continue;
  }

  const projectId = entry.name;
  const projectFile = join(projectsDir, projectId, 'state.yaml');
  if (!existsSync(projectFile)) {
    continue;
  }

  migrateProject(projectId, projectFile, now);
  migrated.push(projectId);
}

console.log(`Migrated ${migrated.length} project${migrated.length === 1 ? '' : 's'} to the simplified project model.`);
for (const projectId of migrated) {
  console.log(`- ${projectId}`);
}

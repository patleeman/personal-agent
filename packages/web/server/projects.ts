import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  createProjectScaffold,
  createProjectTask,
  formatProject,
  formatProjectTask,
  parseProject,
  parseProjectTask,
  readProject,
  readProjectTask,
  resolveProjectPaths,
  resolveProjectTaskPath,
  writeProject,
  writeProjectTask,
  type ProjectDocument,
  type ProjectMilestoneDocument,
  type ProjectTaskDocument,
} from '@personal-agent/core';

export interface ProjectDetail {
  project: ProjectDocument;
  taskCount: number;
  artifactCount: number;
  tasks: ProjectTaskDocument[];
}

export interface CreateProjectRecordInput {
  repoRoot?: string;
  profile: string;
  projectId: string;
  description: string;
  summary?: string;
  status?: string;
  currentFocus?: string | null;
  blockers?: string[];
  recentProgress?: string[];
}

export interface UpdateProjectRecordInput {
  repoRoot?: string;
  profile: string;
  projectId: string;
  description?: string;
  summary?: string;
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

export interface AddProjectMilestoneInput {
  repoRoot?: string;
  profile: string;
  projectId: string;
  id: string;
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
  taskId: string;
  title: string;
  status: string;
  summary?: string;
  milestoneId?: string | null;
  acceptanceCriteria?: string[];
  plan?: string[];
  notes?: string | null;
}

export interface UpdateProjectTaskRecordInput {
  repoRoot?: string;
  profile: string;
  projectId: string;
  taskId: string;
  title?: string;
  status?: string;
  summary?: string | null;
  milestoneId?: string | null;
  acceptanceCriteria?: string[];
  plan?: string[];
  notes?: string | null;
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

export interface SaveProjectTaskSourceInput {
  repoRoot?: string;
  profile: string;
  projectId: string;
  taskId: string;
  content: string;
}

const TASK_STATUS_RANK: Record<string, number> = {
  running: 0,
  blocked: 1,
  failed: 2,
  pending: 3,
  completed: 4,
  cancelled: 5,
};

function taskStatusRank(status: string): number {
  return TASK_STATUS_RANK[status] ?? TASK_STATUS_RANK.pending;
}

function listFiles(dir: string, extension?: string): string[] {
  if (!existsSync(dir)) {
    return [];
  }

  return readdirSync(dir)
    .filter((name) => extension ? name.endsWith(extension) : true)
    .sort((left, right) => left.localeCompare(right));
}

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

  return values
    .map((value, index) => readRequiredString(value, `${label}[${index}]`));
}

function assertMilestoneExists(project: ProjectDocument, milestoneId: string | undefined): void {
  if (!milestoneId) {
    return;
  }

  if (!project.plan.milestones.some((milestone) => milestone.id === milestoneId)) {
    throw new Error(`Milestone ${milestoneId} does not exist in project ${project.id}.`);
  }
}

function readProjectRecord(options: {
  repoRoot?: string;
  profile: string;
  projectId: string;
}): { paths: ReturnType<typeof resolveProjectPaths>; project: ProjectDocument } {
  const paths = resolveProjectPaths(options);

  if (!existsSync(paths.projectFile)) {
    throw new Error(`Project not found: ${options.projectId}`);
  }

  return {
    paths,
    project: readProject(paths.projectFile),
  };
}

function taskOrderValue(task: ProjectTaskDocument): number | undefined {
  return typeof task.order === 'number' ? task.order : undefined;
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

function reindexTaskOrder(tasks: ProjectTaskDocument[]): ProjectTaskDocument[] {
  return tasks.map((task, index) => ({
    ...task,
    order: index,
  }));
}

export function sortProjectTasks(tasks: ProjectTaskDocument[]): ProjectTaskDocument[] {
  return [...tasks].sort((left, right) => {
    const leftOrder = taskOrderValue(left);
    const rightOrder = taskOrderValue(right);

    if (leftOrder !== undefined || rightOrder !== undefined) {
      const normalizedLeftOrder = leftOrder ?? Number.MAX_SAFE_INTEGER;
      const normalizedRightOrder = rightOrder ?? Number.MAX_SAFE_INTEGER;
      const orderCompare = normalizedLeftOrder - normalizedRightOrder;
      if (orderCompare !== 0) {
        return orderCompare;
      }
    }

    const statusCompare = taskStatusRank(left.status) - taskStatusRank(right.status);
    if (statusCompare !== 0) {
      return statusCompare;
    }

    const updatedAtCompare = right.updatedAt.localeCompare(left.updatedAt);
    if (updatedAtCompare !== 0) {
      return updatedAtCompare;
    }

    return left.id.localeCompare(right.id);
  });
}

function readProjectTasks(dir: string): ProjectTaskDocument[] {
  const tasks = listFiles(dir, '.yaml').map((fileName) => readProjectTask(join(dir, fileName)));
  return sortProjectTasks(tasks);
}

export function readProjectDetailFromProject(options: {
  repoRoot?: string;
  profile: string;
  projectId: string;
}): ProjectDetail {
  const paths = resolveProjectPaths(options);
  const tasks = readProjectTasks(paths.tasksDir);

  return {
    project: readProject(paths.projectFile),
    taskCount: tasks.length,
    artifactCount: listFiles(paths.artifactsDir).length,
    tasks,
  };
}

export function createProjectRecord(input: CreateProjectRecordInput): ProjectDetail {
  createProjectScaffold({
    repoRoot: input.repoRoot,
    profile: input.profile,
    projectId: input.projectId,
    objective: readRequiredString(input.description, 'Project description'),
  });

  const { paths, project } = readProjectRecord(input);
  const updatedProject: ProjectDocument = {
    ...project,
    description: readRequiredString(input.description, 'Project description'),
    summary: readOptionalString(input.summary) ?? project.summary,
    status: readOptionalString(input.status) ?? project.status,
    currentFocus: readOptionalString(input.currentFocus) ?? project.currentFocus,
    blockers: input.blockers ? readStringList(input.blockers, 'Project blockers') : project.blockers,
    recentProgress: input.recentProgress ? readStringList(input.recentProgress, 'Project recentProgress') : project.recentProgress,
    updatedAt: nowIso(),
  };

  writeProject(paths.projectFile, updatedProject);
  return readProjectDetailFromProject(input);
}

export function updateProjectRecord(input: UpdateProjectRecordInput): ProjectDetail {
  const { paths, project } = readProjectRecord(input);

  const updatedProject: ProjectDocument = {
    ...project,
    ...(input.description !== undefined ? { description: readRequiredString(input.description, 'Project description') } : {}),
    ...(input.summary !== undefined ? { summary: readRequiredString(input.summary, 'Project summary') } : {}),
    ...(input.status !== undefined ? { status: readRequiredString(input.status, 'Project status') } : {}),
    ...(input.currentFocus !== undefined ? { currentFocus: readOptionalString(input.currentFocus) } : {}),
    ...(input.blockers !== undefined ? { blockers: readStringList(input.blockers, 'Project blockers') } : {}),
    ...(input.recentProgress !== undefined ? { recentProgress: readStringList(input.recentProgress, 'Project recentProgress') } : {}),
    updatedAt: nowIso(),
  };

  const projectDocumentToWrite: ProjectDocument = {
    ...updatedProject,
    plan: {
      ...updatedProject.plan,
      ...(input.currentMilestoneId !== undefined ? { currentMilestoneId: readOptionalString(input.currentMilestoneId) } : {}),
    },
  };

  writeProject(paths.projectFile, projectDocumentToWrite);
  return readProjectDetailFromProject(input);
}

export function deleteProjectRecord(input: DeleteProjectRecordInput): DeleteProjectRecordResult {
  const { paths } = readProjectRecord(input);
  rmSync(paths.projectDir, { recursive: true, force: false });
  return {
    ok: true,
    deletedProjectId: input.projectId,
  };
}

export function addProjectMilestone(input: AddProjectMilestoneInput): ProjectDetail {
  const { paths, project } = readProjectRecord(input);
  const milestoneId = readRequiredString(input.id, 'Milestone id');

  if (project.plan.milestones.some((milestone) => milestone.id === milestoneId)) {
    throw new Error(`Milestone already exists in project ${project.id}: ${milestoneId}`);
  }

  const milestone: ProjectMilestoneDocument = {
    id: milestoneId,
    title: readRequiredString(input.title, 'Milestone title'),
    status: readRequiredString(input.status, 'Milestone status'),
    summary: readOptionalString(input.summary),
  };

  const updatedProject: ProjectDocument = {
    ...project,
    updatedAt: nowIso(),
    plan: {
      currentMilestoneId: input.makeCurrent ? milestone.id : project.plan.currentMilestoneId,
      milestones: [...project.plan.milestones, milestone],
    },
  };

  writeProject(paths.projectFile, updatedProject);
  return readProjectDetailFromProject(input);
}

export function updateProjectMilestone(input: UpdateProjectMilestoneInput): ProjectDetail {
  const { paths, project } = readProjectRecord(input);
  const milestoneIndex = project.plan.milestones.findIndex((milestone) => milestone.id === input.milestoneId);

  if (milestoneIndex === -1) {
    throw new Error(`Milestone not found in project ${project.id}: ${input.milestoneId}`);
  }

  const existingMilestone = project.plan.milestones[milestoneIndex] as ProjectMilestoneDocument;
  const updatedMilestone: ProjectMilestoneDocument = {
    ...existingMilestone,
    ...(input.title !== undefined ? { title: readRequiredString(input.title, 'Milestone title') } : {}),
    ...(input.status !== undefined ? { status: readRequiredString(input.status, 'Milestone status') } : {}),
    ...(input.summary !== undefined ? { summary: readOptionalString(input.summary) } : {}),
  };

  const milestones = [...project.plan.milestones];
  milestones[milestoneIndex] = updatedMilestone;

  const updatedProject: ProjectDocument = {
    ...project,
    updatedAt: nowIso(),
    plan: {
      currentMilestoneId: input.makeCurrent ? updatedMilestone.id : project.plan.currentMilestoneId,
      milestones,
    },
  };

  writeProject(paths.projectFile, updatedProject);
  return readProjectDetailFromProject(input);
}

export function createProjectTaskRecord(input: CreateProjectTaskRecordInput): ProjectDetail {
  const { paths, project } = readProjectRecord(input);
  const taskId = readRequiredString(input.taskId, 'Task id');
  const taskPath = resolveProjectTaskPath({
    repoRoot: input.repoRoot,
    profile: input.profile,
    projectId: input.projectId,
    taskId,
  });

  if (existsSync(taskPath)) {
    throw new Error(`Task already exists in project ${input.projectId}: ${taskId}`);
  }

  const milestoneId = readOptionalString(input.milestoneId);
  assertMilestoneExists(project, milestoneId);
  const existingTasks = readProjectTasks(paths.tasksDir);
  const nextOrder = existingTasks.length === 0
    ? 0
    : Math.max(...existingTasks.map((task) => task.order ?? -1)) + 1;

  writeProjectTask(
    taskPath,
    createProjectTask({
      id: taskId,
      createdAt: nowIso(),
      status: readRequiredString(input.status, 'Task status'),
      title: readRequiredString(input.title, 'Task title'),
      summary: readOptionalString(input.summary),
      order: nextOrder,
      milestoneId,
      acceptanceCriteria: input.acceptanceCriteria ? readStringList(input.acceptanceCriteria, 'Task acceptanceCriteria') : undefined,
      plan: input.plan ? readStringList(input.plan, 'Task plan') : undefined,
      notes: readOptionalString(input.notes),
    }),
  );

  return readProjectDetailFromProject(input);
}

export function updateProjectTaskRecord(input: UpdateProjectTaskRecordInput): ProjectDetail {
  readProjectRecord(input);
  const taskPath = resolveProjectTaskPath({
    repoRoot: input.repoRoot,
    profile: input.profile,
    projectId: input.projectId,
    taskId: input.taskId,
  });

  if (!existsSync(taskPath)) {
    throw new Error(`Task not found in project ${input.projectId}: ${input.taskId}`);
  }

  const existingTask = readProjectTask(taskPath);
  const { project } = readProjectRecord(input);
  const milestoneId = input.milestoneId !== undefined ? readOptionalString(input.milestoneId) : existingTask.milestoneId;
  assertMilestoneExists(project, milestoneId);

  const updatedTask: ProjectTaskDocument = {
    ...existingTask,
    ...(input.title !== undefined ? { title: readRequiredString(input.title, 'Task title') } : {}),
    ...(input.status !== undefined ? { status: readRequiredString(input.status, 'Task status') } : {}),
    ...(input.summary !== undefined ? { summary: readOptionalString(input.summary) } : {}),
    ...(input.milestoneId !== undefined ? { milestoneId } : {}),
    ...(input.acceptanceCriteria !== undefined ? { acceptanceCriteria: readStringList(input.acceptanceCriteria, 'Task acceptanceCriteria') } : {}),
    ...(input.plan !== undefined ? { plan: readStringList(input.plan, 'Task plan') } : {}),
    ...(input.notes !== undefined ? { notes: readOptionalString(input.notes) } : {}),
    updatedAt: nowIso(),
  };

  writeProjectTask(taskPath, updatedTask);
  return readProjectDetailFromProject(input);
}

export function deleteProjectMilestone(input: DeleteProjectMilestoneInput): ProjectDetail {
  const { paths, project } = readProjectRecord(input);
  const milestoneIndex = project.plan.milestones.findIndex((milestone) => milestone.id === input.milestoneId);

  if (milestoneIndex === -1) {
    throw new Error(`Milestone not found in project ${project.id}: ${input.milestoneId}`);
  }

  const nextMilestones = project.plan.milestones.filter((milestone) => milestone.id !== input.milestoneId);
  const nextCurrentMilestoneId = project.plan.currentMilestoneId === input.milestoneId
    ? nextMilestones[0]?.id
    : project.plan.currentMilestoneId;

  writeProject(paths.projectFile, {
    ...project,
    updatedAt: nowIso(),
    plan: {
      currentMilestoneId: nextCurrentMilestoneId,
      milestones: nextMilestones,
    },
  });

  const tasks = readProjectTasks(paths.tasksDir);
  for (const task of tasks) {
    if (task.milestoneId !== input.milestoneId) {
      continue;
    }

    writeProjectTask(
      resolveProjectTaskPath({
        repoRoot: input.repoRoot,
        profile: input.profile,
        projectId: input.projectId,
        taskId: task.id,
      }),
      {
        ...task,
        milestoneId: undefined,
        updatedAt: nowIso(),
      },
    );
  }

  return readProjectDetailFromProject(input);
}

export function moveProjectMilestone(input: MoveProjectMilestoneInput): ProjectDetail {
  const { paths, project } = readProjectRecord(input);
  const milestoneIndex = project.plan.milestones.findIndex((milestone) => milestone.id === input.milestoneId);

  if (milestoneIndex === -1) {
    throw new Error(`Milestone not found in project ${project.id}: ${input.milestoneId}`);
  }

  const milestones = moveArrayItem(project.plan.milestones, milestoneIndex, input.direction);
  writeProject(paths.projectFile, {
    ...project,
    updatedAt: nowIso(),
    plan: {
      ...project.plan,
      milestones,
    },
  });

  return readProjectDetailFromProject(input);
}

export function deleteProjectTaskRecord(input: DeleteProjectTaskRecordInput): ProjectDetail {
  const { paths } = readProjectRecord(input);
  const taskPath = resolveProjectTaskPath({
    repoRoot: input.repoRoot,
    profile: input.profile,
    projectId: input.projectId,
    taskId: input.taskId,
  });

  if (!existsSync(taskPath)) {
    throw new Error(`Task not found in project ${input.projectId}: ${input.taskId}`);
  }

  rmSync(taskPath);

  const tasks = reindexTaskOrder(readProjectTasks(paths.tasksDir));
  for (const task of tasks) {
    writeProjectTask(
      resolveProjectTaskPath({
        repoRoot: input.repoRoot,
        profile: input.profile,
        projectId: input.projectId,
        taskId: task.id,
      }),
      task,
    );
  }

  return readProjectDetailFromProject(input);
}

export function moveProjectTaskRecord(input: MoveProjectTaskRecordInput): ProjectDetail {
  const { paths } = readProjectRecord(input);
  const tasks = reindexTaskOrder(readProjectTasks(paths.tasksDir));
  const taskIndex = tasks.findIndex((task) => task.id === input.taskId);

  if (taskIndex === -1) {
    throw new Error(`Task not found in project ${input.projectId}: ${input.taskId}`);
  }

  const movedTasks = reindexTaskOrder(moveArrayItem(tasks, taskIndex, input.direction));
  for (const task of movedTasks) {
    writeProjectTask(
      resolveProjectTaskPath({
        repoRoot: input.repoRoot,
        profile: input.profile,
        projectId: input.projectId,
        taskId: task.id,
      }),
      {
        ...task,
        updatedAt: nowIso(),
      },
    );
  }

  return readProjectDetailFromProject(input);
}

export function readProjectSource(options: {
  repoRoot?: string;
  profile: string;
  projectId: string;
}): { path: string; content: string } {
  const { paths } = readProjectRecord(options);
  return {
    path: paths.projectFile,
    content: readFileSync(paths.projectFile, 'utf-8'),
  };
}

export function saveProjectSource(input: SaveProjectSourceInput): ProjectDetail {
  const { paths } = readProjectRecord(input);
  const parsedProject = parseProject(input.content);

  if (parsedProject.id !== input.projectId) {
    throw new Error(`Project YAML id must match route id ${input.projectId}.`);
  }

  writeFileSync(paths.projectFile, formatProject(parsedProject));
  return readProjectDetailFromProject(input);
}

export function readProjectTaskSource(options: {
  repoRoot?: string;
  profile: string;
  projectId: string;
  taskId: string;
}): { path: string; content: string } {
  const taskPath = resolveProjectTaskPath(options);

  if (!existsSync(taskPath)) {
    throw new Error(`Task not found in project ${options.projectId}: ${options.taskId}`);
  }

  return {
    path: taskPath,
    content: readFileSync(taskPath, 'utf-8'),
  };
}

export function saveProjectTaskSource(input: SaveProjectTaskSourceInput): ProjectDetail {
  const taskPath = resolveProjectTaskPath(input);

  if (!existsSync(taskPath)) {
    throw new Error(`Task not found in project ${input.projectId}: ${input.taskId}`);
  }

  const parsedTask = parseProjectTask(input.content);
  if (parsedTask.id !== input.taskId) {
    throw new Error(`Task YAML id must match route id ${input.taskId}.`);
  }

  writeFileSync(taskPath, formatProjectTask(parsedTask));
  return readProjectDetailFromProject(input);
}

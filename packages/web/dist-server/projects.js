import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createProjectScaffold, createProjectTask, formatProject, listProjectIds, parseProject, readProject, resolveProjectPaths, resolveProjectRepoRoot, writeProject, } from '@personal-agent/core';
import { listProjectFiles, listProjectNotes, readProjectBrief, } from './projectResources.js';
function nowIso() {
    return new Date().toISOString();
}
function readRequiredString(value, label) {
    const normalized = value?.trim();
    if (!normalized) {
        throw new Error(`${label} must not be empty.`);
    }
    return normalized;
}
function readOptionalString(value) {
    const normalized = value?.trim();
    return normalized && normalized.length > 0 ? normalized : undefined;
}
function readStringList(values, label) {
    if (!values) {
        return [];
    }
    return values
        .map((value, index) => readRequiredString(value, `${label}[${index}]`));
}
function normalizeProjectRepoRoot(projectRepoRoot, appRepoRoot) {
    const normalized = readOptionalString(projectRepoRoot);
    if (!normalized) {
        return undefined;
    }
    return resolveProjectRepoRoot({
        repoRoot: appRepoRoot,
        projectRepoRoot: normalized,
    });
}
function assertMilestoneExists(project, milestoneId) {
    if (!milestoneId) {
        return;
    }
    if (!project.plan.milestones.some((milestone) => milestone.id === milestoneId)) {
        throw new Error(`Milestone ${milestoneId} does not exist in project ${project.id}.`);
    }
}
function readProjectRecord(options) {
    const paths = resolveProjectPaths(options);
    if (!existsSync(paths.projectFile)) {
        throw new Error(`Project not found: ${options.projectId}`);
    }
    return {
        paths,
        project: readProject(paths.projectFile),
    };
}
export function listProjectIndex(options) {
    const projectIds = listProjectIds(options);
    const projects = [];
    const invalidProjects = [];
    for (const projectId of projectIds) {
        const paths = resolveProjectPaths({
            repoRoot: options.repoRoot,
            profile: options.profile,
            projectId,
        });
        if (!existsSync(paths.projectFile)) {
            invalidProjects.push({
                projectId,
                path: paths.projectFile,
                error: 'PROJECT.yaml not found.',
            });
            continue;
        }
        try {
            projects.push(readProject(paths.projectFile));
        }
        catch (error) {
            invalidProjects.push({
                projectId,
                path: paths.projectFile,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }
    projects.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    return { projects, invalidProjects };
}
function moveArrayItem(items, index, direction) {
    const nextIndex = direction === 'up' ? index - 1 : index + 1;
    if (index < 0 || nextIndex < 0 || nextIndex >= items.length) {
        return [...items];
    }
    const output = [...items];
    const [item] = output.splice(index, 1);
    output.splice(nextIndex, 0, item);
    return output;
}
const MAX_AUTO_GENERATED_ID_LENGTH = 36;
const MAX_AUTO_GENERATED_ID_SEGMENTS = 6;
function slugifyIdentifier(value) {
    return value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .replace(/-{2,}/g, '-');
}
function trimTrailingHyphens(value) {
    return value.replace(/-+$/g, '');
}
function buildGeneratedIdBase(title, fallbackBase) {
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
function generateUniqueId(title, existingIds, fallbackBase) {
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
export function sortProjectTasks(tasks) {
    return [...tasks];
}
export function readProjectDetailFromProject(options) {
    const project = readProject(resolveProjectPaths(options).projectFile);
    const tasks = sortProjectTasks(project.plan.tasks ?? []);
    const notes = listProjectNotes(options);
    const attachments = listProjectFiles({ ...options, kind: 'attachment' });
    const artifacts = listProjectFiles({ ...options, kind: 'artifact' });
    return {
        project,
        taskCount: tasks.length,
        noteCount: notes.length,
        attachmentCount: attachments.length,
        artifactCount: artifacts.length,
        tasks,
        brief: readProjectBrief(options),
        notes,
        attachments,
        artifacts,
        linkedConversations: [],
        timeline: [],
    };
}
export function createProjectRecord(input) {
    const title = readRequiredString(input.title, 'Project title');
    const description = readRequiredString(input.description, 'Project description');
    const projectId = readOptionalString(input.projectId)
        ?? generateUniqueId(title, listProjectIds({ repoRoot: input.repoRoot, profile: input.profile }), 'project');
    createProjectScaffold({
        repoRoot: input.repoRoot,
        profile: input.profile,
        projectId,
        title,
        description,
    });
    const { paths, project } = readProjectRecord({ ...input, projectId });
    const updatedProject = {
        ...project,
        title,
        description,
        repoRoot: normalizeProjectRepoRoot(input.projectRepoRoot, input.repoRoot),
        summary: readOptionalString(input.summary) ?? project.summary,
        status: readOptionalString(input.status) ?? project.status,
        currentFocus: readOptionalString(input.currentFocus) ?? project.currentFocus,
        blockers: input.blockers ? readStringList(input.blockers, 'Project blockers') : project.blockers,
        recentProgress: input.recentProgress ? readStringList(input.recentProgress, 'Project recentProgress') : project.recentProgress,
        updatedAt: nowIso(),
    };
    writeProject(paths.projectFile, updatedProject);
    return readProjectDetailFromProject({ ...input, projectId });
}
export function updateProjectRecord(input) {
    const { paths, project } = readProjectRecord(input);
    const updatedProject = {
        ...project,
        ...(input.title !== undefined ? { title: readRequiredString(input.title, 'Project title') } : {}),
        ...(input.description !== undefined ? { description: readRequiredString(input.description, 'Project description') } : {}),
        ...(input.projectRepoRoot !== undefined ? { repoRoot: normalizeProjectRepoRoot(input.projectRepoRoot, input.repoRoot) } : {}),
        ...(input.summary !== undefined ? { summary: readRequiredString(input.summary, 'Project summary') } : {}),
        ...(input.status !== undefined ? { status: readRequiredString(input.status, 'Project status') } : {}),
        ...(input.currentFocus !== undefined ? { currentFocus: readOptionalString(input.currentFocus) } : {}),
        ...(input.blockers !== undefined ? { blockers: readStringList(input.blockers, 'Project blockers') } : {}),
        ...(input.recentProgress !== undefined ? { recentProgress: readStringList(input.recentProgress, 'Project recentProgress') } : {}),
        updatedAt: nowIso(),
    };
    const projectDocumentToWrite = {
        ...updatedProject,
        plan: {
            ...updatedProject.plan,
            ...(input.currentMilestoneId !== undefined ? { currentMilestoneId: readOptionalString(input.currentMilestoneId) } : {}),
        },
    };
    writeProject(paths.projectFile, projectDocumentToWrite);
    return readProjectDetailFromProject(input);
}
export function deleteProjectRecord(input) {
    const { paths } = readProjectRecord(input);
    rmSync(paths.projectDir, { recursive: true, force: false });
    return {
        ok: true,
        deletedProjectId: input.projectId,
    };
}
export function addProjectMilestone(input) {
    const { paths, project } = readProjectRecord(input);
    const milestoneTitle = readRequiredString(input.title, 'Milestone title');
    const milestoneId = readOptionalString(input.id)
        ?? generateUniqueId(milestoneTitle, project.plan.milestones.map((milestone) => milestone.id), 'milestone');
    if (project.plan.milestones.some((milestone) => milestone.id === milestoneId)) {
        throw new Error(`Milestone already exists in project ${project.id}: ${milestoneId}`);
    }
    const milestone = {
        id: milestoneId,
        title: milestoneTitle,
        status: readRequiredString(input.status, 'Milestone status'),
        summary: readOptionalString(input.summary),
    };
    const updatedProject = {
        ...project,
        updatedAt: nowIso(),
        plan: {
            ...project.plan,
            currentMilestoneId: input.makeCurrent ? milestone.id : project.plan.currentMilestoneId,
            milestones: [...project.plan.milestones, milestone],
        },
    };
    writeProject(paths.projectFile, updatedProject);
    return readProjectDetailFromProject(input);
}
export function updateProjectMilestone(input) {
    const { paths, project } = readProjectRecord(input);
    const milestoneIndex = project.plan.milestones.findIndex((milestone) => milestone.id === input.milestoneId);
    if (milestoneIndex === -1) {
        throw new Error(`Milestone not found in project ${project.id}: ${input.milestoneId}`);
    }
    const existingMilestone = project.plan.milestones[milestoneIndex];
    const updatedMilestone = {
        ...existingMilestone,
        ...(input.title !== undefined ? { title: readRequiredString(input.title, 'Milestone title') } : {}),
        ...(input.status !== undefined ? { status: readRequiredString(input.status, 'Milestone status') } : {}),
        ...(input.summary !== undefined ? { summary: readOptionalString(input.summary) } : {}),
    };
    const milestones = [...project.plan.milestones];
    milestones[milestoneIndex] = updatedMilestone;
    const updatedProject = {
        ...project,
        updatedAt: nowIso(),
        plan: {
            ...project.plan,
            currentMilestoneId: input.makeCurrent ? updatedMilestone.id : project.plan.currentMilestoneId,
            milestones,
        },
    };
    writeProject(paths.projectFile, updatedProject);
    return readProjectDetailFromProject(input);
}
export function createProjectTaskRecord(input) {
    const { paths, project } = readProjectRecord(input);
    const milestoneId = input.milestoneId !== undefined
        ? readOptionalString(input.milestoneId)
        : readOptionalString(project.plan.currentMilestoneId);
    assertMilestoneExists(project, milestoneId);
    const title = readRequiredString(input.title, 'Task title');
    const existingTasks = sortProjectTasks(project.plan.tasks ?? []);
    const taskId = readOptionalString(input.taskId)
        ?? generateUniqueId(title, existingTasks.map((task) => task.id), 'task');
    if (existingTasks.some((task) => task.id === taskId)) {
        throw new Error(`Task already exists in project ${input.projectId}: ${taskId}`);
    }
    const nextTasks = [
        ...existingTasks,
        createProjectTask({
            id: taskId,
            status: readRequiredString(input.status, 'Task status'),
            title,
            milestoneId,
        }),
    ];
    writeProject(paths.projectFile, {
        ...project,
        updatedAt: nowIso(),
        plan: {
            ...project.plan,
            tasks: nextTasks,
        },
    });
    return readProjectDetailFromProject(input);
}
export function updateProjectTaskRecord(input) {
    const { paths, project } = readProjectRecord(input);
    const taskIndex = (project.plan.tasks ?? []).findIndex((task) => task.id === input.taskId);
    if (taskIndex === -1) {
        throw new Error(`Task not found in project ${input.projectId}: ${input.taskId}`);
    }
    const existingTask = project.plan.tasks[taskIndex];
    const milestoneId = input.milestoneId !== undefined
        ? readOptionalString(input.milestoneId)
        : existingTask.milestoneId;
    assertMilestoneExists(project, milestoneId);
    const updatedTask = {
        ...existingTask,
        ...(input.title !== undefined ? { title: readRequiredString(input.title, 'Task title') } : {}),
        ...(input.status !== undefined ? { status: readRequiredString(input.status, 'Task status') } : {}),
        ...(milestoneId ? { milestoneId } : {}),
    };
    if (!milestoneId) {
        delete updatedTask.milestoneId;
    }
    const nextTasks = [...project.plan.tasks];
    nextTasks[taskIndex] = updatedTask;
    writeProject(paths.projectFile, {
        ...project,
        updatedAt: nowIso(),
        plan: {
            ...project.plan,
            tasks: nextTasks,
        },
    });
    return readProjectDetailFromProject(input);
}
export function deleteProjectMilestone(input) {
    const { paths, project } = readProjectRecord(input);
    const milestoneIndex = project.plan.milestones.findIndex((milestone) => milestone.id === input.milestoneId);
    if (milestoneIndex === -1) {
        throw new Error(`Milestone not found in project ${project.id}: ${input.milestoneId}`);
    }
    const nextMilestones = project.plan.milestones.filter((milestone) => milestone.id !== input.milestoneId);
    const nextCurrentMilestoneId = project.plan.currentMilestoneId === input.milestoneId
        ? nextMilestones[0]?.id
        : project.plan.currentMilestoneId;
    const nextTasks = (project.plan.tasks ?? []).map((task) => {
        if (task.milestoneId !== input.milestoneId) {
            return task;
        }
        const updatedTask = { ...task };
        delete updatedTask.milestoneId;
        return updatedTask;
    });
    writeProject(paths.projectFile, {
        ...project,
        updatedAt: nowIso(),
        plan: {
            ...project.plan,
            currentMilestoneId: nextCurrentMilestoneId,
            milestones: nextMilestones,
            tasks: nextTasks,
        },
    });
    return readProjectDetailFromProject(input);
}
export function moveProjectMilestone(input) {
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
export function deleteProjectTaskRecord(input) {
    const { paths, project } = readProjectRecord(input);
    const nextTasks = (project.plan.tasks ?? []).filter((task) => task.id !== input.taskId);
    if (nextTasks.length === (project.plan.tasks ?? []).length) {
        throw new Error(`Task not found in project ${input.projectId}: ${input.taskId}`);
    }
    writeProject(paths.projectFile, {
        ...project,
        updatedAt: nowIso(),
        plan: {
            ...project.plan,
            tasks: nextTasks,
        },
    });
    return readProjectDetailFromProject(input);
}
export function moveProjectTaskRecord(input) {
    const { paths, project } = readProjectRecord(input);
    const tasks = sortProjectTasks(project.plan.tasks ?? []);
    const task = tasks.find((entry) => entry.id === input.taskId);
    if (!task) {
        throw new Error(`Task not found in project ${input.projectId}: ${input.taskId}`);
    }
    const milestoneTasks = tasks.filter((entry) => entry.milestoneId === task.milestoneId);
    const taskIndex = milestoneTasks.findIndex((entry) => entry.id === input.taskId);
    const movedMilestoneTasks = moveArrayItem(milestoneTasks, taskIndex, input.direction);
    let milestoneCursor = 0;
    const nextTasks = tasks.map((entry) => {
        if (entry.milestoneId !== task.milestoneId) {
            return entry;
        }
        const replacement = movedMilestoneTasks[milestoneCursor];
        milestoneCursor += 1;
        return replacement;
    });
    writeProject(paths.projectFile, {
        ...project,
        updatedAt: nowIso(),
        plan: {
            ...project.plan,
            tasks: nextTasks,
        },
    });
    return readProjectDetailFromProject(input);
}
export function readProjectSource(options) {
    const { paths } = readProjectRecord(options);
    return {
        path: paths.projectFile,
        content: readFileSync(paths.projectFile, 'utf-8'),
    };
}
export function saveProjectSource(input) {
    const { paths } = readProjectRecord(input);
    const parsedProject = parseProject(input.content);
    if (parsedProject.id !== input.projectId) {
        throw new Error(`Project YAML id must match route id ${input.projectId}.`);
    }
    writeFileSync(paths.projectFile, formatProject(parsedProject));
    return readProjectDetailFromProject(input);
}

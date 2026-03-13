import { existsSync, mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createProjectScaffold, resolveProjectPaths } from '@personal-agent/core';
import { afterEach, describe, expect, it } from 'vitest';
import { addProjectMilestone, createProjectRecord, createProjectTaskRecord, deleteProjectMilestone, deleteProjectRecord, deleteProjectTaskRecord, moveProjectMilestone, moveProjectTaskRecord, readProjectDetailFromProject, readProjectSource, saveProjectSource, sortProjectTasks, updateProjectMilestone, updateProjectRecord, updateProjectTaskRecord, } from './projects.js';
const tempDirs = [];
afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
function createTempRepo() {
    const dir = mkdtempSync(join(tmpdir(), 'pa-web-projects-'));
    tempDirs.push(dir);
    return dir;
}
describe('sortProjectTasks', () => {
    it('preserves task order from PROJECT.yaml', () => {
        const sorted = sortProjectTasks([
            {
                id: 'task-b',
                status: 'completed',
                title: 'B',
                milestoneId: 'execute-work',
            },
            {
                id: 'task-a',
                status: 'blocked',
                title: 'A',
                milestoneId: 'execute-work',
            },
        ]);
        expect(sorted.map((task) => task.id)).toEqual(['task-b', 'task-a']);
    });
});
describe('readProjectDetailFromProject', () => {
    it('returns the project document, notes, files, and tasks from project storage', () => {
        const repoRoot = createTempRepo();
        createProjectScaffold({
            repoRoot,
            profile: 'datadog',
            projectId: 'web-ui',
            title: 'Project UI',
            description: 'Ship the project UI',
            now: new Date('2026-03-11T01:00:00.000Z'),
        });
        addProjectMilestone({
            repoRoot,
            profile: 'datadog',
            projectId: 'web-ui',
            id: 'planning',
            title: 'Planning',
            status: 'completed',
        });
        addProjectMilestone({
            repoRoot,
            profile: 'datadog',
            projectId: 'web-ui',
            id: 'execution',
            title: 'Execution',
            status: 'in_progress',
            makeCurrent: true,
        });
        createProjectTaskRecord({
            repoRoot,
            profile: 'datadog',
            projectId: 'web-ui',
            taskId: 'completed-task',
            status: 'completed',
            title: 'Polish the list page',
            milestoneId: 'planning',
        });
        createProjectTaskRecord({
            repoRoot,
            profile: 'datadog',
            projectId: 'web-ui',
            taskId: 'in-progress-task',
            status: 'in_progress',
            title: 'Build the project detail card',
            milestoneId: 'execution',
        });
        const detail = readProjectDetailFromProject({
            repoRoot,
            profile: 'datadog',
            projectId: 'web-ui',
        });
        expect(detail.project.id).toBe('web-ui');
        expect(detail.project.title).toBe('Project UI');
        expect(detail.project.description).toBe('Ship the project UI');
        expect(detail.project.plan.milestones).toHaveLength(2);
        expect(detail.project.plan.tasks).toHaveLength(2);
        expect(detail.taskCount).toBe(2);
        expect(detail.noteCount).toBe(0);
        expect(detail.attachmentCount).toBe(0);
        expect(detail.artifactCount).toBe(0);
        expect(detail.tasks.map((task) => task.id)).toEqual(['completed-task', 'in-progress-task']);
        expect(detail.tasks[1]).toEqual({
            id: 'in-progress-task',
            status: 'in_progress',
            title: 'Build the project detail card',
            milestoneId: 'execution',
        });
    });
});
describe('project editing helpers', () => {
    it('creates a project record with editable fields', () => {
        const repoRoot = createTempRepo();
        const detail = createProjectRecord({
            repoRoot,
            profile: 'datadog',
            projectId: 'artifact-model',
            title: 'Artifact model',
            description: 'Build the artifact model',
            projectRepoRoot: '../workspace/artifact-model',
            summary: 'The storage model is taking shape.',
            status: 'in_progress',
            currentFocus: 'Define PROJECT.yaml.',
            blockers: ['Need to settle task shape'],
            recentProgress: ['Created the scaffold'],
        });
        expect(detail.project.title).toBe('Artifact model');
        expect(detail.project.description).toBe('Build the artifact model');
        expect(detail.project.repoRoot).toBe(resolve(repoRoot, '../workspace/artifact-model'));
        expect(detail.project.summary).toBe('The storage model is taking shape.');
        expect(detail.project.status).toBe('in_progress');
        expect(detail.project.currentFocus).toBe('Define PROJECT.yaml.');
        expect(detail.project.blockers).toEqual(['Need to settle task shape']);
        expect(detail.project.recentProgress).toEqual(['Created the scaffold']);
    });
    it('auto-generates a project id from the title when omitted', () => {
        const repoRoot = createTempRepo();
        const first = createProjectRecord({
            repoRoot,
            profile: 'datadog',
            title: 'Artifact model',
            description: 'Build the artifact model',
        });
        const second = createProjectRecord({
            repoRoot,
            profile: 'datadog',
            title: 'Artifact model',
            description: 'Build the artifact model',
        });
        expect(first.project.id).toBe('artifact-model');
        expect(second.project.id).toBe('artifact-model-2');
    });
    it('keeps long auto-generated project ids compact', () => {
        const repoRoot = createTempRepo();
        const detail = createProjectRecord({
            repoRoot,
            profile: 'datadog',
            title: 'Make the web UI cwd agnostic by default and add durable referenced project state',
            description: 'Make the web UI cwd agnostic by default and add durable referenced project state',
        });
        expect(detail.project.id).toBe('make-the-web-ui-cwd-agnostic');
        expect(detail.project.id.length).toBeLessThanOrEqual(36);
    });
    it('keeps duplicate suffixes inside the compact auto-generated id limit', () => {
        const repoRoot = createTempRepo();
        const title = 'Make the web UI cwd agnostic by default and add durable referenced project state';
        const first = createProjectRecord({
            repoRoot,
            profile: 'datadog',
            title,
            description: title,
        });
        const second = createProjectRecord({
            repoRoot,
            profile: 'datadog',
            title,
            description: title,
        });
        expect(first.project.id).toBe('make-the-web-ui-cwd-agnostic');
        expect(second.project.id).toBe('make-the-web-ui-cwd-agnostic-2');
        expect(second.project.id.length).toBeLessThanOrEqual(36);
    });
    it('updates project fields and current milestone', () => {
        const repoRoot = createTempRepo();
        createProjectScaffold({
            repoRoot,
            profile: 'datadog',
            projectId: 'artifact-model',
            title: 'Artifact model',
            description: 'Build the artifact model',
        });
        addProjectMilestone({
            repoRoot,
            profile: 'datadog',
            projectId: 'artifact-model',
            id: 'execute-work',
            title: 'Execute the work',
            status: 'pending',
        });
        const detail = updateProjectRecord({
            repoRoot,
            profile: 'datadog',
            projectId: 'artifact-model',
            title: 'Durable artifact model',
            description: 'Build the durable artifact model',
            summary: 'PROJECT.yaml is now canonical.',
            currentMilestoneId: 'execute-work',
            blockers: [],
            recentProgress: ['Migrated the project schema'],
        });
        expect(detail.project.title).toBe('Durable artifact model');
        expect(detail.project.description).toBe('Build the durable artifact model');
        expect(detail.project.summary).toBe('PROJECT.yaml is now canonical.');
        expect(detail.project.plan.currentMilestoneId).toBe('execute-work');
        expect(detail.project.recentProgress).toEqual(['Migrated the project schema']);
    });
    it('updates and clears the project repo root', () => {
        const repoRoot = createTempRepo();
        createProjectScaffold({
            repoRoot,
            profile: 'datadog',
            projectId: 'artifact-model',
            title: 'Build the artifact model',
            description: 'Build the artifact model',
        });
        let detail = updateProjectRecord({
            repoRoot,
            profile: 'datadog',
            projectId: 'artifact-model',
            projectRepoRoot: '../workspace/artifact-model',
        });
        expect(detail.project.repoRoot).toBe(resolve(repoRoot, '../workspace/artifact-model'));
        detail = updateProjectRecord({
            repoRoot,
            profile: 'datadog',
            projectId: 'artifact-model',
            projectRepoRoot: '',
        });
        expect(detail.project.repoRoot).toBeUndefined();
    });
    it('adds and updates milestones', () => {
        const repoRoot = createTempRepo();
        createProjectScaffold({
            repoRoot,
            profile: 'datadog',
            projectId: 'web-ui',
            title: 'Ship the web UI',
            description: 'Ship the web UI',
        });
        addProjectMilestone({
            repoRoot,
            profile: 'datadog',
            projectId: 'web-ui',
            id: 'polish',
            title: 'Polish the project page',
            status: 'pending',
            summary: 'Reduce visual density and expose editing affordances.',
            makeCurrent: true,
        });
        const updated = updateProjectMilestone({
            repoRoot,
            profile: 'datadog',
            projectId: 'web-ui',
            milestoneId: 'polish',
            status: 'in_progress',
            summary: 'Editing flows are now the focus.',
        });
        const milestone = updated.project.plan.milestones.find((entry) => entry.id === 'polish');
        expect(milestone).toEqual({
            id: 'polish',
            title: 'Polish the project page',
            status: 'in_progress',
            summary: 'Editing flows are now the focus.',
        });
        expect(updated.project.plan.currentMilestoneId).toBe('polish');
    });
    it('creates and updates task records', () => {
        const repoRoot = createTempRepo();
        createProjectScaffold({
            repoRoot,
            profile: 'datadog',
            projectId: 'web-ui',
            title: 'Ship the web UI',
            description: 'Ship the web UI',
        });
        addProjectMilestone({
            repoRoot,
            profile: 'datadog',
            projectId: 'web-ui',
            id: 'editing',
            title: 'Add editing flows',
            status: 'in_progress',
            makeCurrent: true,
        });
        createProjectTaskRecord({
            repoRoot,
            profile: 'datadog',
            projectId: 'web-ui',
            title: 'Add a project editor',
            status: 'pending',
            milestoneId: 'editing',
        });
        const createdTask = readProjectDetailFromProject({
            repoRoot,
            profile: 'datadog',
            projectId: 'web-ui',
        }).tasks[0];
        const updated = updateProjectTaskRecord({
            repoRoot,
            profile: 'datadog',
            projectId: 'web-ui',
            taskId: createdTask?.id ?? '',
            status: 'in_progress',
        });
        const task = updated.tasks.find((entry) => entry.id === createdTask?.id);
        expect(task).toEqual(expect.objectContaining({
            status: 'in_progress',
            milestoneId: 'editing',
            title: 'Add a project editor',
        }));
    });
    it('deletes and reorders milestones', () => {
        const repoRoot = createTempRepo();
        createProjectScaffold({
            repoRoot,
            profile: 'datadog',
            projectId: 'web-ui',
            title: 'Ship the web UI',
            description: 'Ship the web UI',
        });
        addProjectMilestone({
            repoRoot,
            profile: 'datadog',
            projectId: 'web-ui',
            id: 'planning',
            title: 'Planning',
            status: 'completed',
        });
        addProjectMilestone({
            repoRoot,
            profile: 'datadog',
            projectId: 'web-ui',
            id: 'editing',
            title: 'Add editing flows',
            status: 'in_progress',
        });
        addProjectMilestone({
            repoRoot,
            profile: 'datadog',
            projectId: 'web-ui',
            id: 'ship',
            title: 'Ship it',
            status: 'pending',
        });
        let detail = moveProjectMilestone({
            repoRoot,
            profile: 'datadog',
            projectId: 'web-ui',
            milestoneId: 'ship',
            direction: 'up',
        });
        expect(detail.project.plan.milestones[1]?.id).toBe('ship');
        detail = deleteProjectMilestone({
            repoRoot,
            profile: 'datadog',
            projectId: 'web-ui',
            milestoneId: 'editing',
        });
        expect(detail.project.plan.milestones.some((milestone) => milestone.id === 'editing')).toBe(false);
    });
    it('deletes and reorders tasks within a milestone', () => {
        const repoRoot = createTempRepo();
        createProjectScaffold({
            repoRoot,
            profile: 'datadog',
            projectId: 'web-ui',
            title: 'Ship the web UI',
            description: 'Ship the web UI',
        });
        addProjectMilestone({
            repoRoot,
            profile: 'datadog',
            projectId: 'web-ui',
            id: 'work',
            title: 'Work',
            status: 'in_progress',
        });
        createProjectTaskRecord({
            repoRoot,
            profile: 'datadog',
            projectId: 'web-ui',
            taskId: 'task-a',
            title: 'Task A',
            status: 'pending',
            milestoneId: 'work',
        });
        createProjectTaskRecord({
            repoRoot,
            profile: 'datadog',
            projectId: 'web-ui',
            taskId: 'task-b',
            title: 'Task B',
            status: 'pending',
            milestoneId: 'work',
        });
        createProjectTaskRecord({
            repoRoot,
            profile: 'datadog',
            projectId: 'web-ui',
            taskId: 'task-c',
            title: 'Task C',
            status: 'pending',
            milestoneId: 'work',
        });
        let detail = moveProjectTaskRecord({
            repoRoot,
            profile: 'datadog',
            projectId: 'web-ui',
            taskId: 'task-c',
            direction: 'up',
        });
        expect(detail.tasks.map((task) => task.id)).toEqual(['task-a', 'task-c', 'task-b']);
        detail = deleteProjectTaskRecord({
            repoRoot,
            profile: 'datadog',
            projectId: 'web-ui',
            taskId: 'task-c',
        });
        expect(detail.tasks.map((task) => task.id)).toEqual(['task-a', 'task-b']);
    });
    it('deletes a project directory recursively', () => {
        const repoRoot = createTempRepo();
        createProjectScaffold({
            repoRoot,
            profile: 'datadog',
            projectId: 'web-ui',
            title: 'Ship the web UI',
            description: 'Ship the web UI',
        });
        createProjectTaskRecord({
            repoRoot,
            profile: 'datadog',
            projectId: 'web-ui',
            taskId: 'task-a',
            title: 'Task A',
            status: 'pending',
        });
        const paths = resolveProjectPaths({ repoRoot, profile: 'datadog', projectId: 'web-ui' });
        expect(existsSync(paths.projectDir)).toBe(true);
        const result = deleteProjectRecord({
            repoRoot,
            profile: 'datadog',
            projectId: 'web-ui',
        });
        expect(result).toEqual({ ok: true, deletedProjectId: 'web-ui' });
        expect(existsSync(paths.projectDir)).toBe(false);
    });
    it('reads and saves raw project yaml', () => {
        const repoRoot = createTempRepo();
        createProjectScaffold({
            repoRoot,
            profile: 'datadog',
            projectId: 'web-ui',
            title: 'Ship the web UI',
            description: 'Ship the web UI',
        });
        const projectSource = readProjectSource({ repoRoot, profile: 'datadog', projectId: 'web-ui' });
        expect(projectSource.path).toContain('PROJECT.yaml');
        const savedProject = saveProjectSource({
            repoRoot,
            profile: 'datadog',
            projectId: 'web-ui',
            content: projectSource.content.replace('status: created', 'status: blocked'),
        });
        expect(savedProject.project.status).toBe('blocked');
    });
});

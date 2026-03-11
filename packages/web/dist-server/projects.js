import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { readProjectPlan, readProjectSummary, readProjectTask, resolveProjectPaths, } from '@personal-agent/core';
const TASK_STATUS_RANK = {
    running: 0,
    blocked: 1,
    failed: 2,
    pending: 3,
    completed: 4,
    cancelled: 5,
};
function taskStatusRank(status) {
    return TASK_STATUS_RANK[status] ?? TASK_STATUS_RANK.pending;
}
function listMarkdownFiles(dir) {
    if (!existsSync(dir)) {
        return [];
    }
    return readdirSync(dir)
        .filter((name) => name.endsWith('.md'))
        .sort((left, right) => left.localeCompare(right));
}
export function sortProjectTasks(tasks) {
    return [...tasks].sort((left, right) => {
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
function readProjectTasks(dir) {
    const tasks = listMarkdownFiles(dir).map((fileName) => {
        const task = readProjectTask(join(dir, fileName));
        return {
            id: task.id,
            createdAt: task.createdAt,
            updatedAt: task.updatedAt,
            status: task.status,
            title: task.title,
            summary: task.summary,
        };
    });
    return sortProjectTasks(tasks);
}
export function readProjectDetailFromProject(options) {
    const paths = resolveProjectPaths(options);
    const tasks = readProjectTasks(paths.tasksDir);
    return {
        id: options.projectId,
        summary: readProjectSummary(paths.summaryFile),
        plan: readProjectPlan(paths.planFile),
        taskCount: tasks.length,
        artifactCount: listMarkdownFiles(paths.artifactsDir).length,
        tasks,
    };
}

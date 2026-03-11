import { mkdtempSync, mkdirSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { getConversationProjectLink } from '@personal-agent/core';
import { readProjectDetailFromProject } from './projects.js';
import { createProjectAgentExtension } from './projectAgentExtension.js';
const tempDirs = [];
function createTempRepo() {
    const dir = mkdtempSync(join(tmpdir(), 'pa-project-tool-'));
    tempDirs.push(dir);
    mkdirSync(join(dir, 'profiles', 'shared', 'agent'), { recursive: true });
    mkdirSync(join(dir, 'profiles', 'datadog', 'agent'), { recursive: true });
    return dir;
}
afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
function registerProjectTool(repoRoot) {
    let registeredTool;
    createProjectAgentExtension({
        repoRoot,
        getCurrentProfile: () => 'datadog',
    })({
        registerTool: (tool) => {
            registeredTool = tool;
        },
    });
    return registeredTool;
}
function createToolContext(conversationId = 'conv-123') {
    return {
        cwd: '/tmp/workspace',
        hasUI: false,
        isIdle: () => true,
        abort: () => { },
        hasPendingMessages: () => false,
        shutdown: () => { },
        getContextUsage: () => undefined,
        compact: () => { },
        getSystemPrompt: () => '',
        modelRegistry: {},
        model: undefined,
        sessionManager: {
            getSessionId: () => conversationId,
        },
        ui: {},
    };
}
describe('project agent extension', () => {
    it('creates and references a project in the current conversation', async () => {
        const repoRoot = createTempRepo();
        const projectTool = registerProjectTool(repoRoot);
        const result = await projectTool.execute('tool-1', {
            action: 'create',
            description: 'Build the web UI shell.',
        }, undefined, undefined, createToolContext());
        expect(result.isError).not.toBe(true);
        expect(result.content[0]?.text).toContain('Created and referenced @build-the-web-ui-shell');
        const detail = readProjectDetailFromProject({ repoRoot, profile: 'datadog', projectId: 'build-the-web-ui-shell' });
        expect(detail.project.description).toBe('Build the web UI shell.');
        const link = getConversationProjectLink({ repoRoot, profile: 'datadog', conversationId: 'conv-123' });
        expect(link?.relatedProjectIds).toEqual(['build-the-web-ui-shell']);
    });
    it('adds milestones and tasks to an existing project', async () => {
        const repoRoot = createTempRepo();
        const projectTool = registerProjectTool(repoRoot);
        const ctx = createToolContext();
        const createdProjectId = 'build-the-artifact-model';
        await projectTool.execute('tool-1', {
            action: 'create',
            description: 'Build the artifact model.',
            referenceInConversation: false,
        }, undefined, undefined, ctx);
        await projectTool.execute('tool-2', {
            action: 'add_milestone',
            projectId: createdProjectId,
            title: 'Finalize the schema',
            milestoneStatus: 'in_progress',
            makeCurrent: true,
        }, undefined, undefined, ctx);
        const taskResult = await projectTool.execute('tool-3', {
            action: 'add_task',
            projectId: createdProjectId,
            title: 'Write the YAML parser',
            taskStatus: 'in_progress',
            taskMilestoneId: 'finalize-the-schema',
        }, undefined, undefined, ctx);
        expect(taskResult.isError).not.toBe(true);
        expect(taskResult.content[0]?.text).toContain(`Added task to project ${createdProjectId}`);
        const detail = readProjectDetailFromProject({ repoRoot, profile: 'datadog', projectId: createdProjectId });
        expect(detail.project.plan.currentMilestoneId).toBe('finalize-the-schema');
        expect(detail.project.plan.milestones.some((milestone) => milestone.id === 'finalize-the-schema')).toBe(true);
        expect(detail.tasks[0]).toEqual(expect.objectContaining({
            id: 'write-the-yaml-parser',
            status: 'in_progress',
            milestoneId: 'finalize-the-schema',
        }));
    });
});

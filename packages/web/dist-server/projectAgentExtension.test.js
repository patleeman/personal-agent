import { mkdtempSync, mkdirSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createProjectScaffold, getConversationProjectLink } from '@personal-agent/core';
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
function registerProjectTool(repoRoot, stateRoot) {
    let registeredTool;
    createProjectAgentExtension({
        repoRoot,
        stateRoot,
        getCurrentProfile: () => 'datadog',
    })({
        registerTool: (tool) => {
            registeredTool = tool;
        },
    });
    if (!registeredTool) {
        throw new Error('Project tool was not registered.');
    }
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
    it('references and unreferences a project in the current conversation', async () => {
        const repoRoot = createTempRepo();
        const stateRoot = join(repoRoot, '.state');
        const projectTool = registerProjectTool(repoRoot, stateRoot);
        createProjectScaffold({
            repoRoot,
            profile: 'datadog',
            projectId: 'artifact-model',
            title: 'Artifact model',
            description: 'Build the artifact model.',
        });
        const referenceResult = await projectTool.execute('tool-1', {
            action: 'reference',
            projectId: 'artifact-model',
        }, undefined, undefined, createToolContext());
        expect(referenceResult.isError).not.toBe(true);
        expect(referenceResult.content[0]?.text).toContain('Referenced @artifact-model');
        let link = getConversationProjectLink({ stateRoot, profile: 'datadog', conversationId: 'conv-123' });
        expect(link?.relatedProjectIds).toEqual(['artifact-model']);
        const unreferenceResult = await projectTool.execute('tool-2', {
            action: 'unreference',
            projectId: 'artifact-model',
        }, undefined, undefined, createToolContext());
        expect(unreferenceResult.isError).not.toBe(true);
        expect(unreferenceResult.content[0]?.text).toContain('Stopped referencing @artifact-model');
        link = getConversationProjectLink({ stateRoot, profile: 'datadog', conversationId: 'conv-123' });
        expect(link?.relatedProjectIds ?? []).toEqual([]);
    });
    it('returns an error when referencing a missing project', async () => {
        const repoRoot = createTempRepo();
        const stateRoot = join(repoRoot, '.state');
        const projectTool = registerProjectTool(repoRoot, stateRoot);
        const result = await projectTool.execute('tool-1', {
            action: 'reference',
            projectId: 'missing-project',
        }, undefined, undefined, createToolContext());
        expect(result.isError).toBe(true);
        expect(result.content[0]?.text).toContain('Project not found: missing-project');
    });
});

import { describe, expect, it } from 'vitest';
import { buildReferencedMemoryDocsContext, buildReferencedProfilesContext, buildReferencedSkillsContext, buildReferencedTasksContext, extractMentionIds, pickPromptReferencesInOrder, resolvePromptReferences, } from './promptReferences.js';
const TASKS = [
    {
        id: 'daily-review',
        filePath: '/repo/profiles/datadog/agent/tasks/daily-review.task.md',
        prompt: 'Review today\'s items.',
        enabled: true,
        running: false,
        cron: '0 9 * * *',
        model: 'claude-sonnet-4-6',
        lastStatus: 'success',
    },
    {
        id: 'memory-maintenance',
        filePath: '/repo/profiles/datadog/agent/tasks/memory-maintenance.task.md',
        prompt: 'Maintain durable memory.',
        enabled: false,
        running: true,
    },
];
const MEMORY_DOCS = [
    {
        id: 'project-state-model',
        title: 'Project State Model',
        summary: 'How projects are represented in durable artifacts.',
        tags: ['architecture', 'projects'],
        path: '/repo/profiles/datadog/agent/memory/project-state-model.md',
        updated: '2026-03-11',
    },
];
const SKILLS = [
    {
        name: 'dd-pup-cli',
        source: 'datadog',
        description: 'Query Datadog platform data.',
        path: '/repo/profiles/datadog/agent/skills/dd-pup-cli/SKILL.md',
    },
];
const PROFILES = [
    {
        id: 'profile',
        profile: 'datadog',
        source: 'datadog',
        path: '/repo/profiles/datadog/agent/AGENTS.md',
    },
];
describe('promptReferences', () => {
    it('extracts unique mention ids in encounter order', () => {
        expect(extractMentionIds('Check @daily-review and @project-state-model then @daily-review again')).toEqual([
            'daily-review',
            'project-state-model',
        ]);
    });
    it('resolves project, task, memory doc, skill, and profile mentions independently', () => {
        expect(resolvePromptReferences({
            text: 'Use @web-ui with @memory-maintenance @project-state-model @dd-pup-cli and @profile.',
            availableProjectIds: ['web-ui', 'artifact-model'],
            tasks: TASKS,
            memoryDocs: MEMORY_DOCS,
            skills: SKILLS,
            profiles: PROFILES,
        })).toEqual({
            projectIds: ['web-ui'],
            taskIds: ['memory-maintenance'],
            memoryDocIds: ['project-state-model'],
            skillNames: ['dd-pup-cli'],
            profileIds: ['profile'],
        });
    });
    it('preserves mention order when selecting referenced items', () => {
        expect(pickPromptReferencesInOrder(['memory-maintenance', 'daily-review'], TASKS).map((task) => task.id)).toEqual([
            'memory-maintenance',
            'daily-review',
        ]);
        expect(pickPromptReferencesInOrder(['dd-pup-cli'], SKILLS).map((skill) => skill.name)).toEqual(['dd-pup-cli']);
    });
    it('builds scheduled task context with file paths and status', () => {
        const context = buildReferencedTasksContext(TASKS, '/repo');
        expect(context).toContain('Referenced scheduled tasks:');
        expect(context).toContain('@daily-review');
        expect(context).toContain('profiles/datadog/agent/tasks/daily-review.task.md');
        expect(context).toContain('status: enabled, last status success');
        expect(context).toContain('prompt: Review today\'s items.');
        expect(context).toContain('status: disabled, running');
    });
    it('builds knowledge doc context with title, summary, and tags', () => {
        const context = buildReferencedMemoryDocsContext(MEMORY_DOCS, '/repo');
        expect(context).toContain('Referenced knowledge docs:');
        expect(context).toContain('@project-state-model: Project State Model');
        expect(context).toContain('summary: How projects are represented in durable artifacts.');
        expect(context).toContain('tags: architecture, projects');
    });
    it('builds skill and profile context with paths and descriptions', () => {
        const skillsContext = buildReferencedSkillsContext(SKILLS, '/repo');
        expect(skillsContext).toContain('Referenced skills:');
        expect(skillsContext).toContain('@dd-pup-cli');
        expect(skillsContext).toContain('source: datadog');
        expect(skillsContext).toContain('description: Query Datadog platform data.');
        const profilesContext = buildReferencedProfilesContext(PROFILES, '/repo');
        expect(profilesContext).toContain('Referenced profile instructions:');
        expect(profilesContext).toContain('@profile: datadog');
        expect(profilesContext).toContain('profiles/datadog/agent/AGENTS.md');
    });
});

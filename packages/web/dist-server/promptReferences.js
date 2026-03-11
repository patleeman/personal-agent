import { relative } from 'node:path';
function appendUnique(target, seen, value) {
    if (seen.has(value)) {
        return;
    }
    seen.add(value);
    target.push(value);
}
export function extractMentionIds(text) {
    const matches = text.match(/@[a-zA-Z0-9][a-zA-Z0-9-_]*/g) ?? [];
    const result = [];
    const seen = new Set();
    for (const match of matches) {
        const id = match.slice(1);
        appendUnique(result, seen, id);
    }
    return result;
}
export function resolvePromptReferences(input) {
    const mentionIds = extractMentionIds(input.text);
    const projectIdSet = new Set(input.availableProjectIds);
    const taskIdSet = new Set(input.tasks.map((task) => task.id));
    const memoryDocIdSet = new Set(input.memoryDocs.map((doc) => doc.id));
    const skillNameSet = new Set(input.skills.map((skill) => skill.name));
    const profileIdSet = new Set(input.profiles.map((profile) => profile.id));
    const projectIds = [];
    const taskIds = [];
    const memoryDocIds = [];
    const skillNames = [];
    const profileIds = [];
    const seenProjects = new Set();
    const seenTasks = new Set();
    const seenMemoryDocs = new Set();
    const seenSkills = new Set();
    const seenProfiles = new Set();
    for (const mentionId of mentionIds) {
        if (projectIdSet.has(mentionId)) {
            appendUnique(projectIds, seenProjects, mentionId);
        }
        if (taskIdSet.has(mentionId)) {
            appendUnique(taskIds, seenTasks, mentionId);
        }
        if (memoryDocIdSet.has(mentionId)) {
            appendUnique(memoryDocIds, seenMemoryDocs, mentionId);
        }
        if (skillNameSet.has(mentionId)) {
            appendUnique(skillNames, seenSkills, mentionId);
        }
        if (profileIdSet.has(mentionId)) {
            appendUnique(profileIds, seenProfiles, mentionId);
        }
    }
    return {
        projectIds,
        taskIds,
        memoryDocIds,
        skillNames,
        profileIds,
    };
}
export function pickPromptReferencesInOrder(ids, items) {
    const byId = new Map();
    for (const item of items) {
        const key = item.id ?? item.name;
        if (!key) {
            continue;
        }
        byId.set(key, item);
    }
    return ids.flatMap((id) => {
        const item = byId.get(id);
        return item ? [item] : [];
    });
}
export function buildReferencedTasksContext(tasks, repoRoot) {
    return [
        'Referenced scheduled tasks:',
        ...tasks.map((task) => {
            const lines = [
                `- @${task.id}`,
                `  path: ${relative(repoRoot, task.filePath)}`,
            ];
            if (task.cron) {
                lines.push(`  cron: ${task.cron}`);
            }
            if (task.model) {
                lines.push(`  model: ${task.model}`);
            }
            const statusParts = [task.enabled ? 'enabled' : 'disabled'];
            if (task.running) {
                statusParts.push('running');
            }
            if (task.lastStatus) {
                statusParts.push(`last status ${task.lastStatus}`);
            }
            lines.push(`  status: ${statusParts.join(', ')}`);
            if (task.prompt) {
                lines.push(`  prompt: ${task.prompt}`);
            }
            return lines.join('\n');
        }),
        'These are durable scheduled-task definitions. Read the task file before changing automation behavior, schedules, or runtime settings.',
    ].join('\n');
}
export function buildReferencedMemoryDocsContext(memoryDocs, repoRoot) {
    return [
        'Referenced knowledge docs:',
        ...memoryDocs.map((doc) => {
            const lines = [
                `- @${doc.id}: ${doc.title}`,
                `  path: ${relative(repoRoot, doc.path)}`,
            ];
            if (doc.summary) {
                lines.push(`  summary: ${doc.summary}`);
            }
            if (doc.tags.length > 0) {
                lines.push(`  tags: ${doc.tags.join(', ')}`);
            }
            if (doc.updated) {
                lines.push(`  updated: ${doc.updated}`);
            }
            return lines.join('\n');
        }),
        'These are durable knowledge docs. Read them when the user refers to that knowledge, asks for details, or wants the information updated.',
    ].join('\n');
}
export function buildReferencedSkillsContext(skills, repoRoot) {
    return [
        'Referenced skills:',
        ...skills.map((skill) => {
            const lines = [
                `- @${skill.name}`,
                `  path: ${relative(repoRoot, skill.path)}`,
                `  source: ${skill.source}`,
            ];
            if (skill.description) {
                lines.push(`  description: ${skill.description}`);
            }
            return lines.join('\n');
        }),
        'These are reusable workflow skills. Read the skill file when the user refers to that workflow, asks how it works, or wants it applied.',
    ].join('\n');
}
export function buildReferencedProfilesContext(profiles, repoRoot) {
    return [
        'Referenced profile instructions:',
        ...profiles.map((profile) => [
            `- @${profile.id}: ${profile.id} profile`,
            `  path: ${relative(repoRoot, profile.path)}`,
            `  source: ${profile.source}`,
        ].join('\n')),
        'These are active profile instructions. Read them when the user refers to profile behavior, durable preferences, or operating constraints.',
    ].join('\n');
}

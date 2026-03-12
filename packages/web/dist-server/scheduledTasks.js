import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
function normalizePath(value) {
    return resolve(value).replace(/\\/g, '/');
}
function readFrontmatter(content) {
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    return match?.[1];
}
function readFrontmatterString(frontmatter, key) {
    if (!frontmatter) {
        return undefined;
    }
    const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = frontmatter.match(new RegExp(`^${escapedKey}:\\s*[\"']?([^\"'\\n]+)[\"']?\\s*$`, 'm'));
    const value = match?.[1]?.trim();
    return value && value.length > 0 ? value : undefined;
}
export function inferTaskProfileFromFilePath(filePath) {
    const normalized = normalizePath(filePath);
    const match = normalized.match(/\/profiles\/([^/]+)\/agent\/tasks(?:\/|$)/);
    return match?.[1];
}
export function readScheduledTaskFileMetadata(filePath) {
    const fileContent = readFileSync(filePath, 'utf-8');
    const frontmatter = readFrontmatter(fileContent);
    const prompt = fileContent.replace(/^---\n[\s\S]*?\n---\n?/, '').trim().split('\n')[0]?.slice(0, 120) ?? '';
    return {
        fileContent,
        enabled: !Boolean(frontmatter && /enabled:\s*false/.test(frontmatter)),
        cron: readFrontmatterString(frontmatter, 'cron'),
        model: readFrontmatterString(frontmatter, 'model'),
        profile: readFrontmatterString(frontmatter, 'profile') ?? inferTaskProfileFromFilePath(filePath),
        cwd: readFrontmatterString(frontmatter, 'cwd'),
        prompt,
    };
}
export function taskBelongsToProfile(task, profile) {
    const inferredProfile = inferTaskProfileFromFilePath(task.filePath);
    if (inferredProfile) {
        return inferredProfile === profile;
    }
    if (!existsSync(task.filePath)) {
        return false;
    }
    try {
        const metadata = readScheduledTaskFileMetadata(task.filePath);
        return metadata.profile === profile;
    }
    catch {
        return false;
    }
}

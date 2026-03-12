import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export interface TaskRuntimeEntry {
  id: string;
  filePath: string;
  scheduleType: string;
  running: boolean;
  lastStatus?: string;
  lastRunAt?: string;
  lastSuccessAt?: string;
  lastScheduledMinute?: string;
  lastAttemptCount?: number;
  lastLogPath?: string;
}

export interface ScheduledTaskFileMetadata {
  fileContent: string;
  enabled: boolean;
  cron?: string;
  model?: string;
  profile?: string;
  cwd?: string;
  prompt: string;
}

function normalizePath(value: string): string {
  return resolve(value).replace(/\\/g, '/');
}

function readFrontmatter(content: string): string | undefined {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  return match?.[1];
}

function readFrontmatterString(frontmatter: string | undefined, key: string): string | undefined {
  if (!frontmatter) {
    return undefined;
  }

  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = frontmatter.match(new RegExp(`^${escapedKey}:\\s*[\"']?([^\"'\\n]+)[\"']?\\s*$`, 'm'));
  const value = match?.[1]?.trim();
  return value && value.length > 0 ? value : undefined;
}

export function inferTaskProfileFromFilePath(filePath: string): string | undefined {
  const normalized = normalizePath(filePath);
  const match = normalized.match(/\/profiles\/([^/]+)\/agent\/tasks(?:\/|$)/);
  return match?.[1];
}

export function readScheduledTaskFileMetadata(filePath: string): ScheduledTaskFileMetadata {
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

export function taskBelongsToProfile(task: { filePath: string }, profile: string): boolean {
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
  } catch {
    return false;
  }
}

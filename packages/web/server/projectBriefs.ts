import { existsSync, readFileSync } from 'node:fs';
import { completeSimple, type Api, type Model, type ThinkingLevel } from '@mariozechner/pi-ai';
import { AuthStorage, ModelRegistry } from '@mariozechner/pi-coding-agent';
import { requirePromptCatalogEntry } from '@personal-agent/resources';
import type { ProjectDetail, ProjectLinkedConversation } from './projects.js';

const DEFAULT_PROVIDER = 'openai-codex';
const DEFAULT_MODEL = 'gpt-5.1-codex-mini';
const DEFAULT_REASONING: ThinkingLevel = 'minimal';
const DEFAULT_MAX_ITEMS = 8;

interface ProjectActivityEntryInput {
  summary: string;
  details?: string;
  relatedProjectIds?: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readSettingsObject(settingsFile: string): Record<string, unknown> {
  if (!existsSync(settingsFile)) {
    return {};
  }

  try {
    const parsed = JSON.parse(readFileSync(settingsFile, 'utf-8')) as unknown;
    return isRecord(parsed) ? { ...parsed } : {};
  } catch {
    return {};
  }
}

function readNonEmptyString(value: unknown): string {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : '';
}

function normalizeThinkingLevel(value: unknown): ThinkingLevel {
  switch (value) {
    case 'minimal':
    case 'low':
    case 'medium':
    case 'high':
    case 'xhigh':
      return value;
    default:
      return DEFAULT_REASONING;
  }
}

function readProjectBriefSettings(settingsFile: string): {
  provider: string;
  model: string;
  reasoning: ThinkingLevel;
} {
  const settings = readSettingsObject(settingsFile);
  const configuredModel = readNonEmptyString(settings.defaultModel);
  const configuredProvider = readNonEmptyString(settings.defaultProvider);
  const configuredThinkingLevel = normalizeThinkingLevel(settings.defaultThinkingLevel);

  return {
    provider: configuredProvider || DEFAULT_PROVIDER,
    model: configuredModel || DEFAULT_MODEL,
    reasoning: configuredThinkingLevel,
  };
}

function makeModelRegistry(authFile: string): ModelRegistry {
  return new ModelRegistry(AuthStorage.create(authFile));
}

function resolveModel(modelRegistry: ModelRegistry, settings: { provider: string; model: string }): Model<Api> | null {
  return modelRegistry.getAvailable().find((model) => model.provider === settings.provider && model.id === settings.model) ?? null;
}

function truncate(value: string, maxLength = 280): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

function formatList(lines: string[], fallback: string): string {
  return lines.length > 0 ? lines.join('\n') : fallback;
}

function buildProjectDigest(
  detail: ProjectDetail,
  linkedConversations: ProjectLinkedConversation[],
  activityEntries: ProjectActivityEntryInput[],
): string {
  const project = detail.project;
  const milestoneLines = project.plan.milestones.slice(0, DEFAULT_MAX_ITEMS).map((milestone) => (
    `- ${milestone.title} [${milestone.status}]${milestone.summary ? ` — ${truncate(milestone.summary, 160)}` : ''}`
  ));
  const taskLines = detail.tasks.slice(0, DEFAULT_MAX_ITEMS).map((task) => (
    `- ${task.title} [${task.status}]${task.milestoneId ? ` (milestone: ${task.milestoneId})` : ' (unassigned)'}`
  ));
  const noteLines = detail.notes.slice(0, DEFAULT_MAX_ITEMS).map((note) => (
    `- ${note.title} [${note.kind}] — ${truncate(note.body, 180) || 'No body.'}`
  ));
  const attachmentLines = detail.attachments.slice(0, DEFAULT_MAX_ITEMS).map((file) => (
    `- ${file.title} (${file.originalName}, ${file.sizeBytes} bytes)${file.description ? ` — ${truncate(file.description, 140)}` : ''}`
  ));
  const artifactLines = detail.artifacts.slice(0, DEFAULT_MAX_ITEMS).map((file) => (
    `- ${file.title} (${file.originalName}, ${file.sizeBytes} bytes)${file.description ? ` — ${truncate(file.description, 140)}` : ''}`
  ));
  const conversationLines = linkedConversations.slice(0, DEFAULT_MAX_ITEMS).map((conversation) => (
    `- ${conversation.title} (${conversation.conversationId})${conversation.lastActivityAt ? ` — last activity ${conversation.lastActivityAt}` : ''}${conversation.snippet ? ` — ${truncate(conversation.snippet, 180)}` : ''}`
  ));
  const activityLines = activityEntries.slice(0, DEFAULT_MAX_ITEMS).map((entry) => (
    `- ${entry.summary}${entry.details ? ` — ${truncate(entry.details, 180)}` : ''}`
  ));

  return [
    `Project ID: ${project.id}`,
    `Title: ${project.title}`,
    `Status: ${project.status}`,
    `Description: ${project.description}`,
    `Summary: ${project.summary}`,
    `Goal: ${project.requirements.goal}`,
    project.requirements.acceptanceCriteria.length > 0
      ? `Acceptance criteria: ${project.requirements.acceptanceCriteria.join(' | ')}`
      : 'Acceptance criteria: none',
    project.planSummary ? `Plan summary: ${project.planSummary}` : 'Plan summary: none',
    project.completionSummary ? `Completion summary: ${project.completionSummary}` : 'Completion summary: none',
    project.currentFocus ? `Current focus: ${project.currentFocus}` : 'Current focus: none',
    project.repoRoot ? `Repo root: ${project.repoRoot}` : 'Repo root: none',
    '',
    'Blockers:',
    formatList(project.blockers.map((blocker) => `- ${blocker}`), '- none'),
    '',
    'Recent progress:',
    formatList(project.recentProgress.map((item) => `- ${item}`), '- none'),
    '',
    'Milestones:',
    formatList(milestoneLines, '- none'),
    '',
    'Tasks:',
    formatList(taskLines, '- none'),
    '',
    'Existing handoff doc:',
    detail.brief ? truncate(detail.brief.content, 2_000) : 'No project handoff doc exists yet.',
    '',
    'Recent notes:',
    formatList(noteLines, '- none'),
    '',
    'Attachments:',
    formatList(attachmentLines, '- none'),
    '',
    'Artifacts:',
    formatList(artifactLines, '- none'),
    '',
    'Linked conversations:',
    formatList(conversationLines, '- none'),
    '',
    'Recent related activity:',
    formatList(activityLines, '- none'),
  ].join('\n');
}

function extractAssistantText(content: Array<{ type?: string; text?: string }>): string {
  return content
    .filter((item) => item.type === 'text' && typeof item.text === 'string')
    .map((item) => item.text?.trim() ?? '')
    .filter((text) => text.length > 0)
    .join('\n\n')
    .trim();
}

export async function generateProjectBrief(options: {
  detail: ProjectDetail;
  linkedConversations: ProjectLinkedConversation[];
  activityEntries: ProjectActivityEntryInput[];
  settingsFile: string;
  authFile: string;
}): Promise<string> {
  const settings = readProjectBriefSettings(options.settingsFile);
  const modelRegistry = makeModelRegistry(options.authFile);
  const model = resolveModel(modelRegistry, settings);
  if (!model) {
    throw new Error(`Project brief model not found: ${settings.provider}/${settings.model}`);
  }

  const authResult = await modelRegistry.getApiKeyAndHeaders(model);
  if (!authResult.ok) {
    throw new Error(`Project brief model auth could not be resolved: ${authResult.error}`);
  }

  const response = await completeSimple(
    model,
    {
      systemPrompt: requirePromptCatalogEntry('utilities/project-brief.md'),
      messages: [
        {
          role: 'user',
          timestamp: Date.now(),
          content: [{
            type: 'text',
            text: [
              'Regenerate the canonical project handoff document for this project.',
              'Use exactly these sections in markdown:',
              `# ${options.detail.project.title}`,
              '## Requirements',
              '### Goal',
              '### Acceptance criteria',
              '## Plan',
              '## Completion summary',
              '',
              'Requirements should capture the goal and explicit definition of done when it can be inferred from the project state.',
              'Plan should break the work into concrete chunks and note the most important open work.',
              'If the project is not finished yet, completion summary should say that clearly and summarize progress so far.',
              'Keep the writing compact, concrete, and useful for future conversations.',
              'Do not mention that the document was generated.',
              '',
              buildProjectDigest(options.detail, options.linkedConversations, options.activityEntries),
            ].join('\n'),
          }],
        },
      ],
    },
    {
      apiKey: authResult.apiKey,
      headers: authResult.headers,
      reasoning: settings.reasoning,
      temperature: 0.2,
      maxTokens: 900,
      cacheRetention: 'none',
    },
  );

  const text = extractAssistantText(response.content as Array<{ type?: string; text?: string }>);
  if (!text) {
    throw new Error('Project brief generation returned no text.');
  }

  return text.trim();
}

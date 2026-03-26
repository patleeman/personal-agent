import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { loadMemoryDocs, loadMemoryPackageReferences, type ParsedMemoryDoc, type ParsedMemoryReference } from '@personal-agent/core';

export interface DistilledConversationMemoryDraft {
  title: string;
  summary: string;
  body: string;
  tags: string[];
  userIntent: string;
  learnedPoints: string[];
  carryForwardPoints: string[];
}

export interface SaveCuratedDistilledConversationMemoryOptions {
  memoryDir: string;
  existingDocs: ParsedMemoryDoc[];
  draft: DistilledConversationMemoryDraft;
  updated: string;
  distilledAt: string;
  area?: string;
  sourceConversationTitle?: string;
  sourceCwd?: string;
  sourceProfile?: string;
  relatedProjectIds: string[];
  anchorPreview: string;
}

export interface SavedDistilledConversationMemoryResult {
  memory: {
    id: string;
    title: string;
    summary: string;
    tags: string[];
    path: string;
    type: string;
    status: string;
    area?: string;
    updated: string;
    referenceCount: number;
  };
  reference: {
    path: string;
    relativePath: string;
    title: string;
    summary: string;
    tags: string[];
    updated: string;
  };
  disposition: 'updated-existing' | 'created-reference';
}

interface ReferenceMatch {
  reference: ParsedMemoryReference;
  score: number;
}

const MEMORY_DOC_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const DISTILLED_UPDATES_HEADING = '## Distilled updates';
const GENERIC_MEMORY_TERMS = new Set([
  'about',
  'after',
  'agent',
  'also',
  'and',
  'around',
  'because',
  'been',
  'before',
  'being',
  'between',
  'both',
  'checkpoint',
  'checkpoints',
  'conversation',
  'conversations',
  'could',
  'detail',
  'details',
  'distill',
  'distilled',
  'does',
  'done',
  'durable',
  'during',
  'each',
  'file',
  'files',
  'from',
  'have',
  'hub',
  'hubs',
  'into',
  'just',
  'keep',
  'knowledge',
  'like',
  'make',
  'memory',
  'more',
  'most',
  'note',
  'notes',
  'onto',
  'over',
  'package',
  'packages',
  'reference',
  'references',
  'same',
  'should',
  'that',
  'them',
  'there',
  'these',
  'this',
  'through',
  'update',
  'updates',
  'user',
  'using',
  'when',
  'with',
  'work',
]);

function normalizeMatchText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeTag(value: string): string | null {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-');

  return normalized.length > 0 ? normalized : null;
}

function tokenizeForMatching(value: string, ignoredTerms: Set<string>): Set<string> {
  const tokens = normalizeMatchText(value)
    .split(' ')
    .filter((token) => token.length >= 4)
    .filter((token) => !GENERIC_MEMORY_TERMS.has(token))
    .filter((token) => !ignoredTerms.has(token));

  return new Set(tokens);
}

function buildIgnoredTerms(area: string | undefined): Set<string> {
  const ignoredTerms = new Set<string>();
  const normalizedArea = normalizeTag(area ?? '');
  if (!normalizedArea) {
    return ignoredTerms;
  }

  ignoredTerms.add(normalizedArea);
  for (const part of normalizedArea.split('-')) {
    if (part.length >= 2) {
      ignoredTerms.add(part);
    }
  }

  return ignoredTerms;
}

function buildSpecificDraftTags(tags: string[], area: string | undefined): string[] {
  const normalizedArea = normalizeTag(area ?? '');
  const values = tags
    .map((tag) => normalizeTag(tag))
    .filter((tag): tag is string => Boolean(tag))
    .filter((tag) => tag !== normalizedArea)
    .filter((tag) => tag !== 'conversation' && tag !== 'checkpoint' && tag !== 'memory');

  return [...new Set(values)];
}

function splitMarkdownFrontmatter(rawContent: string): { frontmatter: string; body: string } | null {
  const normalized = rawContent.replace(/\r\n/g, '\n');
  const match = normalized.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) {
    return null;
  }

  return {
    frontmatter: match[1] ?? '',
    body: (match[2] ?? '').replace(/^\n+/, ''),
  };
}

function readLooseString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function humanizeMemoryTitle(value: string): string {
  return value
    .split('-')
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function buildMemoryFrontmatter(options: {
  name: string;
  description: string;
  metadata: Record<string, unknown>;
}): Record<string, unknown> {
  const frontmatter: Record<string, unknown> = {
    name: options.name,
    description: options.description,
  };

  if (Object.keys(options.metadata).length > 0) {
    frontmatter.metadata = options.metadata;
  }

  return frontmatter;
}

function stringifyMemoryMarkdown(frontmatter: Record<string, unknown>, body: string): string {
  const frontmatterText = stringifyYaml(frontmatter).trimEnd();
  const normalizedBody = body.replace(/^\n+/, '');
  return `---\n${frontmatterText}\n---\n\n${normalizedBody.replace(/\s*$/, '\n')}`;
}

function readParsedReferenceMarkdown(filePath: string): { frontmatter: Record<string, unknown> | null; body: string } {
  if (!existsSync(filePath)) {
    throw new Error(`Memory file not found: ${filePath}`);
  }

  const raw = readFileSync(filePath, 'utf-8');
  const parsed = splitMarkdownFrontmatter(raw);
  if (!parsed) {
    return {
      frontmatter: null,
      body: raw.trim(),
    };
  }

  try {
    const frontmatter = parseYaml(parsed.frontmatter);
    if (!frontmatter || typeof frontmatter !== 'object' || Array.isArray(frontmatter)) {
      return {
        frontmatter: null,
        body: parsed.body,
      };
    }

    return {
      frontmatter: frontmatter as Record<string, unknown>,
      body: parsed.body,
    };
  } catch {
    return {
      frontmatter: null,
      body: parsed.body,
    };
  }
}

function readFrontmatterMetadata(frontmatter: Record<string, unknown> | null): Record<string, unknown> {
  if (!frontmatter) {
    return {};
  }

  const existing = frontmatter.metadata;
  if (existing && typeof existing === 'object' && !Array.isArray(existing)) {
    return { ...(existing as Record<string, unknown>) };
  }

  return {};
}

function appendDistilledUpdateSection(existingBody: string, block: string): string {
  const trimmedBody = existingBody.trimEnd();
  if (!trimmedBody) {
    return `${DISTILLED_UPDATES_HEADING}\n\n${block}\n`;
  }

  const hasSection = /(?:^|\n)## Distilled updates\s*(?:\n|$)/.test(trimmedBody);
  if (hasSection) {
    return `${trimmedBody}\n\n${block}\n`;
  }

  return `${trimmedBody}\n\n${DISTILLED_UPDATES_HEADING}\n\n${block}\n`;
}

function buildReferenceUpdateBlock(options: {
  updated: string;
  sourceConversationTitle?: string;
  sourceCwd?: string;
  draft: DistilledConversationMemoryDraft;
}): string {
  const lines = [
    `### ${options.updated} — ${options.draft.title}`,
    '',
    `- Summary: ${options.draft.summary}`,
    `- User intent: ${options.draft.userIntent}`,
  ];

  if (options.draft.learnedPoints.length > 0) {
    lines.push('- Learned:');
    for (const point of options.draft.learnedPoints) {
      lines.push(`  - ${point}`);
    }
  }

  if (options.draft.carryForwardPoints.length > 0) {
    lines.push('- Carry forward:');
    for (const point of options.draft.carryForwardPoints) {
      lines.push(`  - ${point}`);
    }
  }

  const sourceParts = [
    options.sourceConversationTitle ? `conversation "${options.sourceConversationTitle}"` : 'conversation',
    options.sourceCwd ? `cwd ${options.sourceCwd}` : undefined,
  ].filter((part): part is string => Boolean(part));

  lines.push(`- Source: ${sourceParts.join(' · ')}`);
  return lines.join('\n');
}

function compactDateStamp(now = new Date()): string {
  return now.toISOString().slice(0, 10).replace(/-/g, '');
}

function slugifyMemoryIdSegment(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-');

  if (!slug) {
    return 'memory-reference';
  }

  return slug.length > 52 ? slug.slice(0, 52).replace(/-+$/g, '') : slug;
}

function findHubDoc(docs: ParsedMemoryDoc[], area: string | undefined): ParsedMemoryDoc | undefined {
  if (!area) {
    return undefined;
  }

  const activeDocs = docs.filter((doc) => doc.status !== 'archived');
  const exact = activeDocs.find((doc) => doc.id === area);
  if (exact) {
    return exact;
  }

  const areaMatches = activeDocs.filter((doc) => doc.area === area);
  return areaMatches.length === 1 ? areaMatches[0] : undefined;
}

function scoreReferenceMatch(reference: ParsedMemoryReference, draft: DistilledConversationMemoryDraft, area: string | undefined): ReferenceMatch {
  const ignoredTerms = buildIgnoredTerms(area);
  const queryText = [draft.title, draft.summary, draft.body].join('\n');
  const normalizedQueryText = normalizeMatchText(queryText);
  const queryTokens = tokenizeForMatching(queryText, ignoredTerms);
  const referenceText = [reference.id, reference.title, reference.summary, reference.tags.join(' '), reference.body].join('\n');
  const referenceTokens = tokenizeForMatching(referenceText, ignoredTerms);
  const draftTags = buildSpecificDraftTags(draft.tags, area);
  const referenceTags = reference.tags
    .map((tag) => normalizeTag(tag))
    .filter((tag): tag is string => Boolean(tag));

  let score = 0;

  const matchedDraftTags = draftTags.filter((tag) => referenceTags.includes(tag));
  score += matchedDraftTags.length * 4;

  for (const tag of referenceTags) {
    const phrase = tag.replace(/-/g, ' ');
    if (phrase.length >= 4 && normalizedQueryText.includes(phrase)) {
      score += 2;
    }
  }

  const normalizedTitle = normalizeMatchText(reference.title);
  if (normalizedTitle.length >= 8 && normalizedQueryText.includes(normalizedTitle)) {
    score += 3;
  }

  const normalizedIdPhrase = reference.id.replace(/-/g, ' ');
  if (normalizedIdPhrase.length >= 8 && normalizedQueryText.includes(normalizedIdPhrase)) {
    score += 3;
  }

  let overlapCount = 0;
  for (const token of queryTokens) {
    if (referenceTokens.has(token)) {
      overlapCount += 1;
    }
  }
  score += Math.min(overlapCount, 6);

  return { reference, score };
}

function chooseReferenceMatch(references: ParsedMemoryReference[], draft: DistilledConversationMemoryDraft, area: string | undefined): ParsedMemoryReference | undefined {
  const scored = references
    .map((reference) => scoreReferenceMatch(reference, draft, area))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return left.reference.title.localeCompare(right.reference.title);
    });

  const top = scored[0];
  const second = scored[1];
  const isStrongMatch = Boolean(top)
    && top.score >= 6
    && (!second || top.score >= second.score + 2);

  return isStrongMatch ? top?.reference : undefined;
}

function deriveNewHubId(existingDocs: ParsedMemoryDoc[], draft: DistilledConversationMemoryDraft, area: string | undefined): string {
  const specificTag = buildSpecificDraftTags(draft.tags, area)[0];
  const preferred = area ?? specificTag ?? slugifyMemoryIdSegment(draft.title);
  const safeBase = MEMORY_DOC_ID_PATTERN.test(preferred) ? preferred : slugifyMemoryIdSegment(draft.title);
  const existingIds = new Set(existingDocs.map((doc) => doc.id));

  let candidate = safeBase || `memory-${compactDateStamp()}`;
  let suffix = 2;
  while (existingIds.has(candidate)) {
    candidate = `${safeBase}-${suffix}`;
    suffix += 1;
  }

  return candidate;
}

function readHubDoc(memoryDir: string, id: string): ParsedMemoryDoc {
  const refreshed = loadMemoryDocs({ profilesRoot: join(dirname(memoryDir), 'profiles') }).docs.find((doc) => doc.id === id);
  if (!refreshed) {
    throw new Error(`Failed to load note node @${id}.`);
  }

  return refreshed;
}

function normalizeHubMemoryDir(memoryDir: string): string {
  return basename(memoryDir) === 'memory' ? join(dirname(memoryDir), 'notes') : memoryDir;
}

function createHubMemoryDoc(options: SaveCuratedDistilledConversationMemoryOptions, existingDocs: ParsedMemoryDoc[]): ParsedMemoryDoc {
  const id = deriveNewHubId(existingDocs, options.draft, options.area);
  const packagePath = join(normalizeHubMemoryDir(options.memoryDir), id);
  const filePath = join(packagePath, 'INDEX.md');
  const hubTitle = options.area ? humanizeMemoryTitle(options.area) : options.draft.title;
  const hubSummary = options.area
    ? `Durable note node for ${humanizeMemoryTitle(options.area)}.`
    : options.draft.summary;
  const tags = [...new Set([
    ...options.draft.tags.filter((tag) => tag !== 'conversation' && tag !== 'checkpoint'),
    'structure',
  ])];
  const metadata: Record<string, unknown> = {
    type: 'note',
    area: options.area ?? id,
  };

  mkdirSync(packagePath, { recursive: true });
  writeFileSync(filePath, stringifyMemoryMarkdown({
    id,
    kind: 'note',
    title: hubTitle,
    summary: hubSummary,
    status: 'active',
    ...(tags.length > 0 ? { tags } : {}),
    updatedAt: options.updated,
    metadata,
  }, [
    `# ${hubTitle}`,
    '',
    hubSummary,
    '',
    '## References',
    '',
    'Use this node to organize durable notes for this area. Detailed material lives in `references/`.',
  ].join('\n')), 'utf-8');

  return readHubDoc(options.memoryDir, id);
}

function referenceIdFromTitle(title: string, existingReferenceIds: Set<string>): string {
  const baseSlug = slugifyMemoryIdSegment(title);
  const safeBase = MEMORY_DOC_ID_PATTERN.test(baseSlug) ? baseSlug : `memory-reference-${compactDateStamp()}`;

  let candidate = safeBase;
  let suffix = 2;
  while (existingReferenceIds.has(candidate)) {
    candidate = `${safeBase}-${suffix}`;
    suffix += 1;
  }

  return candidate;
}

function buildReferenceMarkdown(input: {
  id: string;
  title: string;
  summary: string;
  tags: string[];
  updated: string;
  area?: string;
  distilledAt: string;
  sourceConversationTitle?: string;
  sourceCwd?: string;
  sourceProfile?: string;
  relatedProjectIds: string[];
  anchorPreview: string;
  body: string;
}): string {
  const metadata: Record<string, unknown> = {
    title: input.title,
    type: 'note',
    status: 'active',
    ...(input.area ? { area: input.area } : {}),
    tags: input.tags,
    updated: input.updated,
    origin: 'conversation',
    distilled_at: input.distilledAt,
    anchor_preview: input.anchorPreview,
    ...(input.sourceConversationTitle ? { origin_title: input.sourceConversationTitle } : {}),
    ...(input.sourceCwd ? { source_cwd: input.sourceCwd } : {}),
    ...(input.sourceProfile ? { source_profile: input.sourceProfile } : {}),
    ...(input.relatedProjectIds.length > 0 ? { related_project_ids: input.relatedProjectIds } : {}),
  };

  const normalizedBody = input.body.startsWith('#') ? input.body : `# ${input.title}\n\n${input.body}`;
  return stringifyMemoryMarkdown(buildMemoryFrontmatter({
    name: input.id,
    description: input.summary,
    metadata,
  }), normalizedBody);
}

function updateReferenceMemory(options: {
  hub: ParsedMemoryDoc;
  reference: ParsedMemoryReference;
  draft: DistilledConversationMemoryDraft;
  updated: string;
  sourceConversationTitle?: string;
  sourceCwd?: string;
}): SavedDistilledConversationMemoryResult {
  const parsed = readParsedReferenceMarkdown(options.reference.filePath);
  const frontmatter = parsed.frontmatter ?? {};
  const metadata = readFrontmatterMetadata(parsed.frontmatter);
  metadata.updated = options.updated;
  metadata.title = options.reference.title;
  if (options.hub.area) {
    metadata.area = options.hub.area;
  }

  const updateBlock = buildReferenceUpdateBlock({
    updated: options.updated,
    sourceConversationTitle: options.sourceConversationTitle,
    sourceCwd: options.sourceCwd,
    draft: options.draft,
  });
  const nextBody = appendDistilledUpdateSection(parsed.body, updateBlock);
  const nextSummary = readLooseString(frontmatter.description) ?? options.reference.summary;

  writeFileSync(
    options.reference.filePath,
    stringifyMemoryMarkdown(buildMemoryFrontmatter({
      name: readLooseString(frontmatter.name) ?? options.reference.id,
      description: nextSummary,
      metadata,
    }), nextBody),
    'utf-8',
  );

  return {
    memory: {
      id: options.hub.id,
      title: options.hub.title,
      summary: options.hub.summary,
      tags: options.hub.tags,
      path: options.hub.filePath,
      type: options.hub.type,
      status: options.hub.status,
      area: options.hub.area,
      updated: options.updated,
      referenceCount: options.hub.referencePaths.length,
    },
    reference: {
      path: options.reference.filePath,
      relativePath: options.reference.relativePath,
      title: options.reference.title,
      summary: options.reference.summary,
      tags: options.reference.tags,
      updated: options.updated,
    },
    disposition: 'updated-existing',
  };
}

function createReferenceMemory(options: SaveCuratedDistilledConversationMemoryOptions, hub: ParsedMemoryDoc): SavedDistilledConversationMemoryResult {
  const existingReferences = loadMemoryPackageReferences(hub.packagePath);
  const existingReferenceIds = new Set(existingReferences.map((reference) => reference.id));
  const id = referenceIdFromTitle(options.draft.title, existingReferenceIds);
  const filePath = join(hub.packagePath, 'references', `${id}.md`);
  const relativePath = `references/${id}.md`;
  const content = buildReferenceMarkdown({
    id,
    title: options.draft.title,
    summary: options.draft.summary,
    tags: options.draft.tags,
    updated: options.updated,
    area: options.area ?? hub.area ?? hub.id,
    distilledAt: options.distilledAt,
    sourceConversationTitle: options.sourceConversationTitle,
    sourceCwd: options.sourceCwd,
    sourceProfile: options.sourceProfile,
    relatedProjectIds: options.relatedProjectIds,
    anchorPreview: options.anchorPreview,
    body: options.draft.body,
  });

  mkdirSync(join(hub.packagePath, 'references'), { recursive: true });
  writeFileSync(filePath, content, 'utf-8');

  return {
    memory: {
      id: hub.id,
      title: hub.title,
      summary: hub.summary,
      tags: hub.tags,
      path: hub.filePath,
      type: hub.type,
      status: hub.status,
      area: hub.area,
      updated: options.updated,
      referenceCount: hub.referencePaths.length + 1,
    },
    reference: {
      path: filePath,
      relativePath,
      title: options.draft.title,
      summary: options.draft.summary,
      tags: options.draft.tags,
      updated: options.updated,
    },
    disposition: 'created-reference',
  };
}

export function saveCuratedDistilledConversationMemory(options: SaveCuratedDistilledConversationMemoryOptions): SavedDistilledConversationMemoryResult {
  const hub = findHubDoc(options.existingDocs, options.area) ?? createHubMemoryDoc(options, options.existingDocs);
  const references = loadMemoryPackageReferences(hub.packagePath).filter((reference) => reference.body.trim().length > 0);
  const match = chooseReferenceMatch(references, options.draft, options.area ?? hub.area ?? hub.id);

  if (match) {
    return updateReferenceMemory({
      hub,
      reference: match,
      draft: options.draft,
      updated: options.updated,
      sourceConversationTitle: options.sourceConversationTitle,
      sourceCwd: options.sourceCwd,
    });
  }

  return createReferenceMemory(options, hub);
}

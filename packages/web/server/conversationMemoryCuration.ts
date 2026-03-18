import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { ParsedMemoryDoc } from '@personal-agent/core';

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
    role: string;
    parent?: string;
    related: string[];
    updated: string;
  };
  disposition: 'updated-existing' | 'created-capture';
  matchedCanonicalIds: string[];
  hubId?: string;
}

export interface MergeCaptureMemoryIntoCanonicalResult {
  memory: {
    id: string;
    title: string;
    summary: string;
    tags: string[];
    path: string;
    type: string;
    status: string;
    area?: string;
    role: string;
    parent?: string;
    related: string[];
    updated: string;
  };
  mergedMemoryId: string;
  deletedMemoryId: string;
}

interface CanonicalMatch {
  doc: ParsedMemoryDoc;
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
  'capture',
  'checkpoint',
  'checkpoints',
  'conversation',
  'conversations',
  'could',
  'distill',
  'distilled',
  'doc',
  'docs',
  'does',
  'done',
  'durable',
  'during',
  'each',
  'from',
  'have',
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
  'project',
  'projects',
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

function findHubDoc(docs: ParsedMemoryDoc[], area: string | undefined): ParsedMemoryDoc | undefined {
  if (!area) {
    return undefined;
  }

  const activeDocs = docs.filter((doc) => doc.status !== 'archived');
  const exact = activeDocs.find((doc) => doc.role === 'hub' && doc.id === area);
  if (exact) {
    return exact;
  }

  const areaMatches = activeDocs.filter((doc) => doc.role === 'hub' && doc.area === area);
  return areaMatches.length === 1 ? areaMatches[0] : undefined;
}

function scoreCanonicalMatch(doc: ParsedMemoryDoc, draft: DistilledConversationMemoryDraft, area: string | undefined): CanonicalMatch {
  const ignoredTerms = buildIgnoredTerms(area);
  const queryText = [draft.title, draft.summary, draft.body].join('\n');
  const normalizedQueryText = normalizeMatchText(queryText);
  const queryTokens = tokenizeForMatching(queryText, ignoredTerms);
  const docText = [doc.id, doc.title, doc.summary, doc.tags.join(' '), doc.body].join('\n');
  const docTokens = tokenizeForMatching(docText, ignoredTerms);
  const draftTags = buildSpecificDraftTags(draft.tags, area);
  const docTags = doc.tags
    .map((tag) => normalizeTag(tag))
    .filter((tag): tag is string => Boolean(tag));

  let score = 0;

  if (area && (doc.area === area || doc.id === area)) {
    score += 1;
  }

  const matchedDraftTags = draftTags.filter((tag) => docTags.includes(tag));
  score += matchedDraftTags.length * 4;

  for (const tag of docTags) {
    if (tag === 'conversation' || tag === 'checkpoint' || tag === 'memory') {
      continue;
    }

    const phrase = tag.replace(/-/g, ' ');
    if (phrase.length >= 4 && normalizedQueryText.includes(phrase)) {
      score += 2;
    }
  }

  const normalizedTitle = normalizeMatchText(doc.title);
  if (normalizedTitle.length >= 8 && normalizedQueryText.includes(normalizedTitle)) {
    score += 3;
  }

  const normalizedIdPhrase = doc.id.replace(/-/g, ' ');
  if (normalizedIdPhrase.length >= 8 && normalizedQueryText.includes(normalizedIdPhrase)) {
    score += 3;
  }

  let overlapCount = 0;
  for (const token of queryTokens) {
    if (docTokens.has(token)) {
      overlapCount += 1;
    }
  }
  score += Math.min(overlapCount, 6);

  return { doc, score };
}

function chooseCanonicalMatch(docs: ParsedMemoryDoc[], draft: DistilledConversationMemoryDraft, area: string | undefined): {
  target?: ParsedMemoryDoc;
  relatedIds: string[];
} {
  const activeCanonicalDocs = docs.filter((doc) => doc.role === 'canonical' && doc.status !== 'archived');
  const scopedCanonicalDocs = area
    ? activeCanonicalDocs.filter((doc) => doc.area === area || doc.id === area)
    : activeCanonicalDocs;

  if (area && scopedCanonicalDocs.length === 1) {
    return {
      target: scopedCanonicalDocs[0],
      relatedIds: [scopedCanonicalDocs[0].id],
    };
  }

  const scored = scopedCanonicalDocs
    .map((doc) => scoreCanonicalMatch(doc, draft, area))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return left.doc.id.localeCompare(right.doc.id);
    });

  const top = scored[0];
  const second = scored[1];
  const isStrongMatch = Boolean(top)
    && top.score >= 6
    && (!second || top.score >= second.score + 2);

  return {
    target: isStrongMatch ? top?.doc : undefined,
    relatedIds: scored.slice(0, 3).map((entry) => entry.doc.id),
  };
}

function splitMarkdownFrontmatter(rawContent: string): { frontmatter: string; body: string } {
  const normalized = rawContent.replace(/\r\n/g, '\n');
  const match = normalized.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) {
    throw new Error('Memory markdown must start with YAML frontmatter.');
  }

  return {
    frontmatter: match[1] ?? '',
    body: (match[2] ?? '').replace(/^\n+/, ''),
  };
}

function readParsedMemoryMarkdown(filePath: string): { frontmatter: Record<string, unknown>; body: string } {
  if (!existsSync(filePath)) {
    throw new Error(`Memory file not found: ${filePath}`);
  }

  const raw = readFileSync(filePath, 'utf-8');
  const parsed = splitMarkdownFrontmatter(raw);
  const frontmatter = parseYaml(parsed.frontmatter);
  if (!frontmatter || typeof frontmatter !== 'object' || Array.isArray(frontmatter)) {
    throw new Error(`Invalid memory frontmatter in ${filePath}`);
  }

  return {
    frontmatter: frontmatter as Record<string, unknown>,
    body: parsed.body,
  };
}

function readOptionalFrontmatterString(frontmatter: Record<string, unknown>, key: string): string | undefined {
  const value = frontmatter[key];
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function stringifyMemoryMarkdown(frontmatter: Record<string, unknown>, body: string): string {
  const frontmatterText = stringifyYaml(frontmatter).trimEnd();
  const normalizedBody = body.replace(/^\n+/, '');
  return `---\n${frontmatterText}\n---\n\n${normalizedBody.replace(/\s*$/, '\n')}`;
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

function extractLineValue(body: string, prefix: string): string | undefined {
  const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = body.match(new RegExp(`^${escapedPrefix}(.+)$`, 'm'));
  const value = match?.[1]?.trim();
  return value && value.length > 0 ? value : undefined;
}

function extractBulletSection(body: string, heading: string): string[] {
  const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = body.match(new RegExp(`(?:^|\\n)${escapedHeading}\\n([\\s\\S]*?)(?=\\n(?:#|##|_|[A-Z][^\\n]*:)|$)`));
  if (!match) {
    return [];
  }

  return (match[1] ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('- '))
    .map((line) => line.slice(2).trim())
    .filter((line) => line.length > 0);
}

function buildDraftFromCaptureDoc(captureDoc: ParsedMemoryDoc): {
  draft: DistilledConversationMemoryDraft;
  sourceConversationTitle?: string;
  sourceCwd?: string;
} {
  const parsed = readParsedMemoryMarkdown(captureDoc.filePath);
  const userIntent = extractLineValue(parsed.body, 'At this checkpoint, the user intent was: ')
    ?? captureDoc.summary
    ?? 'Merge this capture into the target canonical memory.';
  const learnedPoints = extractBulletSection(parsed.body, 'What the agent had learned by this point:');
  const carryForwardPoints = extractBulletSection(parsed.body, 'Key carry-forward points:');

  return {
    draft: {
      title: captureDoc.title,
      summary: captureDoc.summary,
      body: parsed.body.startsWith('#') ? parsed.body : `# ${captureDoc.title}\n\n${parsed.body}`,
      tags: captureDoc.tags,
      userIntent,
      learnedPoints,
      carryForwardPoints,
    },
    sourceConversationTitle: readOptionalFrontmatterString(parsed.frontmatter, 'origin_title'),
    sourceCwd: readOptionalFrontmatterString(parsed.frontmatter, 'source_cwd'),
  };
}

function buildCanonicalUpdateBlock(options: {
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

function updateCanonicalMemoryDoc(options: {
  doc: ParsedMemoryDoc;
  draft: DistilledConversationMemoryDraft;
  updated: string;
  sourceConversationTitle?: string;
  sourceCwd?: string;
}): SavedDistilledConversationMemoryResult {
  const parsed = readParsedMemoryMarkdown(options.doc.filePath);
  const updatedFrontmatter = {
    ...parsed.frontmatter,
    updated: options.updated,
  };

  const updateBlock = buildCanonicalUpdateBlock({
    updated: options.updated,
    sourceConversationTitle: options.sourceConversationTitle,
    sourceCwd: options.sourceCwd,
    draft: options.draft,
  });

  const nextBody = appendDistilledUpdateSection(parsed.body, updateBlock);
  writeFileSync(options.doc.filePath, stringifyMemoryMarkdown(updatedFrontmatter, nextBody), 'utf-8');

  return {
    memory: {
      id: options.doc.id,
      title: options.doc.title,
      summary: options.doc.summary,
      tags: options.doc.tags,
      path: options.doc.filePath,
      type: options.doc.type,
      status: options.doc.status,
      area: options.doc.area,
      role: options.doc.role ?? 'canonical',
      parent: options.doc.parent,
      related: options.doc.related,
      updated: options.updated,
    },
    disposition: 'updated-existing',
    matchedCanonicalIds: [options.doc.id],
    ...(options.doc.parent ? { hubId: options.doc.parent } : {}),
  };
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
    return 'conversation-memory';
  }

  return slug.length > 52 ? slug.slice(0, 52).replace(/-+$/g, '') : slug;
}

function allocateDistilledMemoryId(memoryDir: string, title: string): string {
  const baseSlug = `conv-${slugifyMemoryIdSegment(title)}-${compactDateStamp()}`;
  const safeBase = MEMORY_DOC_ID_PATTERN.test(baseSlug) ? baseSlug : `conv-memory-${compactDateStamp()}`;

  let candidate = safeBase;
  let suffix = 2;

  while (existsSync(join(memoryDir, `${candidate}.md`))) {
    candidate = `${safeBase}-${suffix}`;
    suffix += 1;
  }

  return candidate;
}

function buildCaptureMemoryMarkdown(input: {
  id: string;
  title: string;
  summary: string;
  tags: string[];
  updated: string;
  area?: string;
  role: string;
  parent?: string;
  related: string[];
  distilledAt: string;
  sourceConversationTitle?: string;
  sourceCwd?: string;
  sourceProfile?: string;
  relatedProjectIds: string[];
  anchorPreview: string;
  body: string;
}): string {
  const frontmatter: Record<string, unknown> = {
    id: input.id,
    title: input.title,
    summary: input.summary,
    type: 'conversation-checkpoint',
    status: 'active',
    ...(input.area ? { area: input.area } : {}),
    role: input.role,
    ...(input.parent ? { parent: input.parent } : {}),
    ...(input.related.length > 0 ? { related: input.related } : {}),
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

  const normalizedBody = input.body.startsWith('#') ? input.body : `\n${input.body}`;
  return stringifyMemoryMarkdown(frontmatter, normalizedBody);
}

function createCaptureMemoryDoc(options: SaveCuratedDistilledConversationMemoryOptions, relatedIds: string[], hubId: string | undefined): SavedDistilledConversationMemoryResult {
  const id = allocateDistilledMemoryId(options.memoryDir, options.draft.title);
  const filePath = join(options.memoryDir, `${id}.md`);
  const related = relatedIds.filter((relatedId) => relatedId !== hubId).slice(0, 3);
  const content = buildCaptureMemoryMarkdown({
    id,
    title: options.draft.title,
    summary: options.draft.summary,
    tags: options.draft.tags,
    updated: options.updated,
    area: options.area,
    role: 'capture',
    parent: hubId,
    related,
    distilledAt: options.distilledAt,
    sourceConversationTitle: options.sourceConversationTitle,
    sourceCwd: options.sourceCwd,
    sourceProfile: options.sourceProfile,
    relatedProjectIds: options.relatedProjectIds,
    anchorPreview: options.anchorPreview,
    body: options.draft.body,
  });

  writeFileSync(filePath, content, 'utf-8');

  return {
    memory: {
      id,
      title: options.draft.title,
      summary: options.draft.summary,
      tags: options.draft.tags,
      path: filePath,
      type: 'conversation-checkpoint',
      status: 'active',
      area: options.area,
      role: 'capture',
      parent: hubId,
      related,
      updated: options.updated,
    },
    disposition: 'created-capture',
    matchedCanonicalIds: relatedIds,
    ...(hubId ? { hubId } : {}),
  };
}

export function mergeCaptureMemoryIntoCanonical(options: {
  captureDoc: ParsedMemoryDoc;
  targetDoc: ParsedMemoryDoc;
  updated: string;
}): MergeCaptureMemoryIntoCanonicalResult {
  if (options.captureDoc.id === options.targetDoc.id) {
    throw new Error('Capture memory and target memory must be different docs.');
  }

  if (options.captureDoc.role !== 'capture') {
    throw new Error(`Memory @${options.captureDoc.id} is not a capture doc.`);
  }

  if (options.targetDoc.role !== 'canonical') {
    throw new Error(`Memory @${options.targetDoc.id} is not a canonical doc.`);
  }

  if (options.targetDoc.status === 'archived') {
    throw new Error(`Memory @${options.targetDoc.id} is archived and cannot accept merges.`);
  }

  const capture = buildDraftFromCaptureDoc(options.captureDoc);
  const result = updateCanonicalMemoryDoc({
    doc: options.targetDoc,
    draft: capture.draft,
    updated: options.updated,
    sourceConversationTitle: capture.sourceConversationTitle,
    sourceCwd: capture.sourceCwd,
  });

  unlinkSync(options.captureDoc.filePath);

  return {
    memory: result.memory,
    mergedMemoryId: options.captureDoc.id,
    deletedMemoryId: options.captureDoc.id,
  };
}

export function saveCuratedDistilledConversationMemory(options: SaveCuratedDistilledConversationMemoryOptions): SavedDistilledConversationMemoryResult {
  const hub = findHubDoc(options.existingDocs, options.area);
  const match = chooseCanonicalMatch(options.existingDocs, options.draft, options.area);

  if (match.target) {
    return updateCanonicalMemoryDoc({
      doc: match.target,
      draft: options.draft,
      updated: options.updated,
      sourceConversationTitle: options.sourceConversationTitle,
      sourceCwd: options.sourceCwd,
    });
  }

  return createCaptureMemoryDoc(options, match.relatedIds, hub?.id);
}

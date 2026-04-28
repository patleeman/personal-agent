import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import { extension as mimeExtension } from 'mime-types';
import TurndownService from 'turndown';
import { stringify as stringifyYaml } from 'yaml';

export interface VaultKnowledgeShareImportInput {
  kind: 'text' | 'url' | 'image';
  root: string;
  targetDirAbs: string;
  title?: string;
  text?: string;
  url?: string;
  mimeType?: string;
  fileName?: string;
  dataBase64?: string;
  sourceApp?: string;
  createdAt?: string;
}

export interface VaultKnowledgeShareImportResult {
  sourceKind: 'text' | 'url' | 'image';
  title: string;
  notePath: string;
  asset?: {
    id: string;
    url: string;
  };
}

function normalizeShareString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function slugifyShareValue(value: string, fallback = 'shared-note'): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    || fallback;
}

function uniqueNameInDirectory(absDir: string, baseName: string, extension: string): string {
  let attempt = `${baseName}${extension}`;
  let index = 2;
  while (existsSync(join(absDir, attempt))) {
    attempt = `${baseName}-${String(index)}${extension}`;
    index += 1;
  }
  return attempt;
}

function markdownWithFrontmatter(frontmatter: Record<string, unknown>, body: string): string {
  const yaml = stringifyYaml(frontmatter, { lineWidth: 0, indent: 2, minContentWidth: 0 }).trimEnd();
  const normalizedBody = body.replace(/\r\n/g, '\n').trim();
  return `---\n${yaml}\n---\n\n${normalizedBody.length > 0 ? `${normalizedBody}\n` : ''}`;
}

function summarizeShareText(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, 180);
}

function buildSharedTextNote(input: {
  title?: string;
  text: string;
  sourceApp?: string;
  createdAt: string;
}): { title: string; content: string } {
  const bodyText = input.text.replace(/\r\n/g, '\n').trim();
  const title = input.title?.trim()
    || bodyText.split('\n').find((line) => line.trim().length > 0)?.trim().slice(0, 80)
    || `Shared text ${input.createdAt.slice(0, 10)}`;
  const summary = summarizeShareText(bodyText) || `Shared text captured on ${input.createdAt.slice(0, 10)}.`;
  const frontmatter: Record<string, unknown> = {
    title,
    source_type: 'shared-text',
    captured_at: input.createdAt,
    summary,
    tags: ['share', 'text'],
  };
  if (input.sourceApp) {
    frontmatter.source_app = input.sourceApp;
  }
  return {
    title,
    content: markdownWithFrontmatter(frontmatter, bodyText.length > 0 ? bodyText : 'Shared from iOS.'),
  };
}

async function extractReadableUrlShare(url: string): Promise<{
  title: string;
  summary?: string;
  siteName?: string;
  author?: string;
  publishedAt?: string;
  contentType?: string;
  markdown: string;
}> {
  const response = await fetch(url, {
    headers: {
      'user-agent': 'Personal Agent Knowledge Import/1.0',
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5',
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`.trim());
  }
  const contentType = response.headers.get('content-type')?.trim() || undefined;
  const raw = await response.text();
  if (!contentType || !contentType.toLowerCase().includes('html')) {
    return {
      title: url,
      summary: summarizeShareText(raw),
      contentType,
      markdown: raw.trim(),
    };
  }

  const dom = new JSDOM(raw, { url, contentType: 'text/html' });
  const document = dom.window.document;
  const description = document.querySelector('meta[name="description"], meta[property="og:description"]')?.getAttribute('content')?.trim() || undefined;
  const siteName = document.querySelector('meta[property="og:site_name"]')?.getAttribute('content')?.trim() || undefined;
  const author = document.querySelector('meta[name="author"], meta[property="article:author"]')?.getAttribute('content')?.trim() || undefined;
  const publishedAt = document.querySelector('meta[property="article:published_time"], meta[name="article:published_time"], meta[name="parsely-pub-date"]')?.getAttribute('content')?.trim() || undefined;
  const article = new Readability(document).parse();
  const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-' });
  const title = article?.title?.trim() || document.title?.trim() || url;
  const sourceHtml = article?.content?.trim() || document.body?.innerHTML?.trim() || '';
  const markdown = sourceHtml.length > 0 ? turndown.turndown(sourceHtml).trim() : '';
  return {
    title,
    summary: article?.excerpt?.trim() || description,
    siteName,
    author,
    publishedAt,
    contentType,
    markdown,
  };
}

async function buildSharedUrlNote(input: {
  url: string;
  title?: string;
  sourceApp?: string;
  createdAt: string;
}): Promise<{ title: string; content: string }> {
  const frontmatter: Record<string, unknown> = {
    source_type: 'shared-url',
    source_url: input.url,
    captured_at: input.createdAt,
    tags: ['share', 'web-clip'],
  };
  if (input.sourceApp) {
    frontmatter.source_app = input.sourceApp;
  }

  try {
    const extracted = await extractReadableUrlShare(input.url);
    const title = input.title?.trim() || extracted.title;
    frontmatter.title = title;
    if (extracted.summary) {
      frontmatter.summary = extracted.summary;
    }
    if (extracted.siteName) {
      frontmatter.site_name = extracted.siteName;
    }
    if (extracted.author) {
      frontmatter.author = extracted.author;
    }
    if (extracted.publishedAt) {
      frontmatter.published_at = extracted.publishedAt;
    }
    if (extracted.contentType) {
      frontmatter.content_type = extracted.contentType;
    }
    const body = [
      `Source: [${title}](${input.url})`,
      extracted.markdown || '_Readable content extraction returned no body._',
    ].filter((part) => part.trim().length > 0).join('\n\n');
    return { title, content: markdownWithFrontmatter(frontmatter, body) };
  } catch (error) {
    const title = input.title?.trim() || input.url;
    frontmatter.title = title;
    frontmatter.capture_error = String(error instanceof Error ? error.message : error);
    const body = [
      `Source: [${input.url}](${input.url})`,
      '_Automatic readable-content extraction failed. The original URL was still saved._',
    ].join('\n\n');
    return { title, content: markdownWithFrontmatter(frontmatter, body) };
  }
}

function decodeSharedBase64(value: string): Buffer {
  const trimmed = value.trim();
  const base64 = trimmed.startsWith('data:') ? trimmed.slice(trimmed.indexOf(',') + 1) : trimmed;
  const normalized = base64.trim();
  if (!normalized || normalized.length % 4 === 1 || !/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)) {
    throw new Error('Shared image data must be valid base64.');
  }

  const decoded = Buffer.from(normalized, 'base64');
  if (decoded.length === 0) {
    throw new Error('Shared image data must decode to non-empty content.');
  }

  return decoded;
}

function buildSharedImageNote(input: {
  root: string;
  title?: string;
  mimeType?: string;
  fileName?: string;
  dataBase64: string;
  sourceApp?: string;
  createdAt: string;
}): { title: string; content: string; assetId: string } {
  const imageBuffer = decodeSharedBase64(input.dataBase64);
  const baseTitle = input.title?.trim()
    || normalizeShareString(input.fileName)?.replace(/\.[^.]+$/, '')
    || `Shared image ${input.createdAt.slice(0, 10)}`;
  const assetExt = extname(input.fileName ?? '').trim().replace(/^\./, '')
    || mimeExtension(input.mimeType ?? '')
    || 'png';
  const assetDirAbs = join(input.root, '_attachments');
  mkdirSync(assetDirAbs, { recursive: true });
  const assetBase = `${Date.now()}-${slugifyShareValue(baseTitle, 'shared-image')}`;
  const assetFileName = uniqueNameInDirectory(assetDirAbs, assetBase, `.${assetExt}`);
  const assetId = `_attachments/${assetFileName}`;
  writeFileSync(join(assetDirAbs, assetFileName), imageBuffer);
  const assetUrl = `/api/vault/asset?id=${encodeURIComponent(assetId)}`;
  const frontmatter: Record<string, unknown> = {
    title: baseTitle,
    source_type: 'shared-image',
    captured_at: input.createdAt,
    asset_path: assetId,
    mime_type: input.mimeType ?? `image/${assetExt}`,
    tags: ['share', 'image'],
  };
  if (input.sourceApp) {
    frontmatter.source_app = input.sourceApp;
  }
  const body = [
    `![${baseTitle}](${assetUrl})`,
    `Saved asset path: \`${assetId}\``,
  ].join('\n\n');
  return {
    title: baseTitle,
    content: markdownWithFrontmatter(frontmatter, body),
    assetId,
  };
}

export async function importVaultSharedItem(input: VaultKnowledgeShareImportInput): Promise<VaultKnowledgeShareImportResult> {
  const createdAt = normalizeShareString(input.createdAt) ?? new Date().toISOString();
  mkdirSync(input.targetDirAbs, { recursive: true });

  let title: string;
  let content: string;
  let asset: VaultKnowledgeShareImportResult['asset'];

  if (input.kind === 'text') {
    const text = normalizeShareString(input.text) ?? '';
    const built = buildSharedTextNote({
      title: input.title,
      text,
      sourceApp: normalizeShareString(input.sourceApp),
      createdAt,
    });
    title = built.title;
    content = built.content;
  } else if (input.kind === 'url') {
    const url = normalizeShareString(input.url);
    if (!url) {
      throw new Error('url is required for URL imports.');
    }
    const built = await buildSharedUrlNote({
      url,
      title: input.title,
      sourceApp: normalizeShareString(input.sourceApp),
      createdAt,
    });
    title = built.title;
    content = built.content;
  } else {
    const dataBase64 = normalizeShareString(input.dataBase64);
    if (!dataBase64) {
      throw new Error('dataBase64 is required for image imports.');
    }
    const built = buildSharedImageNote({
      root: input.root,
      title: input.title,
      mimeType: normalizeShareString(input.mimeType),
      fileName: normalizeShareString(input.fileName),
      dataBase64,
      sourceApp: normalizeShareString(input.sourceApp),
      createdAt,
    });
    title = built.title;
    content = built.content;
    asset = {
      id: built.assetId,
      url: `/api/vault/asset?id=${encodeURIComponent(built.assetId)}`,
    };
  }

  const noteBase = slugifyShareValue(title, 'shared-note');
  const noteFileName = uniqueNameInDirectory(input.targetDirAbs, noteBase, '.md');
  const notePath = join(input.targetDirAbs, noteFileName);
  writeFileSync(notePath, content, 'utf-8');

  return {
    sourceKind: input.kind,
    title,
    notePath,
    ...(asset ? { asset } : {}),
  };
}

import type { MessageBlock } from '../../types';

export interface ConversationRailTurn {
  index: number;
  kind: 'user' | 'assistant';
  label: 'User' | 'Assistant';
  snippet: string;
}

export interface ConversationRailProjectedMarker {
  index: number;
  baseY: number;
  displayY: number;
}

const DEFAULT_SNIPPET_LIMIT = 96;

const XML_TAG_RE = /<\/?[A-Za-z_][\w:.-]*(?:\s+[^<>]*?)?\/?\s*>/g;
const XML_DECLARATION_RE = /<\?(?:xml|[A-Za-z_][\w:.-]*)[\s\S]*?\?>/g;
const XML_COMMENT_RE = /<!--[\s\S]*?-->/g;
const POSIX_PATH_RE = /(^|[\s(])(?:~\/|\/|\.\.\/|\.\/)[^\s)]+/g;
const WINDOWS_PATH_RE = /(^|[\s(])[A-Za-z]:\\[^\s)]+/g;
const BARE_MULTI_SEGMENT_PATH_RE = /(^|[\s(])[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+){2,}/g;
const FILE_EXTENSION_RE = /\.(?:png|jpe?g|gif|webp|svg|xml|json|ya?ml|md|txt|pdf|tsx?|jsx?|html?|css)$/i;
const LEADING_FILLER_WORDS = new Set(['at', 'on', 'in', 'from', 'to', 'via', 'and', 'or']);

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function truncateSnippet(value: string, maxLength = DEFAULT_SNIPPET_LIMIT): string {
  if (value.length <= maxLength) {
    return value;
  }

  const sliced = value.slice(0, Math.max(1, maxLength - 1));
  const boundary = sliced.lastIndexOf(' ');
  const preferred = boundary >= Math.floor(maxLength * 0.6)
    ? sliced.slice(0, boundary)
    : sliced;

  return preferred.trimEnd() + '…';
}

function stripConversationPreviewTechnicalNoise(text: string): string {
  const normalized = text
    .replace(/\\ /g, ' ')
    .replace(/\\+/g, ' ');

  const filteredTokens = collapseWhitespace(normalized)
    .split(' ')
    .map((token) => token.trim())
    .filter(Boolean)
    .filter((token) => {
      const bare = token.replace(/^[([{"'`]+|[)\]},"'`:;!?]+$/g, '');
      if (!bare) {
        return false;
      }

      if (bare.includes('/') || bare.includes('\\')) {
        return false;
      }

      if (FILE_EXTENSION_RE.test(bare)) {
        return false;
      }

      const digitCount = (bare.match(/\d/g) ?? []).length;
      const letterCount = (bare.match(/[A-Za-z]/g) ?? []).length;
      const punctuationCount = (bare.match(/[._:-]/g) ?? []).length;
      if (digitCount >= 2 && letterCount <= 2) {
        return false;
      }

      if ((digitCount + punctuationCount) >= Math.max(3, Math.ceil(bare.length * 0.55)) && letterCount <= Math.max(2, Math.floor(bare.length * 0.35))) {
        return false;
      }

      return true;
    });

  while (filteredTokens.length > 1 && LEADING_FILLER_WORDS.has(filteredTokens[0].toLowerCase())) {
    filteredTokens.shift();
  }

  return collapseWhitespace(filteredTokens.join(' '));
}

function stripConversationPreviewMarkdown(text: string): string {
  const withoutFencedCode = text.replace(/```[\s\S]*?```/g, ' ');
  const withoutInlineCode = withoutFencedCode.replace(/`([^`]+)`/g, '$1');
  const withoutLinks = withoutInlineCode.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  const withoutImages = withoutLinks.replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1');
  const withoutXmlComments = withoutImages.replace(XML_COMMENT_RE, ' ');
  const withoutXmlDeclarations = withoutXmlComments.replace(XML_DECLARATION_RE, ' ');
  const withoutXmlTags = withoutXmlDeclarations.replace(XML_TAG_RE, ' ');
  const withoutPosixPaths = withoutXmlTags.replace(POSIX_PATH_RE, '$1');
  const withoutWindowsPaths = withoutPosixPaths.replace(WINDOWS_PATH_RE, '$1');
  const withoutBarePaths = withoutWindowsPaths.replace(BARE_MULTI_SEGMENT_PATH_RE, '$1');
  const withoutHeadings = withoutBarePaths.replace(/^#{1,6}\s+/gm, '');
  const withoutBlockquotes = withoutHeadings.replace(/^>\s+/gm, '');
  const withoutCheckboxes = withoutBlockquotes.replace(/^\s*[-*+]\s+\[[ xX]\]\s+/gm, '');
  const withoutBullets = withoutCheckboxes.replace(/^\s*[-*+]\s+/gm, '');
  const withoutNumbers = withoutBullets.replace(/^\s*\d+\.\s+/gm, '');
  const withoutEmphasis = withoutNumbers.replace(/[~*_]+/g, '');

  return stripConversationPreviewTechnicalNoise(withoutEmphasis);
}

function formatImageAttachmentSnippet(block: Extract<MessageBlock, { type: 'user' }>): string {
  const imageCount = block.images?.length ?? 0;
  if (imageCount === 0) {
    return 'Message';
  }

  const prefix = `${imageCount} image attachment${imageCount === 1 ? '' : 's'}`;
  const firstDescriptor = block.images
    ?.map((image) => collapseWhitespace(image.caption ?? image.alt ?? ''))
    .find((value) => value.length > 0 && value.toLowerCase() !== 'image');

  if (!firstDescriptor) {
    return prefix;
  }

  return `${prefix} · ${firstDescriptor}`;
}

export function buildConversationRailSnippet(block: Extract<MessageBlock, { type: 'user' | 'text' }>, maxLength = DEFAULT_SNIPPET_LIMIT): string {
  if (block.type === 'user') {
    const stripped = stripConversationPreviewMarkdown(block.text);
    if (stripped.length > 0) {
      return truncateSnippet(stripped, maxLength);
    }

    return truncateSnippet(formatImageAttachmentSnippet(block), maxLength);
  }

  const stripped = stripConversationPreviewMarkdown(block.text);
  if (stripped.length > 0) {
    return truncateSnippet(stripped, maxLength);
  }

  return 'Assistant message';
}

export function getConversationRailTurns(messages: MessageBlock[], maxLength = DEFAULT_SNIPPET_LIMIT): ConversationRailTurn[] {
  const turns: ConversationRailTurn[] = [];

  for (const [index, message] of messages.entries()) {
    if (message.type !== 'user') {
      continue;
    }

    turns.push({
      index,
      kind: 'user',
      label: 'User',
      snippet: buildConversationRailSnippet(message, maxLength),
    });
  }

  return turns;
}

export function applyConversationRailFisheye(
  baseY: number,
  pointerY: number,
  radius: number,
  maxOffset: number,
): number {
  const distance = Math.abs(baseY - pointerY);
  if (distance === 0 || distance > radius) {
    return baseY;
  }

  const direction = baseY < pointerY ? -1 : 1;
  const weight = 1 - (distance / radius);
  const offset = maxOffset * weight * weight;

  return baseY + (direction * offset);
}

export function pickNearestConversationRailMarker(
  markers: ConversationRailProjectedMarker[],
  pointerY: number,
): ConversationRailProjectedMarker | null {
  let best: ConversationRailProjectedMarker | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const marker of markers) {
    const distance = Math.abs(marker.displayY - pointerY);
    if (distance < bestDistance) {
      best = marker;
      bestDistance = distance;
    }
  }

  return best;
}

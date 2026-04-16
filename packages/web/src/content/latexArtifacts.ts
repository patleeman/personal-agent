export type LatexArtifactDisplayMode = 'source' | 'math-preview-and-source';

const FULL_LATEX_DOCUMENT_PATTERNS = [
  /\\documentclass\b/,
  /\\begin\{document\}/,
  /\\usepackage\b/,
  /\\(?:title|author|date|maketitle|tableofcontents)\b/,
] as const;

const LATEX_SOURCE_ONLY_PATTERNS = [
  /\\(?:chapter|section|subsection|subsubsection|paragraph|subparagraph|appendix|maketitle|tableofcontents|item)\b/,
  /\\begin\{(?:itemize|enumerate|figure|table|tabular|abstract|verbatim|lstlisting|tikzpicture)\}/,
  /\\end\{(?:itemize|enumerate|figure|table|tabular|abstract|verbatim|lstlisting|tikzpicture)\}/,
] as const;

const STANDALONE_MATH_ENVIRONMENTS = [
  'equation',
  'equation*',
  'align',
  'align*',
  'gather',
  'gather*',
  'multline',
  'multline*',
  'displaymath',
  'math',
] as const;

function normalizeTrimmedContent(content: string): string {
  return content.trim();
}

export function normalizeLatexMathSource(content: string): string {
  const trimmed = normalizeTrimmedContent(content);
  if (trimmed.startsWith('$$') && trimmed.endsWith('$$') && trimmed.length >= 4) {
    return trimmed.slice(2, -2).trim();
  }
  if (trimmed.startsWith('\\[') && trimmed.endsWith('\\]') && trimmed.length >= 4) {
    return trimmed.slice(2, -2).trim();
  }
  if (trimmed.startsWith('$') && trimmed.endsWith('$') && trimmed.length >= 2) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

export function looksLikeFullLatexDocument(content: string): boolean {
  const trimmed = normalizeTrimmedContent(content);
  if (trimmed.length === 0) {
    return false;
  }

  return FULL_LATEX_DOCUMENT_PATTERNS.some((pattern) => pattern.test(trimmed));
}

function looksLikeSourceOnlyLatexFragment(content: string): boolean {
  const trimmed = normalizeTrimmedContent(content);
  if (trimmed.length === 0) {
    return false;
  }

  return LATEX_SOURCE_ONLY_PATTERNS.some((pattern) => pattern.test(trimmed));
}

function isStandaloneMathEnvironment(content: string): boolean {
  const trimmed = normalizeTrimmedContent(content);
  return STANDALONE_MATH_ENVIRONMENTS.some((environment) => (
    trimmed.startsWith(`\\begin{${environment}}`)
    && trimmed.endsWith(`\\end{${environment}}`)
  ));
}

export function shouldRenderLatexMathPreview(content: string): boolean {
  const trimmed = normalizeTrimmedContent(content);
  if (trimmed.length === 0) {
    return false;
  }

  if (looksLikeFullLatexDocument(trimmed) || looksLikeSourceOnlyLatexFragment(trimmed)) {
    return false;
  }

  if (trimmed.startsWith('$$') && trimmed.endsWith('$$')) {
    return true;
  }

  if (trimmed.startsWith('\\[') && trimmed.endsWith('\\]')) {
    return true;
  }

  if (trimmed.startsWith('$') && trimmed.endsWith('$')) {
    return true;
  }

  if (isStandaloneMathEnvironment(trimmed)) {
    return true;
  }

  return trimmed.length <= 400 && /\\|\^|_/.test(trimmed);
}

export function getLatexArtifactDisplayMode(content: string): LatexArtifactDisplayMode {
  return shouldRenderLatexMathPreview(content)
    ? 'math-preview-and-source'
    : 'source';
}

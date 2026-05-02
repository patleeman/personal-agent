import { describe, expect, it } from 'vitest';

import { getLatexArtifactDisplayMode, looksLikeFullLatexDocument, normalizeLatexMathSource } from './latexArtifacts.js';

describe('latex artifact helpers', () => {
  it('recognizes full latex documents', () => {
    const content = String.raw`\documentclass{article}
\usepackage{hyperref}
\begin{document}
\section{Overview}
Hello
\end{document}`;

    expect(looksLikeFullLatexDocument(content)).toBe(true);
    expect(getLatexArtifactDisplayMode(content)).toBe('source');
  });

  it('treats section-oriented fragments as source-first latex', () => {
    const content = String.raw`\section{Overview}
This is still latex source.`;

    expect(looksLikeFullLatexDocument(content)).toBe(false);
    expect(getLatexArtifactDisplayMode(content)).toBe('source');
  });

  it('normalizes wrapped math snippets for preview', () => {
    expect(
      normalizeLatexMathSource(String.raw`$$
x = \frac{1}{2}
$$`),
    ).toBe(String.raw`x = \frac{1}{2}`);
    expect(
      normalizeLatexMathSource(String.raw`\[
y = x^2
\]`),
    ).toBe(String.raw`y = x^2`);
    expect(normalizeLatexMathSource(String.raw`$z$`)).toBe('z');
  });

  it('renders math snippets with preview plus source', () => {
    const content = String.raw`$$
\int_0^1 x^2 \, dx
$$`;

    expect(looksLikeFullLatexDocument(content)).toBe(false);
    expect(getLatexArtifactDisplayMode(content)).toBe('math-preview-and-source');
  });

  it('renders standalone math environments with preview plus source', () => {
    const content = String.raw`\begin{align*}
a &= b + c
\end{align*}`;

    expect(getLatexArtifactDisplayMode(content)).toBe('math-preview-and-source');
  });

  it('avoids math preview for non-math latex structures', () => {
    const content = String.raw`\begin{itemize}
\item first
\item second
\end{itemize}`;

    expect(getLatexArtifactDisplayMode(content)).toBe('source');
  });
});

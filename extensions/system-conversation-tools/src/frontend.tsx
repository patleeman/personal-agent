import { lazy, Suspense } from 'react';

type AskProps = Parameters<typeof import('./panels.js').AskUserQuestionTranscriptRenderer>[0];
type TerminalProps = Parameters<typeof import('./panels.js').TerminalBashTranscriptRenderer>[0];
const LazyAskUserQuestionTranscriptRenderer = lazy(async () => ({
  default: (await import('./panels.js')).AskUserQuestionTranscriptRenderer,
}));
const LazyTerminalBashTranscriptRenderer = lazy(async () => ({ default: (await import('./panels.js')).TerminalBashTranscriptRenderer }));
const fallback = <div className="px-3 py-2 text-[12px] text-dim">Loading tool output…</div>;

export function AskUserQuestionTranscriptRenderer(props: AskProps) {
  return (
    <Suspense fallback={fallback}>
      <LazyAskUserQuestionTranscriptRenderer {...props} />
    </Suspense>
  );
}
export function TerminalBashTranscriptRenderer(props: TerminalProps) {
  return (
    <Suspense fallback={fallback}>
      <LazyTerminalBashTranscriptRenderer {...props} />
    </Suspense>
  );
}

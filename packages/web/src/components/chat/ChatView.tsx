import React, { Children, cloneElement, isValidElement, memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactElement, type ReactNode, type RefObject } from 'react';
import ReactMarkdown from 'react-markdown';
import { parseSkillBlock, type ParsedSkillBlock } from '../../skillBlock';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import { readArtifactPresentation } from '../../conversationArtifacts';
import { extractDurableRunIdsFromBlock } from '../../conversationRuns';
import { normalizeReplyQuoteSelection } from '../../conversationReplyQuote';
import {
  isAskUserQuestionComplete,
  moveAskUserQuestionIndex,
  readAskUserQuestionPresentation,
  resolveAskUserQuestionDefaultOptionIndex,
  resolveAskUserQuestionNavigationHotkey,
  resolveAskUserQuestionOptionHotkey,
  shouldAdvanceAskUserQuestionAfterSelection,
  type AskUserQuestionAnswers,
  type AskUserQuestionPresentation,
} from '../../askUserQuestions';
import type { MessageBlock } from '../../types';
import { timeAgo } from '../../utils';
import { extractMarkdownTextContent, InlineMarkdownCode } from '../MarkdownInlineCode';
import { FilePathButton, FilePathPreformattedText, normalizeDetectedFilePath, renderFilePathTextFragments } from '../../filePathLinks';
import { buildChatRenderItems, type ChatRenderItem, type TraceClusterSummary, type TraceClusterSummaryCategory, type TraceConversationBlock } from './transcriptItems.js';
import { Pill, SurfacePanel, cx } from '../ui';

// ── Markdown renderer ─────────────────────────────────────────────────────────

const MARKDOWN_REMARK_PLUGINS = [remarkGfm, remarkBreaks];

function MentionPill({ text }: { text: string }) {
  return <span className="ui-markdown-mention">{text}</span>;
}

function splitMentionFragments(text: string): Array<{ text: string; mention: boolean }> {
  const fragments: Array<{ text: string; mention: boolean }> = [];
  const mentionRegex = /@[\w-]+/g;
  let cursor = 0;
  let match: RegExpExecArray | null = null;

  while ((match = mentionRegex.exec(text)) !== null) {
    const mention = match[0];
    const start = match.index;
    const end = start + mention.length;
    const previous = start > 0 ? text[start - 1] : '';
    const shouldSkip = start > 0 && /[\w./+-]/.test(previous);

    if (shouldSkip) {
      continue;
    }

    if (start > cursor) {
      fragments.push({ text: text.slice(cursor, start), mention: false });
    }

    fragments.push({ text: mention, mention: true });
    cursor = end;
  }

  if (cursor < text.length) {
    fragments.push({ text: text.slice(cursor), mention: false });
  }

  return fragments;
}

function renderEnhancedTextFragments(text: string, onOpenFilePath?: (path: string) => void): ReactNode[] {
  return splitMentionFragments(text).map((fragment, index) => {
    if (fragment.mention) {
      return <MentionPill key={`${fragment.text}-${index}`} text={fragment.text} />;
    }

    return (
      <React.Fragment key={`${index}-${fragment.text}`}>
        {renderFilePathTextFragments(fragment.text, { onOpenFilePath, keyPrefix: `fragment-${index}` })}
      </React.Fragment>
    );
  });
}

function getMarkdownTagName(node: ReactNode): string | null {
  if (!isValidElement(node)) {
    return null;
  }

  const props = node.props as { node?: { tagName?: string } };
  if (typeof props.node?.tagName === 'string') {
    return props.node.tagName;
  }

  return typeof node.type === 'string' ? node.type : null;
}

function findMarkdownCodeElement(node: ReactNode): ReactElement<{ className?: string; children?: ReactNode }> | null {
  if (!isValidElement(node)) {
    return null;
  }

  if (getMarkdownTagName(node) === 'code') {
    return node as ReactElement<{ className?: string; children?: ReactNode }>;
  }

  const props = node.props as { children?: ReactNode };
  if (props.children === undefined) {
    return null;
  }

  for (const child of Children.toArray(props.children)) {
    const codeElement = findMarkdownCodeElement(child);
    if (codeElement) {
      return codeElement;
    }
  }

  return null;
}

function extractMarkdownCodeBlock(children: ReactNode): { className?: string; content: string } {
  for (const child of Children.toArray(children)) {
    const codeElement = findMarkdownCodeElement(child);
    if (!codeElement) {
      continue;
    }

    const props = codeElement.props as { className?: string; children?: ReactNode };
    return {
      className: props.className,
      content: extractMarkdownTextContent(props.children).replace(/\n$/, ''),
    };
  }

  return { content: extractMarkdownTextContent(children).replace(/\n$/, '') };
}

function renderChildrenWithMentions(children: ReactNode, onOpenFilePath?: (path: string) => void): ReactNode {
  return Children.map(children, (child, index) => {
    if (typeof child === 'string') {
      return <React.Fragment key={index}>{renderEnhancedTextFragments(child, onOpenFilePath)}</React.Fragment>;
    }

    if (typeof child === 'number' || typeof child === 'bigint') {
      return child;
    }

    if (!isValidElement(child)) {
      return child;
    }

    const tagName = getMarkdownTagName(child);
    if (tagName && ['a', 'code', 'pre'].includes(tagName)) {
      return child;
    }

    const props = child.props as { children?: ReactNode };
    if (props.children === undefined) {
      return child;
    }

    return cloneElement(child as ReactElement<{ children?: ReactNode }>, undefined, renderChildrenWithMentions(props.children, onOpenFilePath));
  });
}

function MarkdownCodeBlock({ children, onOpenFilePath }: { children: ReactNode; onOpenFilePath?: (path: string) => void }) {
  const { content } = extractMarkdownCodeBlock(children);

  return (
    <div className="ui-markdown-code-block">
      <FilePathPreformattedText
        text={content}
        onOpenFilePath={onOpenFilePath}
        className="whitespace-pre-wrap break-all"
      />
    </div>
  );
}

const MarkdownText = memo(function MarkdownText({ text, onOpenFilePath }: { text: string; onOpenFilePath?: (path: string) => void }) {
  const footnoteId = useId();
  const footnotePrefix = `chat-${footnoteId.replace(/[^a-zA-Z0-9_-]+/g, '-')}-`;

  return (
    <div className="ui-markdown">
      <ReactMarkdown
        remarkPlugins={MARKDOWN_REMARK_PLUGINS}
        remarkRehypeOptions={{ clobberPrefix: footnotePrefix }}
        components={{
          h1: ({ children, node: _node, ...props }) => <h1 {...props}>{renderChildrenWithMentions(children, onOpenFilePath)}</h1>,
          h2: ({ children, node: _node, ...props }) => <h2 {...props}>{renderChildrenWithMentions(children, onOpenFilePath)}</h2>,
          h3: ({ children, node: _node, ...props }) => <h3 {...props}>{renderChildrenWithMentions(children, onOpenFilePath)}</h3>,
          h4: ({ children, node: _node, ...props }) => <h4 {...props}>{renderChildrenWithMentions(children, onOpenFilePath)}</h4>,
          h5: ({ children, node: _node, ...props }) => <h5 {...props}>{renderChildrenWithMentions(children, onOpenFilePath)}</h5>,
          h6: ({ children, node: _node, ...props }) => <h6 {...props}>{renderChildrenWithMentions(children, onOpenFilePath)}</h6>,
          p: ({ children, node: _node, ...props }) => <p {...props}>{renderChildrenWithMentions(children, onOpenFilePath)}</p>,
          li: ({ children, node: _node, ...props }) => <li {...props}>{renderChildrenWithMentions(children, onOpenFilePath)}</li>,
          th: ({ children, node: _node, ...props }) => <th {...props}>{renderChildrenWithMentions(children, onOpenFilePath)}</th>,
          td: ({ children, node: _node, ...props }) => <td {...props}>{renderChildrenWithMentions(children, onOpenFilePath)}</td>,
          a: ({ href, children, title }) => {
            const filePath = typeof href === 'string' ? normalizeDetectedFilePath(href) : null;
            if (filePath && onOpenFilePath) {
              const label = extractMarkdownTextContent(children).trim() || href || filePath;
              return <FilePathButton path={filePath} displayText={label} onOpenFilePath={onOpenFilePath} />;
            }

            const isExternal = typeof href === 'string' && !href.startsWith('#');
            return (
              <a
                href={href}
                title={title}
                target={isExternal ? '_blank' : undefined}
                rel={isExternal ? 'noreferrer' : undefined}
              >
                {children}
              </a>
            );
          },
          table: ({ children }) => (
            <div className="my-3 overflow-x-auto">
              <table>{children}</table>
            </div>
          ),
          pre: ({ children }) => <MarkdownCodeBlock onOpenFilePath={onOpenFilePath}>{children}</MarkdownCodeBlock>,
          code: ({ className, children }) => <InlineMarkdownCode className={className} onOpenFilePath={onOpenFilePath}>{children}</InlineMarkdownCode>,
          img: ({ src, alt, title }) => src
            ? <img src={src} alt={alt ?? ''} title={title} loading="lazy" />
            : <span className="text-dim">{alt ?? 'image'}</span>,
          input: ({ type, checked }) => {
            if (type === 'checkbox') {
              return <input type="checkbox" checked={Boolean(checked)} disabled readOnly className="mr-2 translate-y-[1px] accent-[rgb(var(--color-accent))]" />;
            }

            return <input type={type} checked={checked} readOnly disabled />;
          },
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
});

function renderMarkdownText(text: string, onOpenFilePath?: (path: string) => void) {
  return <MarkdownText text={text} onOpenFilePath={onOpenFilePath} />;
}

function parseSkillContentSections(content: string): { relativeTo: string | null; body: string } {
  const match = content.match(/^References are relative to (.+?)\.\n\n([\s\S]*)$/);
  if (!match) {
    return { relativeTo: null, body: content.trim() };
  }

  return {
    relativeTo: match[1] ?? null,
    body: (match[2] ?? '').trim(),
  };
}

function SkillInvocationCard({
  skillBlock,
  className,
  onOpenFilePath,
}: {
  skillBlock: ParsedSkillBlock;
  className?: string;
  onOpenFilePath?: (path: string) => void;
}) {
  const { relativeTo, body } = parseSkillContentSections(skillBlock.content);

  return (
    <details className={cx('ui-skill-invocation', className)}>
      <summary className="ui-skill-invocation-summary">
        <span className="ui-skill-invocation-label">skill</span>
        <span className="ui-skill-invocation-name">{skillBlock.name}</span>
      </summary>
      <div className="ui-skill-invocation-body">
        {relativeTo && <p className="ui-skill-invocation-meta">References resolve relative to {relativeTo}</p>}
        {renderMarkdownText(`**${skillBlock.name}**\n\n${body}`, onOpenFilePath)}
      </div>
    </details>
  );
}

function renderSkillAwareText(text: string, onOpenFilePath?: (path: string) => void) {
  const skillBlock = parseSkillBlock(text);
  if (!skillBlock) {
    return renderMarkdownText(text, onOpenFilePath);
  }

  return (
    <div className="space-y-3">
      <SkillInvocationCard skillBlock={skillBlock} onOpenFilePath={onOpenFilePath} />
      {skillBlock.userMessage && renderMarkdownText(skillBlock.userMessage, onOpenFilePath)}
    </div>
  );
}

export function renderText(text: string, options?: { onOpenFilePath?: (path: string) => void }) {
  return renderSkillAwareText(text, options?.onOpenFilePath);
}

function getElementFromNode(node: Node | null): HTMLElement | null {
  if (!node) {
    return null;
  }

  if (node instanceof HTMLElement) {
    return node;
  }

  return node.parentElement;
}

function isNodeWithinElement(element: HTMLElement, node: Node | null): boolean {
  const elementNode = getElementFromNode(node);
  return Boolean(elementNode && element.contains(elementNode));
}

function findSelectionReplyScopeElement(node: Node | null): HTMLElement | null {
  return getElementFromNode(node)?.closest('[data-selection-reply-scope="assistant-message"]') ?? null;
}

function findSelectionReplyScopeElements(selection: Selection, range: Range): { startScope: HTMLElement | null; endScope: HTMLElement | null } {
  const anchorScope = findSelectionReplyScopeElement(selection.anchorNode);
  const focusScope = findSelectionReplyScopeElement(selection.focusNode);

  return {
    startScope: anchorScope ?? findSelectionReplyScopeElement(range.startContainer),
    endScope: focusScope ?? findSelectionReplyScopeElement(range.endContainer),
  };
}

function readSelectedTextWithinElement(element: HTMLElement | null): string {
  if (!element || typeof window === 'undefined') {
    return '';
  }

  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return '';
  }

  const range = selection.getRangeAt(0);
  if (!isNodeWithinElement(element, range.startContainer) || !isNodeWithinElement(element, range.endContainer)) {
    return '';
  }

  return normalizeReplyQuoteSelection(selection.toString());
}

type ReplySelectionGestureHandler = (scopeElement: HTMLElement) => void;

function buildReplySelectionScopeProps(messageIndex?: number, blockId?: string, onSelectionGesture?: ReplySelectionGestureHandler) {
  const handleSelectionGesture = onSelectionGesture
    ? (event: React.SyntheticEvent<HTMLElement>) => {
        onSelectionGesture(event.currentTarget);
      }
    : undefined;

  return {
    'data-selection-reply-scope': 'assistant-message',
    'data-message-index': typeof messageIndex === 'number' ? String(messageIndex) : undefined,
    'data-block-id': blockId,
    onMouseUp: handleSelectionGesture,
    onPointerUp: handleSelectionGesture,
    onKeyUp: handleSelectionGesture,
    onTouchEnd: handleSelectionGesture,
  };
}

function formatSummaryPreviewLine(line: string) {
  if (/^#{1,6}\s+/.test(line)) {
    return line.replace(/^#{1,6}\s+/, '');
  }

  if (/^[-*+]\s+/.test(line)) {
    return `• ${line.replace(/^[-*+]\s+/, '')}`;
  }

  return line;
}

function buildSummaryPreview(text: string, maxLines: number) {
  const previewLines: string[] = [];

  for (const rawLine of text.split('\n')) {
    const trimmed = rawLine.trim();
    if (trimmed.length === 0) {
      continue;
    }

    previewLines.push(formatSummaryPreviewLine(trimmed));
    if (previewLines.length >= maxLines) {
      break;
    }
  }

  return previewLines.join('\n');
}

function formatInjectedContextLabel(customType?: string): string {
  if (!customType || customType === 'referenced_context') {
    return 'Injected context';
  }

  const normalized = customType.replace(/[_-]+/g, ' ').trim();
  if (!normalized) {
    return 'Injected context';
  }

  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

// ── Tool icon & color ─────────────────────────────────────────────────────────

const TOOL_META: Record<string, { icon: string; label: string; color: string; tone: 'steel' | 'teal' | 'accent' | 'success' | 'warning' | 'muted' }> = {
  bash:        { icon: '$',  label: 'bash',            color: 'text-steel bg-steel/5',       tone: 'steel' },
  read:        { icon: '≡',  label: 'read',            color: 'text-teal bg-teal/5',         tone: 'teal' },
  write:       { icon: '✎',  label: 'write',           color: 'text-accent bg-accent/5',     tone: 'accent' },
  edit:        { icon: '✎',  label: 'edit',            color: 'text-accent bg-accent/5',     tone: 'accent' },
  web_search:  { icon: '⌕',  label: 'web_search',      color: 'text-success bg-success/5',   tone: 'success' },
  web_fetch:   { icon: '⌕',  label: 'web_fetch',       color: 'text-success bg-success/5',   tone: 'success' },
  screenshot:  { icon: '⊡',  label: 'screenshot',      color: 'text-secondary bg-elevated',  tone: 'muted' },
  artifact:    { icon: '◫',  label: 'artifact',        color: 'text-accent bg-accent/5',     tone: 'accent' },
  ask_user_question: { icon: '?', label: 'question',   color: 'text-warning bg-warning/5',   tone: 'warning' },
  todo_list:   { icon: '☑',  label: 'todo_list',       color: 'text-warning bg-warning/5',   tone: 'warning' },
  deferred_resume: { icon: '⏰', label: 'deferred_resume', color: 'text-warning bg-warning/5', tone: 'warning' },
};
function toolMeta(t: string) {
  return TOOL_META[t] ?? { icon: '⚙', label: t, color: 'text-secondary bg-elevated', tone: 'muted' as const };
}

type DisclosurePreference = 'auto' | 'open' | 'closed';
export type ConversationViewMode = 'hybrid';

export function normalizeConversationViewMode(_value: unknown): ConversationViewMode {
  return 'hybrid';
}

export function resolveDisclosureOpen(autoOpen: boolean, preference: DisclosurePreference): boolean {
  if (preference === 'open') return true;
  if (preference === 'closed') return false;
  return autoOpen;
}

export function toggleDisclosurePreference(autoOpen: boolean, preference: DisclosurePreference): DisclosurePreference {
  return resolveDisclosureOpen(autoOpen, preference) ? 'closed' : 'open';
}

export function shouldAutoOpenTraceCluster(live: boolean, hasRunning: boolean): boolean {
  return live || hasRunning;
}

export function shouldAutoOpenConversationBlock(
  block: MessageBlock,
  index: number,
  total: number,
  isStreaming: boolean,
): boolean {
  if (block.type === 'tool_use') {
    return block.status === 'running' || !!block.running;
  }

  if (block.type === 'thinking') {
    return isStreaming && index === total - 1;
  }

  return false;
}

export function getStreamingStatusLabel(messages: MessageBlock[], isStreaming: boolean): string | null {
  if (!isStreaming) {
    return null;
  }

  const last = messages[messages.length - 1];
  if (!last) {
    return 'Working…';
  }

  switch (last.type) {
    case 'thinking':
      return 'Thinking…';
    case 'tool_use':
      return last.status === 'running' || !!last.running
        ? `Running ${toolMeta(last.tool).label}…`
        : 'Working…';
    case 'subagent':
      return last.status === 'running'
        ? `Running ${last.name}…`
        : 'Working…';
    case 'text':
      return 'Responding…';
    default:
      return 'Working…';
  }
}

// ── ToolBlock ─────────────────────────────────────────────────────────────────

function ArtifactToolBlock({
  block,
  artifact,
  onOpenArtifact,
  activeArtifactId,
}: {
  block: Extract<MessageBlock, { type: 'tool_use' }>;
  artifact: NonNullable<ReturnType<typeof readArtifactPresentation>>;
  onOpenArtifact?: (artifactId: string) => void;
  activeArtifactId?: string | null;
}) {
  const isRunning = block.status === 'running' || !!block.running;
  const isError = block.status === 'error' || !!block.error;
  const isActive = activeArtifactId === artifact.artifactId;
  const actionLabel = isActive ? 'opened' : 'open artifact';

  return (
    <SurfacePanel
      muted
      className={cx(
        'px-3.5 py-3 text-[12px] transition-colors',
        isError && 'border-danger/30 bg-danger/5',
      )}
    >
      <div className="flex items-start gap-3">
        <div className="ui-chat-avatar mt-0.5">
          <span className="ui-chat-avatar-mark">◫</span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="truncate text-[13px] font-medium text-primary">{artifact.title}</span>
            <Pill tone={isError ? 'danger' : 'accent'} mono>{artifact.kind}</Pill>
            {artifact.revision !== undefined && <span className="text-[10px] text-dim">rev {artifact.revision}</span>}
          </div>
          <p className="mt-1 break-all font-mono text-[11px] text-secondary">{artifact.artifactId}</p>
          {block.output && !isError && (
            <p className="mt-2 text-[12px] leading-relaxed text-secondary">{block.output}</p>
          )}
          {isError && block.output && (
            <p className="mt-2 text-[12px] leading-relaxed text-danger/85">{block.output}</p>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px]">
            {isRunning ? (
              <span className="inline-flex items-center gap-1.5 text-dim">
                <span className="h-3.5 w-3.5 rounded-full border-[1.5px] border-current border-t-transparent animate-spin" />
                saving artifact…
              </span>
            ) : (
              <button
                type="button"
                onClick={() => onOpenArtifact?.(artifact.artifactId)}
                disabled={!onOpenArtifact}
                className={cx(
                  'text-accent transition-colors hover:text-accent/80 disabled:cursor-default disabled:text-dim',
                  isActive && 'text-dim hover:text-dim',
                )}
              >
                {actionLabel}
              </button>
            )}
            {artifact.updatedAt && <span className="text-dim">updated {timeAgo(artifact.updatedAt)}</span>}
          </div>
        </div>
      </div>
    </SurfacePanel>
  );
}

interface AskUserQuestionState {
  status: 'pending' | 'answered' | 'superseded';
  answerBlock?: Extract<MessageBlock, { type: 'user' }>;
}

function describeAskUserQuestionState(messages: MessageBlock[] | undefined, messageIndex: number | undefined): AskUserQuestionState {
  if (!messages || typeof messageIndex !== 'number') {
    return { status: 'pending' };
  }

  for (let index = messageIndex + 1; index < messages.length; index += 1) {
    const candidate = messages[index];
    if (!candidate) {
      continue;
    }

    if (candidate.type === 'user') {
      return { status: 'answered', answerBlock: candidate };
    }

    if (candidate.type === 'tool_use' && candidate.tool === 'ask_user_question') {
      return { status: 'superseded' };
    }
  }

  return { status: 'pending' };
}

function summarizeAskUserQuestionAnswer(block: Extract<MessageBlock, { type: 'user' }> | undefined): string | null {
  if (!block) {
    return null;
  }

  const text = block.text.trim().replace(/\s+/g, ' ');
  if (text.length > 0) {
    return text.length > 180 ? `${text.slice(0, 179)}…` : text;
  }

  const imageCount = block.images?.length ?? 0;
  if (imageCount > 0) {
    return imageCount === 1 ? 'Sent 1 image attachment.' : `Sent ${imageCount} image attachments.`;
  }

  return null;
}

function AskUserQuestionToolBlock({
  block,
  presentation,
  state,
  onSubmit,
  mode = 'inline',
}: {
  block: Extract<MessageBlock, { type: 'tool_use' }>;
  presentation: AskUserQuestionPresentation;
  state: AskUserQuestionState;
  onSubmit?: (presentation: AskUserQuestionPresentation, answers: AskUserQuestionAnswers) => Promise<void> | void;
  mode?: 'inline' | 'composer';
}) {
  const isRunning = block.status === 'running' || !!block.running;
  const answerPreview = summarizeAskUserQuestionAnswer(state.answerBlock);
  const statusLabel = state.status === 'answered'
    ? 'answered'
    : state.status === 'superseded'
      ? 'replaced'
      : isRunning
        ? 'asking…'
        : 'waiting';
  const [activeQuestionIndex, setActiveQuestionIndex] = useState(0);
  const [activeOptionIndex, setActiveOptionIndex] = useState(0);
  const [answers, setAnswers] = useState<AskUserQuestionAnswers>({});
  const [submitting, setSubmitting] = useState(false);
  const questionTabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const submitButtonRef = useRef<HTMLButtonElement | null>(null);
  const questionIdsKey = useMemo(
    () => presentation.questions.map((question) => question.id).join('|'),
    [presentation.questions],
  );

  useEffect(() => {
    setActiveQuestionIndex(0);
    setActiveOptionIndex(0);
    setAnswers({});
    setSubmitting(false);
  }, [questionIdsKey]);

  const activeQuestion = presentation.questions[Math.max(0, Math.min(activeQuestionIndex, presentation.questions.length - 1))] ?? null;

  useEffect(() => {
    if (!activeQuestion) {
      setActiveOptionIndex(0);
      optionRefs.current = [];
      return;
    }

    setActiveOptionIndex(resolveAskUserQuestionDefaultOptionIndex(activeQuestion, answers));
    optionRefs.current = [];
  }, [activeQuestion, activeQuestionIndex, answers, questionIdsKey]);

  const answeredCount = presentation.questions.filter((question) => (answers[question.id]?.length ?? 0) > 0).length;
  const hasInteractiveOptions = presentation.questions.some((question) => question.options.length > 0);
  const canSubmit = hasInteractiveOptions && isAskUserQuestionComplete(presentation, answers) && Boolean(onSubmit);
  const submitLabel = submitting ? 'Submitting…' : '✓ Submit →';

  const focusQuestionTab = useCallback((index: number) => {
    window.requestAnimationFrame(() => {
      questionTabRefs.current[index]?.focus();
    });
  }, []);

  const focusSubmitButton = useCallback(() => {
    window.requestAnimationFrame(() => {
      submitButtonRef.current?.focus();
    });
  }, []);

  const focusOption = useCallback((index: number) => {
    window.requestAnimationFrame(() => {
      optionRefs.current[index]?.focus();
    });
  }, []);

  const activateQuestion = useCallback((index: number, options?: { focus?: 'tab' | 'option' }) => {
    const nextIndex = Math.max(0, Math.min(index, presentation.questions.length - 1));
    const nextQuestion = presentation.questions[nextIndex];
    const nextOptionIndex = resolveAskUserQuestionDefaultOptionIndex(nextQuestion, answers);
    setActiveQuestionIndex(nextIndex);
    setActiveOptionIndex(nextOptionIndex >= 0 ? nextOptionIndex : 0);

    if (options?.focus === 'tab') {
      focusQuestionTab(nextIndex);
    } else if (options?.focus === 'option') {
      if (nextOptionIndex >= 0) {
        focusOption(nextOptionIndex);
      } else {
        focusQuestionTab(nextIndex);
      }
    }
  }, [answers, focusOption, focusQuestionTab, presentation.questions]);

  const submitIfReady = useCallback(async () => {
    if (!onSubmit || !canSubmit) {
      return;
    }

    setSubmitting(true);
    try {
      await onSubmit(presentation, answers);
    } finally {
      setSubmitting(false);
    }
  }, [answers, canSubmit, onSubmit, presentation]);

  const advanceAfterAnswer = useCallback((questionIndex: number, nextAnswers: AskUserQuestionAnswers) => {
    const nextQuestionIndex = questionIndex + 1;
    if (nextQuestionIndex < presentation.questions.length) {
      const nextQuestion = presentation.questions[nextQuestionIndex];
      const nextOptionIndex = resolveAskUserQuestionDefaultOptionIndex(nextQuestion, nextAnswers);
      setActiveQuestionIndex(nextQuestionIndex);
      setActiveOptionIndex(nextOptionIndex >= 0 ? nextOptionIndex : 0);
      if (nextOptionIndex >= 0) {
        focusOption(nextOptionIndex);
      } else {
        focusQuestionTab(nextQuestionIndex);
      }
      return;
    }

    if (isAskUserQuestionComplete(presentation, nextAnswers)) {
      focusSubmitButton();
    }
  }, [focusOption, focusQuestionTab, focusSubmitButton, presentation]);

  const applyRadioAnswer = useCallback((questionIndex: number, value: string) => {
    const question = presentation.questions[questionIndex];
    if (!question) {
      return;
    }

    const nextValues = [value];
    const nextAnswers = {
      ...answers,
      [question.id]: nextValues,
    };
    setAnswers(nextAnswers);
    if (shouldAdvanceAskUserQuestionAfterSelection(question, nextValues)) {
      advanceAfterAnswer(questionIndex, nextAnswers);
    }
  }, [advanceAfterAnswer, answers, presentation.questions]);

  const applyCheckAnswer = useCallback((questionIndex: number, value: string) => {
    const question = presentation.questions[questionIndex];
    if (!question) {
      return;
    }

    const currentValues = answers[question.id] ?? [];
    const alreadySelected = currentValues.includes(value);
    const nextValues = alreadySelected
      ? currentValues.filter((candidate) => candidate !== value)
      : [...currentValues, value];
    const nextAnswers = {
      ...answers,
      [question.id]: nextValues,
    };

    setAnswers(nextAnswers);
    if (shouldAdvanceAskUserQuestionAfterSelection(question, nextValues)) {
      advanceAfterAnswer(questionIndex, nextAnswers);
    }
  }, [advanceAfterAnswer, answers, presentation.questions]);

  const handleOptionSelect = useCallback((questionIndex: number, optionIndex: number) => {
    const question = presentation.questions[questionIndex];
    const option = question?.options[optionIndex];
    if (!question || !option || submitting) {
      return;
    }

    setActiveOptionIndex(optionIndex);
    if (question.style === 'check') {
      applyCheckAnswer(questionIndex, option.value);
      return;
    }

    applyRadioAnswer(questionIndex, option.value);
  }, [applyCheckAnswer, applyRadioAnswer, presentation.questions, submitting]);

  const handleQuestionTabKeyDown = useCallback((index: number, event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowLeft' || (event.key === 'Tab' && event.shiftKey)) {
      event.preventDefault();
      activateQuestion(Math.max(0, index - 1), { focus: 'tab' });
      return;
    }

    if (event.key === 'ArrowRight' || (event.key === 'Tab' && !event.shiftKey)) {
      event.preventDefault();
      if (index >= presentation.questions.length - 1) {
        focusSubmitButton();
      } else {
        activateQuestion(index + 1, { focus: 'tab' });
      }
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (activeQuestion?.options.length) {
        focusOption(activeOptionIndex);
      }
      return;
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (activeQuestion?.options.length) {
        focusOption(activeOptionIndex);
      }
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      event.currentTarget.blur();
    }
  }, [activateQuestion, activeOptionIndex, activeQuestion?.options.length, focusOption, focusSubmitButton, presentation.questions.length]);

  const handleSubmitKeyDown = useCallback((event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowLeft' || (event.key === 'Tab' && event.shiftKey)) {
      event.preventDefault();
      activateQuestion(presentation.questions.length - 1, { focus: 'tab' });
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (activeQuestion?.options.length) {
        focusOption(activeOptionIndex);
      }
      return;
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      void submitIfReady();
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      event.currentTarget.blur();
    }
  }, [activateQuestion, activeOptionIndex, activeQuestion?.options.length, focusOption, presentation.questions.length, submitIfReady]);

  const handleOptionKeyDown = useCallback((optionIndex: number, event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!activeQuestion) {
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      const nextIndex = moveAskUserQuestionIndex(optionIndex, activeQuestion.options.length, 1);
      setActiveOptionIndex(nextIndex);
      focusOption(nextIndex);
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      const nextIndex = moveAskUserQuestionIndex(optionIndex, activeQuestion.options.length, -1);
      setActiveOptionIndex(nextIndex);
      focusOption(nextIndex);
      return;
    }

    if (event.key === 'ArrowLeft' || (event.key === 'Tab' && event.shiftKey)) {
      event.preventDefault();
      activateQuestion(Math.max(0, activeQuestionIndex - 1), { focus: 'tab' });
      return;
    }

    if (event.key === 'ArrowRight' || (event.key === 'Tab' && !event.shiftKey)) {
      event.preventDefault();
      if (activeQuestionIndex >= presentation.questions.length - 1) {
        focusSubmitButton();
      } else {
        activateQuestion(activeQuestionIndex + 1, { focus: 'tab' });
      }
      return;
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handleOptionSelect(activeQuestionIndex, optionIndex);
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      event.currentTarget.blur();
    }
  }, [activeQuestion, activeQuestionIndex, activateQuestion, focusOption, focusSubmitButton, handleOptionSelect, presentation.questions.length]);

  const handlePanelHotkeys = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || submitting || event.altKey || event.ctrlKey || event.metaKey) {
      return;
    }

    const optionHotkeyIndex = resolveAskUserQuestionOptionHotkey(event.key);
    if (activeQuestion && optionHotkeyIndex >= 0 && optionHotkeyIndex < activeQuestion.options.length) {
      event.preventDefault();
      handleOptionSelect(activeQuestionIndex, optionHotkeyIndex);
      return;
    }

    const questionDirection = resolveAskUserQuestionNavigationHotkey(event.key);
    if (questionDirection === 0) {
      return;
    }

    event.preventDefault();
    if (questionDirection > 0) {
      if (activeQuestionIndex >= presentation.questions.length - 1) {
        focusSubmitButton();
      } else {
        activateQuestion(activeQuestionIndex + 1, { focus: 'option' });
      }
      return;
    }

    activateQuestion(Math.max(0, activeQuestionIndex - 1), { focus: 'option' });
  }, [activeQuestion, activeQuestionIndex, activateQuestion, focusSubmitButton, handleOptionSelect, presentation.questions.length, submitting]);

  const statusTone = state.status === 'answered'
    ? 'success'
    : state.status === 'superseded'
      ? 'muted'
      : 'warning';

  return (
    <SurfacePanel
      muted
      className={cx(
        'px-3 py-2.5 text-[12px] transition-colors',
        state.status === 'pending' && 'border-warning/25 bg-warning/5',
      )}
      onKeyDownCapture={mode === 'inline' ? handlePanelHotkeys : undefined}
    >
      <div className="flex items-start gap-2.5">
        <div className="ui-chat-avatar mt-0.5">
          <span className="ui-chat-avatar-mark">?</span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <span className="text-[13px] font-medium text-primary">
              {presentation.questions.length === 1 ? 'Question for you' : 'Questions for you'}
            </span>
            <Pill tone={statusTone}>{statusLabel}</Pill>
            {mode === 'inline' && state.status === 'pending' && presentation.questions.length > 1 && (
              <span className="text-[10px] uppercase tracking-[0.14em] text-dim/65">
                {answeredCount}/{presentation.questions.length} answered
              </span>
            )}
          </div>

          {state.status === 'pending' ? (
            mode === 'composer' ? (
              <>
                {presentation.details && (
                  <p className="mt-1.5 text-[12px] leading-relaxed text-secondary break-words">{presentation.details}</p>
                )}
                <div className="mt-2 space-y-1">
                  {presentation.questions.map((question, index) => (
                    <p key={question.id} className="flex items-start gap-2 text-[12px] leading-relaxed text-secondary">
                      <span className="mt-px w-4 shrink-0 text-[10px] font-mono text-dim">{index + 1}.</span>
                      <span className="min-w-0 break-words">{question.label}</span>
                    </p>
                  ))}
                </div>
                <p className="mt-2 text-[11px] text-dim">
                  Answer using the composer below. Type 1-9 to select, or send a normal message to skip.
                </p>
              </>
            ) : (
              <>
                {presentation.details && (
                  <p className="mt-1.5 text-[12px] leading-relaxed text-secondary break-words">{presentation.details}</p>
                )}

                <div className="mt-2.5 flex min-w-0 flex-wrap items-center gap-1" role="tablist" aria-label="Question navigation">
                  {presentation.questions.map((question, index) => {
                    const answered = (answers[question.id]?.length ?? 0) > 0;
                    const active = index === activeQuestionIndex;
                    return (
                      <button
                        key={question.id}
                        ref={(node) => { questionTabRefs.current[index] = node; }}
                        type="button"
                        role="tab"
                        aria-selected={active}
                        aria-controls={`ask-user-question-panel-${question.id}`}
                        onClick={() => activateQuestion(index)}
                        onKeyDown={(event) => handleQuestionTabKeyDown(index, event)}
                        className={cx(
                          'ui-action-button min-w-0 px-1 py-0.5 text-[10px] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/50 focus-visible:ring-offset-1 focus-visible:ring-offset-surface',
                          active
                            ? 'text-primary hover:text-primary'
                            : answered
                              ? 'text-secondary'
                              : 'text-dim',
                        )}
                      >
                        <span aria-hidden="true" className={cx('shrink-0 text-[10px]', answered ? 'text-success' : active ? 'text-accent' : 'text-dim/70')}>
                          {answered ? '✓' : active ? '•' : '○'}
                        </span>
                        <span className="truncate">{question.label}</span>
                      </button>
                    );
                  })}
                  {hasInteractiveOptions && onSubmit && (
                    <button
                      ref={submitButtonRef}
                      type="button"
                      disabled={!canSubmit || submitting}
                      onClick={() => { void submitIfReady(); }}
                      onKeyDown={handleSubmitKeyDown}
                      className={cx(
                        'ui-action-button px-1 py-0.5 text-[10px] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/50 focus-visible:ring-offset-1 focus-visible:ring-offset-surface',
                        canSubmit && !submitting ? 'text-accent' : 'text-dim',
                      )}
                    >
                      {submitLabel}
                    </button>
                  )}
                </div>

                {activeQuestion && (
                  <div id={`ask-user-question-panel-${activeQuestion.id}`} role="tabpanel" className="mt-2.5 border-t border-border-subtle pt-2.5">
                    {presentation.questions.length > 1 && (
                      <p className="text-[10px] uppercase tracking-[0.14em] text-dim/65">
                        Question {activeQuestionIndex + 1} of {presentation.questions.length}
                      </p>
                    )}
                    <p className="mt-0.5 text-[13px] font-medium text-primary break-words">{activeQuestion.label}</p>
                    {activeQuestion.details && (
                      <p className="mt-0.5 text-[12px] leading-relaxed text-secondary break-words">{activeQuestion.details}</p>
                    )}

                    {activeQuestion.options.length > 0 ? (
                      <div
                        className="mt-0.5 -mx-0.5"
                        role={activeQuestion.style === 'check' ? 'group' : 'radiogroup'}
                        aria-label={activeQuestion.label}
                      >
                        {activeQuestion.options.map((option, optionIndex) => {
                          const selectedValues = answers[activeQuestion.id] ?? [];
                          const checked = selectedValues.includes(option.value);
                          const indicator = activeQuestion.style === 'check'
                            ? (checked ? '☑' : '☐')
                            : (checked ? '◉' : '◯');
                          return (
                            <button
                              key={`${activeQuestion.id}:${option.value}`}
                              ref={(node) => { optionRefs.current[optionIndex] = node; }}
                              type="button"
                              role={activeQuestion.style === 'check' ? 'checkbox' : 'radio'}
                              aria-checked={checked}
                              aria-label={option.label}
                              aria-keyshortcuts={optionIndex < 9 ? String(optionIndex + 1) : undefined}
                              onClick={() => handleOptionSelect(activeQuestionIndex, optionIndex)}
                              onKeyDown={(event) => handleOptionKeyDown(optionIndex, event)}
                              className={cx(
                                'ui-list-row -mx-0.5 w-full items-start gap-2 px-2.5 py-1 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/50 focus-visible:ring-offset-1 focus-visible:ring-offset-surface',
                                checked ? 'ui-list-row-selected' : 'ui-list-row-hover',
                                submitting && 'cursor-default opacity-60',
                              )}
                            >
                              <span className={cx('mt-px w-3 shrink-0 text-[11px]', checked ? 'text-accent' : 'text-dim')} aria-hidden="true">
                                {indicator}
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="ui-row-title block break-words">{option.label}</span>
                                {option.details && (
                                  <span className="ui-row-summary block break-words">{option.details}</span>
                                )}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="mt-1.5 text-[12px] leading-relaxed text-secondary">
                        Send a normal message in the composer to answer this question.
                      </p>
                    )}
                  </div>
                )}

                <p className="mt-2.5 text-[10px] text-dim">
                  1-9 selects · n/p switches questions · ↑/↓ moves · Esc exits · send a normal message to skip
                </p>
              </>
            )
          ) : answerPreview ? (
            <div className="mt-2.5 space-y-1">
              <p className="text-[10px] uppercase tracking-[0.14em] text-dim/65">Your reply</p>
              <p className="text-[12px] leading-relaxed text-secondary break-words">{answerPreview}</p>
            </div>
          ) : state.status === 'superseded' ? (
            <p className="mt-2.5 text-[11px] text-dim">A newer question was asked later in the conversation.</p>
          ) : null}
        </div>
      </div>
    </SurfacePanel>
  );
}

function summarizeLinkedRunTail(value: string): string | null {
  let segments = value
    .split('-')
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);

  const timestampIndex = segments.findIndex((segment) => /^\d{4}$/.test(segment) || /^\d{4}T\d+/i.test(segment));
  if (timestampIndex >= 0) {
    segments = segments.slice(0, timestampIndex);
  }

  while (segments.length > 0) {
    const last = segments[segments.length - 1] ?? '';
    if (/^[a-f0-9]{6,}$/i.test(last) || /^\d+$/.test(last)) {
      segments = segments.slice(0, -1);
      continue;
    }
    break;
  }

  const summary = segments.join(' ').trim();
  if (!summary) {
    return null;
  }

  const compact = summary.replace(/\s+/g, '');
  if (/^[a-f0-9]+$/i.test(compact) && compact.length >= 8) {
    return null;
  }

  return summary.charAt(0).toUpperCase() + summary.slice(1);
}

function describeLinkedRun(runId: string): { title: string; detail: string | null } {
  if (runId.startsWith('conversation-live-')) {
    return { title: 'Conversation Run', detail: null };
  }

  if (runId.startsWith('conversation-deferred-resume-')) {
    return { title: 'Wakeup', detail: null };
  }

  if (runId.startsWith('task-')) {
    return {
      title: 'Scheduled Task',
      detail: summarizeLinkedRunTail(runId.slice('task-'.length)),
    };
  }

  if (runId.startsWith('run-')) {
    return {
      title: 'Background Run',
      detail: summarizeLinkedRunTail(runId.slice('run-'.length)),
    };
  }

  return {
    title: 'Linked Run',
    detail: summarizeLinkedRunTail(runId),
  };
}

function ToolBlock({
  block,
  autoOpen,
  onOpenArtifact,
  activeArtifactId,
  onOpenRun,
  activeRunId,
  onOpenFilePath,
  onHydrateMessage,
  hydratingMessageBlockIds,
  messages,
  messageIndex,
  onSubmitAskUserQuestion,
  askUserQuestionDisplayMode = 'inline',
}: {
  block: Extract<MessageBlock, { type: 'tool_use' }>;
  autoOpen: boolean;
  onOpenArtifact?: (artifactId: string) => void;
  activeArtifactId?: string | null;
  onOpenRun?: (runId: string) => void;
  activeRunId?: string | null;
  onOpenFilePath?: (path: string) => void;
  onHydrateMessage?: (blockId: string) => Promise<void> | void;
  hydratingMessageBlockIds?: ReadonlySet<string>;
  messages?: MessageBlock[];
  messageIndex?: number;
  onSubmitAskUserQuestion?: (presentation: AskUserQuestionPresentation, answers: AskUserQuestionAnswers) => Promise<void> | void;
  askUserQuestionDisplayMode?: 'inline' | 'composer';
}) {
  const [preference, setPreference] = useState<DisclosurePreference>('auto');
  const open = resolveDisclosureOpen(autoOpen, preference);
  const meta = toolMeta(block.tool);
  const artifact = readArtifactPresentation(block);
  const askUserQuestion = readAskUserQuestionPresentation(block);
  const askUserQuestionState = useMemo(
    () => describeAskUserQuestionState(messages, messageIndex),
    [messageIndex, messages],
  );
  const runIds = useMemo(() => extractDurableRunIdsFromBlock(block), [block]);

  if (artifact) {
    return (
      <ArtifactToolBlock
        block={block}
        artifact={artifact}
        onOpenArtifact={onOpenArtifact}
        activeArtifactId={activeArtifactId}
      />
    );
  }

  if (block.tool === 'ask_user_question' && askUserQuestion && !(block.status === 'error' || block.error)) {
    return (
      <AskUserQuestionToolBlock
        block={block}
        presentation={askUserQuestion}
        state={askUserQuestionState}
        onSubmit={onSubmitAskUserQuestion}
        mode={askUserQuestionDisplayMode}
      />
    );
  }

  // Normalise tool state across streamed and persisted entries.
  const isRunning = block.status === 'running' || !!block.running;
  const isError   = block.status === 'error'   || !!block.error;
  const output    = block.output ?? '';
  const blockId = block.id?.trim();
  const outputDeferred = Boolean(block.outputDeferred && blockId && onHydrateMessage);
  const hydratingDeferredOutput = Boolean(blockId && hydratingMessageBlockIds?.has(blockId));

  const preview = block.input.command
    ? String(block.input.command).split('\n')[0].slice(0, 64)
    : block.input.path  ? String(block.input.path)
    : block.input.url   ? String(block.input.url).replace('https://', '').slice(0, 60)
    : block.input.query ? String(block.input.query).slice(0, 60)
    : '';

  return (
    <div className={cx('rounded-lg text-[12px] font-mono overflow-hidden transition-colors', meta.color, isError && 'border border-danger/40 bg-danger/5 text-danger')}>
      <button
        onClick={() => setPreference((current) => toggleDisclosurePreference(autoOpen, current))}
        className="w-full flex items-center gap-2 px-2.5 py-2 hover:bg-black/5 transition-colors text-left"
      >
        {isRunning ? (
          <span className="w-4 h-4 border-[1.5px] border-current border-t-transparent rounded-full animate-spin shrink-0 opacity-70" />
        ) : (
          <span className="font-bold w-4 text-center shrink-0 select-none">{meta.icon}</span>
        )}
        <Pill tone={isError ? 'danger' : meta.tone} mono className="shrink-0">
          {meta.label}
        </Pill>
        <span className="flex-1 truncate opacity-70 font-normal">{preview}</span>
        {block.durationMs && !isRunning && (
          <span className="shrink-0 opacity-40 ml-2">{(block.durationMs / 1000).toFixed(1)}s</span>
        )}
        {isRunning ? (
          <>
            <span className="shrink-0 text-[10px] opacity-60 ml-2">running…</span>
            <span className="shrink-0 opacity-30 text-[10px]">{open ? '▲' : '▼'}</span>
          </>
        ) : <span className="shrink-0 opacity-30 text-[10px]">{open ? '▲' : '▼'}</span>}
      </button>

      {runIds.length > 0 && (
        <div className="border-t border-border-subtle/70 bg-black/5 px-2.5 py-2 text-[11px] font-sans">
          <p className="mb-1.5 uppercase tracking-[0.14em] opacity-40">
            {runIds.length === 1 ? 'linked run' : 'linked runs'}
          </p>
          <div className="space-y-1.5">
            {runIds.map((runId) => {
              const isActiveRun = activeRunId === runId;
              const linkedRun = describeLinkedRun(runId);
              const headline = isActiveRun
                ? `Opened ${linkedRun.title}`
                : onOpenRun
                  ? `Open ${linkedRun.title}`
                  : linkedRun.title;
              return (
                <button
                  key={runId}
                  type="button"
                  onClick={() => { onOpenRun?.(runId); }}
                  disabled={!onOpenRun}
                  className={cx(
                    'w-full rounded-md px-2 py-1.5 text-left transition-colors',
                    onOpenRun ? 'hover:bg-black/5' : 'cursor-default',
                    isActiveRun ? 'bg-black/10 text-primary' : 'text-accent',
                    !onOpenRun && 'text-dim',
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium leading-4 text-current">{headline}</p>
                      {linkedRun.detail && (
                        <p className="mt-1 truncate text-[10px] leading-4 text-secondary/80">{linkedRun.detail}</p>
                      )}
                    </div>
                    <span className="shrink-0 text-[10px] uppercase tracking-[0.14em] opacity-45">{isActiveRun ? 'open' : onOpenRun ? 'show' : 'linked'}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {open && (
        <div className="border-t border-border-subtle/70">
          <div className="px-2.5 py-2 bg-black/5">
            <p className="text-[10px] uppercase tracking-wider opacity-40 mb-1">input</p>
            <FilePathPreformattedText
              text={JSON.stringify(block.input, null, 2)}
              onOpenFilePath={onOpenFilePath}
              className="whitespace-pre-wrap break-all text-[11px] leading-relaxed opacity-75"
            />
          </div>
          {(isRunning || output || outputDeferred) && (
            <div className={cx('px-2.5 py-2', isRunning && output && 'max-h-40 overflow-y-auto')}>
              <div className="mb-1 flex items-center gap-2">
                <p className="text-[10px] uppercase tracking-wider opacity-40">
                  {isRunning ? 'live output' : `output · ${output.split('\n').length} lines`}
                </p>
                {outputDeferred && blockId && (
                  <button
                    type="button"
                    onClick={() => { void onHydrateMessage?.(blockId); }}
                    disabled={hydratingDeferredOutput}
                    className="ui-action-button text-[10px]"
                  >
                    {hydratingDeferredOutput ? 'Loading full output…' : 'Load full output'}
                  </button>
                )}
              </div>
              {output ? (
                <FilePathPreformattedText
                  text={output}
                  onOpenFilePath={onOpenFilePath}
                  className="whitespace-pre-wrap break-all text-[11px] leading-relaxed opacity-75"
                />
              ) : isRunning ? (
                <p className="text-[11px] italic leading-relaxed opacity-55">Waiting for output…</p>
              ) : outputDeferred ? (
                <p className="text-[11px] italic leading-relaxed opacity-55">Older tool output is available on demand.</p>
              ) : null}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── ThinkingBlock ─────────────────────────────────────────────────────────────

function ThinkingBlock({ block, autoOpen }: { block: Extract<MessageBlock, { type: 'thinking' }>; autoOpen: boolean }) {
  const [preference, setPreference] = useState<DisclosurePreference>('auto');
  const open = resolveDisclosureOpen(autoOpen, preference);

  return (
    <SurfacePanel muted className="overflow-hidden border-transparent bg-elevated/35 text-[12px] shadow-none">
      <button
        onClick={() => setPreference((current) => toggleDisclosurePreference(autoOpen, current))}
        className="w-full flex items-center gap-2 px-2.5 py-2 text-left hover:bg-elevated transition-colors"
      >
        <span className="text-dim select-none">💭</span>
        <Pill tone="muted">Thinking</Pill>
        <span className="flex-1" />
        {autoOpen && <span className="text-[10px] uppercase tracking-[0.14em] text-dim/55">live</span>}
        <span className="text-dim text-[10px]">{open ? '▲ hide' : '▼ show'}</span>
      </button>
      {open && (
        <div className="border-t border-border-subtle/70 px-2.5 pb-2.5 pt-1.5 text-secondary italic leading-relaxed space-y-1">
          {block.text.split('\n').map((l, i) => <p key={i} className="text-[12px]">{l || <br />}</p>)}
        </div>
      )}
    </SurfacePanel>
  );
}

// ── SubagentBlock ─────────────────────────────────────────────────────────────

function SubagentBlock({ block }: { block: Extract<MessageBlock, { type: 'subagent' }> }) {
  const [open, setOpen] = useState(false);
  const clr = { running: 'text-steel bg-steel/8 border-steel/20', complete: 'text-success bg-success/8 border-success/20', failed: 'text-danger bg-danger/8 border-danger/20' }[block.status];
  const tone = { running: 'steel', complete: 'success', failed: 'danger' }[block.status] as 'steel' | 'success' | 'danger';
  return (
    <div className={`rounded-lg overflow-hidden text-[12px] ${clr}`}>
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-2.5 py-2 text-left hover:bg-black/5 transition-colors"
      >
        {block.status === 'running'
          ? <span className="w-4 h-4 border-[1.5px] border-current border-t-transparent rounded-full animate-spin shrink-0" />
          : <span className="font-bold shrink-0 select-none">⟳</span>}
        <Pill tone={tone} mono>subagent</Pill>
        <span className="flex-1 truncate opacity-70 font-normal">{block.name}</span>
        <Pill tone={tone}>{block.status}</Pill>
        <span className="shrink-0 ml-1 opacity-30 text-[10px]">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="border-t border-border-subtle/70 px-2.5 py-2 space-y-2 bg-black/5">
          <div>
            <p className="text-[10px] uppercase tracking-wider opacity-40 mb-1">prompt</p>
            <p className="opacity-70 leading-relaxed">{block.prompt}</p>
          </div>
          {block.summary && (
            <div>
              <p className="text-[10px] uppercase tracking-wider opacity-40 mb-1">result</p>
              <p className="opacity-80 leading-relaxed">{block.summary}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function traceSummaryTone(category: TraceClusterSummaryCategory) {
  switch (category.kind) {
    case 'thinking':
      return 'muted';
    case 'subagent':
      return 'steel';
    case 'error':
      return 'danger';
    case 'tool':
      return toolMeta(category.tool ?? category.label).tone;
  }
}

const MAX_VISIBLE_TRACE_BLOCKS = 5;

function TraceClusterBlock({
  blocks,
  summary,
  live,
  onOpenArtifact,
  activeArtifactId,
  onOpenRun,
  activeRunId,
  onOpenFilePath,
  onResume,
  resumeBusy,
  resumeTitle,
  resumeLabel,
}: {
  blocks: TraceConversationBlock[];
  summary: TraceClusterSummary;
  live: boolean;
  onOpenArtifact?: (artifactId: string) => void;
  activeArtifactId?: string | null;
  onOpenRun?: (runId: string) => void;
  activeRunId?: string | null;
  onOpenFilePath?: (path: string) => void;
  onResume?: () => Promise<void> | void;
  resumeBusy?: boolean;
  resumeTitle?: string | null;
  resumeLabel?: string;
}) {
  const [preference, setPreference] = useState<DisclosurePreference>('auto');
  const [showAllBlocks, setShowAllBlocks] = useState(false);
  const expandedCategories = summary.categories.slice(0, 3);
  const remainingCategoryCount = Math.max(0, summary.categories.length - expandedCategories.length);
  const durationLabel = summary.durationMs && summary.durationMs > 0
    ? `${(summary.durationMs / 1000).toFixed(1)}s`
    : null;
  const isActive = live || summary.hasRunning;
  const title = isActive ? 'Working' : 'Internal work';
  const autoOpen = shouldAutoOpenTraceCluster(live, summary.hasRunning);
  const open = resolveDisclosureOpen(autoOpen, preference);
  const hiddenBlockCount = Math.max(0, blocks.length - MAX_VISIBLE_TRACE_BLOCKS);
  const visibleBlocks = showAllBlocks || hiddenBlockCount === 0
    ? blocks
    : blocks.slice(-MAX_VISIBLE_TRACE_BLOCKS);
  const visibleStartIndex = blocks.length - visibleBlocks.length;
  const panelClassName = cx(
    'flex-1 rounded-xl border px-2.5 py-2 text-left transition-colors',
    summary.hasError
      ? 'border-danger/30 bg-danger/5 hover:bg-danger/10'
      : 'border-border-subtle bg-elevated/60 hover:bg-elevated',
  );

  return (
    <div className="space-y-1.5">
      <div className="flex flex-col gap-1.5 sm:flex-row sm:items-start sm:gap-2">
        <button
          type="button"
          onClick={() => setPreference((current) => toggleDisclosurePreference(autoOpen, current))}
          aria-expanded={open}
          className={panelClassName}
        >
          <div className="flex items-center gap-2 text-[12px]">
            {isActive ? (
              <span className="h-4 w-4 shrink-0 rounded-full border-[1.5px] border-current border-t-transparent animate-spin text-accent" />
            ) : (
              <span className={cx('w-4 shrink-0 text-center text-[11px] select-none', summary.hasError ? 'text-danger' : 'text-dim')}>⋯</span>
            )}
            <span className="font-medium text-primary">{title}</span>
            <span className="text-secondary">· {summary.stepCount} step{summary.stepCount === 1 ? '' : 's'}</span>
            <span className="flex-1" />
            {isActive && <span className="text-[10px] uppercase tracking-[0.14em] text-accent/80">live</span>}
            {durationLabel && !isActive && <span className="text-[11px] text-dim">{durationLabel}</span>}
            <span className="text-[10px] text-dim">{open ? '▲ hide' : '▼ show'}</span>
          </div>
          {summary.categories.length > 0 && (
            <div className="mt-1.5 flex flex-wrap items-center gap-1">
              {expandedCategories.map((category) => (
                <Pill key={category.key} tone={traceSummaryTone(category)} mono={category.kind === 'tool'}>
                  {category.label}{category.count > 1 ? ` ×${category.count}` : ''}
                </Pill>
              ))}
              {remainingCategoryCount > 0 && <span className="text-[11px] text-dim">+{remainingCategoryCount} more</span>}
            </div>
          )}
        </button>
        <ResumeConversationAction
          onResume={onResume}
          busy={resumeBusy}
          title={resumeTitle}
          label={resumeLabel}
          variant="inline"
        />
      </div>

      {open && (
        <div className="ml-2.5 space-y-1.5 border-l border-border-subtle pl-2.5">
          {hiddenBlockCount > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-md bg-elevated/35 px-2.5 py-1.5 text-[11px] text-secondary">
              <span>{showAllBlocks ? `Showing all ${blocks.length} steps.` : `${hiddenBlockCount} earlier step${hiddenBlockCount === 1 ? '' : 's'} summarized above.`}</span>
              <span className="flex-1" />
              <button
                type="button"
                onClick={() => setShowAllBlocks((current) => !current)}
                className="ui-action-button text-[10px]"
              >
                {showAllBlocks ? `Show latest ${MAX_VISIBLE_TRACE_BLOCKS}` : 'Show all'}
              </button>
            </div>
          )}
          {visibleBlocks.map((block, index) => {
            const blockIndex = visibleStartIndex + index;
            const autoOpen = shouldAutoOpenConversationBlock(block, blockIndex, blocks.length, live);

            switch (block.type) {
              case 'thinking':
                return <ThinkingBlock key={`thinking-${blockIndex}`} block={block} autoOpen={autoOpen} />;
              case 'tool_use':
                return (
                  <ToolBlock
                    key={`tool-${blockIndex}`}
                    block={block}
                    autoOpen={autoOpen}
                    onOpenArtifact={onOpenArtifact}
                    activeArtifactId={activeArtifactId}
                    onOpenRun={onOpenRun}
                    activeRunId={activeRunId}
                    onOpenFilePath={onOpenFilePath}
                  />
                );
              case 'subagent':
                return <SubagentBlock key={`subagent-${blockIndex}`} block={block} />;
              case 'error':
                return <ErrorBlock key={`error-${blockIndex}`} block={block} onOpenFilePath={onOpenFilePath} />;
              default:
                return null;
            }
          })}
        </div>
      )}
    </div>
  );
}

// ── ImageBlock ────────────────────────────────────────────────────────────────

function ImagePreview({
  alt,
  src,
  caption,
  width,
  height,
  maxHeight,
  deferred = false,
  loading = false,
  onLoad,
}: {
  alt: string;
  src?: string;
  caption?: string;
  width?: number;
  height?: number;
  maxHeight: number;
  deferred?: boolean;
  loading?: boolean;
  onLoad?: () => Promise<void> | void;
}) {
  return (
    <SurfacePanel muted className="overflow-hidden">
      {src ? (
        <img
          src={src}
          alt={alt}
          className="block w-full object-contain bg-elevated"
          style={{ maxHeight }}
        />
      ) : (
        <div
          className="w-full bg-elevated flex flex-col items-center justify-center gap-2 px-4 py-5 text-dim"
          style={{ aspectRatio: `${width ?? 16} / ${height ?? 9}`, maxHeight }}
        >
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4"
            strokeLinecap="round" strokeLinejoin="round" className="opacity-40">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <path d="m21 15-5-5L5 21" />
          </svg>
          <span className="text-[11px] font-mono opacity-50">{alt}</span>
          {width && <span className="text-[10px] opacity-35">{width}×{height}</span>}
          {deferred && onLoad && (
            <button type="button" onClick={() => { void onLoad(); }} disabled={loading} className="ui-action-button text-[11px]">
              {loading ? 'Loading image…' : 'Load image'}
            </button>
          )}
        </div>
      )}
      {(caption || (!src && alt)) && (
        <div className="px-3 py-2 bg-surface border-t border-border-subtle">
          <p className="text-[11px] text-dim font-mono">{caption ?? alt}</p>
        </div>
      )}
    </SurfacePanel>
  );
}

function ImageBlock({
  block,
  onHydrateMessage,
  hydratingMessageBlockIds,
}: {
  block: Extract<MessageBlock, { type: 'image' }>;
  onHydrateMessage?: (blockId: string) => Promise<void> | void;
  hydratingMessageBlockIds?: ReadonlySet<string>;
}) {
  const blockId = block.id?.trim();
  const canHydrate = Boolean(block.deferred && blockId && onHydrateMessage);
  const loading = Boolean(blockId && hydratingMessageBlockIds?.has(blockId));

  return (
    <ImagePreview
      alt={block.alt}
      src={block.src}
      caption={block.caption}
      width={block.width}
      height={block.height}
      maxHeight={320}
      deferred={block.deferred}
      loading={loading}
      onLoad={canHydrate ? () => onHydrateMessage?.(blockId as string) : undefined}
    />
  );
}

function ResumeConversationAction({
  onResume,
  busy = false,
  title,
  label = 'resume',
  variant = 'compact',
}: {
  onResume?: () => Promise<void> | void;
  busy?: boolean;
  title?: string | null;
  label?: string;
  variant?: 'compact' | 'inline';
}) {
  if (!onResume) {
    return null;
  }

  const compactClassName = 'shrink-0 text-[11px] font-medium text-secondary transition-colors hover:text-primary disabled:cursor-default disabled:text-dim';
  const inlineClassName = 'group inline-flex shrink-0 items-center gap-1.5 self-start rounded-lg px-2.5 py-1.5 text-[11px] font-medium text-secondary transition-colors hover:bg-elevated hover:text-primary disabled:cursor-default disabled:text-dim disabled:hover:bg-transparent sm:self-center';

  return (
    <button
      type="button"
      onClick={() => { void onResume(); }}
      disabled={busy}
      title={title ?? 'Resume this conversation'}
      className={variant === 'inline' ? inlineClassName : compactClassName}
    >
      {variant === 'inline' && (
        busy ? (
          <span aria-hidden className="h-3.5 w-3.5 shrink-0 rounded-full border-[1.5px] border-current border-t-transparent animate-spin text-dim" />
        ) : (
          <svg
            aria-hidden
            viewBox="0 0 16 16"
            fill="none"
            className="h-3.5 w-3.5 shrink-0 text-accent/75 transition-colors group-hover:text-accent"
          >
            <path d="M12.75 4.75V1.75M12.75 1.75H9.75M12.75 1.75L10.25 4.25" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M12.1 7.1C12.1 9.91665 9.81665 12.2 7 12.2C4.18335 12.2 1.9 9.91665 1.9 7.1C1.9 4.28335 4.18335 2 7 2C8.31638 2 9.5163 2.49883 10.4201 3.31798" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )
      )}
      {busy ? 'opening…' : label}
    </button>
  );
}

// ── ErrorBlock ────────────────────────────────────────────────────────────────

function ErrorBlock({
  block,
  messageIndex,
  onResume,
  resumeBusy,
  resumeTitle,
  resumeLabel,
  onOpenFilePath,
  onSelectionGesture,
  replySelectionActions,
}: {
  block: Extract<MessageBlock, { type: 'error' }>;
  messageIndex?: number;
  onResume?: () => Promise<void> | void;
  resumeBusy?: boolean;
  resumeTitle?: string | null;
  resumeLabel?: string;
  onOpenFilePath?: (path: string) => void;
  onSelectionGesture?: ReplySelectionGestureHandler;
  replySelectionActions?: ReplySelectionActions;
}) {
  const blockId = block.id?.trim() || undefined;
  const replySelectionScopeProps = buildReplySelectionScopeProps(messageIndex, blockId, onSelectionGesture);

  return (
    <SurfacePanel className="border-danger/30 bg-danger/5 px-3 py-2.5 text-[12px] font-mono flex gap-2 items-start">
      <span className="text-danger font-bold shrink-0 mt-0.5 select-none">✕</span>
      <div className="flex-1 min-w-0 space-y-2">
        <div {...replySelectionScopeProps}>
          {block.tool && <span className="text-danger/70 font-semibold">{block.tool} · </span>}
          <span className="text-danger/85 leading-relaxed">{renderFilePathTextFragments(block.message, { onOpenFilePath, keyPrefix: 'error' })}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {replySelectionActions && <ReplySelectionInlineActions onReply={replySelectionActions.onReply} onCopy={replySelectionActions.onCopy} />}
          <span className="flex-1" />
          <ResumeConversationAction
            onResume={onResume}
            busy={resumeBusy}
            title={resumeTitle}
            label={resumeLabel}
            variant="inline"
          />
        </div>
      </div>
    </SurfacePanel>
  );
}

// ── Message actions ───────────────────────────────────────────────────────────

interface ReplySelectionState {
  text: string;
  messageIndex: number;
  blockId?: string;
}

interface ReplySelectionActions {
  onReply: () => void;
  onCopy: () => void;
}

function clearWindowSelection() {
  if (typeof window === 'undefined') {
    return;
  }

  window.getSelection()?.removeAllRanges();
}

function hasActiveReplySelection(
  replySelection: ReplySelectionState | null,
  messageIndex?: number,
  blockId?: string,
): replySelection is ReplySelectionState {
  return Boolean(
    replySelection
      && typeof messageIndex === 'number'
      && replySelection.messageIndex === messageIndex
      && replySelection.blockId === blockId,
  );
}

function ReplySelectionInlineActions({ onReply, onCopy }: ReplySelectionActions) {
  const suppressPointerDown = (event: React.MouseEvent<HTMLButtonElement> | React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5" role="toolbar" aria-label="Selected text actions">
      <button
        type="button"
        onMouseDown={suppressPointerDown}
        onPointerDown={suppressPointerDown}
        onClick={onReply}
        className="ui-action-button text-[11px] text-accent"
      >
        ↩ reply selection
      </button>
      <button
        type="button"
        onMouseDown={suppressPointerDown}
        onPointerDown={suppressPointerDown}
        onClick={onCopy}
        className="ui-action-button text-[11px]"
      >
        ⎘ copy selection
      </button>
    </div>
  );
}

function MsgActions({
  isUser,
  copyText,
  onFork,
  onRewind,
}: {
  isUser?: boolean;
  copyText?: string;
  onFork?: () => Promise<void> | void;
  onRewind?: () => Promise<void> | void;
}) {
  const [isForking, setIsForking] = useState(false);
  const [isRewinding, setIsRewinding] = useState(false);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const copyResetTimeoutRef = useRef<number | null>(null);
  const canCopy = !isUser && typeof copyText === 'string' && copyText.length > 0;

  useEffect(() => () => {
    if (copyResetTimeoutRef.current !== null) {
      window.clearTimeout(copyResetTimeoutRef.current);
    }
  }, []);

  function setTransientCopyState(nextState: 'copied' | 'failed') {
    if (copyResetTimeoutRef.current !== null) {
      window.clearTimeout(copyResetTimeoutRef.current);
    }

    setCopyState(nextState);
    copyResetTimeoutRef.current = window.setTimeout(() => {
      setCopyState('idle');
      copyResetTimeoutRef.current = null;
    }, 1200);
  }

  async function handleFork() {
    if (!onFork || isForking) {
      return;
    }

    try {
      setIsForking(true);
      await onFork();
    } finally {
      setIsForking(false);
    }
  }

  async function handleRewind() {
    if (!onRewind || isRewinding) {
      return;
    }

    try {
      setIsRewinding(true);
      await onRewind();
    } finally {
      setIsRewinding(false);
    }
  }

  async function handleCopy() {
    if (!canCopy) {
      return;
    }

    if (typeof navigator === 'undefined' || typeof navigator.clipboard?.writeText !== 'function') {
      setTransientCopyState('failed');
      return;
    }

    try {
      await navigator.clipboard.writeText(copyText);
      setTransientCopyState('copied');
    } catch {
      setTransientCopyState('failed');
    }
  }

  return (
    <div className={`flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity ${isUser ? 'justify-start' : 'justify-end'}`}>
      {canCopy && (
        <button
          type="button"
          onClick={() => { void handleCopy(); }}
          className={cx('ui-action-button', copyState === 'copied' && 'text-accent', copyState === 'failed' && 'text-danger')}
          title={copyState === 'failed' ? 'Copy to clipboard failed' : 'Copy this assistant message to the clipboard'}
        >
          {copyState === 'copied' ? '⎘ copied' : copyState === 'failed' ? '⎘ copy failed' : '⎘ copy'}
        </button>
      )}
      {onRewind && (
        <button
          type="button"
          onClick={() => { void handleRewind(); }}
          className={cx('ui-action-button', isRewinding && 'text-accent')}
          title={isUser ? 'Rewind into a new conversation from this prompt' : 'Rewind into a new conversation from the prompt that led here'}
          disabled={isRewinding}
        >
          {isRewinding ? '↩ rewinding…' : '↩ rewind'}
        </button>
      )}
      {!isUser && onFork && (
        <button
          type="button"
          onClick={() => { void handleFork(); }}
          className={cx('ui-action-button', isForking && 'text-accent')}
          title="Fork into a new conversation from here"
          disabled={isForking}
        >
          {isForking ? '⑂ forking…' : '⑂ fork'}
        </button>
      )}
    </div>
  );
}

// ── UserMessage ───────────────────────────────────────────────────────────────

function UserMessage({
  block,
  onRewind,
  onHydrateMessage,
  hydratingMessageBlockIds,
  onOpenFilePath,
  layout = 'default',
}: {
  block: Extract<MessageBlock, { type: 'user' }>;
  onRewind?: () => Promise<void> | void;
  onHydrateMessage?: (blockId: string) => Promise<void> | void;
  hydratingMessageBlockIds?: ReadonlySet<string>;
  onOpenFilePath?: (path: string) => void;
  layout?: ChatViewLayout;
}) {
  const hasText = block.text.trim().length > 0;
  const skillBlock = hasText ? parseSkillBlock(block.text) : null;

  return (
    <div className="group flex flex-col items-end gap-1.5">
      <MsgActions isUser onRewind={onRewind} />
      <div className={layout === 'companion' ? 'max-w-[92%] sm:max-w-[88%]' : 'max-w-[86%]'}>
        <div className="ui-message-card-user space-y-2">
          {block.images && block.images.length > 0 && (
            <div className="space-y-2">
              {block.images.map((image, index) => {
                const blockId = block.id?.trim();
                const loading = Boolean(blockId && hydratingMessageBlockIds?.has(blockId));
                const canHydrate = Boolean(image.deferred && blockId && onHydrateMessage);

                return (
                  <ImagePreview
                    key={`${image.caption ?? image.alt}-${index}`}
                    alt={image.alt}
                    src={image.src}
                    caption={image.caption}
                    width={image.width}
                    height={image.height}
                    maxHeight={280}
                    deferred={image.deferred}
                    loading={loading}
                    onLoad={canHydrate ? () => onHydrateMessage?.(blockId as string) : undefined}
                  />
                );
              })}
            </div>
          )}
          {skillBlock ? (
            <div className="space-y-2 px-1.5 pb-0.5">
              <SkillInvocationCard skillBlock={skillBlock} className="ui-skill-invocation-user" onOpenFilePath={onOpenFilePath} />
              {skillBlock.userMessage && renderMarkdownText(skillBlock.userMessage, onOpenFilePath)}
            </div>
          ) : hasText ? (
            <div className="px-1.5 pb-0.5">
              {renderMarkdownText(block.text, onOpenFilePath)}
            </div>
          ) : null}
        </div>
        <p className="ui-message-meta mt-1 text-right pr-1">{timeAgo(block.ts)}</p>
      </div>
    </div>
  );
}

// ── AssistantMessage ──────────────────────────────────────────────────────────

function AssistantMessage({
  block,
  messageIndex,
  onFork,
  onRewind,
  onOpenFilePath,
  onSelectionGesture,
  replySelectionActions,
  showCursor = false,
  layout = 'default',
}: {
  block: Extract<MessageBlock, { type: 'text' }>;
  messageIndex?: number;
  onFork?: () => Promise<void> | void;
  onRewind?: () => Promise<void> | void;
  onOpenFilePath?: (path: string) => void;
  onSelectionGesture?: ReplySelectionGestureHandler;
  replySelectionActions?: ReplySelectionActions;
  showCursor?: boolean;
  layout?: ChatViewLayout;
}) {
  const shouldShowCursor = showCursor || !!block.streaming;
  const blockId = block.id?.trim() || undefined;
  const replySelectionScopeProps = buildReplySelectionScopeProps(messageIndex, blockId, onSelectionGesture);

  return (
    <div className={cx('group flex items-start', layout === 'companion' ? 'gap-2.5' : 'gap-3')}>
      <div className="ui-chat-avatar mt-0.5">
        <span className="ui-chat-avatar-mark">pa</span>
      </div>
      <div className="flex-1 min-w-0 space-y-1.5">
        <div
          {...replySelectionScopeProps}
          className="ui-message-card-assistant text-primary space-y-1"
        >
          {renderText(block.text, { onOpenFilePath })}
          {shouldShowCursor && (
            <span
              className="inline-block w-[2px] h-[14px] bg-accent ml-0.5 rounded-sm"
              style={{ animation: 'cursorBlink 1s step-end infinite', verticalAlign: 'text-bottom' }}
            />
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 pt-0.5">
          <p className="ui-message-meta">{timeAgo(block.ts)}</p>
          <span className="flex-1" />
          {replySelectionActions && <ReplySelectionInlineActions onReply={replySelectionActions.onReply} onCopy={replySelectionActions.onCopy} />}
          <MsgActions copyText={block.text} onRewind={onRewind} onFork={onFork} />
        </div>
      </div>
    </div>
  );
}

function ContextMessage({
  block,
  messageIndex,
  onOpenFilePath,
  onSelectionGesture,
  replySelectionActions,
}: {
  block: Extract<MessageBlock, { type: 'context' }>;
  messageIndex?: number;
  onOpenFilePath?: (path: string) => void;
  onSelectionGesture?: ReplySelectionGestureHandler;
  replySelectionActions?: ReplySelectionActions;
}) {
  const label = formatInjectedContextLabel(block.customType);
  const blockId = block.id?.trim() || undefined;
  const replySelectionScopeProps = buildReplySelectionScopeProps(messageIndex, blockId, onSelectionGesture);

  return (
    <div className="group">
      <div
        className="rounded-2xl rounded-l-md border-l-2 border-warning/35 bg-warning/5 px-3.5 py-3"
        data-context-type={block.customType ?? 'injected_context'}
      >
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-warning">{label}</p>
          <span className="flex-1" />
          <p className="ui-message-meta">{timeAgo(block.ts)}</p>
        </div>
        <div {...replySelectionScopeProps} className="pt-2 text-primary">
          {renderText(block.text, { onOpenFilePath })}
        </div>
        {replySelectionActions && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="flex-1" />
            <ReplySelectionInlineActions onReply={replySelectionActions.onReply} onCopy={replySelectionActions.onCopy} />
          </div>
        )}
      </div>
    </div>
  );
}

function resolveCompactionSummaryLabel(title: string | undefined): string {
  const normalized = title?.trim();
  if (!normalized || normalized === 'Compaction summary') {
    return 'Context compacted';
  }

  return normalized;
}

function resolveCompactionSummaryDetail(title: string | undefined): string {
  switch (title?.trim()) {
    case 'Manual compaction':
      return 'You explicitly summarized older turns to shrink the active context window.';
    case 'Proactive compaction':
      return 'Older turns were summarized because the context window was getting full. The conversation is ready for the next turn.';
    case 'Overflow recovery compaction':
      return 'Older turns were summarized after a context overflow so the interrupted turn could retry automatically.';
    default:
      return 'Older turns were summarized to keep the active context window focused.';
  }
}

function SummaryMessage({
  block,
  messageIndex,
  onOpenFilePath,
  onSelectionGesture,
  replySelectionActions,
}: {
  block: Extract<MessageBlock, { type: 'summary' }>;
  messageIndex?: number;
  onOpenFilePath?: (path: string) => void;
  onSelectionGesture?: ReplySelectionGestureHandler;
  replySelectionActions?: ReplySelectionActions;
}) {
  const isCompaction = block.kind === 'compaction';
  const label = isCompaction ? resolveCompactionSummaryLabel(block.title) : block.title || 'Branch summary';
  const detail = isCompaction
    ? resolveCompactionSummaryDetail(block.title)
    : 'Context from another branch was summarized while preserving the current path.';
  const accentClass = isCompaction
    ? 'border-warning/25 bg-warning/5'
    : 'border-teal/20 bg-teal/5';
  const markerClass = isCompaction
    ? 'border-warning/25 bg-warning/10 text-warning'
    : 'border-teal/25 bg-teal/10 text-teal';
  const labelClass = isCompaction ? 'text-warning' : 'text-teal';
  const previewLineCount = 4;
  const shouldCollapse = isCompaction;
  const previewText = useMemo(
    () => (isCompaction ? buildSummaryPreview(block.text, previewLineCount) : ''),
    [block.text, isCompaction],
  );
  const [expanded, setExpanded] = useState(() => !isCompaction);
  const blockId = block.id?.trim() || undefined;
  const replySelectionScopeProps = buildReplySelectionScopeProps(messageIndex, blockId, onSelectionGesture);

  return (
    <div className="group">
      <SurfacePanel muted className={cx('px-3.5 py-3.5', accentClass)} data-summary-kind={block.kind}>
        <div className="flex items-start gap-3">
          <div className={cx('mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border text-[11px] font-semibold', markerClass)}>
            <span aria-hidden="true">{isCompaction ? '≋' : '⑂'}</span>
          </div>
          <div className="min-w-0 flex-1 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <p className={cx('text-[10px] font-semibold uppercase tracking-[0.18em]', labelClass)}>{label}</p>
              <span className="flex-1" />
              <p className="ui-message-meta">{timeAgo(block.ts)}</p>
            </div>
            <div {...replySelectionScopeProps} className="space-y-3">
              <p className="text-[12px] leading-relaxed text-secondary">{detail}</p>
              <div className="text-primary">
                {shouldCollapse && !expanded ? (
                  <p className="whitespace-pre-wrap text-[12px] leading-relaxed text-primary">{previewText}</p>
                ) : (
                  renderText(block.text, { onOpenFilePath })
                )}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 pt-0.5">
              {shouldCollapse && (
                <button
                  type="button"
                  className="ui-action-button text-[11px]"
                  aria-expanded={expanded}
                  onClick={() => setExpanded(current => !current)}
                >
                  {expanded ? 'Hide summary' : 'Show summary'}
                </button>
              )}
              <span className="flex-1" />
              {replySelectionActions && <ReplySelectionInlineActions onReply={replySelectionActions.onReply} onCopy={replySelectionActions.onCopy} />}
              <MsgActions />
            </div>
          </div>
        </div>
      </SurfacePanel>
    </div>
  );
}

function StreamingIndicator({ label }: { label: string }) {
  return (
    <div className="flex gap-3 items-start" role="status" aria-live="polite">
      <div className="ui-chat-avatar mt-0.5">
        <span className="ui-chat-avatar-mark">pa</span>
      </div>
      <div className="flex items-center gap-2 pt-1 text-[12px] text-secondary italic">
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent animate-pulse not-italic" />
        <span>{label}</span>
      </div>
    </div>
  );
}

type ChatViewPerformanceMode = 'default' | 'aggressive';
type ChatViewLayout = 'default' | 'companion';

const CHAT_VIEW_RENDERING_PROFILE: Record<ChatViewPerformanceMode, {
  contentVisibilityThreshold: number;
  windowingThreshold: number;
  windowingChunkSize: number;
  windowingOverscanChunks: number;
}> = {
  default: {
    contentVisibilityThreshold: 120,
    windowingThreshold: 240,
    windowingChunkSize: 80,
    windowingOverscanChunks: 2,
  },
  aggressive: {
    contentVisibilityThreshold: 48,
    windowingThreshold: 96,
    windowingChunkSize: 40,
    windowingOverscanChunks: 1,
  },
};

const CHAT_WINDOWING_FALLBACK_SPAN_HEIGHT = 96;

interface ChatRenderChunk {
  key: string;
  items: ChatRenderItem[];
  startItemIndex: number;
  endItemIndex: number;
  startMessageIndex: number;
  endMessageIndex: number;
  spanCount: number;
}

function getChatRenderItemAbsoluteRange(item: ChatRenderItem, messageIndexOffset: number): { start: number; end: number } {
  if (item.type === 'trace_cluster') {
    return {
      start: messageIndexOffset + item.startIndex,
      end: messageIndexOffset + item.endIndex,
    };
  }

  return {
    start: messageIndexOffset + item.index,
    end: messageIndexOffset + item.index,
  };
}

function buildChatRenderChunks(
  renderItems: ChatRenderItem[],
  messageIndexOffset: number,
  chunkSize: number,
): ChatRenderChunk[] {
  const chunks: ChatRenderChunk[] = [];

  for (let startItemIndex = 0; startItemIndex < renderItems.length; startItemIndex += chunkSize) {
    const items = renderItems.slice(startItemIndex, startItemIndex + chunkSize);
    const startRange = getChatRenderItemAbsoluteRange(items[0], messageIndexOffset);
    const endRange = getChatRenderItemAbsoluteRange(items[items.length - 1], messageIndexOffset);
    const spanCount = items.reduce((count, item) => {
      const range = getChatRenderItemAbsoluteRange(item, messageIndexOffset);
      return count + (range.end - range.start + 1);
    }, 0);
    chunks.push({
      key: `${startRange.start}-${endRange.end}-${items.length}`,
      items,
      startItemIndex,
      endItemIndex: startItemIndex + items.length - 1,
      startMessageIndex: startRange.start,
      endMessageIndex: endRange.end,
      spanCount,
    });
  }

  return chunks;
}

function resolveChunkIndexForOffset(offset: number, chunkTops: number[], chunkHeights: number[]): number {
  for (let index = 0; index < chunkTops.length; index += 1) {
    if (offset < chunkTops[index] + chunkHeights[index]) {
      return index;
    }
  }

  return Math.max(0, chunkTops.length - 1);
}

function formatWindowingCount(value: number): string {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}m`;
  }

  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}k`;
  }

  return String(value);
}

function WindowedChatChunk({
  chunk,
  renderItem,
  onHeightChange,
  includeTrailingGap,
}: {
  chunk: ChatRenderChunk;
  renderItem: (item: ChatRenderItem, itemIndex: number) => ReactNode;
  onHeightChange: (chunkKey: string, height: number) => void;
  includeTrailingGap: boolean;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }

    const measure = () => {
      onHeightChange(chunk.key, element.getBoundingClientRect().height);
    };

    measure();
    const observer = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => measure())
      : null;
    observer?.observe(element);

    return () => {
      observer?.disconnect();
    };
  }, [chunk.key, includeTrailingGap, onHeightChange]);

  return (
    <div ref={ref} className={includeTrailingGap ? 'space-y-4 pb-4' : 'space-y-4'}>
      {chunk.items.map((item, itemIndex) => renderItem(item, chunk.startItemIndex + itemIndex))}
    </div>
  );
}

// ── ChatView ──────────────────────────────────────────────────────────────────

interface ChatViewProps {
  messages: MessageBlock[];
  messageIndexOffset?: number;
  scrollContainerRef?: RefObject<HTMLDivElement>;
  focusMessageIndex?: number | null;
  isStreaming?: boolean;
  pendingStatusLabel?: string | null;
  performanceMode?: ChatViewPerformanceMode;
  layout?: ChatViewLayout;
  onForkMessage?: (messageIndex: number) => Promise<void> | void;
  onRewindMessage?: (messageIndex: number) => Promise<void> | void;
  onReplyToSelection?: (selection: { text: string; messageIndex: number; blockId?: string }) => Promise<void> | void;
  onHydrateMessage?: (blockId: string) => Promise<void> | void;
  hydratingMessageBlockIds?: ReadonlySet<string>;
  onOpenArtifact?: (artifactId: string) => void;
  activeArtifactId?: string | null;
  onOpenRun?: (runId: string) => void;
  activeRunId?: string | null;
  onOpenFilePath?: (path: string) => void;
  onSubmitAskUserQuestion?: (presentation: AskUserQuestionPresentation, answers: AskUserQuestionAnswers) => Promise<void> | void;
  askUserQuestionDisplayMode?: 'inline' | 'composer';
  onResumeConversation?: () => Promise<void> | void;
  resumeConversationBusy?: boolean;
  resumeConversationTitle?: string | null;
  resumeConversationLabel?: string;
}

export const ChatView = memo(function ChatView({
  messages,
  messageIndexOffset = 0,
  scrollContainerRef,
  focusMessageIndex = null,
  isStreaming = false,
  pendingStatusLabel = null,
  performanceMode = 'default',
  layout = 'default',
  onForkMessage,
  onRewindMessage,
  onReplyToSelection,
  onHydrateMessage,
  hydratingMessageBlockIds,
  onOpenArtifact,
  activeArtifactId,
  onOpenRun,
  activeRunId,
  onOpenFilePath,
  onSubmitAskUserQuestion,
  askUserQuestionDisplayMode = 'inline',
  onResumeConversation,
  resumeConversationBusy = false,
  resumeConversationTitle,
  resumeConversationLabel = 'resume',
}: ChatViewProps) {
  const renderItems = useMemo(() => buildChatRenderItems(messages), [messages]);
  const streamingStatusLabel = pendingStatusLabel ?? getStreamingStatusLabel(messages, isStreaming);
  const renderingProfile = CHAT_VIEW_RENDERING_PROFILE[performanceMode];
  const lastBlock = messages[messages.length - 1];
  const showStreamingIndicator = !!streamingStatusLabel && (Boolean(pendingStatusLabel) || !lastBlock || lastBlock.type === 'user');
  const shouldUseContentVisibility = renderItems.length >= renderingProfile.contentVisibilityThreshold;
  const [contentVisibilityReady, setContentVisibilityReady] = useState(false);

  useEffect(() => {
    if (!shouldUseContentVisibility) {
      setContentVisibilityReady(false);
      return;
    }

    // Let the transcript fully lay out once before enabling content-visibility.
    // Initial scroll-to-bottom logic depends on an accurate scrollHeight.
    const animationFrame = window.requestAnimationFrame(() => {
      setContentVisibilityReady(true);
    });

    return () => {
      window.cancelAnimationFrame(animationFrame);
    };
  }, [shouldUseContentVisibility]);

  const contentVisibilityStyle = useMemo<React.CSSProperties | undefined>(
    () => (shouldUseContentVisibility && contentVisibilityReady ? { contentVisibility: 'auto' } : undefined),
    [contentVisibilityReady, shouldUseContentVisibility],
  );

  const shouldWindowTranscript = Boolean(scrollContainerRef) && renderItems.length >= renderingProfile.windowingThreshold;
  const renderChunks = useMemo(
    () => (shouldWindowTranscript ? buildChatRenderChunks(renderItems, messageIndexOffset, renderingProfile.windowingChunkSize) : []),
    [messageIndexOffset, renderItems, renderingProfile.windowingChunkSize, shouldWindowTranscript],
  );
  const [viewport, setViewport] = useState<{ scrollTop: number; clientHeight: number } | null>(null);
  const [chunkHeights, setChunkHeights] = useState<Record<string, number>>({});
  const [replySelection, setReplySelection] = useState<ReplySelectionState | null>(null);
  const replySelectionSyncFrameRef = useRef<number | null>(null);
  const replySelectionSyncTimeoutRefs = useRef<number[]>([]);
  const replySelectionClearTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    if (!shouldWindowTranscript) {
      setViewport(null);
      return;
    }

    const scrollEl = scrollContainerRef?.current;
    if (!scrollEl) {
      return;
    }

    let frame = 0;
    const sync = () => {
      frame = 0;
      const next = {
        scrollTop: scrollEl.scrollTop,
        clientHeight: scrollEl.clientHeight,
      };
      setViewport((current) => (
        current && current.scrollTop === next.scrollTop && current.clientHeight === next.clientHeight
          ? current
          : next
      ));
    };
    const scheduleSync = () => {
      if (frame !== 0) {
        return;
      }

      frame = window.requestAnimationFrame(sync);
    };

    scheduleSync();
    scrollEl.addEventListener('scroll', scheduleSync, { passive: true });
    window.addEventListener('resize', scheduleSync);

    return () => {
      scrollEl.removeEventListener('scroll', scheduleSync);
      window.removeEventListener('resize', scheduleSync);
      if (frame !== 0) {
        window.cancelAnimationFrame(frame);
      }
    };
  }, [shouldWindowTranscript, scrollContainerRef]);

  const averageSpanHeight = useMemo(() => {
    const measurements = renderChunks
      .map((chunk) => ({ height: chunkHeights[chunk.key], spanCount: chunk.spanCount }))
      .filter((entry): entry is { height: number; spanCount: number } => typeof entry.height === 'number' && entry.height > 0 && entry.spanCount > 0);

    if (measurements.length === 0) {
      return CHAT_WINDOWING_FALLBACK_SPAN_HEIGHT;
    }

    const totalHeight = measurements.reduce((sum, entry) => sum + entry.height, 0);
    const totalSpans = measurements.reduce((sum, entry) => sum + entry.spanCount, 0);
    return totalSpans > 0 ? totalHeight / totalSpans : CHAT_WINDOWING_FALLBACK_SPAN_HEIGHT;
  }, [chunkHeights, renderChunks]);

  const chunkLayouts = useMemo(() => {
    let top = 0;
    return renderChunks.map((chunk) => {
      const estimatedHeight = Math.max(1, chunk.spanCount * averageSpanHeight);
      const height = chunkHeights[chunk.key] ?? estimatedHeight;
      const layout = {
        ...chunk,
        top,
        height,
        bottom: top + height,
      };
      top += height;
      return layout;
    });
  }, [averageSpanHeight, chunkHeights, renderChunks]);

  const updateChunkHeight = useCallback((chunkKey: string, height: number) => {
    setChunkHeights((current) => (current[chunkKey] === height ? current : { ...current, [chunkKey]: height }));
  }, []);

  const clearScheduledReplySelectionSync = useCallback(() => {
    if (typeof window === 'undefined') {
      return;
    }

    if (replySelectionSyncFrameRef.current !== null) {
      window.cancelAnimationFrame(replySelectionSyncFrameRef.current);
      replySelectionSyncFrameRef.current = null;
    }

    if (replySelectionSyncTimeoutRefs.current.length > 0) {
      for (const timeoutId of replySelectionSyncTimeoutRefs.current) {
        window.clearTimeout(timeoutId);
      }
      replySelectionSyncTimeoutRefs.current = [];
    }
  }, []);

  const cancelReplySelectionClear = useCallback(() => {
    if (typeof window === 'undefined') {
      return;
    }

    if (replySelectionClearTimeoutRef.current !== null) {
      window.clearTimeout(replySelectionClearTimeoutRef.current);
      replySelectionClearTimeoutRef.current = null;
    }
  }, []);

  const scheduleReplySelectionClear = useCallback(() => {
    if (typeof window === 'undefined') {
      setReplySelection((current) => (current ? null : current));
      return;
    }

    cancelReplySelectionClear();
    replySelectionClearTimeoutRef.current = window.setTimeout(() => {
      replySelectionClearTimeoutRef.current = null;
      setReplySelection((current) => (current ? null : current));
    }, 140);
  }, [cancelReplySelectionClear]);

  const applyReplySelectionForScope = useCallback((scopeElement: HTMLElement | null) => {
    if (!scopeElement) {
      scheduleReplySelectionClear();
      return;
    }

    const text = readSelectedTextWithinElement(scopeElement);
    if (!text) {
      scheduleReplySelectionClear();
      return;
    }

    const messageIndex = Number.parseInt(scopeElement.dataset.messageIndex ?? '', 10);
    if (!Number.isFinite(messageIndex)) {
      scheduleReplySelectionClear();
      return;
    }

    cancelReplySelectionClear();

    const blockId = scopeElement.dataset.blockId?.trim() || undefined;
    setReplySelection((current) => {
      if (
        current
        && current.text === text
        && current.messageIndex === messageIndex
        && current.blockId === blockId
      ) {
        return current;
      }

      return { text, messageIndex, blockId };
    });
  }, [cancelReplySelectionClear, scheduleReplySelectionClear]);

  const syncReplySelectionFromSelection = useCallback(() => {
    if (typeof window === 'undefined') {
      scheduleReplySelectionClear();
      return;
    }

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      scheduleReplySelectionClear();
      return;
    }

    const range = selection.getRangeAt(0);
    const { startScope, endScope } = findSelectionReplyScopeElements(selection, range);
    if (!startScope || startScope !== endScope) {
      scheduleReplySelectionClear();
      return;
    }

    applyReplySelectionForScope(startScope);
  }, [applyReplySelectionForScope, scheduleReplySelectionClear]);

  const scheduleReplySelectionSync = useCallback((scopeElement?: HTMLElement | null) => {
    if (typeof window === 'undefined' || !onReplyToSelection) {
      clearScheduledReplySelectionSync();
      cancelReplySelectionClear();
      setReplySelection((current) => (current ? null : current));
      return;
    }

    const sync = () => {
      if (scopeElement) {
        applyReplySelectionForScope(scopeElement);
        return;
      }

      syncReplySelectionFromSelection();
    };

    clearScheduledReplySelectionSync();

    replySelectionSyncFrameRef.current = window.requestAnimationFrame(() => {
      replySelectionSyncFrameRef.current = null;
      sync();
    });

    for (const delayMs of [40, 120, 240]) {
      const timeoutId = window.setTimeout(() => {
        replySelectionSyncTimeoutRefs.current = replySelectionSyncTimeoutRefs.current.filter((currentId) => currentId !== timeoutId);
        sync();
      }, delayMs);
      replySelectionSyncTimeoutRefs.current.push(timeoutId);
    }
  }, [applyReplySelectionForScope, cancelReplySelectionClear, clearScheduledReplySelectionSync, onReplyToSelection, syncReplySelectionFromSelection]);

  useEffect(() => {
    if (typeof document === 'undefined' || typeof window === 'undefined' || !onReplyToSelection) {
      clearScheduledReplySelectionSync();
      cancelReplySelectionClear();
      setReplySelection(null);
      return;
    }

    const fallbackIntervalId = window.setInterval(() => {
      syncReplySelectionFromSelection();
    }, 180);
    const handleDocumentReplySelectionSync = () => {
      scheduleReplySelectionSync();
    };
    const handleFocus = () => {
      scheduleReplySelectionSync();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        scheduleReplySelectionSync();
        return;
      }

      scheduleReplySelectionClear();
    };

    document.addEventListener('selectionchange', handleDocumentReplySelectionSync);
    document.addEventListener('mouseup', handleDocumentReplySelectionSync);
    document.addEventListener('pointerup', handleDocumentReplySelectionSync);
    document.addEventListener('keyup', handleDocumentReplySelectionSync);
    document.addEventListener('touchend', handleDocumentReplySelectionSync);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleFocus);
    window.addEventListener('pageshow', handleFocus);

    return () => {
      window.clearInterval(fallbackIntervalId);
      document.removeEventListener('selectionchange', handleDocumentReplySelectionSync);
      document.removeEventListener('mouseup', handleDocumentReplySelectionSync);
      document.removeEventListener('pointerup', handleDocumentReplySelectionSync);
      document.removeEventListener('keyup', handleDocumentReplySelectionSync);
      document.removeEventListener('touchend', handleDocumentReplySelectionSync);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('pageshow', handleFocus);
      clearScheduledReplySelectionSync();
      cancelReplySelectionClear();
    };
  }, [cancelReplySelectionClear, clearScheduledReplySelectionSync, onReplyToSelection, scheduleReplySelectionClear, scheduleReplySelectionSync, syncReplySelectionFromSelection]);

  const handleReplySelection = useCallback(async () => {
    if (!replySelection || !onReplyToSelection) {
      return;
    }

    setReplySelection(null);
    clearWindowSelection();
    await onReplyToSelection({
      text: replySelection.text,
      messageIndex: replySelection.messageIndex,
      blockId: replySelection.blockId,
    });
  }, [onReplyToSelection, replySelection]);

  const handleCopyReplySelection = useCallback(async () => {
    if (!replySelection || typeof navigator === 'undefined' || typeof navigator.clipboard?.writeText !== 'function') {
      setReplySelection(null);
      clearWindowSelection();
      return;
    }

    try {
      await navigator.clipboard.writeText(replySelection.text);
    } finally {
      clearWindowSelection();
      setReplySelection(null);
    }
  }, [replySelection]);

  const renderChatItem = useCallback((item: ChatRenderItem, itemIndex: number) => {
    const isTailItem = itemIndex === renderItems.length - 1;

    if (item.type === 'trace_cluster') {
      const live = isStreaming && isTailItem;

      return (
        <div key={`trace-${messageIndexOffset + item.startIndex}-${messageIndexOffset + item.endIndex}`} style={contentVisibilityStyle}>
          {item.blocks.map((_, offset) => {
            const absoluteIndex = messageIndexOffset + item.startIndex + offset;
            return <span key={`anchor-${absoluteIndex}`} id={`msg-${absoluteIndex}`} className="block h-0 overflow-hidden" aria-hidden />;
          })}
          <TraceClusterBlock
            blocks={item.blocks}
            summary={item.summary}
            live={live}
            onOpenArtifact={onOpenArtifact}
            activeArtifactId={activeArtifactId}
            onOpenRun={onOpenRun}
            activeRunId={activeRunId}
            onOpenFilePath={onOpenFilePath}
            onResume={isTailItem ? onResumeConversation : undefined}
            resumeBusy={resumeConversationBusy}
            resumeTitle={resumeConversationTitle}
            resumeLabel={resumeConversationLabel}
          />
        </div>
      );
    }

    const block = item.block;
    const markerKind = block.type === 'user'
      ? 'user'
      : block.type === 'text' || (block.type === 'tool_use' && block.tool === 'ask_user_question')
        ? 'assistant'
        : undefined;
    const absoluteIndex = messageIndexOffset + item.index;
    const autoOpen = shouldAutoOpenConversationBlock(block, item.index, messages.length, isStreaming);
    const showStreamingCursor = isStreaming && block.type === 'text' && item.index === messages.length - 1;
    const replySelectionBlockId = block.id?.trim() || undefined;
    const replySelectionActions = hasActiveReplySelection(replySelection, absoluteIndex, replySelectionBlockId)
      ? {
          onReply: () => { void handleReplySelection(); },
          onCopy: () => { void handleCopyReplySelection(); },
        }
      : undefined;

    const el = (() => {
      switch (block.type) {
        case 'user':
          return (
            <UserMessage
              block={block}
              onRewind={onRewindMessage ? () => onRewindMessage(absoluteIndex) : undefined}
              onHydrateMessage={onHydrateMessage}
              hydratingMessageBlockIds={hydratingMessageBlockIds}
              onOpenFilePath={onOpenFilePath}
              layout={layout}
            />
          );
        case 'text':
          return (
            <AssistantMessage
              block={block}
              messageIndex={absoluteIndex}
              showCursor={showStreamingCursor}
              onRewind={onRewindMessage ? () => onRewindMessage(absoluteIndex) : undefined}
              onFork={onForkMessage ? () => onForkMessage(absoluteIndex) : undefined}
              onOpenFilePath={onOpenFilePath}
              onSelectionGesture={onReplyToSelection ? scheduleReplySelectionSync : undefined}
              replySelectionActions={replySelectionActions}
              layout={layout}
            />
          );
        case 'context':
          return <ContextMessage block={block} messageIndex={absoluteIndex} onOpenFilePath={onOpenFilePath} onSelectionGesture={onReplyToSelection ? scheduleReplySelectionSync : undefined} replySelectionActions={replySelectionActions} />;
        case 'summary':
          return <SummaryMessage block={block} messageIndex={absoluteIndex} onOpenFilePath={onOpenFilePath} onSelectionGesture={onReplyToSelection ? scheduleReplySelectionSync : undefined} replySelectionActions={replySelectionActions} />;
        case 'thinking':
          return <ThinkingBlock block={block} autoOpen={autoOpen} />;
        case 'tool_use':
          return (
            <ToolBlock
              block={block}
              autoOpen={autoOpen}
              onOpenArtifact={onOpenArtifact}
              activeArtifactId={activeArtifactId}
              onOpenRun={onOpenRun}
              activeRunId={activeRunId}
              onOpenFilePath={onOpenFilePath}
              onHydrateMessage={onHydrateMessage}
              hydratingMessageBlockIds={hydratingMessageBlockIds}
              messages={messages}
              messageIndex={item.index}
              onSubmitAskUserQuestion={onSubmitAskUserQuestion}
              askUserQuestionDisplayMode={askUserQuestionDisplayMode}
            />
          );
        case 'subagent':
          return <SubagentBlock block={block} />;
        case 'image':
          return <ImageBlock block={block} onHydrateMessage={onHydrateMessage} hydratingMessageBlockIds={hydratingMessageBlockIds} />;
        case 'error':
          return (
            <ErrorBlock
              block={block}
              messageIndex={absoluteIndex}
              onResume={isTailItem ? onResumeConversation : undefined}
              resumeBusy={resumeConversationBusy}
              resumeTitle={resumeConversationTitle}
              resumeLabel={resumeConversationLabel}
              onOpenFilePath={onOpenFilePath}
              onSelectionGesture={onReplyToSelection ? scheduleReplySelectionSync : undefined}
              replySelectionActions={replySelectionActions}
            />
          );
        default:
          return null;
      }
    })();

    return el ? (
      <div
        key={absoluteIndex}
        id={`msg-${absoluteIndex}`}
        data-message-index={absoluteIndex}
        data-conversation-rail-kind={markerKind}
        style={contentVisibilityStyle}
      >
        {el}
      </div>
    ) : null;
  }, [activeArtifactId, activeRunId, askUserQuestionDisplayMode, contentVisibilityStyle, handleCopyReplySelection, handleReplySelection, hydratingMessageBlockIds, isStreaming, layout, messageIndexOffset, messages, messages.length, onForkMessage, onHydrateMessage, onOpenArtifact, onOpenFilePath, onOpenRun, onReplyToSelection, onSubmitAskUserQuestion, onResumeConversation, onRewindMessage, renderItems.length, replySelection, resumeConversationBusy, resumeConversationLabel, resumeConversationTitle, scheduleReplySelectionSync]);

  const visibleChunkRange = useMemo(() => {
    if (!shouldWindowTranscript || chunkLayouts.length === 0) {
      return null;
    }

    const totalHeight = chunkLayouts[chunkLayouts.length - 1]?.bottom ?? 0;
    const tops = chunkLayouts.map((chunk) => chunk.top);
    const heights = chunkLayouts.map((chunk) => chunk.height);
    const focusChunkIndex = focusMessageIndex === null
      ? -1
      : chunkLayouts.findIndex((chunk) => focusMessageIndex >= chunk.startMessageIndex && focusMessageIndex <= chunk.endMessageIndex);

    let startChunkIndex: number;
    let endChunkIndex: number;

    if (viewport === null) {
      const anchorChunkIndex = focusChunkIndex >= 0 ? focusChunkIndex : chunkLayouts.length - 1;
      startChunkIndex = Math.max(0, anchorChunkIndex - renderingProfile.windowingOverscanChunks);
      endChunkIndex = Math.min(chunkLayouts.length - 1, anchorChunkIndex + renderingProfile.windowingOverscanChunks);
    } else {
      const viewportTop = Math.max(0, viewport.scrollTop);
      const viewportBottom = viewportTop + Math.max(1, viewport.clientHeight);
      const firstVisibleChunkIndex = resolveChunkIndexForOffset(viewportTop, tops, heights);
      const lastVisibleChunkIndex = resolveChunkIndexForOffset(viewportBottom, tops, heights);
      startChunkIndex = Math.max(0, firstVisibleChunkIndex - renderingProfile.windowingOverscanChunks);
      endChunkIndex = Math.min(chunkLayouts.length - 1, lastVisibleChunkIndex + renderingProfile.windowingOverscanChunks);

      if (focusChunkIndex >= 0 && (focusChunkIndex < startChunkIndex || focusChunkIndex > endChunkIndex)) {
        startChunkIndex = Math.max(0, focusChunkIndex - renderingProfile.windowingOverscanChunks);
        endChunkIndex = Math.min(chunkLayouts.length - 1, focusChunkIndex + renderingProfile.windowingOverscanChunks);
      }
    }

    const topSpacerHeight = startChunkIndex > 0 ? chunkLayouts[startChunkIndex].top : 0;
    const bottomSpacerHeight = endChunkIndex < chunkLayouts.length - 1
      ? Math.max(0, totalHeight - chunkLayouts[endChunkIndex].bottom)
      : 0;

    return {
      chunks: chunkLayouts.slice(startChunkIndex, endChunkIndex + 1),
      topSpacerHeight,
      bottomSpacerHeight,
    };
  }, [chunkLayouts, focusMessageIndex, renderingProfile.windowingOverscanChunks, shouldWindowTranscript, viewport]);

  const fullTranscript = (
    <div className="space-y-4">
      {renderItems.map((item, itemIndex) => renderChatItem(item, itemIndex))}
    </div>
  );

  const windowedTranscript = visibleChunkRange ? (
    <>
      {visibleChunkRange.topSpacerHeight > 0 && <div style={{ height: visibleChunkRange.topSpacerHeight }} aria-hidden />}
      {visibleChunkRange.chunks.map((chunk) => (
        <WindowedChatChunk
          key={chunk.key}
          chunk={chunk}
          renderItem={renderChatItem}
          onHeightChange={updateChunkHeight}
          includeTrailingGap={chunk.endItemIndex < renderItems.length - 1 || showStreamingIndicator}
        />
      ))}
      {visibleChunkRange.bottomSpacerHeight > 0 && <div style={{ height: visibleChunkRange.bottomSpacerHeight }} aria-hidden />}
    </>
  ) : fullTranscript;
  const mountedMessageCount = visibleChunkRange
    ? visibleChunkRange.chunks.reduce((sum, chunk) => sum + chunk.spanCount, 0)
    : messages.length;
  const mountedChunkCount = visibleChunkRange?.chunks.length ?? renderChunks.length;
  const windowingBadge = shouldWindowTranscript ? (
    <div className="sticky top-3 z-10 mb-3 flex justify-end pointer-events-none">
      <div className="inline-flex min-h-[2rem] items-center gap-2 rounded-lg border border-border-subtle bg-surface/88 px-3 py-1.5 text-[10px] text-secondary shadow-sm backdrop-blur">
        <span className="font-medium uppercase tracking-[0.16em] text-primary/85">windowing</span>
        <span>{formatWindowingCount(messages.length)} loaded</span>
        <span className="text-dim">·</span>
        <span>{formatWindowingCount(mountedMessageCount)} mounted</span>
        <span className="text-dim">·</span>
        <span>{mountedChunkCount}/{renderChunks.length} chunks</span>
      </div>
    </div>
  ) : null;
  return (
    <>
      <style>{`@keyframes cursorBlink { 0%,100%{opacity:1} 50%{opacity:0} }`}</style>
      <div className={layout === 'companion' ? 'px-2.5 py-3 sm:px-4 sm:py-4' : 'pl-6 pr-10 py-5'}>
        {windowingBadge}
        {shouldWindowTranscript ? windowedTranscript : fullTranscript}
        {showStreamingIndicator && (
          <div className={shouldWindowTranscript && visibleChunkRange?.chunks.length ? '' : 'mt-4'}>
            <StreamingIndicator label={streamingStatusLabel ?? 'Working…'} />
          </div>
        )}
      </div>
    </>
  );
});

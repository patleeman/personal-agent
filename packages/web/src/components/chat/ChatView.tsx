import React, { Children, cloneElement, isValidElement, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactElement, type ReactNode, type RefObject } from 'react';
import ReactMarkdown from 'react-markdown';
import { parseSkillBlock, type ParsedSkillBlock } from '../../skillBlock';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import { readArtifactPresentation } from '../../conversationArtifacts';
import { extractDurableRunIdsFromBlock } from '../../conversationRuns';
import type { MessageBlock } from '../../types';
import { timeAgo } from '../../utils';
import { extractMarkdownTextContent, InlineMarkdownCode } from '../MarkdownInlineCode';
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

function renderMentionFragments(text: string): ReactNode[] {
  return splitMentionFragments(text).map((fragment, index) => {
    if (fragment.mention) {
      return <MentionPill key={`${fragment.text}-${index}`} text={fragment.text} />;
    }

    return <React.Fragment key={`${index}-${fragment.text}`}>{fragment.text}</React.Fragment>;
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

function renderChildrenWithMentions(children: ReactNode): ReactNode {
  return Children.map(children, (child, index) => {
    if (typeof child === 'string') {
      return <React.Fragment key={index}>{renderMentionFragments(child)}</React.Fragment>;
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

    return cloneElement(child as ReactElement<{ children?: ReactNode }>, undefined, renderChildrenWithMentions(props.children));
  });
}

function MarkdownCodeBlock({ children }: { children: ReactNode }) {
  const { className, content } = extractMarkdownCodeBlock(children);

  return (
    <div className="ui-markdown-code-block">
      <pre>
        <code className={className}>{content}</code>
      </pre>
    </div>
  );
}

function renderMarkdownText(text: string) {
  return (
    <div className="ui-markdown">
      <ReactMarkdown
        remarkPlugins={MARKDOWN_REMARK_PLUGINS}
        components={{
          h1: ({ children }) => <h1>{renderChildrenWithMentions(children)}</h1>,
          h2: ({ children }) => <h2>{renderChildrenWithMentions(children)}</h2>,
          h3: ({ children }) => <h3>{renderChildrenWithMentions(children)}</h3>,
          h4: ({ children }) => <h4>{renderChildrenWithMentions(children)}</h4>,
          h5: ({ children }) => <h5>{renderChildrenWithMentions(children)}</h5>,
          h6: ({ children }) => <h6>{renderChildrenWithMentions(children)}</h6>,
          p: ({ children }) => <p>{renderChildrenWithMentions(children)}</p>,
          li: ({ children }) => <li>{renderChildrenWithMentions(children)}</li>,
          th: ({ children, style }) => <th style={style}>{renderChildrenWithMentions(children)}</th>,
          td: ({ children, style }) => <td style={style}>{renderChildrenWithMentions(children)}</td>,
          a: ({ href, children, title }) => {
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
          pre: ({ children }) => <MarkdownCodeBlock>{children}</MarkdownCodeBlock>,
          code: ({ className, children }) => <InlineMarkdownCode className={className}>{children}</InlineMarkdownCode>,
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
}: {
  skillBlock: ParsedSkillBlock;
  className?: string;
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
        {renderMarkdownText(`**${skillBlock.name}**\n\n${body}`)}
      </div>
    </details>
  );
}

function renderSkillAwareText(text: string) {
  const skillBlock = parseSkillBlock(text);
  if (!skillBlock) {
    return renderMarkdownText(text);
  }

  return (
    <div className="space-y-3">
      <SkillInvocationCard skillBlock={skillBlock} />
      {skillBlock.userMessage && renderMarkdownText(skillBlock.userMessage)}
    </div>
  );
}

export function renderText(text: string) {
  return renderSkillAwareText(text);
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

// ── Tool icon & color ─────────────────────────────────────────────────────────

const TOOL_META: Record<string, { icon: string; label: string; color: string; tone: 'steel' | 'teal' | 'accent' | 'success' | 'warning' | 'muted' }> = {
  bash:        { icon: '$',  label: 'bash',            color: 'text-steel border-steel/25 bg-steel/5',         tone: 'steel' },
  read:        { icon: '≡',  label: 'read',            color: 'text-teal border-teal/25 bg-teal/5',            tone: 'teal' },
  write:       { icon: '✎', label: 'write',           color: 'text-accent border-accent/25 bg-accent/5',      tone: 'accent' },
  edit:        { icon: '✎', label: 'edit',            color: 'text-accent border-accent/25 bg-accent/5',      tone: 'accent' },
  web_search:  { icon: '⌕',  label: 'web_search',      color: 'text-success border-success/25 bg-success/5',   tone: 'success' },
  web_fetch:   { icon: '⌕',  label: 'web_fetch',       color: 'text-success border-success/25 bg-success/5',   tone: 'success' },
  screenshot:  { icon: '⊡',  label: 'screenshot',      color: 'text-secondary border-border-default bg-elevated', tone: 'muted' },
  artifact:    { icon: '◫',  label: 'artifact',        color: 'text-accent border-accent/25 bg-accent/5',      tone: 'accent' },
  deferred_resume: { icon: '⏰', label: 'deferred_resume', color: 'text-warning border-warning/25 bg-warning/5', tone: 'warning' },
};
function toolMeta(t: string) {
  return TOOL_META[t] ?? { icon: '⚙', label: t, color: 'text-secondary border-border-default bg-elevated', tone: 'muted' as const };
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

function ToolBlock({
  block,
  autoOpen,
  onOpenArtifact,
  activeArtifactId,
  onOpenRun,
  activeRunId,
  onHydrateMessage,
  hydratingMessageBlockIds,
}: {
  block: Extract<MessageBlock, { type: 'tool_use' }>;
  autoOpen: boolean;
  onOpenArtifact?: (artifactId: string) => void;
  activeArtifactId?: string | null;
  onOpenRun?: (runId: string) => void;
  activeRunId?: string | null;
  onHydrateMessage?: (blockId: string) => Promise<void> | void;
  hydratingMessageBlockIds?: ReadonlySet<string>;
}) {
  const [preference, setPreference] = useState<DisclosurePreference>('auto');
  const open = resolveDisclosureOpen(autoOpen, preference);
  const meta = toolMeta(block.tool);
  const artifact = readArtifactPresentation(block);
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
    <div className={cx('rounded-xl border text-[12px] font-mono overflow-hidden transition-colors', meta.color, isError && 'border-danger/40 bg-danger/5 text-danger')}>
      <button
        onClick={() => setPreference((current) => toggleDisclosurePreference(autoOpen, current))}
        className="w-full flex items-center gap-2 px-3 py-2.5 hover:bg-black/5 transition-colors text-left"
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
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-inherit bg-black/5 px-3 py-2 text-[11px]">
          <span className="uppercase tracking-[0.14em] opacity-40">runs</span>
          {runIds.map((runId) => {
            const isActiveRun = activeRunId === runId;
            return (
              <button
                key={runId}
                type="button"
                onClick={() => { onOpenRun?.(runId); }}
                disabled={!onOpenRun}
                className={cx(
                  'font-mono transition-colors',
                  isActiveRun ? 'text-primary' : 'text-accent hover:text-accent/80',
                  !onOpenRun && 'cursor-default text-dim',
                )}
                title={runId}
              >
                {isActiveRun ? 'opened' : 'inspect'} {runId}
              </button>
            );
          })}
        </div>
      )}

      {open && (
        <div className="border-t border-inherit">
          <div className="px-3 py-2.5 bg-black/5">
            <p className="text-[10px] uppercase tracking-wider opacity-40 mb-1">input</p>
            <pre className="whitespace-pre-wrap break-all text-[11px] leading-relaxed opacity-75">
              {JSON.stringify(block.input, null, 2)}
            </pre>
          </div>
          {(isRunning || output || outputDeferred) && (
            <div className={cx('px-3 py-2.5', isRunning && output && 'max-h-40 overflow-y-auto')}>
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
                <pre className="whitespace-pre-wrap break-all text-[11px] leading-relaxed opacity-75">
                  {output}
                </pre>
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
    <SurfacePanel muted className="overflow-hidden text-[12px]">
      <button
        onClick={() => setPreference((current) => toggleDisclosurePreference(autoOpen, current))}
        className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-elevated transition-colors"
      >
        <span className="text-dim select-none">💭</span>
        <Pill tone="muted">Thinking</Pill>
        <span className="flex-1" />
        {autoOpen && <span className="text-[10px] uppercase tracking-[0.14em] text-dim/55">live</span>}
        <span className="text-dim text-[10px]">{open ? '▲ hide' : '▼ show'}</span>
      </button>
      {open && (
        <div className="px-3 pb-3 pt-2 border-t border-border-subtle text-secondary italic leading-relaxed space-y-1">
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
    <div className={`rounded-xl border overflow-hidden text-[12px] ${clr}`}>
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-black/5 transition-colors"
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
        <div className="border-t border-inherit px-3 py-2.5 space-y-2 bg-black/5">
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

function TraceClusterBlock({
  blocks,
  summary,
  live,
  onOpenArtifact,
  activeArtifactId,
  onOpenRun,
  activeRunId,
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
  onResume?: () => Promise<void> | void;
  resumeBusy?: boolean;
  resumeTitle?: string | null;
  resumeLabel?: string;
}) {
  const [preference, setPreference] = useState<DisclosurePreference>('auto');
  const expandedCategories = summary.categories.slice(0, 3);
  const remainingCategoryCount = Math.max(0, summary.categories.length - expandedCategories.length);
  const durationLabel = summary.durationMs && summary.durationMs > 0
    ? `${(summary.durationMs / 1000).toFixed(1)}s`
    : null;
  const isActive = live || summary.hasRunning;
  const title = isActive ? 'Working' : 'Internal work';
  const autoOpen = shouldAutoOpenTraceCluster(live, summary.hasRunning);
  const open = resolveDisclosureOpen(autoOpen, preference);
  const panelClassName = cx(
    'flex-1 rounded-xl border px-3 py-2.5 text-left transition-colors',
    summary.hasError
      ? 'border-danger/30 bg-danger/5 hover:bg-danger/10'
      : 'border-border-subtle bg-elevated/60 hover:bg-elevated',
  );

  return (
    <div className="space-y-2">
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
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
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
        <div className="ml-3 space-y-2 border-l border-border-subtle pl-3">
          {blocks.map((block, index) => {
            const autoOpen = shouldAutoOpenConversationBlock(block, index, blocks.length, live);

            switch (block.type) {
              case 'thinking':
                return <ThinkingBlock key={`thinking-${index}`} block={block} autoOpen={autoOpen} />;
              case 'tool_use':
                return (
                  <ToolBlock
                    key={`tool-${index}`}
                    block={block}
                    autoOpen={autoOpen}
                    onOpenArtifact={onOpenArtifact}
                    activeArtifactId={activeArtifactId}
                    onOpenRun={onOpenRun}
                    activeRunId={activeRunId}
                  />
                );
              case 'subagent':
                return <SubagentBlock key={`subagent-${index}`} block={block} />;
              case 'error':
                return <ErrorBlock key={`error-${index}`} block={block} />;
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
  onResume,
  resumeBusy,
  resumeTitle,
  resumeLabel,
}: {
  block: Extract<MessageBlock, { type: 'error' }>;
  onResume?: () => Promise<void> | void;
  resumeBusy?: boolean;
  resumeTitle?: string | null;
  resumeLabel?: string;
}) {
  return (
    <SurfacePanel className="border-danger/30 bg-danger/5 px-3 py-2.5 text-[12px] font-mono flex gap-2 items-start">
      <span className="text-danger font-bold shrink-0 mt-0.5 select-none">✕</span>
      <div className="flex-1 min-w-0 space-y-2">
        <div>
          {block.tool && <span className="text-danger/70 font-semibold">{block.tool} · </span>}
          <span className="text-danger/85 leading-relaxed">{block.message}</span>
        </div>
        <ResumeConversationAction
          onResume={onResume}
          busy={resumeBusy}
          title={resumeTitle}
          label={resumeLabel}
          variant="inline"
        />
      </div>
    </SurfacePanel>
  );
}

// ── Message actions ───────────────────────────────────────────────────────────

function MsgActions({
  isUser,
  copyText,
  onFork,
  onRewind,
  onCheckpoint,
}: {
  isUser?: boolean;
  copyText?: string;
  onFork?: () => Promise<void> | void;
  onRewind?: () => Promise<void> | void;
  onCheckpoint?: () => Promise<void> | void;
}) {
  const [isForking, setIsForking] = useState(false);
  const [isRewinding, setIsRewinding] = useState(false);
  const [isSavingCheckpoint, setIsSavingCheckpoint] = useState(false);
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

  async function handleCheckpoint() {
    if (!onCheckpoint || isSavingCheckpoint) {
      return;
    }

    try {
      setIsSavingCheckpoint(true);
      await onCheckpoint();
    } finally {
      setIsSavingCheckpoint(false);
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
      {onCheckpoint && (
        <button
          type="button"
          onClick={() => { void handleCheckpoint(); }}
          className={cx('ui-action-button', isSavingCheckpoint && 'text-accent')}
          title="Distill conversation up to this point into durable memory"
          disabled={isSavingCheckpoint}
        >
          {isSavingCheckpoint ? '⟡ distilling…' : '⟡ distill'}
        </button>
      )}
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
  onCheckpoint,
  onRewind,
  onHydrateMessage,
  hydratingMessageBlockIds,
}: {
  block: Extract<MessageBlock, { type: 'user' }>;
  onCheckpoint?: () => Promise<void> | void;
  onRewind?: () => Promise<void> | void;
  onHydrateMessage?: (blockId: string) => Promise<void> | void;
  hydratingMessageBlockIds?: ReadonlySet<string>;
}) {
  const hasText = block.text.trim().length > 0;
  const skillBlock = hasText ? parseSkillBlock(block.text) : null;

  return (
    <div className="group flex flex-col items-end gap-1.5">
      <MsgActions isUser onCheckpoint={onCheckpoint} onRewind={onRewind} />
      <div className="max-w-[86%]">
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
              <SkillInvocationCard skillBlock={skillBlock} className="ui-skill-invocation-user" />
              {skillBlock.userMessage && renderMarkdownText(skillBlock.userMessage)}
            </div>
          ) : hasText ? (
            <div className="px-1.5 pb-0.5">
              {renderMarkdownText(block.text)}
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
  onFork,
  onRewind,
  onCheckpoint,
  showCursor = false,
}: {
  block: Extract<MessageBlock, { type: 'text' }>;
  onFork?: () => Promise<void> | void;
  onRewind?: () => Promise<void> | void;
  onCheckpoint?: () => Promise<void> | void;
  showCursor?: boolean;
}) {
  const shouldShowCursor = showCursor || !!block.streaming;

  return (
    <div className="group flex gap-3 items-start">
      <div className="ui-chat-avatar mt-0.5">
        <span className="ui-chat-avatar-mark">pa</span>
      </div>
      <div className="flex-1 min-w-0 space-y-1.5">
        <div className="ui-message-card-assistant text-primary space-y-1">
          {renderText(block.text)}
          {shouldShowCursor && (
            <span
              className="inline-block w-[2px] h-[14px] bg-accent ml-0.5 rounded-sm"
              style={{ animation: 'cursorBlink 1s step-end infinite', verticalAlign: 'text-bottom' }}
            />
          )}
        </div>
        <div className="flex items-center gap-2 pt-0.5">
          <p className="ui-message-meta">{timeAgo(block.ts)}</p>
          <MsgActions copyText={block.text} onCheckpoint={onCheckpoint} onRewind={onRewind} onFork={onFork} />
        </div>
      </div>
    </div>
  );
}

function SummaryMessage({
  block,
}: {
  block: Extract<MessageBlock, { type: 'summary' }>;
}) {
  const isCompaction = block.kind === 'compaction';
  const label = isCompaction ? 'Context compacted' : 'Branch summary';
  const detail = isCompaction
    ? 'Older turns were summarized to keep the active context window focused.'
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
            <p className="text-[12px] leading-relaxed text-secondary">{detail}</p>
            <div className="text-primary">
              {shouldCollapse && !expanded ? (
                <p className="whitespace-pre-wrap text-[12px] leading-relaxed text-primary">{previewText}</p>
              ) : (
                renderText(block.text)
              )}
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

const CHAT_WINDOWING_THRESHOLD = 240;
const CHAT_WINDOWING_CHUNK_SIZE = 80;
const CHAT_WINDOWING_OVERSCAN_CHUNKS = 2;
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

function buildChatRenderChunks(renderItems: ChatRenderItem[], messageIndexOffset: number): ChatRenderChunk[] {
  const chunks: ChatRenderChunk[] = [];

  for (let startItemIndex = 0; startItemIndex < renderItems.length; startItemIndex += CHAT_WINDOWING_CHUNK_SIZE) {
    const items = renderItems.slice(startItemIndex, startItemIndex + CHAT_WINDOWING_CHUNK_SIZE);
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
  onForkMessage?: (messageIndex: number) => Promise<void> | void;
  onRewindMessage?: (messageIndex: number) => Promise<void> | void;
  onCheckpointMessage?: (block: MessageBlock, messageIndex: number) => Promise<void> | void;
  onHydrateMessage?: (blockId: string) => Promise<void> | void;
  hydratingMessageBlockIds?: ReadonlySet<string>;
  onOpenArtifact?: (artifactId: string) => void;
  activeArtifactId?: string | null;
  onOpenRun?: (runId: string) => void;
  activeRunId?: string | null;
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
  onForkMessage,
  onRewindMessage,
  onCheckpointMessage,
  onHydrateMessage,
  hydratingMessageBlockIds,
  onOpenArtifact,
  activeArtifactId,
  onOpenRun,
  activeRunId,
  onResumeConversation,
  resumeConversationBusy = false,
  resumeConversationTitle,
  resumeConversationLabel = 'resume',
}: ChatViewProps) {
  const renderItems = useMemo(() => buildChatRenderItems(messages), [messages]);
  const streamingStatusLabel = getStreamingStatusLabel(messages, isStreaming);
  const lastBlock = messages[messages.length - 1];
  const showStreamingIndicator = !!streamingStatusLabel && (!lastBlock || lastBlock.type === 'user');
  const shouldUseContentVisibility = renderItems.length >= 120;
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

  const shouldWindowTranscript = Boolean(scrollContainerRef) && renderItems.length >= CHAT_WINDOWING_THRESHOLD;
  const renderChunks = useMemo(
    () => (shouldWindowTranscript ? buildChatRenderChunks(renderItems, messageIndexOffset) : []),
    [messageIndexOffset, renderItems, shouldWindowTranscript],
  );
  const [viewport, setViewport] = useState<{ scrollTop: number; clientHeight: number } | null>(null);
  const [chunkHeights, setChunkHeights] = useState<Record<string, number>>({});

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
      : block.type === 'text'
        ? 'assistant'
        : undefined;
    const absoluteIndex = messageIndexOffset + item.index;
    const autoOpen = shouldAutoOpenConversationBlock(block, item.index, messages.length, isStreaming);
    const showStreamingCursor = isStreaming && block.type === 'text' && item.index === messages.length - 1;

    const el = (() => {
      switch (block.type) {
        case 'user':
          return (
            <UserMessage
              block={block}
              onCheckpoint={onCheckpointMessage ? () => onCheckpointMessage(block, absoluteIndex) : undefined}
              onRewind={onRewindMessage ? () => onRewindMessage(absoluteIndex) : undefined}
              onHydrateMessage={onHydrateMessage}
              hydratingMessageBlockIds={hydratingMessageBlockIds}
            />
          );
        case 'text':
          return (
            <AssistantMessage
              block={block}
              showCursor={showStreamingCursor}
              onCheckpoint={onCheckpointMessage ? () => onCheckpointMessage(block, absoluteIndex) : undefined}
              onRewind={onRewindMessage ? () => onRewindMessage(absoluteIndex) : undefined}
              onFork={onForkMessage ? () => onForkMessage(absoluteIndex) : undefined}
            />
          );
        case 'summary':
          return <SummaryMessage block={block} />;
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
              onHydrateMessage={onHydrateMessage}
              hydratingMessageBlockIds={hydratingMessageBlockIds}
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
              onResume={isTailItem ? onResumeConversation : undefined}
              resumeBusy={resumeConversationBusy}
              resumeTitle={resumeConversationTitle}
              resumeLabel={resumeConversationLabel}
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
  }, [activeArtifactId, activeRunId, contentVisibilityStyle, hydratingMessageBlockIds, isStreaming, messageIndexOffset, messages.length, onCheckpointMessage, onForkMessage, onHydrateMessage, onOpenArtifact, onOpenRun, onResumeConversation, onRewindMessage, renderItems.length, resumeConversationBusy, resumeConversationLabel, resumeConversationTitle]);

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
      startChunkIndex = Math.max(0, anchorChunkIndex - CHAT_WINDOWING_OVERSCAN_CHUNKS);
      endChunkIndex = Math.min(chunkLayouts.length - 1, anchorChunkIndex + CHAT_WINDOWING_OVERSCAN_CHUNKS);
    } else {
      const viewportTop = Math.max(0, viewport.scrollTop);
      const viewportBottom = viewportTop + Math.max(1, viewport.clientHeight);
      const firstVisibleChunkIndex = resolveChunkIndexForOffset(viewportTop, tops, heights);
      const lastVisibleChunkIndex = resolveChunkIndexForOffset(viewportBottom, tops, heights);
      startChunkIndex = Math.max(0, firstVisibleChunkIndex - CHAT_WINDOWING_OVERSCAN_CHUNKS);
      endChunkIndex = Math.min(chunkLayouts.length - 1, lastVisibleChunkIndex + CHAT_WINDOWING_OVERSCAN_CHUNKS);

      if (focusChunkIndex >= 0 && (focusChunkIndex < startChunkIndex || focusChunkIndex > endChunkIndex)) {
        startChunkIndex = Math.max(0, focusChunkIndex - CHAT_WINDOWING_OVERSCAN_CHUNKS);
        endChunkIndex = Math.min(chunkLayouts.length - 1, focusChunkIndex + CHAT_WINDOWING_OVERSCAN_CHUNKS);
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
  }, [chunkLayouts, focusMessageIndex, shouldWindowTranscript, viewport]);

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
      <div className="pl-6 pr-10 py-5">
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

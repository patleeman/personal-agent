import React, { Children, cloneElement, isValidElement, useMemo, useState, type ReactElement, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import { readArtifactPresentation } from '../../conversationArtifacts';
import { useReloadState, type StorageLike } from '../../reloadState';
import type { MessageBlock } from '../../types';
import { timeAgo } from '../../utils';
import { buildConversationRailSnippet } from './conversationRail.js';
import { buildChatRenderItems, getLatestUserMessage, type TraceClusterSummary, type TraceClusterSummaryCategory, type TraceConversationBlock } from './transcriptItems.js';
import { Pill, SurfacePanel, cx } from '../ui';

// ── Markdown renderer ─────────────────────────────────────────────────────────

const MARKDOWN_REMARK_PLUGINS = [remarkGfm, remarkBreaks];

function MentionPill({ text }: { text: string }) {
  return <span className="ui-markdown-mention">{text}</span>;
}

function InlineText({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return (
    <>
      {parts.map((part, index) => {
        if (part.startsWith('**') && part.endsWith('**')) {
          return <strong key={index} className="font-semibold text-primary">{part.slice(2, -2)}</strong>;
        }

        if (part.startsWith('`') && part.endsWith('`')) {
          return <code key={index} className="font-mono text-[0.82em] bg-elevated px-1 py-0.5 rounded text-accent">{part.slice(1, -1)}</code>;
        }

        return <React.Fragment key={index}>{part}</React.Fragment>;
      })}
    </>
  );
}

function renderMentionFragments(text: string): ReactNode[] {
  return text.split(/(@[\w-]+)/g).map((part, index) => {
    if (/^@[\w-]+$/.test(part)) {
      return <MentionPill key={`${part}-${index}`} text={part} />;
    }

    return <React.Fragment key={`${index}-${part}`}>{part}</React.Fragment>;
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

function extractTextContent(children: ReactNode): string {
  let text = '';

  Children.forEach(children, child => {
    if (typeof child === 'string' || typeof child === 'number' || typeof child === 'bigint') {
      text += String(child);
      return;
    }

    if (!isValidElement(child)) {
      return;
    }

    const props = child.props as { children?: ReactNode };
    if (props.children !== undefined) {
      text += extractTextContent(props.children);
    }
  });

  return text;
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
      content: extractTextContent(props.children).replace(/\n$/, ''),
    };
  }

  return { content: extractTextContent(children).replace(/\n$/, '') };
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

function MentionText({ text }: { text: string }) {
  const parts = text.split(/(@[\w-]+)/g);
  return (
    <>
      {parts.map((part, index) => {
        if (/^@[\w-]+$/.test(part)) {
          return <MentionPill key={`${part}-${index}`} text={part} />;
        }

        return <InlineText key={`${index}-${part}`} text={part} />;
      })}
    </>
  );
}

function MarkdownCodeBlock({ children }: { children: ReactNode }) {
  const { className, content } = extractMarkdownCodeBlock(children);

  return (
    <div className="ui-markdown-code-block">
      <CopyBtn
        text={content}
        className="ui-markdown-code-copy"
        label="⎘"
        copiedLabel="✓"
        title="Copy code block"
      />
      <pre>
        <code className={className}>{content}</code>
      </pre>
    </div>
  );
}

export function renderText(text: string) {
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
          code: ({ className, children }) => {
            const content = extractTextContent(children).replace(/\n$/, '');
            const isBlock = content.includes('\n') || Boolean(className?.includes('language-'));

            if (!isBlock) {
              return <code className="font-mono text-[0.82em] bg-elevated px-1 py-0.5 rounded text-accent">{content}</code>;
            }

            return <code className={className}>{content}</code>;
          },
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

// ── Copy button ───────────────────────────────────────────────────────────────

async function copyTextToClipboard(text: string): Promise<boolean> {
  if (typeof navigator === 'undefined' || typeof navigator.clipboard?.writeText !== 'function') {
    return false;
  }

  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function CopyBtn({
  text,
  small,
  label,
  copiedLabel,
  title,
  className,
}: {
  text: string;
  small?: boolean;
  label?: string;
  copiedLabel?: string;
  title?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    const didCopy = await copyTextToClipboard(text);
    if (!didCopy) {
      return;
    }

    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <button
      type="button"
      onClick={() => { void copy(); }}
      className={cx('ui-action-button', small ? 'text-[10px]' : 'text-[11px]', className)}
      title={title ?? 'Copy'}
      aria-label={title ?? 'Copy'}
    >
      {copied ? (copiedLabel ?? '✓') : (label ?? '⎘')}
    </button>
  );
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
export type ConversationViewMode = 'transcript' | 'hybrid' | 'raw';

const CHAT_VIEW_MODE_STORAGE_KEY = 'pa:chat-view-mode';

function getChatViewStorage(storage?: StorageLike | null): StorageLike | null {
  if (storage !== undefined) {
    return storage;
  }

  if (typeof window === 'undefined') {
    return null;
  }

  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function normalizeConversationViewMode(value: unknown): ConversationViewMode {
  if (value === 'transcript' || value === 'hybrid' || value === 'raw') {
    return value;
  }

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

function ToolBlock({ block, autoOpen, onOpenArtifact, activeArtifactId }: {
  block: Extract<MessageBlock, { type: 'tool_use' }>;
  autoOpen: boolean;
  onOpenArtifact?: (artifactId: string) => void;
  activeArtifactId?: string | null;
}) {
  const [preference, setPreference] = useState<DisclosurePreference>('auto');
  const open = resolveDisclosureOpen(autoOpen, preference);
  const meta = toolMeta(block.tool);
  const artifact = readArtifactPresentation(block);

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
        ) : (
          <>
            <CopyBtn text={output} small />
            <span className="shrink-0 opacity-30 text-[10px]">{open ? '▲' : '▼'}</span>
          </>
        )}
      </button>

      {open && (
        <div className="border-t border-inherit">
          <div className="px-3 py-2.5 bg-black/5">
            <p className="text-[10px] uppercase tracking-wider opacity-40 mb-1">input</p>
            <pre className="whitespace-pre-wrap break-all text-[11px] leading-relaxed opacity-75">
              {JSON.stringify(block.input, null, 2)}
            </pre>
          </div>
          {(isRunning || output) && (
            <div className={cx('px-3 py-2.5', isRunning && output && 'max-h-40 overflow-y-auto')}>
              <p className="text-[10px] uppercase tracking-wider opacity-40 mb-1">
                {isRunning ? 'live output' : `output · ${output.split('\n').length} lines`}
              </p>
              {output ? (
                <pre className="whitespace-pre-wrap break-all text-[11px] leading-relaxed opacity-75">
                  {output}
                </pre>
              ) : isRunning ? (
                <p className="text-[11px] italic leading-relaxed opacity-55">Waiting for output…</p>
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
}: {
  blocks: TraceConversationBlock[];
  summary: TraceClusterSummary;
  live: boolean;
  onOpenArtifact?: (artifactId: string) => void;
  activeArtifactId?: string | null;
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

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => setPreference((current) => toggleDisclosurePreference(autoOpen, current))}
        aria-expanded={open}
        className={cx(
          'w-full rounded-xl border px-3 py-2.5 text-left transition-colors',
          summary.hasError
            ? 'border-danger/30 bg-danger/5 hover:bg-danger/10'
            : 'border-border-subtle bg-elevated/60 hover:bg-elevated',
        )}
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

      {open && (
        <div className="ml-3 space-y-2 border-l border-border-subtle pl-3">
          {blocks.map((block, index) => {
            const autoOpen = shouldAutoOpenConversationBlock(block, index, blocks.length, live);

            switch (block.type) {
              case 'thinking':
                return <ThinkingBlock key={`thinking-${index}`} block={block} autoOpen={autoOpen} />;
              case 'tool_use':
                return <ToolBlock key={`tool-${index}`} block={block} autoOpen={autoOpen} onOpenArtifact={onOpenArtifact} activeArtifactId={activeArtifactId} />;
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

function ReplyingToChip({ text }: { text: string }) {
  return (
    <div className="sticky top-3 z-10">
      <div className="mx-auto max-w-[72ch] rounded-full border border-accent/20 bg-base/90 px-3 py-1.5 text-[11px] text-secondary shadow-sm backdrop-blur-sm">
        <span className="uppercase tracking-[0.14em] text-dim/80">Replying to</span>
        <span className="ml-2 text-primary">“{text}”</span>
      </div>
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
}: {
  alt: string;
  src?: string;
  caption?: string;
  width?: number;
  height?: number;
  maxHeight: number;
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
          className="w-full bg-elevated flex flex-col items-center justify-center gap-2 text-dim"
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

function ImageBlock({ block }: { block: Extract<MessageBlock, { type: 'image' }> }) {
  return <ImagePreview alt={block.alt} src={block.src} caption={block.caption} width={block.width} height={block.height} maxHeight={320} />;
}

// ── ErrorBlock ────────────────────────────────────────────────────────────────

function ErrorBlock({ block }: { block: Extract<MessageBlock, { type: 'error' }> }) {
  return (
    <SurfacePanel className="border-danger/30 bg-danger/5 px-3 py-2.5 text-[12px] font-mono flex gap-2 items-start">
      <span className="text-danger font-bold shrink-0 mt-0.5 select-none">✕</span>
      <div className="flex-1 min-w-0">
        {block.tool && <span className="text-danger/70 font-semibold">{block.tool} · </span>}
        <span className="text-danger/85 leading-relaxed">{block.message}</span>
      </div>
    </SurfacePanel>
  );
}

// ── Message actions ───────────────────────────────────────────────────────────

function MsgActions({
  text,
  isUser,
  onFork,
}: {
  text: string;
  isUser?: boolean;
  onFork?: () => Promise<void> | void;
}) {
  const [isForking, setIsForking] = useState(false);

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

  return (
    <div className={`flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity ${isUser ? 'justify-start' : 'justify-end'}`}>
      <CopyBtn text={text} small />
      {!isUser && onFork && (
        <button
          onClick={() => { void handleFork(); }}
          className={cx('ui-action-button', isForking && 'text-accent')}
          title="Fork into a new conversation from here"
          disabled={isForking}
        >
          {isForking ? '⑂ forking…' : '⑂ fork'}
        </button>
      )}
      {isUser && (
        <button className="ui-action-button" title="Rewind to here">
          ↩ rewind
        </button>
      )}
    </div>
  );
}

// ── UserMessage ───────────────────────────────────────────────────────────────

function UserMessage({ block }: { block: Extract<MessageBlock, { type: 'user' }> }) {
  const imageCount = block.images?.length ?? 0;
  const actionText = block.text || (imageCount > 0
    ? `[${imageCount} image attachment${imageCount === 1 ? '' : 's'}]`
    : '');
  const hasText = block.text.trim().length > 0;

  return (
    <div className="group flex flex-col items-end gap-1.5">
      <MsgActions text={actionText} isUser />
      <div className="max-w-[86%]">
        <div className="ui-message-card-user space-y-2">
          {block.images && block.images.length > 0 && (
            <div className="space-y-2">
              {block.images.map((image, index) => (
                <ImagePreview
                  key={`${image.caption ?? image.alt}-${index}`}
                  alt={image.alt}
                  src={image.src}
                  caption={image.caption}
                  width={image.width}
                  height={image.height}
                  maxHeight={280}
                />
              ))}
            </div>
          )}
          {hasText && (
            <div className="px-1.5 pb-0.5">
              <p className="text-sm leading-relaxed text-primary whitespace-pre-wrap"><MentionText text={block.text} /></p>
            </div>
          )}
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
  showCursor = false,
}: {
  block: Extract<MessageBlock, { type: 'text' }>;
  onFork?: () => Promise<void> | void;
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
          <MsgActions text={block.text} onFork={onFork} />
        </div>
      </div>
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

function ViewModeToggle({
  value,
  onChange,
}: {
  value: ConversationViewMode;
  onChange: (value: ConversationViewMode) => void;
}) {
  const options: Array<{ value: ConversationViewMode; label: string }> = [
    { value: 'transcript', label: 'Transcript' },
    { value: 'hybrid', label: 'Hybrid' },
    { value: 'raw', label: 'Raw trace' },
  ];

  return (
    <div className="flex items-center gap-2 self-end">
      <span className="text-[10px] uppercase tracking-[0.14em] text-dim">view</span>
      <div className="ui-segmented-control">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={cx('ui-segmented-button', value === option.value && 'ui-segmented-button-active')}
            aria-pressed={value === option.value}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── ChatView ──────────────────────────────────────────────────────────────────

export function ChatView({
  messages,
  isStreaming = false,
  onForkMessage,
  onOpenArtifact,
  activeArtifactId,
}: {
  messages: MessageBlock[];
  isStreaming?: boolean;
  onForkMessage?: (messageIndex: number) => Promise<void> | void;
  onOpenArtifact?: (artifactId: string) => void;
  activeArtifactId?: string | null;
}) {
  const [viewMode, setViewMode] = useReloadState<ConversationViewMode>({
    storageKey: CHAT_VIEW_MODE_STORAGE_KEY,
    initialValue: 'hybrid',
    storage: getChatViewStorage(),
    serialize: (value) => value,
    deserialize: (raw) => normalizeConversationViewMode(raw),
  });
  const renderItems = useMemo(() => buildChatRenderItems(messages), [messages]);
  const streamingStatusLabel = getStreamingStatusLabel(messages, isStreaming);
  const lastBlock = messages[messages.length - 1];
  const latestUserMessage = useMemo(() => getLatestUserMessage(messages), [messages]);
  const latestUserSnippet = isStreaming && latestUserMessage
    ? buildConversationRailSnippet(latestUserMessage, 120)
    : null;
  const showStreamingIndicator = !!streamingStatusLabel && (!lastBlock || lastBlock.type === 'user');

  function renderMessageBlock(block: MessageBlock, index: number) {
    const markerKind = block.type === 'user'
      ? 'user'
      : block.type === 'text'
        ? 'assistant'
        : undefined;
    const autoOpen = shouldAutoOpenConversationBlock(block, index, messages.length, isStreaming);
    const showStreamingCursor = isStreaming && block.type === 'text' && index === messages.length - 1;

    const el = (() => {
      switch (block.type) {
        case 'user':
          return <UserMessage block={block} />;
        case 'text':
          return <AssistantMessage block={block} showCursor={showStreamingCursor} onFork={onForkMessage ? () => onForkMessage(index) : undefined} />;
        case 'thinking':
          return <ThinkingBlock block={block} autoOpen={autoOpen} />;
        case 'tool_use':
          return <ToolBlock block={block} autoOpen={autoOpen} onOpenArtifact={onOpenArtifact} activeArtifactId={activeArtifactId} />;
        case 'subagent':
          return <SubagentBlock block={block} />;
        case 'image':
          return <ImageBlock block={block} />;
        case 'error':
          return <ErrorBlock block={block} />;
        default:
          return null;
      }
    })();

    return el ? (
      <div
        key={index}
        id={`msg-${index}`}
        data-message-index={index}
        data-conversation-rail-kind={markerKind}
      >
        {el}
      </div>
    ) : null;
  }

  return (
    <>
      <style>{`@keyframes cursorBlink { 0%,100%{opacity:1} 50%{opacity:0} }`}</style>
      <div className="space-y-4 px-6 py-5">
        <div className="flex justify-end">
          <ViewModeToggle value={viewMode} onChange={setViewMode} />
        </div>
        {latestUserSnippet && <ReplyingToChip text={latestUserSnippet} />}
        {viewMode === 'raw'
          ? messages.map((block, index) => renderMessageBlock(block, index))
          : renderItems.map((item, itemIndex) => {
              if (item.type === 'trace_cluster') {
                const live = isStreaming && itemIndex === renderItems.length - 1;
                if (viewMode === 'transcript' && !live) {
                  return item.blocks.map((_, offset) => (
                    <span key={`anchor-${item.startIndex + offset}`} id={`msg-${item.startIndex + offset}`} className="block h-0 overflow-hidden" aria-hidden />
                  ));
                }

                return (
                  <div key={`trace-${item.startIndex}-${item.endIndex}`}>
                    {item.blocks.map((_, offset) => (
                      <span key={`anchor-${item.startIndex + offset}`} id={`msg-${item.startIndex + offset}`} className="block h-0 overflow-hidden" aria-hidden />
                    ))}
                    <TraceClusterBlock
                      blocks={item.blocks}
                      summary={item.summary}
                      live={live}
                      onOpenArtifact={onOpenArtifact}
                      activeArtifactId={activeArtifactId}
                    />
                  </div>
                );
              }

              return renderMessageBlock(item.block, item.index);
            })}
        {showStreamingIndicator && <StreamingIndicator label={streamingStatusLabel ?? 'Working…'} />}
      </div>
    </>
  );
}

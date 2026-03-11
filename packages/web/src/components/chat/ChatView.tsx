import { useState } from 'react';
import type { MessageBlock } from '../../types';
import { timeAgo } from '../../utils';
import { Pill, SurfacePanel, cx } from '../ui';

// ── Markdown renderer ─────────────────────────────────────────────────────────

function InlineText({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return (
    <>
      {parts.map((p, i) => {
        if (p.startsWith('**') && p.endsWith('**'))
          return <strong key={i} className="font-semibold text-primary">{p.slice(2, -2)}</strong>;
        if (p.startsWith('`') && p.endsWith('`'))
          return <code key={i} className="font-mono text-[0.82em] bg-elevated px-1 py-0.5 rounded text-accent">{p.slice(1, -1)}</code>;
        return <span key={i}>{p}</span>;
      })}
    </>
  );
}

function MentionText({ text }: { text: string }) {
  // Render @project-id as amber pill
  const parts = text.split(/(@[\w-]+)/g);
  return (
    <>
      {parts.map((p, i) => {
        if (/^@[\w-]+$/.test(p))
          return <span key={i} className="font-mono text-[0.82em] bg-accent/12 text-accent px-1.5 py-0.5 rounded-full">{p}</span>;
        return <InlineText key={i} text={p} />;
      })}
    </>
  );
}

function renderText(text: string) {
  return text.split('\n').map((line, i) => {
    const isH2 = line.startsWith('## ');
    const isH3 = line.startsWith('### ') || (line.startsWith('**') && line.endsWith('**'));
    const isBullet = /^[-*] /.test(line);
    const isNumbered = /^\d+\. /.test(line);
    const isEmpty = line.trim() === '';

    if (isEmpty) return <div key={i} className="h-2" />;
    if (isH2) return <h2 key={i} className="text-sm font-semibold text-primary mt-3 mb-1">{line.slice(3)}</h2>;
    if (isH3 && line.startsWith('**')) return (
      <p key={i} className="text-sm leading-relaxed font-semibold text-primary mt-2"><MentionText text={line} /></p>
    );
    if (isBullet) return (
      <div key={i} className="flex gap-2 items-start">
        <span className="text-dim mt-0.5 shrink-0 select-none">•</span>
        <p className="text-sm leading-relaxed"><MentionText text={line.slice(2)} /></p>
      </div>
    );
    if (isNumbered) {
      const dot = line.indexOf('. ');
      return (
        <div key={i} className="flex gap-2 items-start">
          <span className="text-dim mt-0.5 shrink-0 font-mono text-xs">{line.slice(0, dot + 1)}</span>
          <p className="text-sm leading-relaxed"><MentionText text={line.slice(dot + 2)} /></p>
        </div>
      );
    }
    return <p key={i} className="text-sm leading-relaxed"><MentionText text={line} /></p>;
  });
}

// ── Copy button ───────────────────────────────────────────────────────────────

function CopyBtn({ text, small }: { text: string; small?: boolean }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }
  return (
    <button
      onClick={copy}
      className={cx('ui-action-button', small ? 'text-[10px]' : 'text-[11px]')}
      title="Copy"
    >
      {copied ? '✓' : '⎘'}
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
  deferred_resume: { icon: '⏰', label: 'deferred_resume', color: 'text-warning border-warning/25 bg-warning/5', tone: 'warning' },
};
function toolMeta(t: string) {
  return TOOL_META[t] ?? { icon: '⚙', label: t, color: 'text-secondary border-border-default bg-elevated', tone: 'muted' as const };
}

// ── ToolBlock ─────────────────────────────────────────────────────────────────

function ToolBlock({ block }: { block: Extract<MessageBlock, { type: 'tool_use' }> }) {
  const [open, setOpen] = useState(false);
  const meta = toolMeta(block.tool);

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
        onClick={() => setOpen(o => !o)}
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
        {isRunning && <span className="shrink-0 text-[10px] opacity-60 ml-2">running…</span>}
        {!isRunning && (
          <>
            <CopyBtn text={output} small />
            <span className="shrink-0 opacity-30 text-[10px]">{open ? '▲' : '▼'}</span>
          </>
        )}
      </button>

      {isRunning && output && (
        <div className="border-t border-inherit px-3 py-2.5 max-h-32 overflow-y-auto bg-black/5">
          <pre className="whitespace-pre-wrap break-all text-[11px] leading-relaxed opacity-70">{output}</pre>
        </div>
      )}

      {open && !isRunning && (
        <div className="border-t border-inherit">
          <div className="px-3 py-2.5 bg-black/5">
            <p className="text-[10px] uppercase tracking-wider opacity-40 mb-1">input</p>
            <pre className="whitespace-pre-wrap break-all text-[11px] leading-relaxed opacity-75">
              {JSON.stringify(block.input, null, 2)}
            </pre>
          </div>
          {output && (
            <div className="px-3 py-2.5">
              <p className="text-[10px] uppercase tracking-wider opacity-40 mb-1">
                output · {output.split('\n').length} lines
              </p>
              <pre className="whitespace-pre-wrap break-all text-[11px] leading-relaxed opacity-75">
                {output}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── ThinkingBlock ─────────────────────────────────────────────────────────────

function ThinkingBlock({ block }: { block: Extract<MessageBlock, { type: 'thinking' }> }) {
  const [open, setOpen] = useState(false);
  return (
    <SurfacePanel muted className="overflow-hidden text-[12px]">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-elevated transition-colors"
      >
        <span className="text-dim select-none">💭</span>
        <Pill tone="muted">Thinking</Pill>
        <span className="flex-1" />
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

function MsgActions({ text, isUser }: { text: string; isUser?: boolean }) {
  const [forked, setForked] = useState(false);
  return (
    <div className={`flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity ${isUser ? 'justify-start' : 'justify-end'}`}>
      <CopyBtn text={text} small />
      {!isUser && (
        <button
          onClick={() => setForked(true)}
          className={cx('ui-action-button', forked && 'text-accent')}
          title="Fork from here"
        >
          {forked ? '⑂ forked' : '⑂ fork'}
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

function AssistantMessage({ block }: { block: Extract<MessageBlock, { type: 'text' }> }) {
  return (
    <div className="group flex gap-3 items-start">
      <div className="ui-chat-avatar mt-0.5">
        <span className="ui-chat-avatar-mark">pa</span>
      </div>
      <div className="flex-1 min-w-0 space-y-1.5">
        <div className="ui-message-card-assistant text-primary space-y-1">
          {renderText(block.text)}
          {block.streaming && (
            <span
              className="inline-block w-[2px] h-[14px] bg-accent ml-0.5 rounded-sm"
              style={{ animation: 'cursorBlink 1s step-end infinite', verticalAlign: 'text-bottom' }}
            />
          )}
        </div>
        <div className="flex items-center gap-2 pt-0.5">
          <p className="ui-message-meta">{timeAgo(block.ts)}</p>
          <MsgActions text={block.text} />
        </div>
      </div>
    </div>
  );
}

// ── ChatView ──────────────────────────────────────────────────────────────────

export function ChatView({ messages }: { messages: MessageBlock[] }) {
  return (
    <>
      <style>{`@keyframes cursorBlink { 0%,100%{opacity:1} 50%{opacity:0} }`}</style>
      <div className="space-y-4 px-6 py-5">
        {messages.map((block, i) => {
          const markerKind = block.type === 'user'
            ? 'user'
            : block.type === 'text'
              ? 'assistant'
              : undefined;

          const el = (() => { switch (block.type) {
            case 'user':     return <UserMessage      key={i} block={block} />;
            case 'text':     return <AssistantMessage key={i} block={block} />;
            case 'thinking': return <ThinkingBlock    key={i} block={block} />;
            case 'tool_use': return <ToolBlock        key={i} block={block} />;
            case 'subagent': return <SubagentBlock    key={i} block={block} />;
            case 'image':    return <ImageBlock       key={i} block={block} />;
            case 'error':    return <ErrorBlock       key={i} block={block} />;
            default: return null;
          }})();

          return el ? (
            <div
              key={i}
              id={`msg-${i}`}
              data-message-index={i}
              data-conversation-rail-kind={markerKind}
            >
              {el}
            </div>
          ) : null;
        })}
      </div>
    </>
  );
}

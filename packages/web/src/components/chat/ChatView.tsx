import { useState } from 'react';
import type { MessageBlock } from '../../data/mockConversations';
import { timeAgo } from '../../utils';

// ── Tiny markdown: bold and inline-code only ─────────────────────────────────

function InlineText({ text }: { text: string }) {
  // Split on **bold** and `code`
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

function renderText(text: string) {
  return text.split('\n').map((line, i) => {
    const isBullet = /^[-*] /.test(line);
    const isNumbered = /^\d+\. /.test(line);
    const isH3 = line.startsWith('### ');
    const isH2 = line.startsWith('## ');
    const isH1 = line.startsWith('# ');
    const isCode = line.startsWith('    ') || line.startsWith('\t');
    const isEmpty = line.trim() === '';

    if (isEmpty) return <div key={i} className="h-2" />;
    if (isCode) return (
      <code key={i} className="block font-mono text-xs bg-elevated px-3 py-0.5 text-secondary -mx-1 rounded">{line.trim()}</code>
    );
    if (isH1) return <h1 key={i} className="text-base font-bold text-primary mt-2 mb-1">{line.slice(2)}</h1>;
    if (isH2) return <h2 key={i} className="text-sm font-semibold text-primary mt-2 mb-0.5">{line.slice(3)}</h2>;
    if (isH3) return <h3 key={i} className="text-sm font-medium text-secondary mt-1.5 mb-0.5">{line.slice(4)}</h3>;
    if (isBullet) return (
      <div key={i} className="flex gap-2 items-start">
        <span className="text-dim mt-0.5 shrink-0">•</span>
        <p className="text-sm leading-relaxed"><InlineText text={line.slice(2)} /></p>
      </div>
    );
    if (isNumbered) {
      const dotIdx = line.indexOf('. ');
      return (
        <div key={i} className="flex gap-2 items-start">
          <span className="text-dim mt-0.5 shrink-0 font-mono text-xs">{line.slice(0, dotIdx + 1)}</span>
          <p className="text-sm leading-relaxed"><InlineText text={line.slice(dotIdx + 2)} /></p>
        </div>
      );
    }
    return <p key={i} className="text-sm leading-relaxed"><InlineText text={line} /></p>;
  });
}

// ── Tool icon & color ─────────────────────────────────────────────────────────

const TOOL_META: Record<string, { icon: string; color: string; label: string }> = {
  bash:        { icon: '$', color: 'text-steel border-steel/30 bg-steel/5',    label: 'bash' },
  read:        { icon: '≡', color: 'text-teal border-teal/30 bg-teal/5',      label: 'read' },
  write:       { icon: '✎', color: 'text-accent border-accent/30 bg-accent/5', label: 'write' },
  edit:        { icon: '✎', color: 'text-accent border-accent/30 bg-accent/5', label: 'edit' },
  web_search:  { icon: '⌕', color: 'text-success border-success/30 bg-success/5', label: 'web_search' },
  web_fetch:   { icon: '⌕', color: 'text-success border-success/30 bg-success/5', label: 'web_fetch' },
  screenshot:  { icon: '⊡', color: 'text-secondary border-border-default bg-elevated', label: 'screenshot' },
};
function toolMeta(tool: string) {
  return TOOL_META[tool] ?? { icon: '⚙', color: 'text-secondary border-border-default bg-elevated', label: tool };
}

// ── ToolBlock ─────────────────────────────────────────────────────────────────

function ToolBlock({ block }: { block: Extract<MessageBlock, { type: 'tool_use' }> }) {
  const [open, setOpen] = useState(false);
  const meta = toolMeta(block.tool);
  const inputStr = JSON.stringify(block.input, null, 2);
  const outputLines = block.output.split('\n').length;

  return (
    <div className={`rounded-lg border text-[12px] font-mono overflow-hidden ${meta.color}`}>
      {/* Header row */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-black/5 transition-colors text-left"
      >
        <span className="font-bold w-4 text-center shrink-0">{meta.icon}</span>
        <span className="font-semibold">{meta.label}</span>

        {/* Primary input preview */}
        <span className="flex-1 truncate opacity-60 font-normal">
          {block.input.command
            ? String(block.input.command).split('\n')[0].slice(0, 60)
            : block.input.path
            ? String(block.input.path)
            : ''}
        </span>

        <span className="shrink-0 opacity-50 ml-2">
          {block.durationMs ? `${(block.durationMs / 1000).toFixed(1)}s` : ''}
        </span>
        <span className="shrink-0 ml-1 opacity-40">{open ? '▲' : '▼'}</span>
      </button>

      {/* Expanded body */}
      {open && (
        <div className="border-t border-inherit">
          {/* Input */}
          <div className="px-3 py-2 bg-black/5">
            <p className="text-[10px] uppercase tracking-wider opacity-50 mb-1">input</p>
            <pre className="whitespace-pre-wrap break-all text-[11px] leading-relaxed opacity-80">{inputStr}</pre>
          </div>
          {/* Output */}
          <div className="px-3 py-2">
            <p className="text-[10px] uppercase tracking-wider opacity-50 mb-1">
              output · {outputLines} {outputLines === 1 ? 'line' : 'lines'}
            </p>
            <pre className="whitespace-pre-wrap break-all text-[11px] leading-relaxed opacity-80">{block.output}</pre>
          </div>
        </div>
      )}
    </div>
  );
}

// ── ThinkingBlock ─────────────────────────────────────────────────────────────

function ThinkingBlock({ block }: { block: Extract<MessageBlock, { type: 'thinking' }> }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-border-subtle bg-elevated/50 text-[12px] overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-elevated transition-colors"
      >
        <span className="text-dim">💭</span>
        <span className="text-secondary font-medium">Thinking</span>
        <span className="flex-1" />
        <span className="text-dim text-[10px]">{open ? '▲ hide' : '▼ show'}</span>
      </button>
      {open && (
        <div className="px-3 pb-3 text-secondary italic leading-relaxed border-t border-border-subtle pt-2">
          {block.text.split('\n').map((line, i) =>
            <p key={i} className="text-[12px]">{line || <br />}</p>
          )}
        </div>
      )}
    </div>
  );
}

// ── SubagentBlock ─────────────────────────────────────────────────────────────

function SubagentBlock({ block }: { block: Extract<MessageBlock, { type: 'subagent' }> }) {
  const [open, setOpen] = useState(false);
  const statusColor = {
    running:  'text-steel bg-steel/10 border-steel/20',
    complete: 'text-success bg-success/10 border-success/20',
    failed:   'text-danger bg-danger/10 border-danger/20',
  }[block.status];

  return (
    <div className={`rounded-lg border overflow-hidden text-[12px] ${statusColor}`}>
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-black/5 transition-colors"
      >
        <span className="font-bold shrink-0">⟳</span>
        <span className="font-semibold font-mono">subagent</span>
        <span className="flex-1 truncate opacity-70 font-normal">{block.name}</span>
        <span className={`shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${statusColor}`}>
          {block.status}
        </span>
        <span className="shrink-0 ml-1 opacity-40">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="border-t border-inherit px-3 py-2 space-y-2 bg-black/5">
          <div>
            <p className="text-[10px] uppercase tracking-wider opacity-50 mb-1">prompt</p>
            <p className="opacity-70 leading-relaxed">{block.prompt}</p>
          </div>
          {block.summary && (
            <div>
              <p className="text-[10px] uppercase tracking-wider opacity-50 mb-1">result</p>
              <p className="opacity-80 leading-relaxed">{block.summary}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Message row ───────────────────────────────────────────────────────────────

function UserMessage({ block }: { block: Extract<MessageBlock, { type: 'user' }> }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%]">
        <div className="bg-accent/10 border border-accent/15 rounded-2xl rounded-br-sm px-4 py-2.5">
          <p className="text-sm leading-relaxed text-primary">{block.text}</p>
        </div>
        <p className="text-[10px] text-dim mt-1 text-right pr-1">{timeAgo(block.ts)}</p>
      </div>
    </div>
  );
}

function AssistantMessage({ block }: { block: Extract<MessageBlock, { type: 'text' }> }) {
  return (
    <div className="flex gap-3 items-start">
      <div className="w-6 h-6 rounded-md bg-accent/20 flex items-center justify-center shrink-0 mt-0.5">
        <span className="text-accent text-[9px] font-bold font-mono">pa</span>
      </div>
      <div className="flex-1 min-w-0 space-y-1">
        <div className="text-primary space-y-1">{renderText(block.text)}</div>
        <p className="text-[10px] text-dim pt-0.5">{timeAgo(block.ts)}</p>
      </div>
    </div>
  );
}

// ── ChatView ──────────────────────────────────────────────────────────────────

interface Props { messages: MessageBlock[]; }

export function ChatView({ messages }: Props) {
  return (
    <div className="space-y-3 px-5 py-4">
      {messages.map((block, i) => {
        switch (block.type) {
          case 'user':     return <UserMessage     key={i} block={block} />;
          case 'text':     return <AssistantMessage key={i} block={block} />;
          case 'thinking': return <ThinkingBlock    key={i} block={block} />;
          case 'tool_use': return <ToolBlock        key={i} block={block} />;
          case 'subagent': return <SubagentBlock    key={i} block={block} />;
          default:         return null;
        }
      })}
    </div>
  );
}

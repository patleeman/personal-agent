import { useState, useRef, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { ChatView } from '../components/chat/ChatView';
import { MOCK_CONVERSATIONS, type MockConversation, type MessageBlock } from '../data/mockConversations';
import { useSessionDetail } from '../hooks/useSessions';
import type { DisplayBlock } from '../types';

// ── Real session → MessageBlock converter ─────────────────────────────────────

function displayBlockToMessageBlock(b: DisplayBlock): MessageBlock {
  switch (b.type) {
    case 'user':
      return { type: 'user', text: b.text, ts: b.ts };
    case 'text':
      return { type: 'text', text: b.text, ts: b.ts };
    case 'thinking':
      return { type: 'thinking', text: b.text, ts: b.ts };
    case 'tool_use':
      return { type: 'tool_use', tool: b.tool, input: b.input, output: b.output, durationMs: b.durationMs, ts: b.ts };
    case 'error':
      return { type: 'error', tool: b.tool, message: b.message, ts: b.ts };
  }
}

// ── Slash commands ────────────────────────────────────────────────────────────

const SLASH_CMDS = [
  { cmd: '/think',       icon: '💭', desc: 'Add a reasoning step'       },
  { cmd: '/search',      icon: '⌕',  desc: 'Search the web'             },
  { cmd: '/task',        icon: '⏰', desc: 'Schedule a background task' },
  { cmd: '/fork',        icon: '⑂',  desc: 'Fork conversation here'     },
  { cmd: '/run',         icon: '$',  desc: 'Run a shell command'        },
  { cmd: '/workstream',  icon: '□',  desc: 'Link workstream context'    },
  { cmd: '/summarize',   icon: '≡',  desc: 'Summarize this thread'      },
  { cmd: '/model',       icon: '⊕',  desc: 'Switch model'               },
  { cmd: '/image',       icon: '⊡',  desc: 'Attach an image'            },
  { cmd: '/clear',       icon: '↺',  desc: 'Clear and restart'          },
];

const MENTIONS = [
  { id: '@artifact-model', label: 'artifact-model', kind: 'workstream' },
  { id: '@web-ui',         label: 'web-ui',         kind: 'workstream' },
  { id: '@inbox',          label: 'inbox',          kind: 'view'       },
  { id: '@tasks',          label: 'tasks',          kind: 'view'       },
];

// ── Context bar ───────────────────────────────────────────────────────────────

function ContextBar({ conv }: { conv: MockConversation }) {
  const win   = conv.contextWindow ?? 200_000;
  const sys   = conv.systemTokens    ?? 0;
  const user  = conv.userTokens      ?? 0;
  const asst  = conv.assistantTokens ?? 0;
  const tool  = conv.toolTokens      ?? 0;
  const total = sys + user + asst + tool;
  if (!total) return null;

  const pct = (total / win) * 100;
  // Each segment width relative to full context window
  const w = (n: number) => `${(n / win) * 100}%`;

  return (
    <div className="px-4 py-2 border-t border-border-subtle space-y-1.5">
      {/* Segmented bar */}
      <div className="flex h-1.5 rounded-full bg-elevated overflow-hidden gap-px">
        <div className="rounded-l-full bg-border-default/80"  style={{ width: w(sys)  }} title={`system: ${sys.toLocaleString()}`} />
        <div className="bg-teal/60"   style={{ width: w(user) }} title={`user: ${user.toLocaleString()}`} />
        <div className="bg-accent/70" style={{ width: w(asst) }} title={`assistant: ${asst.toLocaleString()}`} />
        <div className="rounded-r-full bg-steel/60"  style={{ width: w(tool) }} title={`tool: ${tool.toLocaleString()}`} />
      </div>
      {/* Legend */}
      <div className="flex items-center gap-3 text-[10px]">
        <span className="flex items-center gap-1 text-dim">
          <span className="w-2 h-1.5 rounded-sm bg-border-default/80 inline-block" />
          sys {(sys / 1000).toFixed(1)}k
        </span>
        <span className="flex items-center gap-1 text-teal/80">
          <span className="w-2 h-1.5 rounded-sm bg-teal/60 inline-block" />
          user {(user / 1000).toFixed(1)}k
        </span>
        <span className="flex items-center gap-1 text-accent/80">
          <span className="w-2 h-1.5 rounded-sm bg-accent/70 inline-block" />
          asst {(asst / 1000).toFixed(1)}k
        </span>
        <span className="flex items-center gap-1 text-steel/80">
          <span className="w-2 h-1.5 rounded-sm bg-steel/60 inline-block" />
          tool {(tool / 1000).toFixed(1)}k
        </span>
        <span className="flex-1 text-right text-dim">
          {pct.toFixed(1)}% of {(win / 1000).toFixed(0)}k ctx
        </span>
      </div>
    </div>
  );
}

// ── SlashMenu ─────────────────────────────────────────────────────────────────

function SlashMenu({ query, idx, onSelect }: { query: string; idx: number; onSelect: (cmd: string) => void }) {
  const q = query.slice(1).toLowerCase();
  const filtered = SLASH_CMDS.filter(c => !q || c.cmd.slice(1).startsWith(q));
  if (!filtered.length) return null;
  return (
    <div className="absolute bottom-full left-0 right-0 mb-2 bg-surface border border-border-default rounded-xl shadow-xl overflow-hidden z-50">
      <div className="px-3 pt-2 pb-1">
        <p className="text-[10px] uppercase tracking-wider text-dim font-medium">Commands</p>
      </div>
      {filtered.map((c, i) => (
        <button key={c.cmd} onMouseDown={e => { e.preventDefault(); onSelect(c.cmd + ' '); }}
          className={`w-full flex items-center gap-3 px-3 py-2 text-left transition-colors ${i === idx % filtered.length ? 'bg-elevated text-primary' : 'text-secondary hover:bg-elevated/50'}`}>
          <span className="w-5 text-center text-[13px] select-none">{c.icon}</span>
          <span className="font-mono text-[13px] font-semibold text-accent">{c.cmd}</span>
          <span className="text-[12px] text-dim">{c.desc}</span>
        </button>
      ))}
    </div>
  );
}

function MentionMenu({ query, idx, onSelect }: { query: string; idx: number; onSelect: (id: string) => void }) {
  const q = query.slice(1).toLowerCase();
  const filtered = MENTIONS.filter(m => !q || m.label.startsWith(q));
  if (!filtered.length) return null;
  return (
    <div className="absolute bottom-full left-0 right-0 mb-2 bg-surface border border-border-default rounded-xl shadow-xl overflow-hidden z-50">
      <div className="px-3 pt-2 pb-1">
        <p className="text-[10px] uppercase tracking-wider text-dim font-medium">Mention</p>
      </div>
      {filtered.map((m, i) => (
        <button key={m.id} onMouseDown={e => { e.preventDefault(); onSelect(m.id + ' '); }}
          className={`w-full flex items-center gap-3 px-3 py-2 text-left transition-colors ${i === idx % filtered.length ? 'bg-elevated text-primary' : 'text-secondary hover:bg-elevated/50'}`}>
          <span className="text-[10px] text-dim w-16 shrink-0">{m.kind}</span>
          <span className="font-mono text-[13px] text-accent">{m.id}</span>
        </button>
      ))}
    </div>
  );
}

// ── File attachment pill ──────────────────────────────────────────────────────

function formatBytes(b: number) {
  if (b < 1024) return `${b}B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)}KB`;
  return `${(b / 1024 / 1024).toFixed(1)}MB`;
}

const FILE_ICONS: Record<string, string> = {
  'image/':       '🖼',
  'text/':        '📄',
  'application/json': '{ }',
  'application/pdf':  '📕',
  'video/':       '🎬',
};
function fileIcon(type: string) {
  return Object.entries(FILE_ICONS).find(([k]) => type.startsWith(k))?.[1] ?? '📎';
}

// ── ConversationPage ──────────────────────────────────────────────────────────

export function ConversationPage() {
  const { id } = useParams<{ id: string }>();
  const mockConv = id ? MOCK_CONVERSATIONS[id] : undefined;

  // If not a mock, fetch real session
  const { detail: sessionDetail, loading: sessionLoading } = useSessionDetail(
    mockConv ? undefined : id
  );

  // Resolve what to display
  const conv: MockConversation | undefined = mockConv;
  const realMessages: MessageBlock[] | undefined = sessionDetail
    ? sessionDetail.blocks.map(displayBlockToMessageBlock)
    : undefined;

  const title = conv?.title
    ?? sessionDetail?.meta.title
    ?? id?.replace(/-/g, ' ')
    ?? 'conversation';
  const model = conv?.model ?? sessionDetail?.meta.model;
  const messageCount = conv?.messages.length ?? sessionDetail?.meta.messageCount ?? 0;

  // Input state
  const [input, setInput] = useState('');
  const [slashIdx, setSlashIdx] = useState(0);
  const [mentionIdx, setMentionIdx] = useState(0);
  const [attachments, setAttachments] = useState<File[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [atBottom, setAtBottom] = useState(true);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef   = useRef<HTMLDivElement>(null);

  // Derive menu states
  const slashMatch   = input.match(/^(\/[\w]*)$/);
  const mentionMatch = input.match(/(^|.*\s)(@[\w-]*)$/);
  const showSlash    = !!slashMatch;
  const showMention  = !!mentionMatch && !showSlash;
  const slashQuery   = slashMatch?.[1] ?? '';
  const mentionQuery = mentionMatch?.[2] ?? '';

  // Auto-resize textarea
  const resize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, []);

  useEffect(() => { resize(); }, [input, resize]);

  // Scroll tracking
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 40);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    el.addEventListener('scroll', handleScroll);
    return () => el.removeEventListener('scroll', handleScroll);
  }, [conv?.id, handleScroll]);

  // Keyboard handling
  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (showSlash || showMention) {
      if (e.key === 'ArrowDown') { e.preventDefault(); showSlash ? setSlashIdx(i => i + 1) : setMentionIdx(i => i + 1); return; }
      if (e.key === 'ArrowUp')   { e.preventDefault(); showSlash ? setSlashIdx(i => Math.max(0, i - 1)) : setMentionIdx(i => Math.max(0, i - 1)); return; }
      if (e.key === 'Escape')    { e.preventDefault(); setInput(''); return; }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
        e.preventDefault();
        if (showSlash) {
          const q = slashQuery.slice(1).toLowerCase();
          const filtered = SLASH_CMDS.filter(c => !q || c.cmd.slice(1).startsWith(q));
          const sel = filtered[slashIdx % (filtered.length || 1)];
          if (sel) { setInput(sel.cmd + ' '); setSlashIdx(0); }
        } else {
          const q = mentionQuery.slice(1).toLowerCase();
          const filtered = MENTIONS.filter(m => !q || m.label.startsWith(q));
          const sel = filtered[mentionIdx % (filtered.length || 1)];
          if (sel) { setInput(input.replace(/@[\w-]*$/, sel.id + ' ')); setMentionIdx(0); }
        }
        return;
      }
    }
    // Cmd+Enter = send
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      setInput('');
      setAttachments([]);
    }
  }

  // Drag-and-drop
  function handleDragOver(e: React.DragEvent) { e.preventDefault(); setDragOver(true); }
  function handleDragLeave() { setDragOver(false); }
  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length) setAttachments(prev => [...prev, ...files]);
  }
  function removeAttachment(i: number) {
    setAttachments(prev => prev.filter((_, j) => j !== i));
  }

  const isRunning = conv?.messages.some(m => m.type === 'tool_use' && (m as { running?: boolean }).running) ?? false;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-base/95 backdrop-blur-sm border-b border-border-subtle px-5 py-3 flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <h1 className="text-sm font-semibold text-primary truncate">{title}</h1>
          <div className="flex items-center gap-2 mt-0.5">
            <p className="text-[11px] text-secondary">{messageCount} messages</p>
            {model && <>
              <span className="text-border-default">·</span>
              <span className="text-[11px] font-mono text-dim">{model}</span>
            </>}
            {sessionDetail && (
              <>
                <span className="text-border-default">·</span>
                <span className="text-[11px] text-dim truncate max-w-[160px]"
                  title={sessionDetail.meta.cwd}>
                  {sessionDetail.meta.cwd.split('/').slice(-2).join('/')}
                </span>
              </>
            )}
          </div>
        </div>
        {isRunning && (
          <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-accent/10 border border-accent/20">
            <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse shrink-0" />
            <span className="text-[10px] text-accent font-medium">running</span>
          </div>
        )}
        {conv && <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-elevated text-dim border border-border-subtle">mock</span>}
        {sessionDetail && <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-teal/10 text-teal border border-teal/20">live</span>}
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto relative">
        {(conv || realMessages) ? (
          <ChatView messages={realMessages ?? conv!.messages} />
        ) : sessionLoading ? (
          <div className="flex items-center justify-center h-full gap-3 text-dim">
            <span className="animate-spin">⟳</span>
            <span className="text-sm">Loading session…</span>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-8">
            <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="text-accent">
                <path d="M20.25 8.511c.884.284 1.5 1.128 1.5 2.097v4.286c0 1.136-.847 2.1-1.98 2.193-.34.027-.68.052-1.02.072v3.091l-3-3c-1.354 0-2.694-.055-4.02-.163a2.115 2.115 0 0 1-.825-.242m9.345-8.334a2.126 2.126 0 0 0-.476-.095 48.64 48.64 0 0 0-8.048 0c-1.131.094-1.976 1.057-1.976 2.192v4.286c0 .837.46 1.58 1.155 1.951m9.345-8.334V6.637c0-1.621-1.152-3.026-2.76-3.235A48.455 48.455 0 0 0 11.25 3c-2.115 0-4.198.137-6.24.402-1.608.209-2.76 1.614-2.76 3.235v6.226c0 1.621 1.152 3.026 2.76 3.235.577.075 1.157.14 1.74.194V21l4.155-4.155" />
              </svg>
            </div>
            <p className="text-sm font-medium text-primary">New conversation</p>
            <p className="text-xs text-secondary max-w-xs">Start a Pi session to populate this conversation.</p>
          </div>
        )}
        {!atBottom && (
          <button onClick={() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })}
            className="sticky bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-surface border border-border-default shadow-md text-[12px] text-secondary hover:text-primary transition-colors">
            ↓ scroll to bottom
          </button>
        )}
      </div>

      {/* Context bar — only for mock convs that have token breakdowns */}
      {conv && <ContextBar conv={conv} />}

      {/* Input area */}
      <div
        className={`px-4 pb-4 pt-2 transition-colors ${dragOver ? 'bg-accent/5' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <div className="relative">
          {showSlash   && <SlashMenu   query={slashQuery}   idx={slashIdx}   onSelect={cmd => { setInput(cmd); setSlashIdx(0);   textareaRef.current?.focus(); }} />}
          {showMention && <MentionMenu query={mentionQuery} idx={mentionIdx} onSelect={id  => { setInput(input.replace(/@[\w-]*$/, id + ' ')); setMentionIdx(0); textareaRef.current?.focus(); }} />}

          <div className={`rounded-xl border transition-all ${dragOver ? 'border-accent/50 ring-2 ring-accent/20 bg-accent/5' : showSlash || showMention ? 'border-accent/40 ring-1 ring-accent/15' : 'border-border-subtle'} bg-elevated`}>

            {/* Drag overlay hint */}
            {dragOver && (
              <div className="px-4 py-3 text-center text-[12px] text-accent border-b border-accent/20">
                📎 Drop files to attach
              </div>
            )}

            {/* Attachments */}
            {attachments.length > 0 && (
              <div className="flex flex-wrap gap-1.5 px-3 pt-3">
                {attachments.map((f, i) => (
                  <div key={i} className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-surface border border-border-subtle text-[11px] max-w-[200px]">
                    <span className="shrink-0">{fileIcon(f.type)}</span>
                    <span className="text-secondary truncate">{f.name}</span>
                    <span className="text-dim shrink-0">{formatBytes(f.size)}</span>
                    <button onClick={() => removeAttachment(i)} className="text-dim hover:text-primary ml-0.5 shrink-0 leading-none">×</button>
                  </div>
                ))}
              </div>
            )}

            {/* Textarea */}
            <div className="flex items-end gap-2 px-3 py-2.5">
              <button className="text-dim hover:text-secondary transition-colors shrink-0 mb-0.5" title="Attach file"
                onClick={() => { /* would open file picker */ }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                </svg>
              </button>

              <textarea
                ref={textareaRef}
                value={input}
                onChange={e => { setInput(e.target.value); setSlashIdx(0); setMentionIdx(0); resize(); }}
                onKeyDown={handleKeyDown}
                rows={1}
                className="flex-1 bg-transparent text-sm text-primary placeholder:text-dim outline-none resize-none leading-relaxed"
                placeholder="Message… (/ for commands, @ to mention)"
                style={{ minHeight: '24px', maxHeight: '160px' }}
              />

              <div className="flex items-center gap-1 shrink-0 mb-0.5">
                <kbd className="text-[10px] text-dim bg-surface border border-border-subtle rounded px-1.5 py-0.5 font-mono leading-tight">⌘↵</kbd>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

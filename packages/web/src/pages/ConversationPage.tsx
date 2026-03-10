import { useState, useRef, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { ChatView } from '../components/chat/ChatView';
import { MOCK_CONVERSATIONS } from '../data/mockConversations';

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

// ── @ mentions ────────────────────────────────────────────────────────────────

const MENTIONS = [
  { id: '@artifact-model', label: 'artifact-model', kind: 'workstream' },
  { id: '@web-ui',         label: 'web-ui',         kind: 'workstream' },
  { id: '@inbox',          label: 'inbox',          kind: 'view'       },
  { id: '@tasks',          label: 'tasks',          kind: 'view'       },
];

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
        <button
          key={c.cmd}
          onMouseDown={e => { e.preventDefault(); onSelect(c.cmd); }}
          className={`w-full flex items-center gap-3 px-3 py-2 text-left transition-colors ${i === idx % filtered.length ? 'bg-elevated text-primary' : 'text-secondary hover:bg-elevated/50'}`}
        >
          <span className="w-5 text-center text-[14px] select-none">{c.icon}</span>
          <span className="font-mono text-[13px] font-semibold text-accent">{c.cmd}</span>
          <span className="text-[12px] text-dim">{c.desc}</span>
        </button>
      ))}
    </div>
  );
}

// ── MentionMenu ───────────────────────────────────────────────────────────────

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
        <button
          key={m.id}
          onMouseDown={e => { e.preventDefault(); onSelect(m.id); }}
          className={`w-full flex items-center gap-3 px-3 py-2 text-left transition-colors ${i === idx % filtered.length ? 'bg-elevated text-primary' : 'text-secondary hover:bg-elevated/50'}`}
        >
          <span className="text-[10px] text-dim w-16 shrink-0">{m.kind}</span>
          <span className="font-mono text-[13px] text-accent">{m.id}</span>
        </button>
      ))}
    </div>
  );
}

// ── ConversationPage ──────────────────────────────────────────────────────────

export function ConversationPage() {
  const { id } = useParams<{ id: string }>();
  const conv = id ? MOCK_CONVERSATIONS[id] : undefined;
  const title = conv?.title ?? id?.replace(/-/g, ' ') ?? 'conversation';

  const [input, setInput] = useState('');
  const [slashIdx, setSlashIdx] = useState(0);
  const [mentionIdx, setMentionIdx] = useState(0);
  const [atBottom, setAtBottom] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Detect menu states
  const slashMatch = input.match(/^(\/[\w]*)$/);
  const mentionMatch = input.match(/(^|.*\s)(@[\w-]*)$/);
  const showSlash   = !!slashMatch;
  const showMention = !!mentionMatch && !showSlash;
  const slashQuery   = slashMatch?.[1] ?? '';
  const mentionQuery = mentionMatch?.[2] ?? '';

  // Scroll tracking
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 40);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
      el.addEventListener('scroll', handleScroll);
      return () => el.removeEventListener('scroll', handleScroll);
    }
  }, [conv?.id, handleScroll]);

  function scrollToBottom() {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (showSlash || showMention) {
      if (e.key === 'ArrowDown')  { e.preventDefault(); showSlash ? setSlashIdx(i => i + 1) : setMentionIdx(i => i + 1); }
      if (e.key === 'ArrowUp')    { e.preventDefault(); showSlash ? setSlashIdx(i => Math.max(0, i - 1)) : setMentionIdx(i => Math.max(0, i - 1)); }
      if (e.key === 'Escape')     { e.preventDefault(); setInput(''); }
      if (e.key === 'Tab' || e.key === 'Enter') {
        e.preventDefault();
        if (showSlash) {
          const q = slashQuery.slice(1).toLowerCase();
          const filtered = SLASH_CMDS.filter(c => !q || c.cmd.slice(1).startsWith(q));
          const sel = filtered[slashIdx % (filtered.length || 1)];
          if (sel) setInput(sel.cmd + ' ');
        } else {
          const q = mentionQuery.slice(1).toLowerCase();
          const filtered = MENTIONS.filter(m => !q || m.label.startsWith(q));
          const sel = filtered[mentionIdx % (filtered.length || 1)];
          if (sel) setInput(input.replace(/@[\w-]*$/, sel.id + ' '));
        }
        setSlashIdx(0);
        setMentionIdx(0);
      }
    }
  }

  const isRunning = conv?.messages.some(m => m.type === 'tool_use' && (m as { running?: boolean }).running);

  // Token display
  const totalTokens = (conv?.inputTokens ?? 0) + (conv?.outputTokens ?? 0);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-base/95 backdrop-blur-sm border-b border-border-subtle px-5 py-3 flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <h1 className="text-sm font-semibold text-primary truncate">{title}</h1>
          <div className="flex items-center gap-2 mt-0.5">
            <p className="text-[11px] text-secondary">{conv?.messages.length ?? 0} messages</p>
            {conv?.model && (
              <>
                <span className="text-border-default">·</span>
                <span className="text-[11px] font-mono text-dim">{conv.model}</span>
              </>
            )}
          </div>
        </div>
        {/* Token counter */}
        {totalTokens > 0 && (
          <div className="text-right shrink-0">
            <p className="text-[10px] text-dim font-mono">
              {(conv!.inputTokens!).toLocaleString()} in · {(conv!.outputTokens!).toLocaleString()} out
            </p>
            <p className="text-[10px] text-dim/60 font-mono">{totalTokens.toLocaleString()} total</p>
          </div>
        )}
        {/* Running indicator */}
        {isRunning && (
          <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-accent/10 border border-accent/20">
            <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse shrink-0" />
            <span className="text-[10px] text-accent font-medium">running</span>
          </div>
        )}
        <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-elevated text-dim border border-border-subtle">
          mock
        </span>
      </div>

      {/* Messages scroll area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto relative">
        {conv ? (
          <ChatView messages={conv.messages} />
        ) : (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-8">
            <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="text-accent">
                <path d="M20.25 8.511c.884.284 1.5 1.128 1.5 2.097v4.286c0 1.136-.847 2.1-1.98 2.193-.34.027-.68.052-1.02.072v3.091l-3-3c-1.354 0-2.694-.055-4.02-.163a2.115 2.115 0 0 1-.825-.242m9.345-8.334a2.126 2.126 0 0 0-.476-.095 48.64 48.64 0 0 0-8.048 0c-1.131.094-1.976 1.057-1.976 2.192v4.286c0 .837.46 1.58 1.155 1.951m9.345-8.334V6.637c0-1.621-1.152-3.026-2.76-3.235A48.455 48.455 0 0 0 11.25 3c-2.115 0-4.198.137-6.24.402-1.608.209-2.76 1.614-2.76 3.235v6.226c0 1.621 1.152 3.026 2.76 3.235.577.075 1.157.14 1.74.194V21l4.155-4.155" />
              </svg>
            </div>
            <p className="text-sm font-medium text-primary">New conversation</p>
            <p className="text-xs text-secondary max-w-xs">Start a Pi session to populate this conversation.</p>
          </div>
        )}

        {/* Scroll to bottom */}
        {!atBottom && (
          <button
            onClick={scrollToBottom}
            className="sticky bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-surface border border-border-default shadow-md text-[12px] text-secondary hover:text-primary transition-colors"
          >
            <span>↓</span> scroll to bottom
          </button>
        )}
      </div>

      {/* Input bar */}
      <div className="border-t border-border-subtle px-4 py-3">
        <div className="relative">
          {/* Slash menu */}
          {showSlash && (
            <SlashMenu query={slashQuery} idx={slashIdx} onSelect={cmd => { setInput(cmd + ' '); setSlashIdx(0); inputRef.current?.focus(); }} />
          )}
          {/* Mention menu */}
          {showMention && (
            <MentionMenu query={mentionQuery} idx={mentionIdx} onSelect={id => { setInput(input.replace(/@[\w-]*$/, id + ' ')); setMentionIdx(0); inputRef.current?.focus(); }} />
          )}

          <div className={`flex items-center gap-2 bg-elevated rounded-xl px-4 py-2.5 border transition-colors ${showSlash || showMention ? 'border-accent/40 ring-1 ring-accent/20' : 'border-border-subtle'}`}>
            {/* Attachment */}
            <button className="text-dim hover:text-secondary transition-colors shrink-0" title="Attach file">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"
                strokeLinecap="round" strokeLinejoin="round">
                <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
              </svg>
            </button>

            <input
              ref={inputRef}
              value={input}
              onChange={e => { setInput(e.target.value); setSlashIdx(0); setMentionIdx(0); }}
              onKeyDown={handleKeyDown}
              className="flex-1 bg-transparent text-sm text-primary placeholder:text-dim outline-none"
              placeholder="Message… (/ for commands, @ to mention)"
            />

            <div className="flex items-center gap-1 shrink-0">
              <kbd className="text-[10px] text-dim bg-surface border border-border-subtle rounded px-1.5 py-0.5 font-mono">
                /
              </kbd>
              <kbd className="text-[10px] text-dim bg-surface border border-border-subtle rounded px-1.5 py-0.5 font-mono">
                @
              </kbd>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

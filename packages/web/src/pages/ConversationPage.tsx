import { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ChatView } from '../components/chat/ChatView';
import { ConversationTree } from '../components/ConversationTree';
import { MOCK_CONVERSATIONS, type MockConversation } from '../data/mockConversations';
import type { MessageBlock } from '../types';
import { useSessionDetail } from '../hooks/useSessions';
import { useSessionStream } from '../hooks/useSessionStream';
import { api } from '../api';
import type { DisplayBlock } from '../types';
import { useLiveTitles } from '../contexts';

// ── Model picker ──────────────────────────────────────────────────────────────

interface ModelInfo { id: string; provider: string; name: string; context: number; }

function useModels() {
  const [models, setModels]        = useState<ModelInfo[]>([]);
  const [currentModel, setCurrent] = useState<string>('');
  useEffect(() => {
    fetch('/api/models')
      .then(r => r.json())
      .then((d: { currentModel: string; models: ModelInfo[] }) => {
        setModels(d.models); setCurrent(d.currentModel);
      }).catch(() => {});
  }, []);
  return { models, currentModel, setCurrent };
}

function ModelPicker({ models, currentModel, idx, onSelect, onClose }:
  { models: ModelInfo[]; currentModel: string; idx: number; onSelect: (id: string) => void; onClose: () => void }) {
  if (!models.length) return null;
  const groups: Record<string, ModelInfo[]> = {};
  for (const m of models) { (groups[m.provider] ??= []).push(m); }
  const flat = models;
  const sel  = flat[((idx % flat.length) + flat.length) % flat.length];
  const fmtCtx = (n: number) => n >= 1_000_000 ? `${n / 1_000_000}M` : `${n / 1_000}k`;

  return (
    <div className="absolute bottom-full left-0 right-0 mb-2 bg-surface border border-border-default rounded-xl shadow-xl overflow-hidden z-50">
      <div className="px-3 pt-2.5 pb-1.5 border-b border-border-subtle flex items-center justify-between">
        <p className="text-[10px] uppercase tracking-wider text-dim font-medium">Switch model</p>
        <button onClick={onClose} className="text-[11px] text-dim hover:text-primary">esc</button>
      </div>
      {Object.entries(groups).map(([provider, ms]) => (
        <div key={provider}>
          <p className="px-3 pt-2 pb-0.5 text-[9px] uppercase tracking-widest text-dim/60 font-semibold">{provider}</p>
          {ms.map(m => {
            const isCurrent = m.id === currentModel;
            const isFocused = m.id === sel?.id;
            return (
              <button key={m.id} onMouseDown={e => { e.preventDefault(); onSelect(m.id); }}
                className={`w-full flex items-center gap-3 px-3 py-2 text-left transition-colors ${
                  isFocused ? 'bg-elevated text-primary' : 'text-secondary hover:bg-elevated/50'
                }`}>
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isCurrent ? 'bg-accent' : 'bg-transparent border border-border-default'}`} />
                <span className="flex-1 text-[13px] font-medium">{m.name}</span>
                <span className="font-mono text-[11px] text-dim">{m.id}</span>
                <span className="text-[10px] text-dim/60 shrink-0">{fmtCtx(m.context)}</span>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

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
  { cmd: '/tree',        icon: '⎇',  desc: 'Open session tree'          },
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

interface TokenCounts {
  sys: number;
  user: number;
  asst: number;
  tool: number;
  contextWindow: number;
}

interface ContextBarProps {
  conv?: MockConversation;
  messageCount?: number;
  model?: string;
  tokens?: TokenCounts;
}

function estimateTokens(chars: number) { return Math.ceil(chars / 4); }

function computeTokensFromBlocks(blocks: DisplayBlock[], contextWindow: number): TokenCounts {
  let user = 0, asst = 0, tool = 0;
  for (const b of blocks) {
    if (b.type === 'user') {
      user += estimateTokens(b.text.length);
    } else if (b.type === 'text' || b.type === 'thinking') {
      asst += estimateTokens(b.text.length);
    } else if (b.type === 'tool_use') {
      tool += estimateTokens(JSON.stringify(b.input).length + b.output.length);
    }
  }
  return { sys: 0, user, asst, tool, contextWindow };
}

function ContextBar({ conv, messageCount, model, tokens }: ContextBarProps) {
  const win   = tokens?.contextWindow ?? conv?.contextWindow  ?? 200_000;
  const sys   = tokens?.sys  ?? conv?.systemTokens    ?? 0;
  const user  = tokens?.user ?? conv?.userTokens      ?? 0;
  const asst  = tokens?.asst ?? conv?.assistantTokens ?? 0;
  const tool  = tokens?.tool ?? conv?.toolTokens      ?? 0;
  const total = sys + user + asst + tool;
  const hasTokens = total > 0;

  const pct = hasTokens ? (total / win) * 100 : 0;
  const w = (n: number) => `${(n / win) * 100}%`;

  return (
    <div className="px-4 py-2 border-t border-border-subtle space-y-1.5">
      {/* Segmented bar */}
      <div className="flex h-1.5 rounded-full bg-elevated overflow-hidden gap-px">
        {hasTokens ? <>
          {sys  > 0 && <div className="rounded-l-full bg-border-default/80" style={{ width: w(sys)  }} title={`system: ${sys.toLocaleString()}`} />}
          <div className={`${sys === 0 ? 'rounded-l-full' : ''} bg-teal/60`}   style={{ width: w(user) }} title={`user: ${user.toLocaleString()}`} />
          <div className="bg-accent/70" style={{ width: w(asst) }} title={`assistant: ${asst.toLocaleString()}`} />
          <div className="rounded-r-full bg-steel/60"  style={{ width: w(tool) }} title={`tool: ${tool.toLocaleString()}`} />
        </> : (
          <div className="rounded-full bg-border-default/30 w-full" />
        )}
      </div>
      {/* Legend */}
      <div className="flex items-center gap-3 text-[10px]">
        {hasTokens ? <>
        {sys > 0 && (
          <span className="flex items-center gap-1 text-dim">
            <span className="w-2 h-1.5 rounded-sm bg-border-default/80 inline-block" />
            sys {(sys / 1000).toFixed(1)}k
          </span>
        )}
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
        </> : (
          <span className="text-dim">
            {messageCount ?? 0} messages
            {model && <span className="ml-2 font-mono opacity-60">{model}</span>}
          </span>
        )}
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
  const navigate = useNavigate();
  const mockConv = id ? MOCK_CONVERSATIONS[id] : undefined;

  // ── Live session detection ─────────────────────────────────────────────────
  // Always attempt SSE connection — useSessionStream handles 404 gracefully.
  // We use a confirmed-live flag only for UI badge / resume button logic.
  const [confirmedLive, setConfirmedLive] = useState<boolean | null>(null);
  const [resuming, setResuming] = useState(false);

  // ── Pi SDK stream — attempt connection immediately for all real sessions ──
  const stream = useSessionStream(!mockConv && !!id ? id : null);

  // Confirm live status via API (for badge + resume button, not for stream)
  useEffect(() => {
    if (!id || mockConv) { setConfirmedLive(false); return; }
    api.liveSession(id)
      .then(r => setConfirmedLive(r.live))
      .catch(() => setConfirmedLive(false));
  }, [id, mockConv]);

  // Session is "live" if SSE connected (has blocks) OR API confirms it
  const isLiveSession = stream.blocks.length > 0 || stream.isStreaming || confirmedLive === true;
  const liveStatus = confirmedLive;

  // ── Existing session data (read-only JSONL) ───────────────────────────────
  const { detail: sessionDetail, loading: sessionLoading } = useSessionDetail(
    mockConv ? undefined : id
  );

  // ── Resolve what to display ───────────────────────────────────────────────
  const conv: MockConversation | undefined = mockConv;

  // Historical messages from the JSONL snapshot (doesn't update after load)
  const baseMessages: MessageBlock[] = sessionDetail
    ? sessionDetail.blocks.map(displayBlockToMessageBlock)
    : [];

  // When live, combine snapshot + stream; when not, show snapshot only
  const realMessages: MessageBlock[] | undefined = mockConv
    ? undefined
    : isLiveSession
      ? [...baseMessages, ...stream.blocks]
      : sessionDetail
        ? baseMessages
        : undefined;

  const { setTitle: pushTitle } = useLiveTitles();
  useEffect(() => {
    if (id && stream.title) pushTitle(id, stream.title);
  }, [id, stream.title, pushTitle]);

  const title = conv?.title
    ?? stream.title
    ?? sessionDetail?.meta.title
    ?? id?.replace(/-/g, ' ')
    ?? 'New conversation';
  const model = conv?.model ?? sessionDetail?.meta.model;
  const messageCount = conv?.messages.length ?? (realMessages?.length ?? 0);

  // Model
  const { models, currentModel, setCurrent } = useModels();

  // Token estimates from real session blocks
  const sessionTokens = useMemo(() => {
    // Live session: use SDK token counts if available
    if (isLiveSession && stream.tokens) {
      const modelInfo = models.find(m => m.id === (currentModel || model));
      const win = modelInfo?.context ?? 200_000;
      const total = stream.tokens.input + stream.tokens.output;
      return {
        sys: 0, user: stream.tokens.input, asst: stream.tokens.output, tool: 0,
        total, contextWindow: win, pct: Math.round((total / win) * 100),
      } as TokenCounts;
    }
    if (!sessionDetail) return undefined;
    const modelInfo = models.find(m => m.id === (currentModel || model));
    const contextWindow = modelInfo?.context ?? 128_000;
    return computeTokensFromBlocks(sessionDetail.blocks, contextWindow);
  }, [isLiveSession, stream.tokens, sessionDetail, models, currentModel, model]);
  const [modelNotice, setModelNotice] = useState<string | null>(null);
  const [modelIdx, setModelIdx] = useState(0);

  // Input state
  const [input, setInput] = useState('');
  const [slashIdx, setSlashIdx] = useState(0);
  const [mentionIdx, setMentionIdx] = useState(0);
  const [attachments, setAttachments] = useState<File[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [atBottom, setAtBottom] = useState(true);
  const [showTree, setShowTree] = useState(false);

  // Pending steer/followup queue — cleared when the agent finishes its run
  type PendingMsg = { id: string; text: string; type: 'steer' | 'followUp' };
  const [pendingQueue, setPendingQueue] = useState<PendingMsg[]>([]);
  const prevStreamingRef = useRef(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef   = useRef<HTMLDivElement>(null);

  // Derive menu states — /model needs exact match including trailing space
  const slashMatch    = input.match(/^(\/[\w]*)$/);
  const showModelPicker = input === '/model ';
  const mentionMatch  = input.match(/(^|.*\s)(@[\w-]*)$/);
  const showSlash     = !!slashMatch && !showModelPicker;
  const showMention   = !!mentionMatch && !showSlash && !showModelPicker;
  const slashQuery    = slashMatch?.[1] ?? '';
  const mentionQuery  = mentionMatch?.[2] ?? '';

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
    el.addEventListener('scroll', handleScroll);
    return () => el.removeEventListener('scroll', handleScroll);
  }, [handleScroll]);

  // Scroll to bottom when navigating to a new session.
  // useLayoutEffect fires synchronously after DOM commit so scrollHeight is accurate.
  // The flag is reset on id change so each new session gets one initial scroll.
  const shouldScrollToBottomRef = useRef(true);
  useEffect(() => {
    shouldScrollToBottomRef.current = true;
  }, [id]);
  useLayoutEffect(() => {
    if (!shouldScrollToBottomRef.current) return;
    const messages = realMessages ?? (conv ? conv.messages : undefined);
    if (!messages?.length || !scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    shouldScrollToBottomRef.current = false;
  });

  // Esc+Esc → open tree
  useEffect(() => {
    let lastEsc = 0;
    function handler(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      if (showTree) return; // let tree handle its own Esc
      const now = Date.now();
      if (now - lastEsc < 500) { setShowTree(true); lastEsc = 0; }
      else lastEsc = now;
    }
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [showTree]);

  // Auto-scroll when streaming adds new content
  useEffect(() => {
    if (!stream.isStreaming) return;
    if (atBottom && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [stream.blocks.length, stream.isStreaming, atBottom]);

  // Focus input on navigation
  useEffect(() => { textareaRef.current?.focus(); }, [id]);

  // Clear pending queue when agent finishes its run
  useEffect(() => {
    if (prevStreamingRef.current && !stream.isStreaming) {
      setPendingQueue([]);
    }
    prevStreamingRef.current = stream.isStreaming;
  }, [stream.isStreaming]);

  // Jump to message by index
  const jumpToMessage = useCallback((index: number) => {
    const el = scrollRef.current?.querySelector(`#msg-${index}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, []);

  function selectModel(modelId: string) {
    setCurrent(modelId);
    setInput('');
    setModelIdx(0);
    const m = models.find(x => x.id === modelId);
    if (m) { setModelNotice(m.name); setTimeout(() => setModelNotice(null), 2500); }
    textareaRef.current?.focus();
    // Persist to settings.json
    api.setModel(modelId).catch(console.error);
  }

  // /clear — destroy current session, create new one in same cwd
  async function handleClear() {
    if (!id) return;
    if (stream.isStreaming) await stream.abort();
    await api.destroySession(id).catch(() => {});
    const cwd = sessionDetail?.meta.cwd ?? undefined;
    const { id: newId } = await api.createLiveSession(cwd);
    navigate(`/conversations/${newId}`);
  }

  // /run <cmd> — run a shell command and show output as a system message
  async function handleRun(command: string) {
    if (!command.trim()) return;
    if (isLiveSession) {
      // Let the agent run it with its bash tool
      stream.send(`Run this shell command and show me the output:\n\`\`\`\n${command}\n\`\`\``);
    }
  }

  // Generic send-to-agent helper for slash shortcut commands
  function sendToAgent(text: string) {
    if (isLiveSession && text.trim()) stream.send(text);
  }

  // Keyboard handling
  async function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (showModelPicker) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setModelIdx(i => (i + 1) % models.length); return; }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setModelIdx(i => (i - 1 + models.length) % models.length); return; }
      if (e.key === 'Escape')    { e.preventDefault(); setInput(''); return; }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const sel = models[modelIdx % models.length];
        if (sel) selectModel(sel.id);
        return;
      }
    }
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
    // Alt+Enter = queue as follow-up (runs after agent finishes current turn)
    if (e.key === 'Enter' && e.altKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      const text = input.trim();
      if (!text || !isLiveSession) return;
      setInput('');
      setAttachments([]);
      const pid = `${Date.now()}-${Math.random()}`;
      setPendingQueue(q => [...q, { id: pid, text, type: 'followUp' }]);
      stream.send(text, 'followUp');
      return;
    }

    // Enter = send (Shift+Enter = newline)
    if (e.key === 'Enter' && !e.shiftKey && !e.altKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      const text = input.trim();
      if (!text) return;
      setInput('');
      setAttachments([]);

      // Handle slash commands
      if (text === '/clear')           { void handleClear(); return; }
      if (text.startsWith('/run '))    { void handleRun(text.slice(5)); return; }
      if (text.startsWith('/search ')) { sendToAgent(`Search the web for: ${text.slice(8)}`); return; }
      if (text === '/summarize')       { sendToAgent('Summarize our conversation so far concisely.'); return; }
      if (text === '/think')           { sendToAgent('Think step-by-step about our conversation so far and share your reasoning.'); return; }
      if (text.startsWith('/think '))  { sendToAgent(`Think step-by-step about: ${text.slice(7)}`); return; }
      if (text === '/fork' && id && isLiveSession) {
        void (async () => {
          try {
            const entries = await api.forkEntries(id);
            if (entries.length === 0) { sendToAgent('(No forkable messages yet)'); return; }
            // Fork at most recent message
            const { newSessionId } = await api.forkSession(id, entries[entries.length - 1].entryId);
            navigate(`/conversations/${newSessionId}`);
          } catch (err) {
            console.error('Fork failed:', err);
          }
        })();
        return;
      }

      if (isLiveSession) {
        if (stream.isStreaming) {
          // Agent is running — queue as a steering message injected mid-run
          const pid = `${Date.now()}-${Math.random()}`;
          setPendingQueue(q => [...q, { id: pid, text, type: 'steer' }]);
          stream.send(text, 'steer');
        } else {
          stream.send(text);
        }
        setTimeout(() => {
          if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }, 50);
      } else if (sessionDetail) {
        // Auto-resume: activate the session then send
        try {
          await api.resumeSession(sessionDetail.meta.file);
          setLiveStatus(true);
          // Small delay to let the stream connect before sending
          setTimeout(() => stream.send(text), 150);
        } catch (err) {
          console.error('Auto-resume failed:', err);
        }
      }
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

  async function handleResume() {
    if (!id || !sessionDetail) return;
    setResuming(true);
    try {
      await api.resumeSession(sessionDetail.meta.file);
      setLiveStatus(true);
    } catch (err) {
      console.error('Resume failed:', err);
    } finally {
      setResuming(false);
    }
  }

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
                <span className="text-[11px] text-dim truncate max-w-[160px]" title={sessionDetail.meta.cwd}>
                  {sessionDetail.meta.cwd.split('/').slice(-2).join('/')}
                </span>
              </>
            )}
          </div>
        </div>

        {/* Streaming: running indicator + abort */}
        {stream.isStreaming && (
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-accent/10 border border-accent/20">
              <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse shrink-0" />
              <span className="text-[10px] text-accent font-medium">running</span>
            </div>
            <button onClick={() => stream.abort()}
              className="px-2 py-1 text-[11px] rounded-lg bg-danger/10 border border-danger/20 text-danger hover:bg-danger/20 transition-colors">
              ■ stop
            </button>
          </div>
        )}

        {conv      && <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-elevated text-dim border border-border-subtle">mock</span>}
        {isLiveSession && <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-accent/10 text-accent border border-accent/20">live</span>}
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

      {/* Input area */}
      <div
        className={`px-4 pb-4 pt-2 transition-colors ${dragOver ? 'bg-accent/5' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <div className="relative">
          {showSlash   && <SlashMenu   query={slashQuery}   idx={slashIdx}   onSelect={cmd => {
            const c = cmd.trim();
            if (c === '/tree')       { setInput(''); setShowTree(true); return; }
            if (c === '/clear')      { setInput(''); void handleClear(); return; }
            if (c === '/summarize')  { setInput(''); sendToAgent('Summarize our conversation so far concisely.'); return; }
            if (c === '/think')      { setInput(''); sendToAgent('Think step-by-step about our conversation so far and share your reasoning.'); return; }
            if (c === '/fork' && id && isLiveSession) {
              setInput('');
              void api.forkEntries(id).then(entries => {
                if (entries.length === 0) return;
                return api.forkSession(id, entries[entries.length - 1].entryId)
                  .then(({ newSessionId }) => navigate(`/conversations/${newSessionId}`));
              }).catch(console.error);
              return;
            }
            setInput(cmd); setSlashIdx(0); textareaRef.current?.focus();
          }} />}
          {showMention && <MentionMenu query={mentionQuery} idx={mentionIdx} onSelect={id  => { setInput(input.replace(/@[\w-]*$/, id + ' ')); setMentionIdx(0); textareaRef.current?.focus(); }} />}
          {showModelPicker && <ModelPicker models={models} currentModel={currentModel} idx={modelIdx}
            onSelect={selectModel} onClose={() => { setInput(''); textareaRef.current?.focus(); }} />}

          <div className={`rounded-xl border transition-all ${
            dragOver          ? 'border-accent/50 ring-2 ring-accent/20 bg-accent/5' :
            showModelPicker   ? 'border-accent/40 ring-1 ring-accent/15' :
            showSlash || showMention ? 'border-accent/40 ring-1 ring-accent/15' :
            'border-border-subtle'
          } bg-elevated`}>

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

            {/* Pending steer / follow-up queue */}
            {pendingQueue.length > 0 && (
              <div className="px-3 pt-2.5 pb-2 border-b border-border-subtle flex flex-col gap-1.5">
                <span className="text-[9px] font-semibold uppercase tracking-widest text-dim">Queued</span>
                {pendingQueue.map(msg => (
                  <div key={msg.id} className="flex items-center gap-2 min-w-0">
                    <span className={`shrink-0 inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full border ${
                      msg.type === 'steer'
                        ? 'bg-orange-500/10 text-orange-400 border-orange-500/20'
                        : 'bg-teal/10 text-teal border-teal/20'
                    }`}>
                      {msg.type === 'steer' ? '⤵ steer' : '↷ followup'}
                    </span>
                    <span className="flex-1 text-[11px] text-secondary truncate">{msg.text}</span>
                    <button
                      onClick={() => setPendingQueue(q => q.filter(m => m.id !== msg.id))}
                      className="shrink-0 text-dim hover:text-primary text-[13px] leading-none"
                    >×</button>
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

              <div className="flex items-center gap-1.5 shrink-0 mb-0.5">
                {isLiveSession && input.trim() && (
                  <button
                    onClick={() => {
                      const text = input.trim();
                      if (!text) return;
                      setInput(''); setAttachments([]);
                      if (stream.isStreaming) {
                        const pid = `${Date.now()}-${Math.random()}`;
                        setPendingQueue(q => [...q, { id: pid, text, type: 'steer' }]);
                        stream.send(text, 'steer');
                      } else {
                        stream.send(text);
                      }
                      setTimeout(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, 50);
                    }}
                    className="flex items-center gap-1 px-2 py-1 rounded-lg bg-accent text-[11px] font-semibold text-white hover:bg-accent/90 transition-colors"
                  >
                    {stream.isStreaming ? 'Steer' : 'Send'} <span className="opacity-60 text-[10px]">↵</span>
                  </button>
                )}
                {(!isLiveSession || !input.trim()) && (
                  <kbd className="text-[10px] text-dim bg-surface border border-border-subtle rounded px-1.5 py-0.5 font-mono leading-tight">↵</kbd>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Model switch notice */}
      {modelNotice && (
        <div className="mx-4 mb-1 px-3 py-1.5 rounded-lg bg-accent/10 border border-accent/20 text-[12px] text-accent text-center">
          Switched to {modelNotice}
        </div>
      )}

      {/* Context bar — always shown */}
      <ContextBar conv={conv} messageCount={messageCount} model={currentModel || model} tokens={sessionTokens} />

      {/* Session tree overlay */}
      {showTree && (realMessages ?? conv?.messages) && (
        <ConversationTree
          messages={realMessages ?? conv!.messages}
          onJump={jumpToMessage}
          onClose={() => setShowTree(false)}
          onFork={isLiveSession && id ? (blockIdx) => {
            // Fork at the nth user message — find its entryId via fork-entries
            const allMsgs = realMessages ?? conv?.messages ?? [];
            const userMsgsBefore = allMsgs.slice(0, blockIdx + 1).filter(b => b.type === 'user').length;
            void api.forkEntries(id).then(entries => {
              const entry = entries[userMsgsBefore - 1] ?? entries[entries.length - 1];
              if (!entry) return;
              return api.forkSession(id, entry.entryId).then(({ newSessionId }) => {
                navigate(`/conversations/${newSessionId}`);
              });
            }).catch(console.error);
          } : undefined}
        />
      )}
    </div>
  );
}

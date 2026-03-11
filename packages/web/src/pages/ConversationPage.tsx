import { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ChatView } from '../components/chat/ChatView';
import { ConversationRail } from '../components/chat/ConversationRailOverlay';
import { ConversationTree } from '../components/ConversationTree';
import { EmptyState, IconButton, LoadingState, PageHeader, Pill, cx } from '../components/ui';
import { MOCK_CONVERSATIONS, type MockConversation } from '../data/mockConversations';
import type { ContextUsageSegment, DisplayBlock, MessageBlock, PromptImageInput } from '../types';
import { useApi } from '../hooks';
import { useSessionDetail } from '../hooks/useSessions';
import { useSessionStream } from '../hooks/useSessionStream';
import { api } from '../api';
import { formatContextShareLabel, formatContextUsageLabel, formatContextWindowLabel, formatLiveSessionLabel, formatThinkingLevelLabel, getContextUsagePercent } from '../conversationHeader';
import { useLiveTitles } from '../contexts';
import { buildSlashMenuItems, parseSlashInput, type SlashMenuItem } from '../slashMenu';
import { filterModelPickerItems } from '../modelPicker';

// ── Model picker ──────────────────────────────────────────────────────────────

interface ModelInfo { id: string; provider: string; name: string; context: number; }

function useModels() {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [currentModel, setCurrent] = useState<string>('');
  const [currentThinkingLevel, setCurrentThinkingLevel] = useState<string>('');
  useEffect(() => {
    fetch('/api/models')
      .then(r => r.json())
      .then((d: { currentModel: string; currentThinkingLevel?: string; models: ModelInfo[] }) => {
        setModels(d.models);
        setCurrent(d.currentModel);
        setCurrentThinkingLevel(d.currentThinkingLevel ?? '');
      }).catch(() => {});
  }, []);
  return { models, currentModel, currentThinkingLevel, setCurrent };
}

function useLiveContextUsage(sessionId: string | null) {
  const [usage, setUsage] = useState<{ tokens: number | null; contextWindow?: number; modelId?: string } | null>(null);

  useEffect(() => {
    if (!sessionId) {
      setUsage(null);
      return;
    }

    let cancelled = false;

    const load = () => {
      api.liveSessionContextUsage(sessionId)
        .then((data) => {
          if (!cancelled) {
            setUsage(data);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setUsage(null);
          }
        });
    };

    load();
    const timer = setInterval(load, 2_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [sessionId]);

  return usage;
}

function ModelPicker({ models, currentModel, query, idx, onSelect, onClose }:
  { models: ModelInfo[]; currentModel: string; query: string; idx: number; onSelect: (id: string) => void; onClose: () => void }) {
  const groups: Record<string, ModelInfo[]> = {};
  for (const m of models) { (groups[m.provider] ??= []).push(m); }
  const flat = models;
  const sel  = flat.length > 0 ? flat[((idx % flat.length) + flat.length) % flat.length] : null;
  const fmtCtx = (n: number) => n >= 1_000_000 ? `${n / 1_000_000}M` : `${n / 1_000}k`;

  return (
    <div className="ui-menu-shell">
      <div className="ui-menu-header">
        <p className="ui-section-label">Switch model</p>
        <IconButton onClick={onClose} title="Close model picker" aria-label="Close model picker" compact>
          <span className="text-[11px] font-mono">esc</span>
        </IconButton>
      </div>
      {flat.length === 0 ? (
        <div className="px-3 py-4 text-[12px] text-dim">
          No models match <span className="font-mono text-secondary">{query}</span>
        </div>
      ) : Object.entries(groups).map(([provider, ms]) => (
        <div key={provider}>
          <p className="px-3 pt-2 pb-0.5 text-[9px] uppercase tracking-widest text-dim/60 font-semibold">{provider}</p>
          {ms.map(m => {
            const isCurrent = m.id === currentModel;
            const isFocused = m.id === sel?.id;
            return (
              <button
                key={m.id}
                onMouseDown={e => { e.preventDefault(); onSelect(m.id); }}
                className={cx('w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors', isFocused ? 'bg-elevated text-primary' : 'text-secondary hover:bg-elevated/50')}
              >
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isCurrent ? 'bg-accent' : 'bg-transparent border border-border-default'}`} />
                <span className="flex-1 text-[13px] font-medium truncate">{m.name}</span>
                <Pill tone={isCurrent ? 'accent' : 'muted'} mono>{m.id}</Pill>
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
      return { type: 'user', id: b.id, text: b.text, images: b.images, ts: b.ts };
    case 'text':
      return { type: 'text', id: b.id, text: b.text, ts: b.ts };
    case 'thinking':
      return { type: 'thinking', id: b.id, text: b.text, ts: b.ts };
    case 'tool_use':
      return { type: 'tool_use', id: b.id, tool: b.tool, input: b.input, output: b.output, durationMs: b.durationMs, ts: b.ts };
    case 'image':
      return { type: 'image', id: b.id, alt: b.alt, src: b.src, mimeType: b.mimeType, width: b.width, height: b.height, caption: b.caption, ts: b.ts };
    case 'error':
      return { type: 'error', id: b.id, tool: b.tool, message: b.message, ts: b.ts };
  }
}

// ── Slash commands ────────────────────────────────────────────────────────────

const MENTIONS = [
  { id: '@artifact-model', label: 'artifact-model', kind: 'workstream' },
  { id: '@web-ui',         label: 'web-ui',         kind: 'workstream' },
  { id: '@inbox',          label: 'inbox',          kind: 'view'       },
  { id: '@tasks',          label: 'tasks',          kind: 'view'       },
];

// ── Context bar ───────────────────────────────────────────────────────────────

interface TokenCounts {
  total: number | null;
  contextWindow: number;
  segments?: ContextUsageSegment[];
}

interface ContextBarProps {
  conv?: MockConversation;
  model?: string;
  thinkingLevel?: string;
  tokens?: TokenCounts;
}

const CONTEXT_SEGMENT_STYLES: Record<ContextUsageSegment['key'], string> = {
  system: 'bg-border-default',
  user: 'bg-teal/85',
  assistant: 'bg-accent/90',
  tool: 'bg-steel/90',
  summary: 'bg-warning/85',
  other: 'bg-border-default/80',
};

function ContextBar({ conv, model, thinkingLevel, tokens }: ContextBarProps) {
  const win = tokens?.contextWindow ?? conv?.contextWindow ?? 200_000;
  const fallbackSegments: ContextUsageSegment[] = [
    { key: 'system', label: 'system', tokens: conv?.systemTokens ?? 0 },
    { key: 'user', label: 'user', tokens: conv?.userTokens ?? 0 },
    { key: 'assistant', label: 'assistant', tokens: conv?.assistantTokens ?? 0 },
    { key: 'tool', label: 'tool', tokens: conv?.toolTokens ?? 0 },
  ].filter((segment) => segment.tokens > 0);
  const segments = (tokens?.segments ?? fallbackSegments)
    .filter((segment) => segment.tokens > 0)
    .map((segment) => ({
      ...segment,
      className: CONTEXT_SEGMENT_STYLES[segment.key] ?? 'bg-border-default/60',
      title: formatContextShareLabel(segment.label, segment.tokens, win),
    }));
  const total = tokens?.total ?? segments.reduce((sum, segment) => sum + segment.tokens, 0);
  const pct = getContextUsagePercent(total, win);
  const w = (n: number) => `${Math.max(0, Math.min(100, (n / win) * 100))}%`;
  const thinkingLabel = formatThinkingLevelLabel(thinkingLevel);
  const segmentTotal = segments.reduce((sum, segment) => sum + segment.tokens, 0);
  const canRenderSegments = total !== null && segmentTotal > 0;
  const filledWidth = total === null ? '100%' : w(total);

  return (
    <div className="mt-1 min-w-0 text-[10px] text-secondary">
      <div className="flex min-w-0 items-center gap-3 overflow-hidden">
        {model && (
          <span className="inline-flex min-w-0 items-baseline gap-1.5">
            <span className="uppercase tracking-[0.14em] text-dim/65">model</span>
            <span className="truncate font-mono text-dim">{model}</span>
          </span>
        )}
        {model && <span className="h-3.5 w-px shrink-0 bg-border-subtle/70" aria-hidden="true" />}
        <span className="inline-flex min-w-0 items-baseline gap-1.5 whitespace-nowrap">
          <span className="uppercase tracking-[0.14em] text-dim/65">thinking</span>
          <span className="font-mono text-primary">{thinkingLabel}</span>
        </span>
        <span className="h-3.5 w-px shrink-0 bg-border-subtle/70" aria-hidden="true" />
        <span className="inline-flex min-w-0 items-center gap-1.5 whitespace-nowrap overflow-hidden">
          <span className="uppercase tracking-[0.14em] text-dim/65">context</span>
          <span
            className="h-2 w-20 shrink-0 overflow-hidden rounded-full border border-border-default/70 bg-surface shadow-[inset_0_1px_1px_rgba(0,0,0,0.18)]"
            title={total === null
              ? 'Current context usage is unknown right now (common immediately after compaction).'
              : `${pct?.toFixed(1) ?? '0.0'}% of ${formatContextWindowLabel(win)} context window`}
          >
            {total !== null ? (
              <span className="flex h-full min-w-0 overflow-hidden rounded-full" style={{ width: filledWidth }}>
                {canRenderSegments ? segments.map((segment, index) => (
                  <span
                    key={segment.key}
                    className={`h-full ${segment.className} ${index === 0 ? 'rounded-l-full' : ''} ${index === segments.length - 1 ? 'rounded-r-full' : ''}`}
                    style={{ flexGrow: segment.tokens, flexBasis: 0, minWidth: '2px' }}
                    title={segment.title}
                  />
                )) : (
                  <span className="h-full w-full rounded-full bg-accent/95" />
                )}
              </span>
            ) : <span className="block h-full w-full rounded-full bg-border-default/25" />}
          </span>
          <span className="font-mono text-dim tabular-nums">{formatContextUsageLabel(total, win)}</span>
        </span>
      </div>
    </div>
  );
}

// ── SlashMenu ─────────────────────────────────────────────────────────────────

function SlashMenu({ items, idx, onSelect }: { items: SlashMenuItem[]; idx: number; onSelect: (item: SlashMenuItem) => void }) {
  if (!items.length) return null;

  return (
    <div className="ui-menu-shell max-h-[28rem] overflow-y-auto py-1.5">
      {items.map((item, itemIndex) => (
        <button
          key={item.key}
          onMouseDown={(event) => { event.preventDefault(); onSelect(item); }}
          className={cx('w-full flex items-start gap-3 px-3 py-2.5 text-left transition-colors', itemIndex === idx % items.length ? 'bg-elevated text-primary' : 'text-secondary hover:bg-elevated/50')}
        >
          <span className="w-5 pt-0.5 text-center text-[13px] select-none text-dim/70">{item.icon}</span>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <span className="min-w-0 max-w-[26rem] truncate whitespace-nowrap font-mono text-[12px] text-accent">
                {item.displayCmd}
              </span>
              {item.source && (
                <span className="shrink-0 text-[10px] uppercase tracking-[0.14em] text-dim/60">
                  {item.source}
                </span>
              )}
            </div>
            <p className="mt-0.5 truncate text-[12px] text-dim/90">{item.desc}</p>
          </div>
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
    <div className="ui-menu-shell">
      <div className="px-3 pt-2 pb-1">
        <p className="ui-section-label">Mention</p>
      </div>
      {filtered.map((m, i) => (
        <button
          key={m.id}
          onMouseDown={e => { e.preventDefault(); onSelect(m.id + ' '); }}
          className={cx('w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors', i === idx % filtered.length ? 'bg-elevated text-primary' : 'text-secondary hover:bg-elevated/50')}
        >
          <Pill tone="muted">{m.kind}</Pill>
          <span className="font-mono text-[13px] text-accent truncate">{m.id}</span>
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

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error(`Failed to read ${file.name}`));
    };
    reader.onerror = () => reject(reader.error ?? new Error(`Failed to read ${file.name}`));
    reader.readAsDataURL(file);
  });
}

async function buildPromptImages(files: File[]): Promise<PromptImageInput[]> {
  const imageFiles = files.filter((file) => file.type.startsWith('image/'));
  const images = await Promise.all(imageFiles.map(async (file) => {
    const previewUrl = await readFileAsDataUrl(file);
    const commaIndex = previewUrl.indexOf(',');
    return {
      name: file.name,
      mimeType: file.type || 'image/png',
      data: commaIndex >= 0 ? previewUrl.slice(commaIndex + 1) : previewUrl,
      previewUrl,
    } satisfies PromptImageInput;
  }));
  return images;
}

// ── ConversationPage ──────────────────────────────────────────────────────────

export function ConversationPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const mockConv = id ? MOCK_CONVERSATIONS[id] : undefined;

  // ── Live session detection ─────────────────────────────────────────────────
  // Always attempt SSE connection — useSessionStream handles 404 gracefully.
  // We use a confirmed-live flag only for lightweight session-state labeling.
  const [confirmedLive, setConfirmedLive] = useState<boolean | null>(null);

  // ── Pi SDK stream — attempt connection immediately for all real sessions ──
  const stream = useSessionStream(!mockConv && !!id ? id : null);

  // Confirm live status via API (for session-state labeling, not for stream)
  useEffect(() => {
    if (!id || mockConv) { setConfirmedLive(false); return; }
    api.liveSession(id)
      .then(r => setConfirmedLive(r.live))
      .catch(() => setConfirmedLive(false));
  }, [id, mockConv]);

  // Session is "live" if SSE connected (has blocks) OR API confirms it
  const isLiveSession = stream.blocks.length > 0 || stream.isStreaming || confirmedLive === true;

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

  const [titleOverride, setTitleOverride] = useState<string | null>(null);

  const title = titleOverride
    ?? conv?.title
    ?? stream.title
    ?? sessionDetail?.meta.title
    ?? id?.replace(/-/g, ' ')
    ?? 'New conversation';
  const model = conv?.model ?? sessionDetail?.meta.model;

  // Model
  const { models, currentModel, currentThinkingLevel, setCurrent } = useModels();
  const liveContextUsage = useLiveContextUsage(isLiveSession && id ? id : null);

  // Current context usage (compaction-aware)
  const sessionTokens = useMemo(() => {
    if (isLiveSession) {
      const modelInfo = models.find(m => m.id === (liveContextUsage?.modelId || currentModel || model));
      return {
        total: liveContextUsage?.tokens ?? null,
        contextWindow: liveContextUsage?.contextWindow ?? modelInfo?.context ?? 200_000,
        segments: liveContextUsage?.segments,
      } satisfies TokenCounts;
    }

    if (!sessionDetail) return undefined;

    const historicalUsage = sessionDetail.contextUsage;
    const modelInfo = models.find(m => m.id === (historicalUsage?.modelId || currentModel || model));
    return {
      total: historicalUsage?.tokens ?? null,
      contextWindow: modelInfo?.context ?? 128_000,
      segments: historicalUsage?.segments,
    } satisfies TokenCounts;
  }, [isLiveSession, liveContextUsage, sessionDetail, models, currentModel, model]);
  const [notice, setNotice] = useState<{ tone: 'accent' | 'danger'; text: string } | null>(null);
  const [modelIdx, setModelIdx] = useState(0);
  const noticeTimeoutRef = useRef<number | null>(null);

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
  const { data: memoryData, refetch: refetchMemoryData } = useApi(api.memory);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef   = useRef<HTMLDivElement>(null);

  // Derive menu states
  const slashInput = useMemo(() => parseSlashInput(input), [input]);
  const showModelPicker = slashInput?.command === '/model' && input.startsWith('/model ');
  const mentionMatch  = input.match(/(^|.*\s)(@[\w-]*)$/);
  const showSlash     = !!slashInput && input === slashInput.command && !showModelPicker;
  const showMention   = !!mentionMatch && !showSlash && !showModelPicker;
  const slashQuery    = slashInput?.command ?? '';
  const modelQuery    = showModelPicker ? slashInput?.argument ?? '' : '';
  const mentionQuery  = mentionMatch?.[2] ?? '';
  const slashItems = useMemo(() => buildSlashMenuItems(input, memoryData?.skills ?? []), [input, memoryData]);
  const modelItems = useMemo(() => filterModelPickerItems(models, modelQuery), [models, modelQuery]);

  // Auto-resize textarea
  const resize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, []);

  useEffect(() => { resize(); }, [input, resize]);
  useEffect(() => { setSlashIdx(0); }, [slashQuery]);
  useEffect(() => { setModelIdx(0); }, [modelQuery]);

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
  function sendToAgent(text: string, images?: PromptImageInput[]) {
    if (isLiveSession && (text.trim() || (images?.length ?? 0) > 0)) {
      stream.send(text, undefined, images);
    }
  }

  function addImageAttachments(files: File[]) {
    const imageFiles = files.filter((file) => file.type.startsWith('image/'));
    if (imageFiles.length > 0) {
      setAttachments((prev) => [...prev, ...imageFiles]);
    }
  }

  function openFilePicker() {
    fileInputRef.current?.click();
  }

  async function submitComposer(behavior?: 'steer' | 'followUp') {
    const text = input.trim();
    const pendingAttachments = attachments;
    if (!text && pendingAttachments.length === 0) return;

    try {
      const promptImages = await buildPromptImages(pendingAttachments);
      setInput('');
      setAttachments([]);

      if (promptImages.length === 0) {
        if (text === '/clear')           { await handleClear(); return; }
        if (text === '/image')           { openFilePicker(); return; }
        if (text.startsWith('/run '))    { await handleRun(text.slice(5)); return; }
        if (text.startsWith('/search ')) { sendToAgent(`Search the web for: ${text.slice(8)}`); return; }
        if (text === '/summarize')       { sendToAgent('Summarize our conversation so far concisely.'); return; }
        if (text === '/think')           { sendToAgent('Think step-by-step about our conversation so far and share your reasoning.'); return; }
        if (text.startsWith('/think '))  { sendToAgent(`Think step-by-step about: ${text.slice(7)}`); return; }
        if (text === '/fork' && id && isLiveSession) {
          try {
            const entries = await api.forkEntries(id);
            if (entries.length === 0) { sendToAgent('(No forkable messages yet)'); return; }
            const { newSessionId } = await api.forkSession(id, entries[entries.length - 1].entryId);
            navigate(`/conversations/${newSessionId}`);
          } catch (err) {
            console.error('Fork failed:', err);
          }
          return;
        }
      }

      const queuedBehavior = behavior ?? (isLiveSession && stream.isStreaming ? 'steer' : undefined);
      const queueLabel = text || (promptImages.length === 1 ? '1 image attached' : `${promptImages.length} images attached`);

      if (isLiveSession) {
        if (queuedBehavior === 'steer' || queuedBehavior === 'followUp') {
          const pid = `${Date.now()}-${Math.random()}`;
          setPendingQueue((q) => [...q, { id: pid, text: queueLabel, type: queuedBehavior }]);
        }
        stream.send(text, queuedBehavior, promptImages);
        setTimeout(() => {
          if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }, 50);
      } else if (sessionDetail) {
        try {
          await api.resumeSession(sessionDetail.meta.file);
          setConfirmedLive(true);
          setTimeout(() => stream.send(text, queuedBehavior, promptImages), 150);
        } catch (err) {
          console.error('Auto-resume failed:', err);
        }
      }
    } catch (err) {
      console.error('Failed to prepare attachments:', err);
    }
  }

  function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(e.clipboardData.files).filter((file) => file.type.startsWith('image/'));
    if (files.length === 0) return;
    e.preventDefault();
    addImageAttachments(files);
  }

  // Keyboard handling
  async function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (showModelPicker) {
      if (e.key === 'Escape')    { e.preventDefault(); setInput(''); return; }
      if (modelItems.length === 0) {
        return;
      }
      if (e.key === 'ArrowDown') { e.preventDefault(); setModelIdx(i => (i + 1) % modelItems.length); return; }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setModelIdx(i => (i - 1 + modelItems.length) % modelItems.length); return; }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const sel = modelItems[modelIdx % modelItems.length];
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
          const sel = slashItems[slashIdx % (slashItems.length || 1)];
          if (sel) {
            if (sel.displayCmd === '/image') {
              setInput('');
              setSlashIdx(0);
              openFilePicker();
            } else {
              setInput(sel.insertText);
              setSlashIdx(0);
            }
          }
        } else {
          const q = mentionQuery.slice(1).toLowerCase();
          const filtered = MENTIONS.filter(m => !q || m.label.startsWith(q));
          const sel = filtered[mentionIdx % (filtered.length || 1)];
          if (sel) { setInput(input.replace(/@[\w-]*$/, sel.id + ' ')); setMentionIdx(0); }
        }
        return;
      }
    }
    if (e.key === 'Enter' && e.altKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      await submitComposer('followUp');
      return;
    }

    if (e.key === 'Enter' && !e.shiftKey && !e.altKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      await submitComposer();
    }
  }

  // Drag-and-drop
  function handleDragOver(e: React.DragEvent) { e.preventDefault(); setDragOver(true); }
  function handleDragLeave() { setDragOver(false); }
  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length) addImageAttachments(files);
  }
  function removeAttachment(i: number) {
    setAttachments(prev => prev.filter((_, j) => j !== i));
  }

  const composerHasContent = input.trim().length > 0 || attachments.length > 0;

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        className="gap-3 py-2"
        actions={(
          <div className="flex shrink-0 items-center gap-2.5 text-[10px] font-medium leading-none">
            {stream.isStreaming && (
              <>
                <span className="inline-flex items-center gap-1.5 text-accent">
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent animate-pulse" />
                  running
                </span>
                <button onClick={() => stream.abort()} className="text-danger transition-colors hover:text-danger/80">
                  stop
                </button>
              </>
            )}
            {conv && <span className="text-dim">mock</span>}
            {isLiveSession && <span className="text-accent">{formatLiveSessionLabel(isLiveSession)}</span>}
          </div>
        )}
      >
        <div className="flex-1 min-w-0">
          <h1 className="ui-page-title truncate">{title}</h1>
          <ContextBar conv={conv} model={currentModel || model} thinkingLevel={currentThinkingLevel} tokens={sessionTokens} />
        </div>
      </PageHeader>

      {/* Messages */}
      <div className="relative flex-1 min-h-0">
        <div ref={scrollRef} className="conversation-scroll-shell h-full overflow-y-auto overflow-x-hidden">
          {(conv || realMessages) ? (
            <ChatView messages={realMessages ?? conv!.messages} />
          ) : sessionLoading ? (
            <LoadingState label="Loading session…" className="justify-center h-full" />
          ) : (
            <EmptyState
              className="h-full flex flex-col justify-center px-8"
              icon={(
                <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center mx-auto">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="text-accent">
                    <path d="M20.25 8.511c.884.284 1.5 1.128 1.5 2.097v4.286c0 1.136-.847 2.1-1.98 2.193-.34.027-.68.052-1.02.072v3.091l-3-3c-1.354 0-2.694-.055-4.02-.163a2.115 2.115 0 0 1-.825-.242m9.345-8.334a2.126 2.126 0 0 0-.476-.095 48.64 48.64 0 0 0-8.048 0c-1.131.094-1.976 1.057-1.976 2.192v4.286c0 .837.46 1.58 1.155 1.951m9.345-8.334V6.637c0-1.621-1.152-3.026-2.76-3.235A48.455 48.455 0 0 0 11.25 3c-2.115 0-4.198.137-6.24.402-1.608.209-2.76 1.614-2.76 3.235v6.226c0 1.621 1.152 3.026 2.76 3.235.577.075 1.157.14 1.74.194V21l4.155-4.155" />
                  </svg>
                </div>
              )}
              title="New conversation"
              body="Start a Pi session to populate this conversation."
            />
          )}
          {!atBottom && (
            <button
              onClick={() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })}
              className="sticky bottom-4 left-1/2 -translate-x-1/2 ui-pill ui-pill-muted shadow-md"
            >
              ↓ scroll to bottom
            </button>
          )}
        </div>
        {(conv || realMessages) && (
          <ConversationRail
            messages={realMessages ?? conv!.messages}
            scrollContainerRef={scrollRef}
            onJumpToMessage={jumpToMessage}
          />
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
          {showSlash   && <SlashMenu items={slashItems} idx={slashIdx} onSelect={(item) => {
            const c = item.displayCmd.trim();
            if (c === '/tree')       { setInput(''); setShowTree(true); return; }
            if (c === '/clear')      { setInput(''); void handleClear(); return; }
            if (c === '/image')      { setInput(''); openFilePicker(); return; }
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
            setInput(item.insertText); setSlashIdx(0); textareaRef.current?.focus();
          }} />}
          {showMention && <MentionMenu query={mentionQuery} idx={mentionIdx} onSelect={id  => { setInput(input.replace(/@[\w-]*$/, id + ' ')); setMentionIdx(0); textareaRef.current?.focus(); }} />}
          {showModelPicker && <ModelPicker models={modelItems} currentModel={currentModel} query={modelQuery} idx={modelIdx}
            onSelect={selectModel} onClose={() => { setInput(''); textareaRef.current?.focus(); }} />}

          <div className={cx(
            'ui-input-shell',
            dragOver ? 'border-accent/50 ring-2 ring-accent/20 bg-accent/5' :
              showModelPicker || showSlash || showMention
                ? 'border-accent/40 ring-1 ring-accent/15'
                : 'border-border-subtle'
          )}>

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
                    <button onClick={() => removeAttachment(i)} className="ui-icon-button ui-icon-button-compact ml-0.5 shrink-0 leading-none" title={`Remove ${f.name}`}>
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Pending steer / follow-up queue */}
            {pendingQueue.length > 0 && (
              <div className="px-3 pt-2.5 pb-2 border-b border-border-subtle flex flex-col gap-1.5">
                <span className="ui-section-label">Queued</span>
                {pendingQueue.map(msg => (
                  <div key={msg.id} className="flex items-center gap-2 min-w-0">
                    <Pill tone={msg.type === 'steer' ? 'warning' : 'teal'}>
                      {msg.type === 'steer' ? '⤵ steer' : '↷ followup'}
                    </Pill>
                    <span className="flex-1 text-[11px] text-secondary truncate">{msg.text}</span>
                    <IconButton
                      onClick={() => setPendingQueue(q => q.filter(m => m.id !== msg.id))}
                      title="Remove queued message"
                      aria-label="Remove queued message"
                      compact
                    >
                      ×
                    </IconButton>
                  </div>
                ))}
              </div>
            )}

            {/* Textarea */}
            <div className="flex items-end gap-2 px-3 py-2.5">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  if (files.length > 0) addImageAttachments(files);
                  e.target.value = '';
                }}
              />

              <IconButton className="shrink-0 mb-0.5" title="Attach image" aria-label="Attach image" onClick={openFilePicker}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                </svg>
              </IconButton>

              <textarea
                ref={textareaRef}
                value={input}
                onChange={e => { setInput(e.target.value); setSlashIdx(0); setMentionIdx(0); resize(); }}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                rows={1}
                className="flex-1 bg-transparent text-sm text-primary placeholder:text-dim outline-none resize-none leading-relaxed"
                placeholder="Message… (/ for commands, @ to mention)"
                style={{ minHeight: '24px', maxHeight: '160px' }}
              />

              {composerHasContent && (
                <div className="shrink-0 mb-0.5">
                  <button
                    onClick={() => { void submitComposer(); }}
                    className="ui-pill ui-pill-solid-accent"
                  >
                    {stream.isStreaming ? 'Steer' : 'Send'}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Model switch notice */}
      {modelNotice && (
        <div className="mx-4 mb-1 text-center">
          <Pill tone="accent">Switched to {modelNotice}</Pill>
        </div>
      )}

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

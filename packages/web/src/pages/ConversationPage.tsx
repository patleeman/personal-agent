import { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo } from 'react';
import { useLocation, useParams, useNavigate } from 'react-router-dom';
import { ChatView } from '../components/chat/ChatView';
import { ConversationRail } from '../components/chat/ConversationRailOverlay';
import { ConversationTree } from '../components/ConversationTree';
import { EmptyState, IconButton, LoadingState, PageHeader, Pill, cx } from '../components/ui';
import type { ContextUsageSegment, DeferredResumeSummary, MessageBlock, ModelInfo, PromptImageInput } from '../types';
import { useApi } from '../hooks';
import { useSessionDetail } from '../hooks/useSessions';
import { useSessionStream } from '../hooks/useSessionStream';
import { api } from '../api';
import { appendComposerHistory, readComposerHistory } from '../composerHistory';
import { getConversationArtifactIdFromSearch, readArtifactPresentation, setConversationArtifactIdInSearch } from '../conversationArtifacts';
import { formatContextShareLabel, formatContextUsageLabel, formatContextWindowLabel, formatLiveSessionLabel, formatThinkingLevelLabel, getContextUsagePercent } from '../conversationHeader';
import { isConversationScrolledToBottom, shouldShowScrollToBottomControl } from '../conversationScroll';
import { getConversationDisplayTitle, NEW_CONVERSATION_TITLE } from '../conversationTitle';
import { emitConversationProjectsChanged, CONVERSATION_PROJECTS_CHANGED_EVENT } from '../conversationProjectEvents';
import { displayBlockToMessageBlock } from '../messageBlocks';
import { useAppData, useAppEvents, useLiveTitles } from '../contexts';
import { filterModelPickerItems } from '../modelPicker';
import { emitProjectsChanged } from '../projectEvents';
import { parseDeferredResumeSlashCommand } from '../deferredResumeSlashCommand';
import { parseProjectSlashCommand, type ProjectSlashCommand } from '../projectSlashCommand';
import { buildSlashMenuItems, parseSlashInput, type SlashMenuItem } from '../slashMenu';
import { buildMentionItems, filterMentionItems, resolveMentionItems, type MentionItem } from '../conversationMentions';
import { buildDeferredResumeIndicatorText, compareDeferredResumes, describeDeferredResumeStatus } from '../deferredResumeIndicator';
import { buildConversationComposerStorageKey, persistForkPromptDraft, resolveForkEntryForMessage } from '../forking';
import { buildDraftConversationComposerStorageKey, persistDraftConversationComposer } from '../draftConversation';
import {
  clearPendingConversationPrompt,
  persistPendingConversationPrompt,
  readPendingConversationPrompt,
  type PendingConversationPrompt,
} from '../pendingConversationPrompt';
import { resolveConversationComposerSubmitState } from '../conversationComposerSubmit';
import { useReloadState } from '../reloadState';
import { ensureConversationTabOpen } from '../sessionTabs';

// ── Model picker ──────────────────────────────────────────────────────────────

function useModels() {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [currentModel, setCurrent] = useState<string>('');
  const [currentThinkingLevel, setCurrentThinkingLevel] = useState<string>('');
  useEffect(() => {
    api.models()
      .then((data) => {
        setModels(data.models);
        setCurrent(data.currentModel);
        setCurrentThinkingLevel(data.currentThinkingLevel ?? '');
      })
      .catch(() => {});
  }, []);
  return { models, currentModel, currentThinkingLevel, setCurrent };
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

// ── Slash commands ────────────────────────────────────────────────────────────

// ── Context bar ───────────────────────────────────────────────────────────────

interface TokenCounts {
  total: number | null;
  contextWindow: number;
  segments?: ContextUsageSegment[];
}

interface ContextBarProps {
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

function ContextBar({ model, thinkingLevel, tokens }: ContextBarProps) {
  const win = tokens?.contextWindow ?? 200_000;
  const segments = (tokens?.segments ?? [])
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

function MentionMenu({
  items,
  query,
  idx,
  onSelect,
}: {
  items: MentionItem[];
  query: string;
  idx: number;
  onSelect: (id: string) => void;
}) {
  const filtered = filterMentionItems(items, query);
  if (!filtered.length) return null;
  return (
    <div className="ui-menu-shell">
      <div className="px-3 pt-2 pb-1">
        <p className="ui-section-label">Mention</p>
      </div>
      {filtered.map((item, i) => (
        <button
          key={`${item.kind}:${item.id}`}
          onMouseDown={(event) => { event.preventDefault(); onSelect(item.id); }}
          className={cx('w-full flex items-start gap-3 px-3 py-2.5 text-left transition-colors', i === idx % filtered.length ? 'bg-elevated text-primary' : 'text-secondary hover:bg-elevated/50')}
        >
          <Pill tone="muted">{item.kind}</Pill>
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[13px] text-accent truncate">{item.id}</p>
            {(item.summary || (item.title && item.title !== item.label)) && (
              <p className="mt-0.5 truncate text-[12px] text-dim/90">
                {item.summary || item.title}
              </p>
            )}
          </div>
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

function formatDeferredResumeWhen(resume: DeferredResumeSummary): string {
  const target = resume.status === 'ready'
    ? resume.readyAt ?? resume.dueAt
    : resume.dueAt;
  const date = new Date(target);
  if (Number.isNaN(date.getTime())) {
    return target;
  }

  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}


// ── ConversationPage ──────────────────────────────────────────────────────────

export function ConversationPage({ draft = false }: { draft?: boolean }) {
  const { id: routeId } = useParams<{ id?: string }>();
  const id = draft ? undefined : routeId;
  const location = useLocation();
  const navigate = useNavigate();
  const selectedArtifactId = getConversationArtifactIdFromSearch(location.search);

  const openArtifact = useCallback((artifactId: string) => {
    if (selectedArtifactId === artifactId) {
      return;
    }

    navigate({
      pathname: location.pathname,
      search: setConversationArtifactIdInSearch(location.search, artifactId),
    });
  }, [location.pathname, location.search, navigate, selectedArtifactId]);

  useEffect(() => {
    if (draft || !id) {
      return;
    }

    ensureConversationTabOpen(id);
  }, [draft, id]);

  // ── Live session detection ─────────────────────────────────────────────────
  // Always attempt SSE connection — useSessionStream handles 404 gracefully.
  // We use a confirmed-live flag only for lightweight session-state labeling.
  const [confirmedLive, setConfirmedLive] = useState<boolean | null>(null);

  // ── Pi SDK stream — attempt connection immediately for all sessions ───────
  const stream = useSessionStream(id ?? null);

  // Confirm live status via API (for session-state labeling, not for stream)
  useEffect(() => {
    if (!id) {
      setConfirmedLive(false);
      return;
    }

    setConfirmedLive(null);
    api.liveSession(id)
      .then(r => setConfirmedLive(r.live))
      .catch(() => setConfirmedLive(false));
  }, [id]);

  // Session is "live" if SSE connected (has blocks) OR API confirms it
  const isLiveSession = stream.blocks.length > 0 || stream.isStreaming || confirmedLive === true;

  // ── Existing session data (read-only JSONL) ───────────────────────────────
  const { detail: sessionDetail, loading: sessionLoading } = useSessionDetail(id);
  const visibleSessionDetail = sessionDetail?.meta.id === id ? sessionDetail : null;

  // Historical messages from the JSONL snapshot (doesn't update after load)
  const baseMessages: MessageBlock[] = visibleSessionDetail
    ? visibleSessionDetail.blocks.map(displayBlockToMessageBlock)
    : [];

  // Live sessions hydrate from the SSE snapshot; until that arrives, fall back to JSONL + live deltas.
  const realMessages: MessageBlock[] | undefined = isLiveSession
    ? stream.hasSnapshot
      ? stream.blocks
      : [...baseMessages, ...stream.blocks]
    : visibleSessionDetail
      ? baseMessages
      : undefined;
  const messageCount = realMessages?.length ?? 0;
  const artifactAutoOpenSeededRef = useRef(false);
  const processedArtifactAutoOpenIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    artifactAutoOpenSeededRef.current = false;
    processedArtifactAutoOpenIdsRef.current = new Set();
  }, [id]);

  useEffect(() => {
    if (!realMessages) {
      return;
    }

    if (!artifactAutoOpenSeededRef.current) {
      const completedArtifactIds = new Set<string>();
      for (const [index, block] of realMessages.entries()) {
        if (block.type !== 'tool_use') {
          continue;
        }

        const artifact = readArtifactPresentation(block);
        const blockKey = block._toolCallId ?? block.id ?? `artifact-${index}`;
        if (artifact && block.status !== 'running' && !block.running) {
          completedArtifactIds.add(blockKey);
        }
      }

      processedArtifactAutoOpenIdsRef.current = completedArtifactIds;
      artifactAutoOpenSeededRef.current = true;
      return;
    }

    for (let index = realMessages.length - 1; index >= 0; index -= 1) {
      const block = realMessages[index];
      if (block?.type !== 'tool_use') {
        continue;
      }

      const artifact = readArtifactPresentation(block);
      if (!artifact || !artifact.openRequested || block.status === 'running' || block.running) {
        continue;
      }

      const blockKey = block._toolCallId ?? block.id ?? `artifact-${index}`;
      if (processedArtifactAutoOpenIdsRef.current.has(blockKey)) {
        continue;
      }

      processedArtifactAutoOpenIdsRef.current.add(blockKey);
      openArtifact(artifact.artifactId);
      break;
    }
  }, [openArtifact, realMessages]);

  const { setTitle: pushTitle } = useLiveTitles();
  useEffect(() => {
    if (id && stream.title) pushTitle(id, stream.title);
  }, [id, stream.title, pushTitle]);

  const titleOverride = null;

  const title = draft
    ? NEW_CONVERSATION_TITLE
    : getConversationDisplayTitle(titleOverride, stream.title, visibleSessionDetail?.meta.title);
  const model = visibleSessionDetail?.meta.model;

  // Model
  const { models, currentModel, currentThinkingLevel, setCurrent } = useModels();

  // Current context usage (compaction-aware)
  const sessionTokens = useMemo(() => {
    if (isLiveSession) {
      const modelInfo = models.find(m => m.id === (stream.contextUsage?.modelId || currentModel || model));
      return {
        total: stream.contextUsage?.tokens ?? null,
        contextWindow: stream.contextUsage?.contextWindow ?? modelInfo?.context ?? 200_000,
        segments: stream.contextUsage?.segments,
      } satisfies TokenCounts;
    }

    if (!visibleSessionDetail) return undefined;

    const historicalUsage = visibleSessionDetail.contextUsage;
    const modelInfo = models.find(m => m.id === (historicalUsage?.modelId || currentModel || model));
    return {
      total: historicalUsage?.tokens ?? null,
      contextWindow: modelInfo?.context ?? 128_000,
      segments: historicalUsage?.segments,
    } satisfies TokenCounts;
  }, [isLiveSession, stream.contextUsage, visibleSessionDetail, models, currentModel, model]);
  const [notice, setNotice] = useState<{ tone: 'accent' | 'danger'; text: string } | null>(null);
  const [modelIdx, setModelIdx] = useState(0);
  const noticeTimeoutRef = useRef<number | null>(null);
  const composerDraftStorageKey = draft
    ? buildDraftConversationComposerStorageKey()
    : id
      ? buildConversationComposerStorageKey(id)
      : null;
  const [pendingInitialPrompt, setPendingInitialPrompt] = useState<PendingConversationPrompt | null>(null);
  const pendingInitialPromptSessionIdRef = useRef<string | null>(null);
  const pinnedInitialPromptScrollSessionIdRef = useRef<string | null>(null);

  // Input state
  const [input, setInputState] = useReloadState<string>({
    storageKey: composerDraftStorageKey,
    initialValue: '',
    shouldPersist: (value) => value.length > 0,
  });
  const setInput = useCallback((next: string) => {
    if (draft) {
      persistDraftConversationComposer(next);
    }

    setInputState(next);
  }, [draft, setInputState]);
  const [slashIdx, setSlashIdx] = useState(0);
  const [mentionIdx, setMentionIdx] = useState(0);
  const [attachments, setAttachments] = useState<File[]>([]);
  const [composerAltHeld, setComposerAltHeld] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [atBottom, setAtBottom] = useState(true);
  const [showTree, setShowTree] = useState(false);
  const composerHistoryScopeId = draft ? null : id ?? null;
  const [composerHistory, setComposerHistory] = useState<string[]>(() => readComposerHistory(composerHistoryScopeId));
  const [composerHistoryIndex, setComposerHistoryIndex] = useState<number | null>(null);
  const composerHistoryDraftRef = useRef('');

  useEffect(() => {
    if (!draft) {
      return;
    }

    setAttachments([]);
    setDragOver(false);
    setSlashIdx(0);
    setMentionIdx(0);
  }, [draft]);

  useEffect(() => {
    function handleModifierChange(event: KeyboardEvent) {
      setComposerAltHeld(event.altKey);
    }

    function resetModifierState() {
      setComposerAltHeld(false);
    }

    window.addEventListener('keydown', handleModifierChange);
    window.addEventListener('keyup', handleModifierChange);
    window.addEventListener('blur', resetModifierState);

    return () => {
      window.removeEventListener('keydown', handleModifierChange);
      window.removeEventListener('keyup', handleModifierChange);
      window.removeEventListener('blur', resetModifierState);
    };
  }, []);

  useEffect(() => {
    setComposerHistory(readComposerHistory(composerHistoryScopeId));
    setComposerHistoryIndex(null);
    composerHistoryDraftRef.current = '';
  }, [composerHistoryScopeId]);

  useEffect(() => {
    if (composerHistoryIndex === null) {
      return;
    }

    if (input === composerHistory[composerHistoryIndex]) {
      return;
    }

    setComposerHistoryIndex(null);
    composerHistoryDraftRef.current = '';
  }, [composerHistory, composerHistoryIndex, input]);

  useEffect(() => {
    if (draft || !id) {
      setPendingInitialPrompt(null);
      pendingInitialPromptSessionIdRef.current = null;
      pinnedInitialPromptScrollSessionIdRef.current = null;
      return;
    }

    setPendingInitialPrompt(readPendingConversationPrompt(id));
    pendingInitialPromptSessionIdRef.current = null;
    pinnedInitialPromptScrollSessionIdRef.current = null;
  }, [draft, id]);

  // Pending steer/followup queue as reported by the live session.
  const pendingQueue = useMemo(() => ([
    ...stream.pendingQueue.steering.map((text, index) => ({
      id: `steer-${index}`,
      text: text.trim() || '(queued attachment)',
      type: 'steer' as const,
    })),
    ...stream.pendingQueue.followUp.map((text, index) => ({
      id: `followup-${index}`,
      text: text.trim() || '(queued attachment)',
      type: 'followUp' as const,
    })),
  ]), [stream.pendingQueue.followUp, stream.pendingQueue.steering]);
  const prevStreamingRef = useRef(false);
  const { data: memoryData } = useApi(api.memory);
  const { data: profileState } = useApi(api.profiles);
  const { versions } = useAppEvents();
  const { projects, tasks, setProjects } = useAppData();
  const conversationProjectsFetcher = useCallback(async () => {
    if (!id) {
      return { conversationId: '', relatedProjectIds: [] };
    }

    return api.conversationProjects(id);
  }, [id]);
  const {
    data: conversationProjects,
    refetch: refetchConversationProjects,
  } = useApi(conversationProjectsFetcher, id ?? 'no-conversation');
  const [conversationProjectsBusy, setConversationProjectsBusy] = useState(false);
  const [deferredResumes, setDeferredResumes] = useState<DeferredResumeSummary[]>([]);
  const [deferredResumesBusy, setDeferredResumesBusy] = useState(false);
  const [showDeferredResumeDetails, setShowDeferredResumeDetails] = useState(false);
  const [deferredResumeNowMs, setDeferredResumeNowMs] = useState(() => Date.now());

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
  const mentionItems = useMemo(() => buildMentionItems({
    projects: projects ?? [],
    tasks: tasks ?? [],
    memoryDocs: memoryData?.memoryDocs ?? [],
    skills: memoryData?.skills ?? [],
    profiles: profileState?.profiles ?? [],
  }), [projects, tasks, memoryData, profileState]);
  const referencedProjectIds = conversationProjects?.relatedProjectIds ?? [];
  const orderedDeferredResumes = useMemo(
    () => [...deferredResumes].sort(compareDeferredResumes),
    [deferredResumes],
  );
  const hasReadyDeferredResumes = orderedDeferredResumes.some((resume) => resume.status === 'ready');
  const deferredResumeIndicatorText = useMemo(
    () => buildDeferredResumeIndicatorText(orderedDeferredResumes, deferredResumeNowMs),
    [orderedDeferredResumes, deferredResumeNowMs],
  );
  const draftMentionItems = useMemo(() => resolveMentionItems(input, mentionItems)
    .filter((item) => item.kind !== 'project' || !referencedProjectIds.includes(item.label)), [input, mentionItems, referencedProjectIds]);
  const draftReferencedProjectIds = useMemo(() => {
    const ids: string[] = [];
    const seen = new Set<string>();

    for (const item of draftMentionItems) {
      if (item.kind !== 'project' || seen.has(item.label)) {
        continue;
      }

      seen.add(item.label);
      ids.push(item.label);
    }

    return ids;
  }, [draftMentionItems]);

  const refetchDeferredResumes = useCallback(async () => {
    if (!id) {
      setDeferredResumes([]);
      return [] as DeferredResumeSummary[];
    }

    const data = await api.deferredResumes(id);
    setDeferredResumes(data.resumes);
    return data.resumes;
  }, [id]);

  useEffect(() => {
    if (!id) {
      setDeferredResumes([]);
      return;
    }

    void refetchDeferredResumes().catch(() => {});
  }, [id, refetchDeferredResumes, versions.sessions]);

  useEffect(() => {
    if (deferredResumes.length === 0) {
      setShowDeferredResumeDetails(false);
      return;
    }

    const intervalHandle = window.setInterval(() => {
      setDeferredResumeNowMs(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(intervalHandle);
    };
  }, [deferredResumes.length]);

  // Auto-resize textarea
  const resize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, []);

  const rememberComposerInput = useCallback((value: string, scopeId: string | null = composerHistoryScopeId) => {
    const nextHistory = appendComposerHistory(scopeId, value);
    setComposerHistory(nextHistory);
    setComposerHistoryIndex(null);
    composerHistoryDraftRef.current = '';
  }, [composerHistoryScopeId]);

  const moveComposerCaretToEnd = useCallback(() => {
    window.requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) {
        return;
      }

      const end = el.value.length;
      el.focus();
      el.setSelectionRange(end, end);
      resize();
    });
  }, [resize]);

  const navigateComposerHistory = useCallback((direction: 'older' | 'newer') => {
    if (composerHistory.length === 0) {
      return false;
    }

    if (direction === 'older') {
      const nextIndex = composerHistoryIndex === null
        ? composerHistory.length - 1
        : Math.max(0, composerHistoryIndex - 1);

      if (composerHistoryIndex === null) {
        composerHistoryDraftRef.current = input;
      }

      setComposerHistoryIndex(nextIndex);
      setInput(composerHistory[nextIndex]);
      moveComposerCaretToEnd();
      return true;
    }

    if (composerHistoryIndex === null) {
      return false;
    }

    if (composerHistoryIndex >= composerHistory.length - 1) {
      setComposerHistoryIndex(null);
      setInput(composerHistoryDraftRef.current);
      composerHistoryDraftRef.current = '';
      moveComposerCaretToEnd();
      return true;
    }

    const nextIndex = composerHistoryIndex + 1;
    setComposerHistoryIndex(nextIndex);
    setInput(composerHistory[nextIndex]);
    moveComposerCaretToEnd();
    return true;
  }, [composerHistory, composerHistoryIndex, input, moveComposerCaretToEnd, setInput]);

  useEffect(() => { resize(); }, [input, resize]);

  useEffect(() => { setSlashIdx(0); }, [slashQuery]);
  useEffect(() => { setModelIdx(0); }, [modelQuery]);

  useEffect(() => {
    function handleConversationProjectsChanged(event: Event) {
      const detail = (event as CustomEvent<{ conversationId?: string }>).detail;
      if (detail?.conversationId && detail.conversationId !== id) {
        return;
      }

      void refetchConversationProjects({ resetLoading: false });
    }

    window.addEventListener(CONVERSATION_PROJECTS_CHANGED_EVENT, handleConversationProjectsChanged);
    return () => {
      window.removeEventListener(CONVERSATION_PROJECTS_CHANGED_EVENT, handleConversationProjectsChanged);
      if (noticeTimeoutRef.current !== null) {
        window.clearTimeout(noticeTimeoutRef.current);
      }
    };
  }, [id, refetchConversationProjects]);

  // Scroll tracking
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setAtBottom(isConversationScrolledToBottom({
      scrollHeight: el.scrollHeight,
      scrollTop: el.scrollTop,
      clientHeight: el.clientHeight,
    }));
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener('scroll', handleScroll);
    return () => el.removeEventListener('scroll', handleScroll);
  }, [handleScroll]);

  useLayoutEffect(() => {
    if (!messageCount) {
      setAtBottom(true);
      return;
    }

    const el = scrollRef.current;
    if (!el) {
      setAtBottom(true);
      return;
    }

    setAtBottom(isConversationScrolledToBottom({
      scrollHeight: el.scrollHeight,
      scrollTop: el.scrollTop,
      clientHeight: el.clientHeight,
    }));
  }, [id, messageCount]);

  // Scroll to the newest message once per conversation after its content loads.
  // We key this by session id so fork/navigation lands at the bottom even if the
  // previous conversation briefly remains rendered during route transition.
  const initialScrollSessionIdRef = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (!id || !realMessages?.length || !scrollRef.current) {
      return;
    }

    if (initialScrollSessionIdRef.current === id) {
      return;
    }

    const el = scrollRef.current;
    const scrollToBottom = () => {
      el.scrollTop = el.scrollHeight;
      setAtBottom(true);
    };

    scrollToBottom();
    const animationFrame = window.requestAnimationFrame(scrollToBottom);
    const timeoutId = window.setTimeout(scrollToBottom, 50);
    initialScrollSessionIdRef.current = id;

    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.clearTimeout(timeoutId);
    };
  }, [id, realMessages]);

  // Esc aborts an active run. Esc+Esc still opens the tree when idle.
  useEffect(() => {
    let lastEsc = 0;
    function handler(e: KeyboardEvent) {
      if (e.key !== 'Escape') {
        return;
      }

      if (e.defaultPrevented || showTree) {
        return; // let focused controls / tree handle their own Escape
      }

      if (stream.isStreaming) {
        e.preventDefault();
        lastEsc = 0;
        void stream.abort();
        return;
      }

      const now = Date.now();
      if (now - lastEsc < 500) {
        setShowTree(true);
        lastEsc = 0;
      } else {
        lastEsc = now;
      }
    }
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [showTree, stream]);

  // Auto-scroll when streaming changes the current tail block.
  // Text deltas usually mutate the last streamed block in place, so keying on
  // blocks.length only follows new blocks and misses most of the live output.
  useLayoutEffect(() => {
    if (!stream.isStreaming) return;
    if (atBottom && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [stream.blocks, stream.isStreaming, atBottom]);

  // Forked/new conversations with a queued initial prompt should stay pinned to
  // the newest message until that first turn finishes, even if the initial load
  // briefly leaves the scroll position at the top.
  useLayoutEffect(() => {
    if (!id || pinnedInitialPromptScrollSessionIdRef.current !== id || !scrollRef.current) {
      return;
    }

    const el = scrollRef.current;
    const scrollToBottom = () => {
      el.scrollTop = el.scrollHeight;
      setAtBottom(true);
    };

    scrollToBottom();
    const animationFrame = window.requestAnimationFrame(scrollToBottom);

    return () => {
      window.cancelAnimationFrame(animationFrame);
    };
  }, [id, realMessages, stream.isStreaming]);

  // Focus input on navigation
  useEffect(() => { textareaRef.current?.focus(); }, [id]);

  // Refresh referenced projects when the agent finishes its run.
  useEffect(() => {
    if (prevStreamingRef.current && !stream.isStreaming) {
      if (pinnedInitialPromptScrollSessionIdRef.current === id) {
        pinnedInitialPromptScrollSessionIdRef.current = null;
      }
      void refetchConversationProjects({ resetLoading: false });
    }
    prevStreamingRef.current = stream.isStreaming;
  }, [id, stream.isStreaming, refetchConversationProjects]);

  // Jump to message by index
  const jumpToMessage = useCallback((index: number) => {
    const el = scrollRef.current?.querySelector(`#msg-${index}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, []);

  const showNotice = useCallback((tone: 'accent' | 'danger', text: string, durationMs = 2500) => {
    setNotice({ tone, text });
    if (noticeTimeoutRef.current !== null) {
      window.clearTimeout(noticeTimeoutRef.current);
    }
    noticeTimeoutRef.current = window.setTimeout(() => {
      setNotice(null);
      noticeTimeoutRef.current = null;
    }, durationMs);
  }, []);

  useEffect(() => {
    if (draft || !id || !pendingInitialPrompt || !stream.hasSnapshot) {
      return;
    }

    if (pendingInitialPromptSessionIdRef.current === id) {
      return;
    }

    pendingInitialPromptSessionIdRef.current = id;
    pinnedInitialPromptScrollSessionIdRef.current = id;

    void stream.send(
      pendingInitialPrompt.text,
      pendingInitialPrompt.behavior,
      pendingInitialPrompt.images,
    ).then(async () => {
      clearPendingConversationPrompt(id);
      pendingInitialPromptSessionIdRef.current = null;
      setPendingInitialPrompt(null);
      await refetchConversationProjects({ resetLoading: false });
      emitConversationProjectsChanged(id);
    }).catch((error) => {
      pendingInitialPromptSessionIdRef.current = null;
      pinnedInitialPromptScrollSessionIdRef.current = null;
      persistForkPromptDraft(id, pendingInitialPrompt.text);
      console.error('Initial prompt failed:', error);
      showNotice('danger', error instanceof Error ? error.message : String(error), 4000);
    });
  }, [draft, id, pendingInitialPrompt, stream.hasSnapshot, stream.send, refetchConversationProjects, showNotice]);

  const forkConversationFromMessage = useCallback(async (messageIndex: number) => {
    if (!id || !isLiveSession || !realMessages) {
      return;
    }

    try {
      const entries = await api.forkEntries(id);
      const entry = resolveForkEntryForMessage(realMessages, messageIndex, entries);
      if (!entry) {
        throw new Error('No forkable message found for that point in the conversation.');
      }

      const { newSessionId } = await api.forkSession(id, entry.entryId, { preserveSource: true });
      // Pi forks before the selected user turn, so queue that prompt into the
      // new session to make the branch behave like “fork from here”.
      persistPendingConversationPrompt(newSessionId, {
        text: entry.text,
        images: [],
      });
      ensureConversationTabOpen(newSessionId);
      navigate(`/conversations/${newSessionId}`);
    } catch (error) {
      showNotice('danger', `Fork failed: ${(error as Error).message}`);
    }
  }, [id, isLiveSession, navigate, realMessages, showNotice]);

  function selectModel(modelId: string) {
    setCurrent(modelId);
    setInput('');
    setModelIdx(0);

    const selectedModel = models.find((candidate) => candidate.id === modelId);
    if (selectedModel) {
      showNotice('accent', `Switched to ${selectedModel.name}`);
    }

    textareaRef.current?.focus();
    // Persist to settings.json
    api.setModel(modelId).catch(console.error);
  }

  // /clear — destroy current session, create new one in same cwd
  async function handleClear() {
    if (!id) return;
    if (stream.isStreaming) await stream.abort();
    await api.destroySession(id).catch(() => {});
    const cwd = visibleSessionDetail?.meta.cwd ?? undefined;
    const { id: newId } = await api.createLiveSession(cwd);
    ensureConversationTabOpen(newId);
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

  async function refreshProjectMentions() {
    const nextProjects = await api.projects();
    setProjects(nextProjects);
    emitProjectsChanged();
  }

  async function scheduleDeferredResume(delay: string, prompt?: string) {
    if (!id || draft) {
      showNotice('danger', 'Deferred resume requires an existing conversation.', 4000);
      return;
    }

    setDeferredResumesBusy(true);
    try {
      const result = await api.scheduleDeferredResume(id, { delay, prompt });
      setDeferredResumes(result.resumes);
      setInput('');
      showNotice('accent', `Deferred resume scheduled for ${describeDeferredResumeStatus(result.resume)}.`);
    } catch (error) {
      showNotice('danger', error instanceof Error ? error.message : String(error), 4000);
    } finally {
      setDeferredResumesBusy(false);
    }
  }

  async function cancelDeferredResume(resumeId: string) {
    if (!id) {
      return;
    }

    setDeferredResumesBusy(true);
    try {
      const result = await api.cancelDeferredResume(id, resumeId);
      setDeferredResumes(result.resumes);
      showNotice('accent', 'Deferred resume cancelled.');
    } catch (error) {
      showNotice('danger', error instanceof Error ? error.message : String(error), 4000);
    } finally {
      setDeferredResumesBusy(false);
    }
  }

  async function continueDeferredResumesNow() {
    if (!id) {
      return;
    }

    if (isLiveSession) {
      await refetchDeferredResumes().catch(() => {});
      return;
    }

    if (!visibleSessionDetail) {
      showNotice('danger', 'Open the saved conversation before continuing deferred work.', 4000);
      return;
    }

    try {
      await api.resumeSession(visibleSessionDetail.meta.file);
      setConfirmedLive(true);
      showNotice('accent', 'Resuming deferred work…');
      setTimeout(() => {
        void refetchDeferredResumes().catch(() => {});
      }, 200);
    } catch (error) {
      showNotice('danger', error instanceof Error ? error.message : String(error), 4000);
    }
  }

  async function removeReferencedProject(projectId: string) {
    if (!id || conversationProjectsBusy) {
      return;
    }

    setConversationProjectsBusy(true);
    try {
      await api.removeConversationProject(id, projectId);
      await refetchConversationProjects({ resetLoading: false });
      emitConversationProjectsChanged(id);
    } finally {
      setConversationProjectsBusy(false);
    }
  }

  async function handleProjectSlashCommand(command: ProjectSlashCommand) {
    try {
      if (command.action === 'new') {
        const detail = await api.createProject({
          title: command.description,
          description: command.description,
        });
        const createdProjectId = detail.project.id;
        await refreshProjectMentions();

        if (id) {
          await api.addConversationProject(id, createdProjectId);
          await refetchConversationProjects({ resetLoading: false });
          emitConversationProjectsChanged(id);
          showNotice('accent', `Created and referenced @${createdProjectId}`);
        } else {
          showNotice('accent', `Created project @${createdProjectId}`);
        }

        setInput('');
        return;
      }

      if (!id) {
        showNotice('danger', 'Project references are only available inside a conversation.');
        return;
      }

      setConversationProjectsBusy(true);
      try {
        if (command.action === 'reference') {
          await api.addConversationProject(id, command.projectId);
          showNotice('accent', `Now referencing @${command.projectId}`);
        } else {
          await api.removeConversationProject(id, command.projectId);
          showNotice('accent', `Stopped referencing @${command.projectId}`);
        }

        await refetchConversationProjects({ resetLoading: false });
        emitConversationProjectsChanged(id);
        setInput('');
      } finally {
        setConversationProjectsBusy(false);
      }
    } catch (error) {
      showNotice('danger', error instanceof Error ? error.message : String(error), 4000);
    }
  }

  async function submitComposer(behavior?: 'steer' | 'followUp') {
    const inputSnapshot = input;
    const text = inputSnapshot.trim();
    const pendingAttachments = attachments;
    if (!text && pendingAttachments.length === 0) return;

    if (pendingAttachments.length === 0) {
      const projectSlash = parseProjectSlashCommand(text);
      if (projectSlash) {
        if (projectSlash.kind === 'invalid') {
          showNotice('danger', projectSlash.message, 4000);
        } else {
          rememberComposerInput(inputSnapshot);
          await handleProjectSlashCommand(projectSlash.command);
        }
        return;
      }

      const deferredResumeSlash = parseDeferredResumeSlashCommand(text);
      if (deferredResumeSlash) {
        if (deferredResumeSlash.kind === 'invalid') {
          showNotice('danger', deferredResumeSlash.message, 4000);
        } else {
          rememberComposerInput(inputSnapshot);
          await scheduleDeferredResume(
            deferredResumeSlash.command.delay,
            deferredResumeSlash.command.prompt,
          );
        }
        return;
      }
    }

    try {
      const promptImages = await buildPromptImages(pendingAttachments);
      let textToSend = text;
      setInput('');
      setAttachments([]);

      if (promptImages.length === 0) {
        if (text === '/clear') {
          if (draft) {
            return;
          }

          await handleClear();
          return;
        }
        if (text === '/image') { openFilePicker(); return; }
        if (text.startsWith('/run ')) {
          if (draft) {
            textToSend = `Run this shell command and show me the output:\n\`\`\`\n${text.slice(5)}\n\`\`\``;
          } else {
            rememberComposerInput(inputSnapshot);
            await handleRun(text.slice(5));
            return;
          }
        }
        if (text.startsWith('/search ')) {
          if (draft) {
            textToSend = `Search the web for: ${text.slice(8)}`;
          } else {
            rememberComposerInput(inputSnapshot);
            sendToAgent(`Search the web for: ${text.slice(8)}`);
            return;
          }
        }
        if (text === '/summarize') {
          if (draft) {
            textToSend = 'Summarize our conversation so far concisely.';
          } else {
            rememberComposerInput(inputSnapshot);
            sendToAgent('Summarize our conversation so far concisely.');
            return;
          }
        }
        if (text === '/think') {
          if (draft) {
            textToSend = 'Think step-by-step about our conversation so far and share your reasoning.';
          } else {
            rememberComposerInput(inputSnapshot);
            sendToAgent('Think step-by-step about our conversation so far and share your reasoning.');
            return;
          }
        }
        if (text.startsWith('/think ')) {
          if (draft) {
            textToSend = `Think step-by-step about: ${text.slice(7)}`;
          } else {
            rememberComposerInput(inputSnapshot);
            sendToAgent(`Think step-by-step about: ${text.slice(7)}`);
            return;
          }
        }
        if (text === '/fork' && id && isLiveSession) {
          try {
            rememberComposerInput(inputSnapshot);
            const entries = await api.forkEntries(id);
            if (entries.length === 0) { sendToAgent('(No forkable messages yet)'); return; }
            const entry = entries[entries.length - 1];
            const { newSessionId } = await api.forkSession(id, entry.entryId, { preserveSource: true });
            persistPendingConversationPrompt(newSessionId, {
              text: entry.text,
              images: [],
            });
            ensureConversationTabOpen(newSessionId);
            navigate(`/conversations/${newSessionId}`);
          } catch (err) {
            console.error('Fork failed:', err);
          }
          return;
        }
      }

      const queuedBehavior = behavior ?? (isLiveSession && stream.isStreaming ? 'steer' : undefined);

      if (!id && !visibleSessionDetail) {
        rememberComposerInput(inputSnapshot);
        try {
          const { id: newId } = await api.createLiveSession(undefined, draftReferencedProjectIds);
          rememberComposerInput(inputSnapshot, newId);
          persistPendingConversationPrompt(newId, {
            text: textToSend,
            behavior: queuedBehavior,
            images: promptImages,
          });
          ensureConversationTabOpen(newId);
          navigate(`/conversations/${newId}`, { replace: true });
        } catch (error) {
          showNotice('danger', error instanceof Error ? error.message : String(error), 4000);
        }
        return;
      }

      if (isLiveSession) {
        rememberComposerInput(inputSnapshot);
        await stream.send(textToSend, queuedBehavior, promptImages);
        if (id) {
          await refetchConversationProjects({ resetLoading: false });
          emitConversationProjectsChanged(id);
        }
        setTimeout(() => {
          if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }, 50);
      } else if (visibleSessionDetail) {
        try {
          rememberComposerInput(inputSnapshot);
          await api.resumeSession(visibleSessionDetail.meta.file);
          setConfirmedLive(true);
          setTimeout(() => {
            void stream.send(textToSend, queuedBehavior, promptImages)
              .then(async () => {
                if (!id) {
                  return;
                }

                await refetchConversationProjects({ resetLoading: false });
                emitConversationProjectsChanged(id);
              })
              .catch((error) => {
                console.error('Send after auto-resume failed:', error);
              });
          }, 150);
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

  function canNavigateComposerHistory(textarea: HTMLTextAreaElement, key: 'ArrowUp' | 'ArrowDown'): boolean {
    if (textarea.selectionStart !== textarea.selectionEnd) {
      return false;
    }

    const caret = textarea.selectionStart;
    return key === 'ArrowUp'
      ? !textarea.value.slice(0, caret).includes('\n')
      : !textarea.value.slice(caret).includes('\n');
  }

  // Keyboard handling
  async function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'c' && !e.nativeEvent.isComposing) {
      if (input.trim().length > 0) {
        rememberComposerInput(input);
      }
      if (input.length > 0 || attachments.length > 0) {
        e.preventDefault();
        setInput('');
        setAttachments([]);
      }
      return;
    }

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
          const filtered = filterMentionItems(mentionItems, mentionQuery);
          const sel = filtered[mentionIdx % (filtered.length || 1)];
          if (sel) { setInput(input.replace(/@[\w-]*$/, sel.id + ' ')); setMentionIdx(0); }
        }
        return;
      }
    }

    if (!e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      if (canNavigateComposerHistory(e.currentTarget, e.key) && navigateComposerHistory(e.key === 'ArrowUp' ? 'older' : 'newer')) {
        e.preventDefault();
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
  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(true);
  }
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
  const composerSubmit = resolveConversationComposerSubmitState(stream.isStreaming, composerAltHeld);
  const showScrollToBottomControl = shouldShowScrollToBottomControl(messageCount, atBottom);

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        className="gap-3 py-2"
        actions={(
          <div className="flex shrink-0 items-center gap-2.5 text-[10px] font-medium leading-none">
            {draft ? (
              <span className="text-dim">draft</span>
            ) : (
              <>
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
                {isLiveSession && <span className="text-accent">{formatLiveSessionLabel(isLiveSession)}</span>}
              </>
            )}
          </div>
        )}
      >
        <div className="flex-1 min-w-0">
          <h1 className="ui-page-title truncate">{title}</h1>
          <ContextBar model={currentModel || model} thinkingLevel={currentThinkingLevel} tokens={sessionTokens} />
        </div>
      </PageHeader>

      {/* Messages */}
      <div className="relative flex-1 min-h-0">
        <div ref={scrollRef} className="conversation-scroll-shell h-full overflow-y-auto overflow-x-hidden">
          {realMessages ? (
            <ChatView
              messages={realMessages}
              isStreaming={stream.isStreaming}
              onForkMessage={isLiveSession && id && !stream.isStreaming ? forkConversationFromMessage : undefined}
              onOpenArtifact={openArtifact}
              activeArtifactId={selectedArtifactId}
            />
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
              title={NEW_CONVERSATION_TITLE}
              body={draft
                ? 'Start typing to create a conversation. Referenced projects with repo roots can set the initial working directory.'
                : 'Start a Pi session to populate this conversation.'}
            />
          )}
          {showScrollToBottomControl && (
            <button
              onClick={() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })}
              className="sticky bottom-4 left-1/2 -translate-x-1/2 ui-pill ui-pill-muted shadow-md"
            >
              ↓ scroll to bottom
            </button>
          )}
        </div>
        {realMessages && (
          <ConversationRail
            messages={realMessages}
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
        {notice && (
          <div className="mb-2 text-center">
            <Pill tone={notice.tone}>{notice.text}</Pill>
          </div>
        )}

        <div className="relative">
          {showSlash   && <SlashMenu items={slashItems} idx={slashIdx} onSelect={(item) => {
            const c = item.displayCmd.trim();
            if (c === '/tree')       { setInput(''); setShowTree(true); return; }
            if (c === '/clear')      { setInput(''); setAttachments([]); if (!draft) { void handleClear(); } return; }
            if (c === '/image')      { setInput(''); openFilePicker(); return; }
            if (c === '/summarize')  {
              if (draft) {
                setInput('/summarize');
                setSlashIdx(0);
                textareaRef.current?.focus();
              } else {
                setInput('');
                sendToAgent('Summarize our conversation so far concisely.');
              }
              return;
            }
            if (c === '/think')      {
              if (draft) {
                setInput('/think');
                setSlashIdx(0);
                textareaRef.current?.focus();
              } else {
                setInput('');
                sendToAgent('Think step-by-step about our conversation so far and share your reasoning.');
              }
              return;
            }
            if (c === '/fork' && id && isLiveSession) {
              setInput('');
              void api.forkEntries(id).then(entries => {
                const entry = entries[entries.length - 1];
                if (!entry) return;
                return api.forkSession(id, entry.entryId, { preserveSource: true })
                  .then(({ newSessionId }) => {
                    persistPendingConversationPrompt(newSessionId, {
                      text: entry.text,
                      images: [],
                    });
                    ensureConversationTabOpen(newSessionId);
                    navigate(`/conversations/${newSessionId}`);
                  });
              }).catch(console.error);
              return;
            }
            setInput(item.insertText); setSlashIdx(0); textareaRef.current?.focus();
          }} />}
          {showMention && <MentionMenu items={mentionItems} query={mentionQuery} idx={mentionIdx} onSelect={id  => { setInput(input.replace(/@[\w-]*$/, id + ' ')); setMentionIdx(0); textareaRef.current?.focus(); }} />}
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

            {/* Prompt references */}
            {draftMentionItems.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 border-b border-border-subtle px-3 pt-3 pb-2.5">
                <span className="ui-section-label">Prompt references</span>
                {draftMentionItems.map((item) => (
                  <span
                    key={`${item.kind}:${item.id}`}
                    className="inline-flex items-center gap-1.5 rounded-full bg-elevated px-2 py-1 text-[11px] text-secondary"
                    title={item.summary || item.title || item.id}
                  >
                    <span className="text-[10px] uppercase tracking-[0.14em] text-dim/70">{item.kind}</span>
                    <span className="font-mono text-accent">{item.id}</span>
                  </span>
                ))}
              </div>
            )}

            {/* Referenced projects */}
            {referencedProjectIds.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 border-b border-border-subtle px-3 pt-3 pb-2.5">
                <span className="ui-section-label">Referenced projects</span>
                {referencedProjectIds.map((projectId) => (
                  <span key={projectId} className="inline-flex max-w-[18rem] items-center gap-1.5 rounded-full bg-accent/10 px-2 py-1 text-[11px] text-accent" title={`@${projectId}`}>
                    <span className="truncate font-mono">@{projectId}</span>
                    <button
                      type="button"
                      onClick={() => { void removeReferencedProject(projectId); }}
                      className="text-accent/70 transition-colors hover:text-accent disabled:opacity-40"
                      disabled={conversationProjectsBusy}
                      title={`Stop referencing ${projectId}`}
                      aria-label={`Stop referencing ${projectId}`}
                    >
                      ×
                    </button>
                  </span>
                ))}
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
                  </div>
                ))}
              </div>
            )}

            {/* Deferred resume indicator */}
            {!draft && orderedDeferredResumes.length > 0 && (
              <>
                <div className="flex items-center justify-between gap-3 border-b border-border-subtle px-3 py-2 text-[11px]">
                  <div className="min-w-0 flex items-center gap-2">
                    <span className={cx(
                      'shrink-0',
                      hasReadyDeferredResumes ? 'text-warning' : 'text-dim',
                    )}>
                      ⏰
                    </span>
                    <span className="shrink-0 text-secondary">Deferred</span>
                    <span className="truncate text-dim">{deferredResumeIndicatorText}</span>
                  </div>
                  <div className="flex shrink-0 items-center gap-3 text-[11px]">
                    {hasReadyDeferredResumes && !isLiveSession && (
                      <button
                        type="button"
                        onClick={() => { void continueDeferredResumesNow(); }}
                        className="text-accent transition-colors hover:text-accent/80"
                      >
                        continue now
                      </button>
                    )}
                    {deferredResumesBusy && <span className="text-dim">updating…</span>}
                    <button
                      type="button"
                      onClick={() => { setShowDeferredResumeDetails((open) => !open); }}
                      className="text-dim transition-colors hover:text-primary"
                    >
                      {showDeferredResumeDetails ? 'hide' : 'details'}
                    </button>
                  </div>
                </div>

                {showDeferredResumeDetails && (
                  <div className="flex flex-col gap-2 border-b border-border-subtle px-3 pt-2.5 pb-2.5">
                    {orderedDeferredResumes.map((resume) => (
                      <div key={resume.id} className="flex items-start gap-3 text-[12px]">
                        <div className="min-w-0 flex-1">
                          <div className="flex min-w-0 items-center gap-2">
                            <span className={cx(
                              'shrink-0 font-medium',
                              resume.status === 'ready' ? 'text-warning' : 'text-secondary',
                            )}>
                              {describeDeferredResumeStatus(resume, deferredResumeNowMs)}
                            </span>
                            <span className="truncate text-primary">{resume.prompt}</span>
                          </div>
                          <div className="mt-0.5 text-[11px] text-dim">
                            {resume.status === 'ready' ? 'Ready' : 'Due'} {formatDeferredResumeWhen(resume)}
                            {resume.attempts > 0 ? ` · retries ${resume.attempts}` : ''}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => { void cancelDeferredResume(resume.id); }}
                          className="shrink-0 text-[11px] text-dim transition-colors hover:text-danger disabled:opacity-40"
                          disabled={deferredResumesBusy}
                        >
                          cancel
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </>
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

              <IconButton
                className="shrink-0 mb-0.5"
                title="Attach image"
                aria-label="Attach image"
                onClick={openFilePicker}
              >
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
                placeholder="Message… (/ for commands, @ to reference projects, tasks, knowledge, skills, and profiles)"
                title="Ctrl+C clears the composer. Alt+Enter queues a follow up. ↑/↓ recalls recent prompts."
                style={{ minHeight: '24px', maxHeight: '160px' }}
              />

              {composerHasContent && (
                <div className="shrink-0 mb-0.5">
                  <button
                    onClick={(event) => {
                      const behavior = resolveConversationComposerSubmitState(
                        stream.isStreaming,
                        composerAltHeld || event.altKey,
                      ).behavior;
                      void submitComposer(behavior);
                    }}
                    className="ui-pill ui-pill-solid-accent"
                  >
                    {composerSubmit.label}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Session tree overlay */}
      {showTree && realMessages && (
        <ConversationTree
          messages={realMessages}
          onJump={jumpToMessage}
          onClose={() => setShowTree(false)}
          onFork={isLiveSession && id && !stream.isStreaming ? (blockIdx) => {
            void forkConversationFromMessage(blockIdx);
          } : undefined}
        />
      )}
    </div>
  );
}

import { Suspense, lazy, useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo, type RefObject } from 'react';
import { useLocation, useParams, useNavigate } from 'react-router-dom';
import { ChatView } from '../components/chat/ChatView';
import { ConversationRail } from '../components/chat/ConversationRailOverlay';
import type { ExcalidrawEditorSavePayload } from '../components/ExcalidrawEditorModal';
import { EmptyState, IconButton, LoadingState, PageHeader, Pill, cx } from '../components/ui';
import type { ContextUsageSegment, ConversationAttachmentSummary, ConversationTreeSnapshot, DeferredResumeSummary, DurableRunRecord, MessageBlock, ModelInfo, PromptAttachmentRefInput, PromptImageInput } from '../types';
import { useApi } from '../hooks';
import { useSessionDetail } from '../hooks/useSessions';
import { useSessionStream } from '../hooks/useSessionStream';
import { api } from '../api';
import { appendComposerHistory, readComposerHistory } from '../composerHistory';
import { getConversationArtifactIdFromSearch, readArtifactPresentation, setConversationArtifactIdInSearch } from '../conversationArtifacts';
import { createConversationLiveRunId, getConversationRunIdFromSearch, setConversationRunIdInSearch } from '../conversationRuns';
import { formatContextBreakdownLabel, formatContextUsageLabel, formatContextWindowLabel, formatLiveSessionLabel, formatThinkingLevelLabel } from '../conversationHeader';
import { isConversationScrolledToBottom, shouldShowScrollToBottomControl } from '../conversationScroll';
import { getConversationDisplayTitle, NEW_CONVERSATION_TITLE } from '../conversationTitle';
import { emitConversationProjectsChanged, CONVERSATION_PROJECTS_CHANGED_EVENT } from '../conversationProjectEvents';
import { displayBlockToMessageBlock } from '../messageBlocks';
import { THINKING_LEVEL_OPTIONS, groupModelsByProvider } from '../modelPreferences';
import { useAppData, useAppEvents, useLiveTitles } from '../contexts';
import { filterModelPickerItems } from '../modelPicker';
import { emitProjectsChanged } from '../projectEvents';
import { parseDeferredResumeSlashCommand } from '../deferredResumeSlashCommand';
import { buildDeferredResumeAutoResumeKey } from '../deferredResumeAutoResume';
import { parseProjectSlashCommand, type ProjectSlashCommand } from '../projectSlashCommand';
import { buildSlashMenuItems, parseSlashInput, type SlashMenuItem } from '../slashMenu';
import { buildMentionItems, filterMentionItems, resolveMentionItems, type MentionItem } from '../conversationMentions';
import { buildDeferredResumeIndicatorText, compareDeferredResumes, describeDeferredResumeStatus } from '../deferredResumeIndicator';
import { buildConversationComposerStorageKey, persistForkPromptDraft, resolveForkEntryForMessage, resolveSessionEntryIdFromBlockId } from '../forking';
import {
  beginDraftConversationAttachmentsMutation,
  buildDraftConversationComposerStorageKey,
  clearDraftConversationAttachments,
  clearDraftConversationCwd,
  isDraftConversationAttachmentsMutationCurrent,
  persistDraftConversationAttachments,
  persistDraftConversationComposer,
  readDraftConversationAttachments,
  readDraftConversationCwd,
  type DraftConversationDrawingAttachment,
} from '../draftConversation';
import {
  consumePendingConversationPrompt,
  persistPendingConversationPrompt,
  readPendingConversationPrompt,
  type PendingConversationPrompt,
} from '../pendingConversationPrompt';
import { getConversationResumeState } from '../conversationResume';
import {
  normalizeConversationComposerBehavior,
  resolveConversationComposerSubmitState,
} from '../conversationComposerSubmit';
import { useReloadState } from '../reloadState';
import { ensureConversationTabOpen } from '../sessionTabs';
import { buildDrawingFileNames, inferDrawingTitleFromFileName, loadExcalidrawSceneFromBlob, parseExcalidrawSceneFromSourceData, serializeExcalidrawScene } from '../excalidrawUtils';

const ConversationTree = lazy(() => import('../components/ConversationTree').then((module) => ({ default: module.ConversationTree })));
const ConversationDrawingsPickerModal = lazy(() => import('../components/ConversationDrawingsPickerModal').then((module) => ({ default: module.ConversationDrawingsPickerModal })));
const ExcalidrawEditorModal = lazy(() => import('../components/ExcalidrawEditorModal').then((module) => ({ default: module.ExcalidrawEditorModal })));

const INITIAL_HISTORICAL_TAIL_BLOCKS = 400;
const HISTORICAL_TAIL_BLOCKS_STEP = 400;
const HISTORICAL_TAIL_BLOCKS_JUMP_PADDING = 40;
const MAX_AUTOMATIC_HISTORICAL_TAIL_BLOCKS = 1200;
const HISTORICAL_PREFETCH_SCROLL_THRESHOLD_PX = 1400;
const HISTORICAL_BACKGROUND_PREFETCH_DELAY_MS = 800;
const INITIAL_SCROLL_STABLE_FRAME_COUNT = 2;
const INITIAL_SCROLL_MAX_FRAMES = 45;
const MAX_CONVERSATION_RAIL_BLOCKS = 240;

// ── Model picker ──────────────────────────────────────────────────────────────

function useModels() {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [currentModel, setCurrentModel] = useState<string>('');
  const [currentThinkingLevel, setCurrentThinkingLevel] = useState<string>('');

  useEffect(() => {
    api.models()
      .then((data) => {
        setModels(data.models);
        setCurrentModel(data.currentModel);
        setCurrentThinkingLevel(data.currentThinkingLevel ?? '');
      })
      .catch(() => {});
  }, []);

  return {
    models,
    currentModel,
    currentThinkingLevel,
    setCurrentModel,
    setCurrentThinkingLevel,
  };
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

const HEADER_PREFERENCE_SELECT_CLASS = 'w-full rounded-lg border border-border-default bg-base px-3 py-2 text-[13px] text-primary outline-none transition-colors focus:border-accent/60 disabled:opacity-50';

function HeaderPreferencesMenu({
  models,
  currentModel,
  currentThinkingLevel,
  savingPreference,
  modelSelectRef,
  thinkingSelectRef,
  onSelectModel,
  onSelectThinkingLevel,
  onClose,
}: {
  models: ModelInfo[];
  currentModel: string;
  currentThinkingLevel: string;
  savingPreference: 'model' | 'thinking' | null;
  modelSelectRef: RefObject<HTMLSelectElement>;
  thinkingSelectRef: RefObject<HTMLSelectElement>;
  onSelectModel: (modelId: string) => void;
  onSelectThinkingLevel: (thinkingLevel: string) => void;
  onClose: () => void;
}) {
  const groupedModels = useMemo(() => groupModelsByProvider(models), [models]);
  const selectedModel = models.find((candidate) => candidate.id === currentModel) ?? null;

  return (
    <div role="dialog" aria-label="Runtime defaults" className="absolute left-0 top-full z-20 mt-2 w-[min(32rem,calc(100vw-3rem))] rounded-xl border border-border-default bg-surface shadow-xl">
      <div className="flex items-start justify-between gap-3 border-b border-border-subtle px-3 py-2.5">
        <div>
          <p className="ui-section-label">Runtime defaults</p>
          <p className="mt-1 text-[12px] text-secondary">
            Change the saved model and thinking defaults without using slash commands.
          </p>
        </div>
        <IconButton onClick={onClose} title="Close runtime defaults" aria-label="Close runtime defaults" compact>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </IconButton>
      </div>

      <div className="grid gap-4 p-3 sm:grid-cols-[minmax(0,1fr)_11rem]">
        <div className="space-y-1.5 min-w-0">
          <label className="ui-section-label" htmlFor="conversation-model-preference">Model</label>
          <select
            ref={modelSelectRef}
            id="conversation-model-preference"
            value={currentModel}
            onChange={(event) => { onSelectModel(event.target.value); }}
            disabled={savingPreference !== null || models.length === 0}
            className={HEADER_PREFERENCE_SELECT_CLASS}
          >
            {groupedModels.map(([provider, providerModels]) => (
              <optgroup key={provider} label={provider}>
                {providerModels.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.name} · {formatContextWindowLabel(model.context)} ctx
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <p className="text-[11px] text-dim">
            {savingPreference === 'model'
              ? 'Saving default model…'
              : selectedModel
                ? `${selectedModel.name} · ${selectedModel.provider} · ${formatContextWindowLabel(selectedModel.context)} ctx`
                : 'No model selected.'}
          </p>
        </div>

        <div className="space-y-1.5 min-w-0">
          <label className="ui-section-label" htmlFor="conversation-thinking-preference">Thinking</label>
          <select
            ref={thinkingSelectRef}
            id="conversation-thinking-preference"
            value={currentThinkingLevel}
            onChange={(event) => { onSelectThinkingLevel(event.target.value); }}
            disabled={savingPreference !== null}
            className={HEADER_PREFERENCE_SELECT_CLASS}
          >
            {THINKING_LEVEL_OPTIONS.map((option) => (
              <option key={option.value || 'unset'} value={option.value}>{option.label}</option>
            ))}
          </select>
          <p className="text-[11px] text-dim">
            {savingPreference === 'thinking'
              ? 'Saving thinking level…'
              : `Current thinking level: ${formatThinkingLevelLabel(currentThinkingLevel)}`}
          </p>
        </div>
      </div>

      <div className="border-t border-border-subtle px-3 py-2 text-[11px] text-dim">
        Applies to new conversations and other runs that use the saved runtime defaults.
      </div>
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
  activePreference?: 'model' | 'thinking' | null;
  onOpenPreferences?: (preference: 'model' | 'thinking') => void;
}

const CONTEXT_SEGMENT_STYLES: Record<ContextUsageSegment['key'], string> = {
  system: 'bg-border-default',
  user: 'bg-teal/85',
  assistant: 'bg-accent/90',
  tool: 'bg-steel/90',
  summary: 'bg-warning/85',
  other: 'bg-border-default/80',
};

function ContextBar({
  model,
  thinkingLevel,
  tokens,
  activePreference = null,
  onOpenPreferences,
}: ContextBarProps) {
  const win = tokens?.contextWindow ?? 200_000;
  const segments = (tokens?.segments ?? [])
    .filter((segment) => segment.tokens > 0)
    .map((segment) => ({
      ...segment,
      className: CONTEXT_SEGMENT_STYLES[segment.key] ?? 'bg-border-default/60',
    }));
  const total = tokens?.total ?? segments.reduce((sum, segment) => sum + segment.tokens, 0);
  const contextBreakdownTitle = formatContextBreakdownLabel(segments, win, total);
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
            {onOpenPreferences ? (
              <button
                type="button"
                onClick={() => onOpenPreferences('model')}
                aria-haspopup="dialog"
                aria-expanded={activePreference === 'model'}
                title="Change the default model"
                className={cx(
                  'group -mx-1 inline-flex min-w-0 items-center gap-1 rounded-md px-1 py-0.5 transition-colors hover:bg-surface/80 hover:text-primary',
                  activePreference === 'model' ? 'bg-surface text-primary' : 'text-dim',
                )}
              >
                <span className="truncate font-mono">{model}</span>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 opacity-70">
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </button>
            ) : (
              <span className="truncate font-mono text-dim">{model}</span>
            )}
          </span>
        )}
        {model && <span className="h-3.5 w-px shrink-0 bg-border-subtle/70" aria-hidden="true" />}
        <span className="inline-flex min-w-0 items-baseline gap-1.5 whitespace-nowrap">
          <span className="uppercase tracking-[0.14em] text-dim/65">thinking</span>
          {onOpenPreferences ? (
            <button
              type="button"
              onClick={() => onOpenPreferences('thinking')}
              aria-haspopup="dialog"
              aria-expanded={activePreference === 'thinking'}
              title="Change the default thinking level"
              className={cx(
                'group -mx-1 inline-flex items-center gap-1 rounded-md px-1 py-0.5 transition-colors hover:bg-surface/80 hover:text-primary',
                activePreference === 'thinking' ? 'bg-surface text-primary' : 'text-primary',
              )}
            >
              <span className="font-mono">{thinkingLabel}</span>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 opacity-70">
                <path d="m6 9 6 6 6-6" />
              </svg>
            </button>
          ) : (
            <span className="font-mono text-primary">{thinkingLabel}</span>
          )}
        </span>
        <span className="h-3.5 w-px shrink-0 bg-border-subtle/70" aria-hidden="true" />
        <span className="inline-flex min-w-0 items-center gap-1.5 whitespace-nowrap overflow-hidden">
          <span className="uppercase tracking-[0.14em] text-dim/65">context</span>
          <span
            className="h-2 w-20 shrink-0 overflow-hidden rounded-full border border-border-default/70 bg-surface shadow-[inset_0_1px_1px_rgba(0,0,0,0.18)]"
            title={contextBreakdownTitle}
          >
            {total !== null ? (
              <span className="flex h-full min-w-0 overflow-hidden rounded-full" style={{ width: filledWidth }}>
                {canRenderSegments ? segments.map((segment, index) => (
                  <span
                    key={segment.key}
                    className={`h-full ${segment.className} ${index === 0 ? 'rounded-l-full' : ''} ${index === segments.length - 1 ? 'rounded-r-full' : ''}`}
                    style={{ flexGrow: segment.tokens, flexBasis: 0, minWidth: '2px' }}
                    title={contextBreakdownTitle}
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

function fileExtensionForMimeType(mimeType: string): string {
  const normalized = mimeType.trim().toLowerCase();
  if (normalized === 'image/jpeg') {
    return 'jpg';
  }

  const [, subtype] = normalized.split('/');
  return subtype || 'png';
}

function base64ToFile(data: string, mimeType: string, name: string): File {
  const decoded = window.atob(data);
  const bytes = new Uint8Array(decoded.length);

  for (let index = 0; index < decoded.length; index += 1) {
    bytes[index] = decoded.charCodeAt(index);
  }

  return new File([bytes], name, { type: mimeType });
}

function restoreQueuedImageFiles(
  images: PromptImageInput[],
  behavior: 'steer' | 'followUp',
  queueIndex: number,
): File[] {
  return images.map((image, imageIndex) => {
    const extension = fileExtensionForMimeType(image.mimeType);
    const name = image.name?.trim() || `queued-${behavior}-${queueIndex + 1}-${imageIndex + 1}.${extension}`;
    return base64ToFile(image.data, image.mimeType, name);
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

type ComposerDrawingAttachment = DraftConversationDrawingAttachment;

function createComposerDrawingLocalId(): string {
  return `drawing-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function isPotentialExcalidrawFile(file: File): boolean {
  const lowerName = file.name.trim().toLowerCase();
  if (lowerName.endsWith('.excalidraw')) {
    return true;
  }

  if (lowerName.endsWith('.png')) {
    return true;
  }

  return file.type === 'application/json' || file.type === 'application/vnd.excalidraw+json';
}

function drawingAttachmentToPromptImage(attachment: ComposerDrawingAttachment): PromptImageInput {
  return {
    name: `${attachment.title}.png`,
    mimeType: attachment.previewMimeType,
    data: attachment.previewData,
    previewUrl: attachment.previewUrl,
  };
}

function drawingAttachmentToPromptRef(attachment: ComposerDrawingAttachment): PromptAttachmentRefInput | null {
  const attachmentId = attachment.attachmentId?.trim();
  if (!attachmentId) {
    return null;
  }

  return {
    attachmentId,
    ...(attachment.revision ? { revision: attachment.revision } : {}),
  };
}

function buildComposerDrawingPreviewTitle(attachment: ComposerDrawingAttachment): string {
  const revisionText = attachment.revision ? ` (rev ${attachment.revision})` : '';
  return `${attachment.title}${revisionText}`;
}

async function buildComposerDrawingFromFile(file: File): Promise<ComposerDrawingAttachment> {
  const scene = await loadExcalidrawSceneFromBlob(file);
  const serialized = await serializeExcalidrawScene(scene);
  const title = inferDrawingTitleFromFileName(file.name);
  const fileNames = buildDrawingFileNames(title);

  return {
    localId: createComposerDrawingLocalId(),
    title,
    sourceData: serialized.sourceData,
    sourceMimeType: serialized.sourceMimeType,
    sourceName: fileNames.sourceName,
    previewData: serialized.previewData,
    previewMimeType: serialized.previewMimeType,
    previewName: fileNames.previewName,
    previewUrl: serialized.previewUrl,
    scene,
    dirty: true,
  };
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read blob as data URL.'));
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error('Failed to read blob as data URL.'));
        return;
      }

      resolve(reader.result);
    };
    reader.readAsDataURL(blob);
  });
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

function buildDistilledMemoryTitleFromBlock(block: MessageBlock): string {
  const fallback = 'Conversation memory';

  if (block.type === 'tool_use') {
    return `After ${block.tool}`;
  }

  if (block.type === 'image') {
    return block.alt?.trim() ? `After ${block.alt.trim()}` : fallback;
  }

  const text = block.type === 'error'
    ? block.message
    : (
      block.type === 'user'
      || block.type === 'text'
      || block.type === 'thinking'
    )
      ? block.text
      : '';

  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return fallback;
  }

  return normalized.length > 80 ? `${normalized.slice(0, 79).trimEnd()}…` : normalized;
}

function hasBlockingOverlayOpen(): boolean {
  if (typeof document === 'undefined') {
    return false;
  }

  return document.querySelector('.ui-overlay-backdrop') !== null;
}

// ── ConversationPage ──────────────────────────────────────────────────────────

export function ConversationPage({ draft = false }: { draft?: boolean }) {
  const { id: routeId } = useParams<{ id?: string }>();
  const id = draft ? undefined : routeId;
  const location = useLocation();
  const navigate = useNavigate();
  const selectedArtifactId = getConversationArtifactIdFromSearch(location.search);
  const selectedRunId = getConversationRunIdFromSearch(location.search);

  const openArtifact = useCallback((artifactId: string) => {
    if (selectedArtifactId === artifactId) {
      return;
    }

    const nextSearch = setConversationRunIdInSearch(
      setConversationArtifactIdInSearch(location.search, artifactId),
      null,
    );

    navigate({
      pathname: location.pathname,
      search: nextSearch,
    });
  }, [location.pathname, location.search, navigate, selectedArtifactId]);

  const openRun = useCallback((runId: string) => {
    if (selectedRunId === runId) {
      return;
    }

    const nextSearch = setConversationRunIdInSearch(
      setConversationArtifactIdInSearch(location.search, null),
      runId,
    );

    navigate({
      pathname: location.pathname,
      search: nextSearch,
    });
  }, [location.pathname, location.search, navigate, selectedRunId]);

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

  const [historicalTailBlocks, setHistoricalTailBlocks] = useState(INITIAL_HISTORICAL_TAIL_BLOCKS);

  // ── Pi SDK stream — attempt connection immediately for all sessions ───────
  const stream = useSessionStream(id ?? null, { tailBlocks: historicalTailBlocks });

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

  useEffect(() => {
    setHistoricalTailBlocks(INITIAL_HISTORICAL_TAIL_BLOCKS);
    pendingPrependRestoreRef.current = null;
  }, [id]);

  // ── Existing session data (read-only JSONL) ───────────────────────────────
  const { detail: sessionDetail, loading: sessionLoading } = useSessionDetail(id, { tailBlocks: historicalTailBlocks });
  const visibleSessionDetail = sessionDetail?.meta.id === id ? sessionDetail : null;
  const [hydratedHistoricalBlocks, setHydratedHistoricalBlocks] = useState<Record<string, MessageBlock>>({});
  const [hydratingHistoricalBlockIds, setHydratingHistoricalBlockIds] = useState<string[]>([]);
  const hydratingHistoricalBlockIdSet = useMemo(
    () => new Set(hydratingHistoricalBlockIds),
    [hydratingHistoricalBlockIds],
  );

  useEffect(() => {
    setHydratedHistoricalBlocks({});
    setHydratingHistoricalBlockIds([]);
    setRequestedFocusMessageIndex(null);
    pendingJumpMessageIndexRef.current = null;
  }, [id]);

  const hydrateHistoricalBlock = useCallback(async (blockId: string) => {
    const normalizedBlockId = blockId.trim();
    if (!id || normalizedBlockId.length === 0 || hydratingHistoricalBlockIdSet.has(normalizedBlockId)) {
      return;
    }

    setHydratingHistoricalBlockIds((current) => current.includes(normalizedBlockId)
      ? current
      : [...current, normalizedBlockId]);

    try {
      const block = await api.sessionBlock(id, normalizedBlockId);
      const messageBlock = displayBlockToMessageBlock(block);
      setHydratedHistoricalBlocks((current) => ({
        ...current,
        [normalizedBlockId]: messageBlock,
      }));
    } catch (error) {
      console.error('Failed to hydrate historical block', error);
    } finally {
      setHydratingHistoricalBlockIds((current) => current.filter((candidate) => candidate !== normalizedBlockId));
    }
  }, [hydratingHistoricalBlockIdSet, id]);

  // Historical messages from the JSONL snapshot (doesn't update after load).
  // Memoize the conversion so typing in the composer does not rebuild long transcripts.
  const baseMessages = useMemo<MessageBlock[]>(() => (
    visibleSessionDetail
      ? visibleSessionDetail.blocks.map((block) => {
          const hydrated = hydratedHistoricalBlocks[block.id];
          return hydrated ?? displayBlockToMessageBlock(block);
        })
      : []
  ), [hydratedHistoricalBlocks, visibleSessionDetail]);
  const visibleStreamBlocks = useMemo<MessageBlock[]>(() => (
    stream.blocks.map((block) => {
      const normalizedId = block.id?.trim();
      return normalizedId ? (hydratedHistoricalBlocks[normalizedId] ?? block) : block;
    })
  ), [hydratedHistoricalBlocks, stream.blocks]);

  // Live sessions hydrate from the SSE snapshot; until that arrives, fall back to
  // JSONL + live deltas only when we have at least one source of blocks.
  const realMessages = useMemo<MessageBlock[] | undefined>(() => {
    if (isLiveSession) {
      if (stream.hasSnapshot) {
        return visibleStreamBlocks;
      }

      return (baseMessages.length > 0 || visibleStreamBlocks.length > 0)
        ? [...baseMessages, ...visibleStreamBlocks]
        : undefined;
    }

    return visibleSessionDetail ? baseMessages : undefined;
  }, [baseMessages, isLiveSession, stream.hasSnapshot, visibleSessionDetail, visibleStreamBlocks]);
  const historicalBlockOffset = stream.hasSnapshot
    ? stream.blockOffset
    : (visibleSessionDetail?.blockOffset ?? 0);
  const historicalTotalBlocks = stream.hasSnapshot
    ? stream.totalBlocks
    : (visibleSessionDetail?.totalBlocks ?? realMessages?.length ?? 0);
  const historicalHasOlderBlocks = historicalBlockOffset > 0;
  const showHistoricalLoadMore = historicalHasOlderBlocks;
  const messageIndexOffset = historicalBlockOffset;
  const messageCount = realMessages?.length ?? 0;
  const artifactAutoOpenSeededRef = useRef(false);
  const [showTree, setShowTree] = useState(false);
  const [treeSnapshot, setTreeSnapshot] = useState<ConversationTreeSnapshot | null>(null);
  const [treeLoading, setTreeLoading] = useState(false);

  useEffect(() => {
    if (!showTree || !id) {
      if (!showTree) {
        setTreeLoading(false);
      }
      setTreeSnapshot(null);
      return;
    }

    let cancelled = false;
    setTreeSnapshot(null);
    setTreeLoading(true);

    api.sessionTree(id)
      .then((snapshot) => {
        if (cancelled) {
          return;
        }
        setTreeSnapshot(snapshot);
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        setTreeSnapshot(null);
      })
      .finally(() => {
        if (!cancelled) {
          setTreeLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [id, messageCount, showTree]);
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

  const [titleOverride, setTitleOverride] = useState<string | null>(null);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [titleSaving, setTitleSaving] = useState(false);
  const titleInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTitleOverride(null);
    setIsEditingTitle(false);
    setTitleDraft('');
    setTitleSaving(false);
    setHeaderPreference(null);
    setSavingPreference(null);
    setNotice(null);

    if (noticeTimeoutRef.current !== null) {
      window.clearTimeout(noticeTimeoutRef.current);
      noticeTimeoutRef.current = null;
    }
  }, [id]);

  const title = draft
    ? NEW_CONVERSATION_TITLE
    : getConversationDisplayTitle(titleOverride, stream.title, visibleSessionDetail?.meta.title);
  const model = visibleSessionDetail?.meta.model;

  // Model
  const {
    models,
    currentModel,
    currentThinkingLevel,
    setCurrentModel,
    setCurrentThinkingLevel,
  } = useModels();

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
  const [headerPreference, setHeaderPreference] = useState<'model' | 'thinking' | null>(null);
  const [savingPreference, setSavingPreference] = useState<'model' | 'thinking' | null>(null);
  const [modelIdx, setModelIdx] = useState(0);
  const noticeTimeoutRef = useRef<number | null>(null);
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
  const headerPreferenceRef = useRef<HTMLDivElement>(null);
  const headerModelSelectRef = useRef<HTMLSelectElement>(null);
  const headerThinkingSelectRef = useRef<HTMLSelectElement>(null);
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
  const [drawingAttachments, setDrawingAttachments] = useState<ComposerDrawingAttachment[]>([]);
  const [editingDrawingLocalId, setEditingDrawingLocalId] = useState<string | null>(null);
  const [drawingsPickerOpen, setDrawingsPickerOpen] = useState(false);
  const [conversationAttachments, setConversationAttachments] = useState<ConversationAttachmentSummary[]>([]);
  const [drawingsBusy, setDrawingsBusy] = useState(false);
  const [drawingsError, setDrawingsError] = useState<string | null>(null);
  const [composerAltHeld, setComposerAltHeld] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [atBottom, setAtBottom] = useState(true);
  const composerHistoryScopeId = draft ? null : id ?? null;
  const [composerHistory, setComposerHistory] = useState<string[]>(() => readComposerHistory(composerHistoryScopeId));
  const [composerHistoryIndex, setComposerHistoryIndex] = useState<number | null>(null);
  const composerHistoryDraftRef = useRef('');
  const draftAttachmentsHydratedRef = useRef(!draft);
  const lastDraftModeRef = useRef(draft);

  if (lastDraftModeRef.current !== draft) {
    lastDraftModeRef.current = draft;
    draftAttachmentsHydratedRef.current = false;
  }

  useLayoutEffect(() => {
    if (!draft) {
      return;
    }

    const storedAttachments = readDraftConversationAttachments();
    setAttachments(storedAttachments.images.map((image, index) => {
      const extension = fileExtensionForMimeType(image.mimeType);
      const name = image.name?.trim() || `draft-image-${index + 1}.${extension}`;
      return base64ToFile(image.data, image.mimeType, name);
    }));
    setDrawingAttachments(storedAttachments.drawings);
    setEditingDrawingLocalId(null);
    setDrawingsPickerOpen(false);
    setConversationAttachments([]);
    setDrawingsError(null);
    setDragOver(false);
    setSlashIdx(0);
    setMentionIdx(0);
    draftAttachmentsHydratedRef.current = true;
  }, [draft]);

  useEffect(() => {
    if (!draft || !draftAttachmentsHydratedRef.current) {
      return;
    }

    const mutationVersion = beginDraftConversationAttachmentsMutation();

    void buildPromptImages(attachments)
      .then((images) => {
        if (!isDraftConversationAttachmentsMutationCurrent(mutationVersion)) {
          return;
        }

        persistDraftConversationAttachments({
          images,
          drawings: drawingAttachments,
        });
      })
      .catch(() => {
        // Ignore draft attachment persistence failures.
      });
  }, [attachments, draft, drawingAttachments]);

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
      queueIndex: index,
    })),
    ...stream.pendingQueue.followUp.map((text, index) => ({
      id: `followup-${index}`,
      text: text.trim() || '(queued attachment)',
      type: 'followUp' as const,
      queueIndex: index,
    })),
  ]), [stream.pendingQueue.followUp, stream.pendingQueue.steering]);
  const prevStreamingRef = useRef(false);
  const { data: memoryData, refetch: refetchMemoryData } = useApi(api.memory);
  const { data: profileState } = useApi(api.profiles);
  const { versions } = useAppEvents();
  const { projects, tasks, sessions, setProjects, setSessions } = useAppData();
  const conversationRunId = useMemo(() => (id ? createConversationLiveRunId(id) : null), [id]);
  const [conversationRun, setConversationRun] = useState<DurableRunRecord | null>(null);
  const [resumeConversationBusy, setResumeConversationBusy] = useState(false);
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
  const composerResizeFrameRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef   = useRef<HTMLDivElement>(null);
  const deferredResumeAutoResumeKeyRef = useRef<string | null>(null);
  const pendingJumpMessageIndexRef = useRef<number | null>(null);
  const [requestedFocusMessageIndex, setRequestedFocusMessageIndex] = useState<number | null>(null);
  const pendingPrependRestoreRef = useRef<{
    sessionId: string;
    scrollHeight: number;
    scrollTop: number;
  } | null>(null);

  const loadOlderMessages = useCallback((targetMessageIndex?: number, options?: { automatic?: boolean }) => {
    if (!id || sessionLoading || historicalTotalBlocks <= 0) {
      return;
    }

    if (options?.automatic && historicalTailBlocks >= Math.min(historicalTotalBlocks, MAX_AUTOMATIC_HISTORICAL_TAIL_BLOCKS)) {
      return;
    }

    const minimumTailBlocks = typeof targetMessageIndex === 'number'
      ? Math.max(
          historicalTailBlocks + HISTORICAL_TAIL_BLOCKS_STEP,
          historicalTotalBlocks - targetMessageIndex + HISTORICAL_TAIL_BLOCKS_JUMP_PADDING,
        )
      : historicalTailBlocks + HISTORICAL_TAIL_BLOCKS_STEP;
    const nextTailBlocks = Math.min(historicalTotalBlocks, minimumTailBlocks);

    if (nextTailBlocks <= historicalTailBlocks) {
      return;
    }

    const scrollEl = scrollRef.current;
    if (scrollEl && targetMessageIndex === undefined) {
      pendingPrependRestoreRef.current = {
        sessionId: id,
        scrollHeight: scrollEl.scrollHeight,
        scrollTop: scrollEl.scrollTop,
      };
    }

    setHistoricalTailBlocks(nextTailBlocks);
  }, [historicalTailBlocks, historicalTotalBlocks, id, sessionLoading]);

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
    profiles: profileState?.profiles ?? [],
  }), [projects, tasks, memoryData, profileState]);
  const referencedProjectIds = conversationProjects?.relatedProjectIds ?? [];
  const savedConversationSessionFile = useMemo(() => {
    if (!id) {
      return null;
    }

    return visibleSessionDetail?.meta.file
      ?? sessions?.find((session) => session.id === id)?.file
      ?? null;
  }, [id, sessions, visibleSessionDetail]);
  const orderedDeferredResumes = useMemo(
    () => [...deferredResumes].sort(compareDeferredResumes),
    [deferredResumes],
  );
  const hasReadyDeferredResumes = orderedDeferredResumes.some((resume) => resume.status === 'ready');
  const deferredResumeAutoResumeKey = useMemo(() => buildDeferredResumeAutoResumeKey({
    resumes: orderedDeferredResumes,
    isLiveSession,
    sessionFile: savedConversationSessionFile,
  }), [isLiveSession, orderedDeferredResumes, savedConversationSessionFile]);
  const deferredResumeIndicatorText = useMemo(
    () => buildDeferredResumeIndicatorText(orderedDeferredResumes, deferredResumeNowMs),
    [orderedDeferredResumes, deferredResumeNowMs],
  );
  const lastConversationMessage = realMessages?.[realMessages.length - 1] ?? null;
  const conversationResumeState = useMemo(() => getConversationResumeState({
    run: conversationRun,
    isLiveSession,
    lastMessage: lastConversationMessage,
  }), [conversationRun, isLiveSession, lastConversationMessage]);
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

  useEffect(() => {
    if (!conversationRunId || draft) {
      setConversationRun(null);
      return;
    }

    let cancelled = false;
    api.durableRun(conversationRunId)
      .then((data) => {
        if (!cancelled) {
          setConversationRun(data.run);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setConversationRun(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [conversationRunId, draft, versions.sessions]);

  const refetchConversationAttachments = useCallback(async () => {
    if (!id) {
      setConversationAttachments([]);
      return [] as ConversationAttachmentSummary[];
    }

    const data = await api.conversationAttachments(id);
    setConversationAttachments(data.attachments);
    return data.attachments;
  }, [id]);

  const refetchDeferredResumes = useCallback(async () => {
    if (!id) {
      setDeferredResumes([]);
      return [] as DeferredResumeSummary[];
    }

    const data = await api.deferredResumes(id);
    setDeferredResumes(data.resumes);
    return data.resumes;
  }, [id]);

  const resumeDeferredConversation = useCallback(async () => {
    if (!savedConversationSessionFile) {
      throw new Error('Open the saved conversation before continuing deferred work.');
    }

    await api.resumeSession(savedConversationSessionFile);
    setConfirmedLive(true);
    stream.reconnect();
    window.setTimeout(() => {
      void refetchDeferredResumes().catch(() => {});
    }, 200);
  }, [refetchDeferredResumes, savedConversationSessionFile, stream.reconnect]);

  useEffect(() => {
    if (draft || !id) {
      setConversationAttachments([]);
      return;
    }

    setDrawingsError(null);
    void refetchConversationAttachments().catch((error) => {
      setDrawingsError(error instanceof Error ? error.message : String(error));
    });
  }, [draft, id, refetchConversationAttachments]);

  useEffect(() => {
    if (!id) {
      setDeferredResumes([]);
      return;
    }

    void refetchDeferredResumes().catch(() => {});
  }, [id, refetchDeferredResumes, versions.sessions]);

  useEffect(() => {
    if (!deferredResumeAutoResumeKey) {
      deferredResumeAutoResumeKeyRef.current = null;
      return;
    }

    if (deferredResumeAutoResumeKeyRef.current === deferredResumeAutoResumeKey) {
      return;
    }

    deferredResumeAutoResumeKeyRef.current = deferredResumeAutoResumeKey;
    let cancelled = false;

    void resumeDeferredConversation()
      .then(() => {
        if (!cancelled) {
          showNotice('accent', 'Deferred resume firing…');
        }
      })
      .catch((error) => {
        if (!cancelled) {
          showNotice('danger', error instanceof Error ? error.message : String(error), 4000);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [deferredResumeAutoResumeKey, resumeDeferredConversation, showNotice]);

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

  // Auto-resize textarea. Schedule the measurement once per frame so typing
  // does not force multiple synchronous layouts against a large transcript.
  const resizeComposer = useCallback(() => {
    const el = textareaRef.current;
    if (!el) {
      return;
    }

    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, []);

  const scheduleComposerResize = useCallback(() => {
    if (typeof window === 'undefined' || composerResizeFrameRef.current !== null) {
      return;
    }

    composerResizeFrameRef.current = window.requestAnimationFrame(() => {
      composerResizeFrameRef.current = null;
      resizeComposer();
    });
  }, [resizeComposer]);

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
    });
  }, []);

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

  useLayoutEffect(() => {
    scheduleComposerResize();
  }, [input, scheduleComposerResize]);

  useEffect(() => () => {
    if (composerResizeFrameRef.current !== null) {
      window.cancelAnimationFrame(composerResizeFrameRef.current);
      composerResizeFrameRef.current = null;
    }
  }, []);

  useEffect(() => { setSlashIdx(0); }, [slashQuery]);
  useEffect(() => { setModelIdx(0); }, [modelQuery]);

  useEffect(() => {
    if (!headerPreference) {
      return;
    }

    const focusTarget = headerPreference === 'model'
      ? headerModelSelectRef.current
      : headerThinkingSelectRef.current;
    focusTarget?.focus();

    function handlePointerDown(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }

      if (!headerPreferenceRef.current?.contains(target)) {
        setHeaderPreference(null);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setHeaderPreference(null);
      }
    }

    window.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleEscape);
    return () => {
      window.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleEscape);
    };
  }, [headerPreference]);

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

    if (historicalHasOlderBlocks && !sessionLoading && el.scrollTop <= HISTORICAL_PREFETCH_SCROLL_THRESHOLD_PX) {
      loadOlderMessages();
    }
  }, [historicalHasOlderBlocks, loadOlderMessages, sessionLoading]);

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

  useLayoutEffect(() => {
    const pendingRestore = pendingPrependRestoreRef.current;
    if (!pendingRestore || !id || pendingRestore.sessionId !== id || pendingJumpMessageIndexRef.current !== null) {
      return;
    }

    const el = scrollRef.current;
    if (!el) {
      return;
    }

    const delta = el.scrollHeight - pendingRestore.scrollHeight;
    el.scrollTop = pendingRestore.scrollTop + Math.max(0, delta);
    pendingPrependRestoreRef.current = null;
  }, [historicalBlockOffset, id, realMessages]);

  useEffect(() => {
    if (!id || sessionLoading || !historicalHasOlderBlocks || historicalTailBlocks >= Math.min(historicalTotalBlocks, MAX_AUTOMATIC_HISTORICAL_TAIL_BLOCKS)) {
      return;
    }

    if (isLiveSession && stream.isStreaming) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      loadOlderMessages(undefined, { automatic: true });
    }, HISTORICAL_BACKGROUND_PREFETCH_DELAY_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [historicalHasOlderBlocks, historicalTailBlocks, historicalTotalBlocks, id, isLiveSession, loadOlderMessages, sessionLoading, stream.isStreaming]);

  // Scroll to the newest message once per conversation after the transcript has
  // finished its initial render pass. Long conversations can keep adjusting
  // scrollHeight for a few frames while windowing/chunk measurements settle.
  const initialScrollSessionIdRef = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (!id || !realMessages?.length || !scrollRef.current || sessionLoading) {
      return;
    }

    if (initialScrollSessionIdRef.current === id) {
      return;
    }

    const el = scrollRef.current;
    let animationFrame = 0;
    let lastScrollHeight = -1;
    let stableFrames = 0;
    let frameCount = 0;

    const settleScroll = () => {
      animationFrame = 0;
      const nextScrollHeight = el.scrollHeight;
      el.scrollTop = nextScrollHeight;
      setAtBottom(true);
      frameCount += 1;

      if (nextScrollHeight === lastScrollHeight) {
        stableFrames += 1;
      } else {
        lastScrollHeight = nextScrollHeight;
        stableFrames = 0;
      }

      if (stableFrames >= INITIAL_SCROLL_STABLE_FRAME_COUNT || frameCount >= INITIAL_SCROLL_MAX_FRAMES) {
        initialScrollSessionIdRef.current = id;
        return;
      }

      animationFrame = window.requestAnimationFrame(settleScroll);
    };

    settleScroll();

    return () => {
      if (animationFrame !== 0) {
        window.cancelAnimationFrame(animationFrame);
      }
    };
  }, [id, realMessages, sessionLoading]);

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

      if (hasBlockingOverlayOpen()) {
        return;
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
    if (el) {
      pendingJumpMessageIndexRef.current = null;
      setRequestedFocusMessageIndex(null);
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    pendingJumpMessageIndexRef.current = index;
    setRequestedFocusMessageIndex(index);
    if (index < historicalBlockOffset) {
      loadOlderMessages(index);
    }
  }, [historicalBlockOffset, loadOlderMessages]);

  useLayoutEffect(() => {
    const pendingIndex = pendingJumpMessageIndexRef.current;
    if (pendingIndex === null || pendingIndex < historicalBlockOffset) {
      return;
    }

    const el = scrollRef.current?.querySelector(`#msg-${pendingIndex}`);
    if (!el) {
      return;
    }

    pendingJumpMessageIndexRef.current = null;
    setRequestedFocusMessageIndex(null);
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [historicalBlockOffset, realMessages]);

  useEffect(() => {
    if (!isEditingTitle) {
      return;
    }

    window.requestAnimationFrame(() => {
      titleInputRef.current?.focus();
      titleInputRef.current?.select();
    });
  }, [isEditingTitle]);

  useEffect(() => {
    if (isEditingTitle) {
      return;
    }

    setTitleDraft(title);
  }, [title, isEditingTitle]);

  const beginTitleEdit = useCallback(() => {
    if (draft || !id || titleSaving) {
      return;
    }

    setTitleDraft(title === NEW_CONVERSATION_TITLE ? '' : title);
    setIsEditingTitle(true);
  }, [draft, id, title, titleSaving]);

  const cancelTitleEdit = useCallback(() => {
    setIsEditingTitle(false);
    setTitleDraft(title);
  }, [title]);

  const saveTitleEdit = useCallback(async () => {
    if (draft || !id) {
      return;
    }

    const nextTitle = titleDraft.trim();
    if (!nextTitle) {
      showNotice('danger', 'Conversation title is required.');
      return;
    }

    setTitleSaving(true);
    try {
      const result = await api.renameConversation(id, nextTitle);
      setTitleOverride(result.title);
      if (isLiveSession) {
        pushTitle(id, result.title);
      }
      if (sessions) {
        setSessions(sessions.map((session) => (
          session.id === id ? { ...session, title: result.title } : session
        )));
      }
      setIsEditingTitle(false);
      showNotice('accent', 'Conversation renamed.');
    } catch (error) {
      showNotice('danger', error instanceof Error ? error.message : String(error), 4000);
    } finally {
      setTitleSaving(false);
    }
  }, [draft, id, isLiveSession, pushTitle, sessions, setSessions, showNotice, titleDraft]);

  useEffect(() => {
    if (draft || !id || !pendingInitialPrompt || !stream.hasSnapshot) {
      return;
    }

    if (pendingInitialPromptSessionIdRef.current === id) {
      return;
    }

    const claimedInitialPrompt = consumePendingConversationPrompt(id);
    if (!claimedInitialPrompt) {
      setPendingInitialPrompt(null);
      return;
    }

    pendingInitialPromptSessionIdRef.current = id;
    pinnedInitialPromptScrollSessionIdRef.current = id;
    setPendingInitialPrompt(null);

    void stream.send(
      claimedInitialPrompt.text,
      normalizeConversationComposerBehavior(claimedInitialPrompt.behavior, stream.isStreaming),
      claimedInitialPrompt.images,
      claimedInitialPrompt.attachmentRefs,
    ).then(async () => {
      pendingInitialPromptSessionIdRef.current = null;
      await refetchConversationProjects({ resetLoading: false });
      emitConversationProjectsChanged(id);
    }).catch((error) => {
      pendingInitialPromptSessionIdRef.current = null;
      pinnedInitialPromptScrollSessionIdRef.current = null;
      persistPendingConversationPrompt(id, claimedInitialPrompt);
      setPendingInitialPrompt(claimedInitialPrompt);
      persistForkPromptDraft(id, claimedInitialPrompt.text);
      console.error('Initial prompt failed:', error);
      showNotice('danger', error instanceof Error ? error.message : String(error), 4000);
    });
  }, [
    draft,
    id,
    pendingInitialPrompt,
    stream.hasSnapshot,
    stream.isStreaming,
    stream.send,
    refetchConversationProjects,
    showNotice,
  ]);

  const ensureConversationIsLiveForFork = useCallback(async () => {
    if (!id) {
      throw new Error('Conversation unavailable.');
    }

    if (isLiveSession) {
      return id;
    }

    const sessionFile = visibleSessionDetail?.meta.file
      ?? sessions?.find((session) => session.id === id)?.file;

    if (!sessionFile) {
      throw new Error('This conversation cannot be forked because its session file is unavailable.');
    }

    const resumed = await api.resumeSession(sessionFile);
    setConfirmedLive(true);
    stream.reconnect();
    return resumed.id;
  }, [id, isLiveSession, sessions, stream, visibleSessionDetail]);

  const forkConversationFromMessage = useCallback(async (messageIndex: number) => {
    if (!id || !realMessages) {
      return;
    }

    const localMessageIndex = messageIndex - messageIndexOffset;
    if (localMessageIndex < 0 || localMessageIndex >= realMessages.length) {
      showNotice('danger', 'Load the relevant part of the conversation before branching from it.');
      return;
    }

    try {
      const liveConversationId = await ensureConversationIsLiveForFork();
      const clickedBlock = realMessages[localMessageIndex];

      if (clickedBlock?.type === 'text') {
        const entryId = resolveSessionEntryIdFromBlockId(clickedBlock.id);
        if (!entryId) {
          throw new Error('Unable to resolve the selected assistant message for branching.');
        }

        const { newSessionId } = await api.branchSession(liveConversationId, entryId);
        ensureConversationTabOpen(newSessionId);
        navigate(`/conversations/${newSessionId}`);
        return;
      }

      const entries = await api.forkEntries(liveConversationId);
      const entry = resolveForkEntryForMessage(realMessages, localMessageIndex, entries);
      if (!entry) {
        throw new Error('No forkable message found for that point in the conversation.');
      }

      const { newSessionId } = await api.forkSession(liveConversationId, entry.entryId, { preserveSource: true });
      // Pi forks before the selected user turn, so prefill that prompt in the
      // destination composer and let the user edit or resend it manually.
      persistForkPromptDraft(newSessionId, entry.text);
      ensureConversationTabOpen(newSessionId);
      navigate(`/conversations/${newSessionId}`);
    } catch (error) {
      showNotice('danger', `Fork failed: ${(error as Error).message}`);
    }
  }, [ensureConversationIsLiveForFork, id, messageIndexOffset, navigate, realMessages, showNotice]);

  function openHeaderPreference(preference: 'model' | 'thinking') {
    setHeaderPreference((current) => current === preference ? null : preference);
  }

  async function saveModelPreference(modelId: string) {
    if (!modelId || modelId === currentModel || savingPreference !== null) {
      return;
    }

    setSavingPreference('model');
    try {
      await api.updateModelPreferences({ model: modelId });
      setCurrentModel(modelId);
      const selectedModel = models.find((candidate) => candidate.id === modelId);
      if (selectedModel) {
        showNotice('accent', `Default model set to ${selectedModel.name}`);
      }
    } catch (error) {
      showNotice('danger', error instanceof Error ? error.message : String(error), 4000);
    } finally {
      setSavingPreference(null);
    }
  }

  async function saveThinkingLevelPreference(thinkingLevel: string) {
    if (thinkingLevel === currentThinkingLevel || savingPreference !== null) {
      return;
    }

    setSavingPreference('thinking');
    try {
      await api.updateModelPreferences({ thinkingLevel });
      setCurrentThinkingLevel(thinkingLevel);
      showNotice('accent', `Thinking level set to ${formatThinkingLevelLabel(thinkingLevel)}.`);
    } catch (error) {
      showNotice('danger', error instanceof Error ? error.message : String(error), 4000);
    } finally {
      setSavingPreference(null);
    }
  }

  function selectModel(modelId: string) {
    setInput('');
    setModelIdx(0);
    textareaRef.current?.focus();
    void saveModelPreference(modelId);
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

  async function addComposerFiles(files: File[]) {
    const nextImageFiles: File[] = [];
    const nextDrawingAttachments: ComposerDrawingAttachment[] = [];
    const rejectedFiles: string[] = [];

    for (const file of files) {
      if (isPotentialExcalidrawFile(file)) {
        try {
          const drawing = await buildComposerDrawingFromFile(file);
          nextDrawingAttachments.push(drawing);
          continue;
        } catch (error) {
          if (file.name.trim().toLowerCase().endsWith('.excalidraw')) {
            showNotice('danger', `Failed to parse ${file.name}: ${error instanceof Error ? error.message : String(error)}`, 4000);
            continue;
          }
        }
      }

      if (file.type.startsWith('image/')) {
        nextImageFiles.push(file);
        continue;
      }

      rejectedFiles.push(file.name || 'Unnamed file');
    }

    if (nextImageFiles.length > 0) {
      addImageAttachments(nextImageFiles);
    }

    if (nextDrawingAttachments.length > 0) {
      setDrawingAttachments((current) => [...current, ...nextDrawingAttachments]);
      showNotice('accent', `Attached ${nextDrawingAttachments.length} drawing${nextDrawingAttachments.length === 1 ? '' : 's'}.`);
    }

    if (rejectedFiles.length > 0) {
      const preview = rejectedFiles.slice(0, 3).join(', ');
      const suffix = rejectedFiles.length > 3 ? `, +${rejectedFiles.length - 3} more` : '';
      showNotice('danger', `Unsupported file type: ${preview}${suffix}`, 4000);
    }
  }

  function openFilePicker() {
    fileInputRef.current?.click();
  }

  function openDrawingEditor() {
    setEditingDrawingLocalId('__new__');
  }

  function openDrawingsPicker() {
    setDrawingsPickerOpen(true);
  }

  function closeDrawingEditor() {
    setEditingDrawingLocalId(null);
  }

  function editDrawing(localId: string) {
    setEditingDrawingLocalId(localId);
  }

  function removeDrawingAttachment(localId: string) {
    setDrawingAttachments((current) => current.filter((attachment) => attachment.localId !== localId));
  }

  async function saveDrawingFromEditor(payload: ExcalidrawEditorSavePayload) {
    const activeLocalId = editingDrawingLocalId;

    setDrawingAttachments((current) => {
      if (activeLocalId && activeLocalId !== '__new__') {
        return current.map((attachment) => {
          if (attachment.localId !== activeLocalId) {
            return attachment;
          }

          return {
            ...attachment,
            title: payload.title,
            sourceData: payload.sourceData,
            sourceMimeType: payload.sourceMimeType,
            sourceName: payload.sourceName,
            previewData: payload.previewData,
            previewMimeType: payload.previewMimeType,
            previewName: payload.previewName,
            previewUrl: payload.previewUrl,
            scene: payload.scene,
            dirty: true,
          } satisfies ComposerDrawingAttachment;
        });
      }

      return [
        ...current,
        {
          localId: createComposerDrawingLocalId(),
          title: payload.title,
          sourceData: payload.sourceData,
          sourceMimeType: payload.sourceMimeType,
          sourceName: payload.sourceName,
          previewData: payload.previewData,
          previewMimeType: payload.previewMimeType,
          previewName: payload.previewName,
          previewUrl: payload.previewUrl,
          scene: payload.scene,
          dirty: true,
        } satisfies ComposerDrawingAttachment,
      ];
    });

    closeDrawingEditor();
    showNotice('accent', 'Drawing saved to composer.');
  }

  async function fetchAttachmentDataUrl(downloadPath: string): Promise<string> {
    const response = await fetch(downloadPath);
    if (!response.ok) {
      throw new Error(`Failed to download attachment asset (${response.status} ${response.statusText}).`);
    }

    return blobToDataUrl(await response.blob());
  }

  async function attachSavedDrawing(selection: { attachment: ConversationAttachmentSummary; revision: number }) {
    if (!id) {
      showNotice('danger', 'Saved drawing picker requires an existing conversation.', 4000);
      return;
    }

    setDrawingsBusy(true);
    setDrawingsError(null);
    try {
      const detail = await api.conversationAttachment(id, selection.attachment.id);
      const record = detail.attachment;
      const revision = record.revisions.find((entry) => entry.revision === selection.revision)
        ?? record.latestRevision;

      const sourceDataUrl = await fetchAttachmentDataUrl(revision.sourceDownloadPath);
      const sourceCommaIndex = sourceDataUrl.indexOf(',');
      const sourceData = sourceCommaIndex >= 0 ? sourceDataUrl.slice(sourceCommaIndex + 1) : sourceDataUrl;
      const previewDataUrl = await fetchAttachmentDataUrl(revision.previewDownloadPath);
      const previewCommaIndex = previewDataUrl.indexOf(',');
      const previewData = previewCommaIndex >= 0 ? previewDataUrl.slice(previewCommaIndex + 1) : previewDataUrl;
      const scene = parseExcalidrawSceneFromSourceData(sourceData);

      const nextAttachment: ComposerDrawingAttachment = {
        localId: createComposerDrawingLocalId(),
        attachmentId: record.id,
        revision: revision.revision,
        title: record.title,
        sourceData,
        sourceMimeType: revision.sourceMimeType,
        sourceName: revision.sourceName,
        previewData,
        previewMimeType: revision.previewMimeType,
        previewName: revision.previewName,
        previewUrl: previewDataUrl,
        scene,
        dirty: false,
      };

      setDrawingAttachments((current) => {
        const alreadyAttached = current.some((attachment) => (
          attachment.attachmentId === nextAttachment.attachmentId
          && attachment.revision === nextAttachment.revision
          && !attachment.dirty
        ));

        if (alreadyAttached) {
          return current;
        }

        return [...current, nextAttachment];
      });

      setDrawingsPickerOpen(false);
      showNotice('accent', `Attached drawing ${record.title} (rev ${revision.revision}).`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setDrawingsError(message);
      showNotice('danger', message, 4000);
    } finally {
      setDrawingsBusy(false);
    }
  }

  async function persistDrawingsForConversation(
    conversationId: string,
    currentDrawings: ComposerDrawingAttachment[],
  ): Promise<ComposerDrawingAttachment[]> {
    const persisted: ComposerDrawingAttachment[] = [];

    for (const drawing of currentDrawings) {
      if (drawing.attachmentId && !drawing.dirty) {
        persisted.push(drawing);
        continue;
      }

      if (drawing.attachmentId) {
        const result = await api.updateConversationAttachment(conversationId, drawing.attachmentId, {
          title: drawing.title,
          sourceData: drawing.sourceData,
          sourceName: drawing.sourceName,
          sourceMimeType: drawing.sourceMimeType,
          previewData: drawing.previewData,
          previewName: drawing.previewName,
          previewMimeType: drawing.previewMimeType,
        });

        persisted.push({
          ...drawing,
          attachmentId: result.attachment.id,
          revision: result.attachment.currentRevision,
          title: result.attachment.title,
          sourceName: result.attachment.latestRevision.sourceName,
          sourceMimeType: result.attachment.latestRevision.sourceMimeType,
          previewName: result.attachment.latestRevision.previewName,
          previewMimeType: result.attachment.latestRevision.previewMimeType,
          dirty: false,
        });
        continue;
      }

      const result = await api.createConversationAttachment(conversationId, {
        kind: 'excalidraw',
        title: drawing.title,
        sourceData: drawing.sourceData,
        sourceName: drawing.sourceName,
        sourceMimeType: drawing.sourceMimeType,
        previewData: drawing.previewData,
        previewName: drawing.previewName,
        previewMimeType: drawing.previewMimeType,
      });

      persisted.push({
        ...drawing,
        attachmentId: result.attachment.id,
        revision: result.attachment.currentRevision,
        title: result.attachment.title,
        sourceName: result.attachment.latestRevision.sourceName,
        sourceMimeType: result.attachment.latestRevision.sourceMimeType,
        previewName: result.attachment.latestRevision.previewName,
        previewMimeType: result.attachment.latestRevision.previewMimeType,
        dirty: false,
      });
    }

    return persisted;
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

    try {
      await resumeDeferredConversation();
      showNotice('accent', 'Resuming deferred work…');
    } catch (error) {
      showNotice('danger', error instanceof Error ? error.message : String(error), 4000);
    }
  }

  const resumeConversation = useCallback(async () => {
    if (!id || draft || resumeConversationBusy) {
      return;
    }

    setResumeConversationBusy(true);
    try {
      const result = await api.recoverConversation(id);
      if (result.conversationId && result.conversationId !== id) {
        ensureConversationTabOpen(result.conversationId);
        navigate(`/conversations/${result.conversationId}`);
        return;
      }

      setConfirmedLive(true);
      stream.reconnect();
      showNotice(
        'accent',
        result.replayedPendingOperation
          ? 'Resuming interrupted turn…'
          : result.usedFallbackPrompt
            ? 'Resuming with a follow-up prompt…'
            : 'Conversation resumed. Send a follow-up to continue.',
      );
    } catch (error) {
      showNotice('danger', error instanceof Error ? error.message : String(error), 4000);
    } finally {
      setResumeConversationBusy(false);
    }
  }, [draft, id, navigate, resumeConversationBusy, showNotice, stream.reconnect]);

  const saveMemoryFromMessage = useCallback(async (block: MessageBlock, messageIndex: number) => {
    if (draft || !id) {
      showNotice('danger', 'Distilling memory requires an existing conversation.', 4000);
      return;
    }

    const anchorMessageId = block.id?.trim();
    if (!anchorMessageId) {
      showNotice('danger', 'Unable to resolve where to anchor this distillation.', 4000);
      return;
    }

    try {
      const result = await api.createConversationMemory(id, {
        title: buildDistilledMemoryTitleFromBlock(block),
        anchorMessageId,
      });

      if (result.accepted) {
        showNotice('accent', `Queued memory distillation from conversation up to message ${messageIndex + 1}.`);
      } else {
        showNotice('danger', 'Unable to queue memory distillation right now.', 4000);
      }

      await refetchMemoryData({ resetLoading: false });
    } catch (error) {
      showNotice('danger', error instanceof Error ? error.message : String(error), 4000);
    }
  }, [draft, id, refetchMemoryData, showNotice]);

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
    const pendingImageAttachments = attachments;
    const pendingDrawingAttachments = drawingAttachments;
    if (!text && pendingImageAttachments.length === 0 && pendingDrawingAttachments.length === 0) {
      return;
    }

    if (pendingImageAttachments.length === 0 && pendingDrawingAttachments.length === 0) {
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
      const filePromptImages = await buildPromptImages(pendingImageAttachments);
      const drawingPromptImages = pendingDrawingAttachments.map((drawing) => drawingAttachmentToPromptImage(drawing));
      const promptImages = [...filePromptImages, ...drawingPromptImages];
      let textToSend = text;

      setInput('');
      setAttachments([]);
      setDrawingAttachments([]);
      setDrawingsError(null);

      if (promptImages.length === 0) {
        if (text === '/clear') {
          if (draft) {
            return;
          }

          await handleClear();
          return;
        }

        if (text === '/image') {
          openFilePicker();
          return;
        }

        if (text === '/draw') {
          openDrawingEditor();
          return;
        }

        if (text === '/drawings') {
          if (!id) {
            showNotice('danger', 'Saved drawings are only available in existing conversations.', 4000);
            return;
          }

          setDrawingsPickerOpen(true);
          return;
        }

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

        if (text === '/fork' && id) {
          try {
            rememberComposerInput(inputSnapshot);
            const liveConversationId = await ensureConversationIsLiveForFork();
            const entries = await api.forkEntries(liveConversationId);
            if (entries.length === 0) {
              sendToAgent('(No forkable messages yet)');
              return;
            }

            const entry = entries[entries.length - 1];
            const { newSessionId } = await api.forkSession(liveConversationId, entry.entryId, { preserveSource: true });
            persistForkPromptDraft(newSessionId, entry.text);
            ensureConversationTabOpen(newSessionId);
            navigate(`/conversations/${newSessionId}`);
          } catch (error) {
            console.error('Fork failed:', error);
          }
          return;
        }
      }

      const requestedBehavior = behavior ?? (isLiveSession && stream.isStreaming ? 'steer' : undefined);
      const queuedBehavior = normalizeConversationComposerBehavior(requestedBehavior, stream.isStreaming);

      const persistPromptDrawings = async (conversationId: string): Promise<PromptAttachmentRefInput[]> => {
        if (pendingDrawingAttachments.length === 0) {
          return [];
        }

        setDrawingsBusy(true);
        try {
          const persistedDrawings = await persistDrawingsForConversation(conversationId, pendingDrawingAttachments);
          return persistedDrawings
            .map((drawing) => drawingAttachmentToPromptRef(drawing))
            .filter((attachmentRef): attachmentRef is PromptAttachmentRefInput => attachmentRef !== null);
        } finally {
          setDrawingsBusy(false);
        }
      };

      if (!id && !visibleSessionDetail) {
        rememberComposerInput(inputSnapshot);
        try {
          const draftCwd = readDraftConversationCwd().trim() || undefined;
          const { id: newId } = await api.createLiveSession(draftCwd, draftReferencedProjectIds);
          const attachmentRefs = await persistPromptDrawings(newId);

          rememberComposerInput(inputSnapshot, newId);
          persistPendingConversationPrompt(newId, {
            text: textToSend,
            behavior: queuedBehavior,
            images: promptImages,
            attachmentRefs,
          });
          clearDraftConversationAttachments();
          clearDraftConversationCwd();
          ensureConversationTabOpen(newId);
          navigate(`/conversations/${newId}`, { replace: true });
        } catch (error) {
          showNotice('danger', error instanceof Error ? error.message : String(error), 4000);
          setInput(inputSnapshot);
          setAttachments(pendingImageAttachments);
          setDrawingAttachments(pendingDrawingAttachments);
        }
        return;
      }

      if (!id) {
        return;
      }

      if (!isLiveSession && !visibleSessionDetail) {
        showNotice('danger', 'Conversation is still loading. Try sending again in a moment.', 4000);
        setInput(inputSnapshot);
        setAttachments(pendingImageAttachments);
        setDrawingAttachments(pendingDrawingAttachments);
        return;
      }

      const attachmentRefs = await persistPromptDrawings(id);

      if (isLiveSession) {
        rememberComposerInput(inputSnapshot);
        await stream.send(textToSend, queuedBehavior, promptImages, attachmentRefs);

        await refetchConversationProjects({ resetLoading: false });
        emitConversationProjectsChanged(id);
        await refetchConversationAttachments();

        setTimeout(() => {
          if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
          }
        }, 50);
      } else if (visibleSessionDetail) {
        try {
          rememberComposerInput(inputSnapshot);
          await api.resumeSession(visibleSessionDetail.meta.file);
          setConfirmedLive(true);
          stream.reconnect();
          setTimeout(() => {
            void stream.send(textToSend, queuedBehavior, promptImages, attachmentRefs)
              .then(async () => {
                await refetchConversationProjects({ resetLoading: false });
                emitConversationProjectsChanged(id);
                await refetchConversationAttachments();
              })
              .catch((error) => {
                console.error('Send after auto-resume failed:', error);
              });
          }, 150);
        } catch (error) {
          console.error('Auto-resume failed:', error);
        }
      }
    } catch (error) {
      console.error('Failed to prepare attachments:', error);
      setInput(inputSnapshot);
      setAttachments(pendingImageAttachments);
      setDrawingAttachments(pendingDrawingAttachments);
      showNotice('danger', error instanceof Error ? error.message : String(error), 4000);
    }
  }

  async function restoreQueuedPromptToComposer(behavior: 'steer' | 'followUp', queueIndex: number) {
    if (!id || !isLiveSession) {
      showNotice('danger', 'Queued prompts can only be restored from a live session.', 4000);
      return;
    }

    try {
      const restored = await api.restoreQueuedMessage(id, { behavior, index: queueIndex });
      const restoredText = restored.text;
      const restoredFiles = restoreQueuedImageFiles(restored.images, behavior, queueIndex);
      const hasRestoredText = restoredText.trim().length > 0;

      if (!hasRestoredText && restoredFiles.length === 0) {
        showNotice('danger', 'Queued prompt had nothing to restore.', 4000);
        return;
      }

      if (hasRestoredText) {
        const currentInput = textareaRef.current?.value ?? input;
        setInput([restoredText, currentInput].filter((value) => value.trim().length > 0).join('\n\n'));
      }
      if (restoredFiles.length > 0) {
        setAttachments((current) => [...restoredFiles, ...current]);
      }

      moveComposerCaretToEnd();

      const restoredParts = [
        hasRestoredText ? 'text' : null,
        restoredFiles.length > 0 ? `${restoredFiles.length} image${restoredFiles.length === 1 ? '' : 's'}` : null,
      ].filter((value): value is string => Boolean(value));
      showNotice('accent', `Restored queued ${restoredParts.join(' + ')} to the composer.`);
    } catch (error) {
      showNotice('danger', error instanceof Error ? error.message : String(error), 4000);
    }
  }

  function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(e.clipboardData.files);
    if (files.length === 0) {
      return;
    }

    e.preventDefault();
    void addComposerFiles(files);
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
      if (input.length > 0 || attachments.length > 0 || drawingAttachments.length > 0) {
        e.preventDefault();
        setInput('');
        setAttachments([]);
        setDrawingAttachments([]);
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
            } else if (sel.displayCmd === '/draw') {
              setInput('');
              setSlashIdx(0);
              openDrawingEditor();
            } else if (sel.displayCmd === '/drawings') {
              setInput('');
              setSlashIdx(0);
              if (!id) {
                showNotice('danger', 'Saved drawings are only available in existing conversations.', 4000);
              } else {
                openDrawingsPicker();
              }
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
      await submitComposer(resolveConversationComposerSubmitState(stream.isStreaming, true).behavior);
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
    if (files.length > 0) {
      void addComposerFiles(files);
    }
  }
  function removeAttachment(i: number) {
    setAttachments(prev => prev.filter((_, j) => j !== i));
  }

  const composerHasContent = input.trim().length > 0 || attachments.length > 0 || drawingAttachments.length > 0;
  const composerSubmit = resolveConversationComposerSubmitState(stream.isStreaming, composerAltHeld);
  const showScrollToBottomControl = shouldShowScrollToBottomControl(messageCount, atBottom);
  const hasRenderableMessages = (realMessages?.length ?? 0) > 0;
  // Keep the rail off once transcripts are large enough to trigger windowing.
  // The rail continuously re-measures mounted message markers, which makes
  // composer-driven layout work scale with transcript size.
  const shouldRenderConversationRail = hasRenderableMessages
    && Boolean(realMessages)
    && (realMessages?.length ?? 0) <= MAX_CONVERSATION_RAIL_BLOCKS;
  const editingDrawingAttachment = useMemo(() => {
    if (!editingDrawingLocalId || editingDrawingLocalId === '__new__') {
      return null;
    }

    return drawingAttachments.find((attachment) => attachment.localId === editingDrawingLocalId) ?? null;
  }, [drawingAttachments, editingDrawingLocalId]);
  const hydratingLiveConversation = isLiveSession
    && !stream.hasSnapshot
    && !visibleSessionDetail
    && stream.blocks.length === 0;
  const showConversationLoadingState = !hasRenderableMessages
    && (sessionLoading || hydratingLiveConversation);

  const transcriptPane = useMemo(() => (
    <div className="relative flex-1 min-h-0">
      <div ref={scrollRef} className="conversation-scroll-shell h-full overflow-y-auto overflow-x-hidden">
        {hasRenderableMessages && realMessages ? (
          <>
            {showHistoricalLoadMore && (
              <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-border-subtle bg-surface/90 px-6 py-3 backdrop-blur">
                <div className="min-w-0 text-[11px] text-secondary">
                  Showing the latest <span className="font-medium text-primary">{realMessages.length}</span> of{' '}
                  <span className="font-medium text-primary">{historicalTotalBlocks}</span> blocks.
                </div>
                <button
                  type="button"
                  onClick={() => loadOlderMessages()}
                  disabled={sessionLoading}
                  className="ui-action-button shrink-0 text-[11px]"
                >
                  {sessionLoading ? 'Loading older…' : `Load ${Math.min(HISTORICAL_TAIL_BLOCKS_STEP, historicalBlockOffset)} older blocks`}
                </button>
              </div>
            )}
            <ChatView
              key={id ?? 'draft-conversation'}
              messages={realMessages}
              messageIndexOffset={messageIndexOffset}
              scrollContainerRef={scrollRef}
              focusMessageIndex={requestedFocusMessageIndex}
              isStreaming={stream.isStreaming}
              onCheckpointMessage={id && !stream.isStreaming ? saveMemoryFromMessage : undefined}
              onForkMessage={id && !stream.isStreaming ? forkConversationFromMessage : undefined}
              onHydrateMessage={hydrateHistoricalBlock}
              hydratingMessageBlockIds={hydratingHistoricalBlockIdSet}
              onOpenArtifact={openArtifact}
              activeArtifactId={selectedArtifactId}
              onOpenRun={openRun}
              activeRunId={selectedRunId}
              onResumeConversation={conversationResumeState.canResume ? resumeConversation : undefined}
              resumeConversationBusy={resumeConversationBusy}
              resumeConversationTitle={conversationResumeState.title}
              resumeConversationLabel={conversationResumeState.actionLabel ?? 'resume'}
            />
          </>
        ) : showConversationLoadingState ? (
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
            title={draft ? NEW_CONVERSATION_TITLE : title}
            body={draft
              ? 'Start typing to create a conversation. You can set its initial working directory in the right rail, use the saved default from Settings, or let a single referenced project repo root pick it automatically.'
              : isLiveSession
                ? 'This conversation is live but has no messages yet. Send a prompt to get started.'
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
      {shouldRenderConversationRail && realMessages && (
        <ConversationRail
          messages={realMessages}
          messageIndexOffset={messageIndexOffset}
          scrollContainerRef={scrollRef}
          onJumpToMessage={jumpToMessage}
        />
      )}
    </div>
  ), [
    conversationResumeState.actionLabel,
    conversationResumeState.canResume,
    conversationResumeState.title,
    draft,
    forkConversationFromMessage,
    hasRenderableMessages,
    historicalBlockOffset,
    historicalTotalBlocks,
    hydrateHistoricalBlock,
    hydratingHistoricalBlockIdSet,
    id,
    isLiveSession,
    jumpToMessage,
    loadOlderMessages,
    messageIndexOffset,
    openArtifact,
    openRun,
    realMessages,
    requestedFocusMessageIndex,
    resumeConversation,
    resumeConversationBusy,
    saveMemoryFromMessage,
    selectedArtifactId,
    selectedRunId,
    sessionLoading,
    shouldRenderConversationRail,
    showConversationLoadingState,
    showHistoricalLoadMore,
    showScrollToBottomControl,
    stream.isStreaming,
    title,
  ]);


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
                {!stream.isStreaming && conversationResumeState.canResume && (
                  <button
                    type="button"
                    onClick={() => { void resumeConversation(); }}
                    disabled={resumeConversationBusy}
                    title={conversationResumeState.title ?? 'Resume this conversation'}
                    className="text-accent transition-colors hover:text-accent/80 disabled:cursor-default disabled:text-dim"
                  >
                    {resumeConversationBusy ? 'opening…' : (conversationResumeState.actionLabel ?? 'resume')}
                  </button>
                )}
                {isLiveSession && <span className="text-accent">{formatLiveSessionLabel(isLiveSession)}</span>}
              </>
            )}
          </div>
        )}
      >
        <div className="flex-1 min-w-0">
          {isEditingTitle && !draft ? (
            <form
              className="flex min-w-0 items-center gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                void saveTitleEdit();
              }}
            >
              <input
                ref={titleInputRef}
                value={titleDraft}
                onChange={(event) => setTitleDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    cancelTitleEdit();
                  }
                }}
                placeholder="Name this conversation"
                className="min-w-0 flex-1 rounded-lg border border-border-default bg-surface px-3 py-1.5 text-[15px] font-medium text-primary outline-none transition-colors focus:border-accent/60"
                disabled={titleSaving}
              />
              <button type="submit" className="ui-toolbar-button text-primary" disabled={titleSaving}>
                {titleSaving ? 'Saving…' : 'Save'}
              </button>
              <button type="button" className="ui-toolbar-button" onClick={cancelTitleEdit} disabled={titleSaving}>
                Cancel
              </button>
            </form>
          ) : (
            <div className="flex min-w-0 items-center gap-2">
              <h1 className="ui-page-title truncate" onDoubleClick={!draft ? beginTitleEdit : undefined}>{title}</h1>
              {!draft && id && (
                <IconButton onClick={beginTitleEdit} title="Rename conversation" aria-label="Rename conversation" compact>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 21h3.75L17.81 9.94l-3.75-3.75L3 17.25V21Zm14.06-13.06 1.69-1.69a1.5 1.5 0 0 0 0-2.12l-.88-.88a1.5 1.5 0 0 0-2.12 0l-1.69 1.69" />
                  </svg>
                </IconButton>
              )}
            </div>
          )}
          <div ref={headerPreferenceRef} className="relative">
            <ContextBar
              model={currentModel || model}
              thinkingLevel={currentThinkingLevel}
              tokens={sessionTokens}
              activePreference={headerPreference}
              onOpenPreferences={openHeaderPreference}
            />
            {headerPreference && (
              <HeaderPreferencesMenu
                models={models}
                currentModel={currentModel}
                currentThinkingLevel={currentThinkingLevel}
                savingPreference={savingPreference}
                modelSelectRef={headerModelSelectRef}
                thinkingSelectRef={headerThinkingSelectRef}
                onSelectModel={(modelId) => { void saveModelPreference(modelId); }}
                onSelectThinkingLevel={(thinkingLevel) => { void saveThinkingLevelPreference(thinkingLevel); }}
                onClose={() => { setHeaderPreference(null); }}
              />
            )}
          </div>
        </div>
      </PageHeader>

      {/* Messages */}
      {transcriptPane}

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
            if (c === '/clear')      { setInput(''); setAttachments([]); setDrawingAttachments([]); if (!draft) { void handleClear(); } return; }
            if (c === '/image')      { setInput(''); openFilePicker(); return; }
            if (c === '/draw')       { setInput(''); openDrawingEditor(); return; }
            if (c === '/drawings')   {
              setInput('');
              if (!id) {
                showNotice('danger', 'Saved drawings are only available in existing conversations.', 4000);
              } else {
                setDrawingsPickerOpen(true);
              }
              return;
            }
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
            if (c === '/fork' && id) {
              setInput('');
              void ensureConversationIsLiveForFork()
                .then((liveConversationId) => api.forkEntries(liveConversationId).then((entries) => ({ liveConversationId, entries })))
                .then(({ liveConversationId, entries }) => {
                  const entry = entries[entries.length - 1];
                  if (!entry) return;
                  return api.forkSession(liveConversationId, entry.entryId, { preserveSource: true })
                    .then(({ newSessionId }) => {
                      persistForkPromptDraft(newSessionId, entry.text);
                      ensureConversationTabOpen(newSessionId);
                      navigate(`/conversations/${newSessionId}`);
                    });
                })
                .catch(console.error);
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

            {drawingAttachments.length > 0 && (
              <div className="flex flex-wrap gap-1.5 px-3 pt-2.5">
                {drawingAttachments.map((attachment) => (
                  <div key={attachment.localId} className="flex items-center gap-1.5 rounded-lg border border-border-subtle bg-surface px-2 py-1 text-[11px] max-w-[270px]">
                    <img
                      src={attachment.previewUrl}
                      alt={buildComposerDrawingPreviewTitle(attachment)}
                      className="h-7 w-9 rounded object-cover"
                    />
                    <div className="min-w-0">
                      <p className="truncate text-secondary">{buildComposerDrawingPreviewTitle(attachment)}</p>
                      <p className="text-[10px] text-dim">{attachment.attachmentId ? `#${attachment.attachmentId}` : 'new drawing'}{attachment.dirty ? ' · unsaved' : ''}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => editDrawing(attachment.localId)}
                      className="text-[11px] text-accent transition-colors hover:text-accent/80"
                      title={`Edit ${attachment.title}`}
                    >
                      edit
                    </button>
                    <button
                      type="button"
                      onClick={() => removeDrawingAttachment(attachment.localId)}
                      className="ui-icon-button ui-icon-button-compact ml-0.5 shrink-0 leading-none"
                      title={`Remove ${attachment.title}`}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}

            {drawingsBusy && (
              <div className="px-3 pt-2 text-[11px] text-dim">Syncing drawings…</div>
            )}

            {drawingsError && (
              <div className="px-3 pt-2 text-[11px] text-danger">{drawingsError}</div>
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
                    <button
                      type="button"
                      onClick={() => { void restoreQueuedPromptToComposer(msg.type, msg.queueIndex); }}
                      className="shrink-0 text-[11px] text-dim transition-colors hover:text-primary"
                      title="Restore this queued prompt to the composer"
                      aria-label="Restore queued prompt to the composer"
                    >
                      restore
                    </button>
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
                accept="image/*,.excalidraw,application/json"
                multiple
                className="hidden"
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  if (files.length > 0) {
                    void addComposerFiles(files);
                  }
                  e.target.value = '';
                }}
              />

              <IconButton
                className="shrink-0 mb-0.5"
                title="Attach image or Excalidraw file"
                aria-label="Attach image or Excalidraw file"
                onClick={openFilePicker}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                </svg>
              </IconButton>

              <IconButton
                className="shrink-0 mb-0.5"
                title="Create drawing"
                aria-label="Create drawing"
                onClick={openDrawingEditor}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 20h9" />
                  <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
                </svg>
              </IconButton>

              <textarea
                ref={textareaRef}
                value={input}
                onChange={e => { setInput(e.target.value); setSlashIdx(0); setMentionIdx(0); }}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                rows={1}
                className="flex-1 bg-transparent text-sm text-primary placeholder:text-dim outline-none resize-none leading-relaxed"
                placeholder="Message… (/ for commands, @ to reference projects, tasks, knowledge, and profiles)"
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

      {editingDrawingLocalId && (
        <Suspense fallback={null}>
          <ExcalidrawEditorModal
            key={editingDrawingLocalId}
            initialTitle={editingDrawingAttachment?.title ?? 'Drawing'}
            initialScene={editingDrawingAttachment?.scene ?? null}
            saveLabel={editingDrawingAttachment ? 'Update drawing' : 'Save drawing'}
            onSave={saveDrawingFromEditor}
            onClose={closeDrawingEditor}
          />
        </Suspense>
      )}

      {drawingsPickerOpen && id && (
        <Suspense fallback={null}>
          <ConversationDrawingsPickerModal
            attachments={conversationAttachments}
            onLoadAttachment={async (attachmentId) => {
              const detail = await api.conversationAttachment(id, attachmentId);
              return detail.attachment;
            }}
            onAttach={(selection) => { void attachSavedDrawing(selection); }}
            onClose={() => setDrawingsPickerOpen(false)}
          />
        </Suspense>
      )}

      {/* Session tree overlay */}
      {showTree && (
        <Suspense fallback={null}>
          <ConversationTree
            tree={treeSnapshot?.roots ?? []}
            loading={treeLoading}
            onJump={jumpToMessage}
            onClose={() => setShowTree(false)}
            onFork={id && !stream.isStreaming && Boolean(realMessages) ? (blockIdx) => {
              void forkConversationFromMessage(blockIdx);
            } : undefined}
          />
        </Suspense>
      )}
    </div>
  );
}

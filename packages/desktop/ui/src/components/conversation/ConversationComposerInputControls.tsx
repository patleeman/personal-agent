import type { ClipboardEventHandler, KeyboardEventHandler, PointerEventHandler, RefObject } from 'react';

import type { ConversationAutoModeState, ModelInfo } from '../../shared/types';
import { ConversationComposerActions, type ConversationComposerSubmitLabel } from './ConversationComposerActions';
import { ConversationPreferencesRow } from './ConversationPreferencesRow';

const COMPOSER_PREFERENCES_MENU_WIDTH_PX = 780;

export function ConversationComposerInputControls({
  fileInputRef,
  textareaRef,
  input,
  pendingAskUserQuestion,
  composerDisabled,
  composerShellWidth,

  streamIsStreaming,
  models,
  currentModel,
  currentThinkingLevel,
  currentServiceTier,
  savingPreference,
  showAutoModeToggle,
  conversationAutoModeEnabled,
  conversationAutoModeBusy,
  conversationAutoMode,
  dictationState,
  dictationLevelSamples,
  dictationStartedAt,
  conversationNeedsTakeover,
  composerHasContent,
  composerShowsQuestionSubmit,
  composerQuestionCanSubmit,
  composerQuestionRemainingCount,
  composerQuestionSubmitting,
  composerSubmitLabel,
  composerAltHeld,
  composerParallelHeld,
  onFilesSelected,
  onInputChange,
  onRememberComposerSelection,
  onKeyDown,
  onPaste,
  onOpenFilePicker,

  onOpenDrawingEditor,
  onSelectModel,
  onSelectThinkingLevel,
  onSelectServiceTier,
  onToggleAutoMode,
  onSelectMode,
  onDictationPointerDown,
  onDictationPointerUp,
  onDictationPointerCancel,
  onSubmitComposerQuestion,
  onSubmitComposerActionForModifiers,
  onAbortStream,
}: {
  fileInputRef: RefObject<HTMLInputElement>;
  textareaRef: RefObject<HTMLTextAreaElement>;
  input: string;
  pendingAskUserQuestion: boolean;
  composerDisabled: boolean;
  composerShellWidth: number | null;

  streamIsStreaming: boolean;
  models: ModelInfo[];
  currentModel: string;
  currentThinkingLevel: string;
  currentServiceTier: string;
  savingPreference: 'model' | 'thinking' | 'serviceTier' | null;
  showAutoModeToggle: boolean;
  conversationAutoModeEnabled: boolean;
  conversationAutoModeBusy: boolean;
  conversationAutoMode: ConversationAutoModeState | null;
  dictationState: 'idle' | 'recording' | 'transcribing';
  dictationLevelSamples: number[];
  dictationStartedAt: number | null;
  conversationNeedsTakeover: boolean;
  composerHasContent: boolean;
  composerShowsQuestionSubmit: boolean;
  composerQuestionCanSubmit: boolean;
  composerQuestionRemainingCount: number;
  composerQuestionSubmitting: boolean;
  composerSubmitLabel: ConversationComposerSubmitLabel;
  composerAltHeld: boolean;
  composerParallelHeld: boolean;
  onFilesSelected: (files: File[]) => void;
  onInputChange: (value: string, textarea: HTMLTextAreaElement) => void;
  onRememberComposerSelection: (textarea: HTMLTextAreaElement) => void;
  onKeyDown: KeyboardEventHandler<HTMLTextAreaElement>;
  onPaste: ClipboardEventHandler<HTMLTextAreaElement>;
  onOpenFilePicker: () => void;

  onOpenDrawingEditor: () => void;
  onSelectModel: (modelId: string) => void;
  onSelectThinkingLevel: (thinkingLevel: string) => void;
  onSelectServiceTier: (enableFastMode: boolean) => void;
  onToggleAutoMode: () => void;
  onSelectMode: (mode: import('../../shared/types').RunMode) => void;
  onDictationPointerDown: PointerEventHandler<HTMLButtonElement>;
  onDictationPointerUp: PointerEventHandler<HTMLButtonElement>;
  onDictationPointerCancel: PointerEventHandler<HTMLButtonElement>;
  onSubmitComposerQuestion: () => void;
  onSubmitComposerActionForModifiers: (altKeyHeld: boolean, parallelKeyHeld: boolean) => void;
  onAbortStream: () => void;
}) {
  return (
    <div className="px-3 pt-2.5 pb-2.5">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,.excalidraw,application/json"
        multiple
        className="hidden"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          if (files.length > 0) {
            onFilesSelected(files);
          }
          event.target.value = '';
        }}
      />

      <div className="flex flex-col gap-0">
        <div className="px-3 pt-1">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(event) => {
              onInputChange(event.target.value, event.target);
            }}
            onSelect={(event) => {
              onRememberComposerSelection(event.currentTarget);
            }}
            onClick={(event) => {
              onRememberComposerSelection(event.currentTarget);
            }}
            onKeyUp={(event) => {
              onRememberComposerSelection(event.currentTarget);
            }}
            onFocus={(event) => {
              onRememberComposerSelection(event.currentTarget);
            }}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            rows={1}
            disabled={composerDisabled}
            className="w-full resize-none overscroll-contain bg-transparent text-sm leading-relaxed text-primary outline-none placeholder:text-dim disabled:cursor-default disabled:text-dim"
            placeholder={pendingAskUserQuestion ? 'Answer 1-9, or type to skip…' : 'Message… / commands, @ notes'}
            title={
              pendingAskUserQuestion
                ? '1-9 selects the current answer. Tab/Shift+Tab or ←/→ moves between questions. Enter selects or submits. Ctrl+C clears the composer.'
                : 'Ctrl+C clears the composer. Ctrl/⌘+Enter starts a parallel prompt while the conversation is busy. Alt+Enter queues a follow up. ↑/↓ recalls recent prompts.'
            }
            style={{ minHeight: '44px', maxHeight: '160px', WebkitOverflowScrolling: 'touch' }}
          />
        </div>

        <div className="flex flex-nowrap items-center gap-1.5 px-3 py-0.5">
          <div className="flex min-w-0 flex-1 flex-nowrap items-center gap-1.5">
            <button
              type="button"
              onClick={onOpenFilePicker}
              disabled={composerDisabled}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-secondary transition-colors hover:bg-elevated/60 hover:text-primary disabled:opacity-40"
              title="Attach image or file"
              aria-label="Attach image or file"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 5v14" />
                <path d="M5 12h14" />
              </svg>
            </button>

            <button
              type="button"
              onClick={onOpenDrawingEditor}
              disabled={composerDisabled || streamIsStreaming}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-secondary transition-colors hover:bg-elevated/60 hover:text-primary disabled:opacity-40"
              title="Create drawing"
              aria-label="Create drawing"
            >
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
              </svg>
            </button>
            {streamIsStreaming && (
              <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center" aria-label="Working">
                <span className="h-2.5 w-2.5 rounded-full border-[1.5px] border-current border-t-transparent animate-spin text-accent/70" />
              </span>
            )}
            <ConversationPreferencesRow
              models={models}
              currentModel={currentModel}
              currentThinkingLevel={currentThinkingLevel}
              currentServiceTier={currentServiceTier}
              savingPreference={savingPreference}
              showAutoModeToggle={showAutoModeToggle}
              autoModeEnabled={conversationAutoModeEnabled}
              autoModeBusy={conversationAutoModeBusy}
              mode={conversationAutoMode?.mode ?? 'manual'}
              onSelectModel={onSelectModel}
              onSelectThinkingLevel={onSelectThinkingLevel}
              onSelectServiceTier={onSelectServiceTier}
              onToggleAutoMode={onToggleAutoMode}
              onSelectMode={onSelectMode}
              compact={(composerShellWidth ?? Number.POSITIVE_INFINITY) < COMPOSER_PREFERENCES_MENU_WIDTH_PX}
            />
          </div>

          <ConversationComposerActions
            dictationState={dictationState}
            dictationLevelSamples={dictationLevelSamples}
            dictationStartedAt={dictationStartedAt}
            composerDisabled={composerDisabled}
            streamIsStreaming={streamIsStreaming}
            conversationNeedsTakeover={conversationNeedsTakeover}
            composerHasContent={composerHasContent}
            composerShowsQuestionSubmit={composerShowsQuestionSubmit}
            composerQuestionCanSubmit={composerQuestionCanSubmit}
            composerQuestionRemainingCount={composerQuestionRemainingCount}
            composerQuestionSubmitting={composerQuestionSubmitting}
            composerSubmitLabel={composerSubmitLabel}
            composerAltHeld={composerAltHeld}
            composerParallelHeld={composerParallelHeld}
            onDictationPointerDown={onDictationPointerDown}
            onDictationPointerUp={onDictationPointerUp}
            onDictationPointerCancel={onDictationPointerCancel}
            onSubmitComposerQuestion={onSubmitComposerQuestion}
            onSubmitComposerActionForModifiers={onSubmitComposerActionForModifiers}
            onAbortStream={onAbortStream}
          />
        </div>
      </div>
    </div>
  );
}

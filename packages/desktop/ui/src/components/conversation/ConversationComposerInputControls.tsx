import { type ClipboardEventHandler, type KeyboardEventHandler, type RefObject, useMemo } from 'react';

import type { ComposerDrawingAttachment } from '../../conversation/promptAttachments';
import { ComposerInputToolHost } from '../../extensions/ComposerInputToolHost';
import { useExtensionRegistry } from '../../extensions/useExtensionRegistry';
import type { ModelInfo } from '../../shared/types';
import { ConversationComposerActions, type ConversationComposerSubmitLabel } from './ConversationComposerActions';
import { ConversationPreferencesRow } from './ConversationPreferencesRow';

function getComposerPreferenceInlineLimit(composerShellWidth: number | null): number {
  const width = composerShellWidth ?? Number.POSITIVE_INFINITY;
  if (width >= 860) return Number.POSITIVE_INFINITY;
  if (width >= 760) return 4;
  if (width >= 660) return 3;
  if (width >= 560) return 2;
  return 1;
}

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
  goalEnabled,
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
  onUpsertDrawingAttachment,

  onSelectModel,
  onSelectThinkingLevel,
  onSelectServiceTier,
  onToggleGoal,
  onInsertComposerText,
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
  goalEnabled: boolean;
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
  onUpsertDrawingAttachment: (payload: Omit<ComposerDrawingAttachment, 'localId' | 'dirty'>) => void;

  onSelectModel: (modelId: string) => void;
  onSelectThinkingLevel: (thinkingLevel: string) => void;
  onSelectServiceTier: (enableFastMode: boolean) => void;
  onToggleGoal: () => void;
  onInsertComposerText: (text: string) => void;
  onSubmitComposerQuestion: () => void;
  onSubmitComposerActionForModifiers: (altKeyHeld: boolean, parallelKeyHeld: boolean) => void;
  onAbortStream: () => void;
}) {
  const { composerButtons = [], composerInputTools } = useExtensionRegistry();
  const visibleComposerInputTools = useMemo(
    () =>
      composerInputTools.filter((tool) => {
        const expr = tool.when;
        if (!expr) return true;
        const clauses = expr.split(/\s*&&\s*/).filter(Boolean);
        for (const clause of clauses) {
          const trimmed = clause.trim();
          if (trimmed === 'composerHasContent' && !composerHasContent) return false;
          if (trimmed === 'streamIsStreaming' && !streamIsStreaming) return false;
          if (trimmed === '!streamIsStreaming' && streamIsStreaming) return false;
        }
        return true;
      }),
    [composerHasContent, composerInputTools, streamIsStreaming],
  );

  const visibleComposerButtons = useMemo(
    () =>
      composerButtons.filter((button) => {
        if (button.placement !== 'afterModelPicker') return false;
        const expr = button.when;
        if (!expr) return true;
        const clauses = expr.split(/\s*&&\s*/).filter(Boolean);
        for (const clause of clauses) {
          const trimmed = clause.trim();
          if (trimmed === 'composerHasContent' && !composerHasContent) return false;
          if (trimmed === 'streamIsStreaming' && !streamIsStreaming) return false;
          if (trimmed === '!streamIsStreaming' && streamIsStreaming) return false;
        }
        return true;
      }),
    [composerButtons, composerHasContent, streamIsStreaming],
  );

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

            {visibleComposerInputTools.map((tool) => (
              <ComposerInputToolHost
                key={`${tool.extensionId}:${tool.id}`}
                registration={tool}
                toolContext={{
                  composerDisabled,
                  streamIsStreaming,
                  composerHasContent,
                  addFiles: onFilesSelected,
                  upsertDrawingAttachment: onUpsertDrawingAttachment,
                }}
              />
            ))}
            <ConversationPreferencesRow
              models={models}
              currentModel={currentModel}
              currentThinkingLevel={currentThinkingLevel}
              currentServiceTier={currentServiceTier}
              savingPreference={savingPreference}
              composerButtons={visibleComposerButtons}
              composerButtonContext={{
                composerDisabled,
                streamIsStreaming,
                composerHasContent,
                goalEnabled,
                toggleGoal: onToggleGoal,
                insertText: onInsertComposerText,
              }}
              onSelectModel={onSelectModel}
              onSelectThinkingLevel={onSelectThinkingLevel}
              onSelectServiceTier={onSelectServiceTier}
              inlineLimit={getComposerPreferenceInlineLimit(composerShellWidth)}
            />
          </div>

          <ConversationComposerActions
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
            onInsertComposerText={onInsertComposerText}
            onSubmitComposerQuestion={onSubmitComposerQuestion}
            onSubmitComposerActionForModifiers={onSubmitComposerActionForModifiers}
            onAbortStream={onAbortStream}
          />
        </div>
      </div>
    </div>
  );
}

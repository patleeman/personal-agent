import { type ClipboardEventHandler, type KeyboardEventHandler, type RefObject, useMemo } from 'react';

import type { ComposerDrawingAttachment } from '../../conversation/promptAttachments';
import { ComposerButtonHost } from '../../extensions/ComposerButtonHost';
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
  const { composerControls = [], composerInputTools } = useExtensionRegistry();
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

  const visibleComposerControls = useMemo(
    () =>
      composerControls.filter((button) => {
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
    [composerControls, composerHasContent, streamIsStreaming],
  );
  const composerControlContext = {
    composerDisabled,
    streamIsStreaming,
    composerHasContent,
    openFilePicker: onOpenFilePicker,
    addFiles: onFilesSelected,
    insertText: onInsertComposerText,
    models,
    currentModel,
    currentThinkingLevel,
    currentServiceTier,
    savingPreference,
    selectModel: onSelectModel,
    selectThinkingLevel: onSelectThinkingLevel,
    selectServiceTier: onSelectServiceTier,
    goalEnabled,
    toggleGoal: onToggleGoal,
  };
  const visibleLeadingControls = visibleComposerControls.filter((control) => control.slot === 'leading');
  const visiblePreferenceControls = visibleComposerControls.filter((control) => control.slot === 'preferences');

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
            {visibleLeadingControls.map((control) => (
              <ComposerButtonHost
                key={`${control.extensionId}:${control.id}`}
                registration={control}
                buttonContext={{ ...composerControlContext, renderMode: 'inline' }}
              />
            ))}
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
              composerButtons={visiblePreferenceControls}
              composerButtonContext={composerControlContext}
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

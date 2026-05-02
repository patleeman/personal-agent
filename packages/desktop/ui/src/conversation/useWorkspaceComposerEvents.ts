import { type MutableRefObject, type RefObject, useEffect } from 'react';

import { insertFileReplyQuoteIntoComposer } from './conversationReplyQuote';

const WORKSPACE_DRAFT_PROMPT_EVENT = 'pa:workspace-draft-prompt';
const WORKSPACE_REPLY_SELECTION_EVENT = 'pa:workspace-reply-selection';

interface UseWorkspaceComposerEventsOptions {
  input: string;
  textareaRef: RefObject<HTMLTextAreaElement>;
  composerSelectionRef: MutableRefObject<{ start: number; end: number }>;
  setInput: (value: string) => void;
  resetMenus: () => void;
}

export function useWorkspaceComposerEvents({
  input,
  textareaRef,
  composerSelectionRef,
  setInput,
  resetMenus,
}: UseWorkspaceComposerEventsOptions): void {
  useEffect(() => {
    function handleWorkspaceDraftPrompt(event: Event) {
      const prompt = (event as CustomEvent<{ prompt?: unknown }>).detail?.prompt;
      if (typeof prompt !== 'string' || prompt.trim().length === 0) {
        return;
      }

      setInput(prompt);
      textareaRef.current?.focus();
    }

    window.addEventListener(WORKSPACE_DRAFT_PROMPT_EVENT, handleWorkspaceDraftPrompt);
    return () => window.removeEventListener(WORKSPACE_DRAFT_PROMPT_EVENT, handleWorkspaceDraftPrompt);
  }, [setInput, textareaRef]);

  useEffect(() => {
    function handleWorkspaceReplySelection(event: Event) {
      const detail = (event as CustomEvent<{ filePath?: unknown; text?: unknown }>).detail;
      if (typeof detail?.filePath !== 'string' || typeof detail?.text !== 'string') {
        return;
      }

      const currentInput = textareaRef.current?.value ?? input;
      const next = insertFileReplyQuoteIntoComposer(currentInput, detail.filePath, detail.text);

      setInput(next.text);
      resetMenus();
      composerSelectionRef.current = {
        start: next.selectionStart,
        end: next.selectionEnd,
      };

      window.requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (!el || el.disabled) {
          return;
        }

        el.focus();
        el.setSelectionRange(next.selectionStart, next.selectionEnd);
      });
    }

    window.addEventListener(WORKSPACE_REPLY_SELECTION_EVENT, handleWorkspaceReplySelection);
    return () => window.removeEventListener(WORKSPACE_REPLY_SELECTION_EVENT, handleWorkspaceReplySelection);
  }, [composerSelectionRef, input, resetMenus, setInput, textareaRef]);
}

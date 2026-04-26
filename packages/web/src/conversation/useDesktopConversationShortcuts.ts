import { useEffect, type RefObject } from 'react';

export const DESKTOP_CONVERSATION_SHORTCUT_EVENT = 'personal-agent-desktop-shortcut';

type DesktopConversationShortcutAction = 'focus-composer' | 'edit-working-directory' | 'rename-conversation';

function isDesktopConversationShortcutAction(value: unknown): value is DesktopConversationShortcutAction {
  return value === 'focus-composer' || value === 'edit-working-directory' || value === 'rename-conversation';
}

interface UseDesktopConversationShortcutsOptions {
  draft: boolean;
  draftCwdPickBusy: boolean;
  textareaRef: RefObject<HTMLTextAreaElement>;
  beginTitleEdit: () => void;
  beginConversationCwdEdit: () => void;
  pickDraftConversationCwd: () => Promise<void> | void;
}

export function useDesktopConversationShortcuts({
  draft,
  draftCwdPickBusy,
  textareaRef,
  beginTitleEdit,
  beginConversationCwdEdit,
  pickDraftConversationCwd,
}: UseDesktopConversationShortcutsOptions): void {
  useEffect(() => {
    function handleDesktopShortcut(event: Event) {
      if (document.querySelector('.ui-overlay-backdrop') !== null) {
        return;
      }

      const action = (event as CustomEvent<{ action?: unknown }>).detail?.action;
      if (!isDesktopConversationShortcutAction(action)) {
        return;
      }

      if (action === 'focus-composer') {
        const composer = textareaRef.current;
        if (!composer) {
          return;
        }

        composer.focus();
        const end = composer.value.length;
        composer.selectionStart = end;
        composer.selectionEnd = end;
        return;
      }

      if (action === 'rename-conversation') {
        beginTitleEdit();
        return;
      }

      if (draft) {
        if (draftCwdPickBusy) {
          return;
        }

        void pickDraftConversationCwd();
        return;
      }

      beginConversationCwdEdit();
    }

    window.addEventListener(DESKTOP_CONVERSATION_SHORTCUT_EVENT, handleDesktopShortcut);
    return () => window.removeEventListener(DESKTOP_CONVERSATION_SHORTCUT_EVENT, handleDesktopShortcut);
  }, [beginConversationCwdEdit, beginTitleEdit, draft, draftCwdPickBusy, pickDraftConversationCwd, textareaRef]);
}

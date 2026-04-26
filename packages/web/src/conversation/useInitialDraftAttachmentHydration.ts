import { useEffect, useRef } from 'react';
import {
  clearDraftConversationAttachments,
  readDraftConversationAttachments,
} from './draftConversation';
import { restoreComposerImageFiles, type ComposerDrawingAttachment } from './promptAttachments';

interface UseInitialDraftAttachmentHydrationOptions {
  draft: boolean;
  conversationId: string | undefined;
  enabled: boolean;
  locationKey: string;
  setAttachments: (attachments: File[]) => void;
  setDrawingAttachments: (attachments: ComposerDrawingAttachment[]) => void;
}

export function useInitialDraftAttachmentHydration({
  draft,
  conversationId,
  enabled,
  locationKey,
  setAttachments,
  setDrawingAttachments,
}: UseInitialDraftAttachmentHydrationOptions): void {
  const appliedLocationKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (draft || !conversationId || !enabled) {
      return;
    }

    if (appliedLocationKeyRef.current === locationKey) {
      return;
    }

    appliedLocationKeyRef.current = locationKey;
    const storedAttachments = readDraftConversationAttachments();
    if (storedAttachments.images.length > 0) {
      setAttachments(restoreComposerImageFiles(storedAttachments.images, 'draft-image'));
    }
    if (storedAttachments.drawings.length > 0) {
      setDrawingAttachments(storedAttachments.drawings);
    }
    clearDraftConversationAttachments();
  }, [conversationId, draft, enabled, locationKey, setAttachments, setDrawingAttachments]);
}

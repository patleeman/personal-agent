import type { ConversationContextDocRef } from '../../shared/types';
import type { MentionItem } from '../../conversation/conversationMentions';

export function ConversationContextShelf({
  attachedContextDocs,
  draftMentionItems,
  unattachedDraftMentionItems,
  contextDocsBusy,
  onRemoveAttachedContextDoc,
  onAttachMentionedDocs,
}: {
  attachedContextDocs: ConversationContextDocRef[];
  draftMentionItems: MentionItem[];
  unattachedDraftMentionItems: Array<MentionItem & { path: string }>;
  contextDocsBusy: boolean;
  onRemoveAttachedContextDoc: (path: string) => void;
  onAttachMentionedDocs: (items: Array<MentionItem & { path: string }>) => void;
}) {
  return (
    <>
      {attachedContextDocs.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-border-subtle px-3 pt-3 pb-2.5">
          <span className="ui-section-label">Attached context</span>
          {attachedContextDocs.map((doc) => (
            <span
              key={doc.path}
              className="inline-flex items-center gap-1.5 rounded-full bg-elevated px-2 py-1 text-[11px] text-secondary"
              title={doc.summary ? `${doc.path}\n\n${doc.summary}` : doc.path}
            >
              <span className="text-[10px] uppercase tracking-[0.14em] text-dim/70">{doc.kind}</span>
              <span className="max-w-[18rem] truncate text-secondary">{doc.title}</span>
              <button
                type="button"
                onClick={() => { onRemoveAttachedContextDoc(doc.path); }}
                disabled={contextDocsBusy}
                className="ui-icon-button ui-icon-button-compact ml-0.5 shrink-0 leading-none disabled:opacity-50"
                title={`Remove ${doc.title} from attached context`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      {draftMentionItems.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-border-subtle px-3 pt-3 pb-2.5">
          <span className="ui-section-label">Prompt references</span>
          {unattachedDraftMentionItems.length > 0 && (
            <button
              type="button"
              onClick={() => { onAttachMentionedDocs(unattachedDraftMentionItems); }}
              disabled={contextDocsBusy}
              className="text-[11px] text-accent transition-colors hover:text-accent/80 disabled:cursor-default disabled:opacity-50"
            >
              {contextDocsBusy ? 'attaching…' : `attach ${unattachedDraftMentionItems.length}`}
            </button>
          )}
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
    </>
  );
}

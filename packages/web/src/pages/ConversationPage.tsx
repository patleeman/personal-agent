import { useParams } from 'react-router-dom';
import { ChatView } from '../components/chat/ChatView';
import { MOCK_CONVERSATIONS } from '../data/mockConversations';

export function ConversationPage() {
  const { id } = useParams<{ id: string }>();
  const conv = id ? MOCK_CONVERSATIONS[id] : undefined;

  const title = conv?.title ?? id?.replace(/-/g, ' ') ?? 'conversation';

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-base/95 backdrop-blur-sm border-b border-border-subtle px-5 py-3 flex items-center gap-3">
        <div>
          <h1 className="text-sm font-semibold text-primary">{title}</h1>
          <p className="text-[11px] text-secondary mt-0.5">
            {conv ? `${conv.messages.length} messages` : 'No session data yet'}
          </p>
        </div>
        <div className="flex-1" />
        <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-elevated text-secondary border border-border-subtle">
          mock
        </span>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto">
        {conv ? (
          <ChatView messages={conv.messages} />
        ) : (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-8">
            <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="text-accent">
                <path d="M20.25 8.511c.884.284 1.5 1.128 1.5 2.097v4.286c0 1.136-.847 2.1-1.98 2.193-.34.027-.68.052-1.02.072v3.091l-3-3c-1.354 0-2.694-.055-4.02-.163a2.115 2.115 0 0 1-.825-.242m9.345-8.334a2.126 2.126 0 0 0-.476-.095 48.64 48.64 0 0 0-8.048 0c-1.131.094-1.976 1.057-1.976 2.192v4.286c0 .837.46 1.58 1.155 1.951m9.345-8.334V6.637c0-1.621-1.152-3.026-2.76-3.235A48.455 48.455 0 0 0 11.25 3c-2.115 0-4.198.137-6.24.402-1.608.209-2.76 1.614-2.76 3.235v6.226c0 1.621 1.152 3.026 2.76 3.235.577.075 1.157.14 1.74.194V21l4.155-4.155" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-medium text-primary">New conversation</p>
              <p className="text-xs text-secondary mt-1 max-w-xs">
                This conversation has no session data yet. Start a Pi session to populate it.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Input bar — shows intent, not yet functional */}
      <div className="border-t border-border-subtle px-4 py-3">
        <div className="flex items-center gap-2 bg-elevated rounded-xl px-4 py-2.5 border border-border-subtle">
          <input
            className="flex-1 bg-transparent text-sm text-secondary placeholder:text-dim outline-none"
            placeholder="Reply in Pi TUI…"
            readOnly
          />
          <kbd className="text-[10px] text-dim bg-surface border border-border-subtle rounded px-1.5 py-0.5 font-mono">
            ⌘K
          </kbd>
        </div>
      </div>
    </div>
  );
}

import type { CSSProperties } from 'react';
import type { AskUserQuestionAnswers, AskUserQuestionPresentation } from '../../transcript/askUserQuestions';
import type { MessageBlock } from '../../shared/types';
import type { ChatRenderItem } from './transcriptItems.js';
import { shouldAutoOpenConversationBlock } from './toolPresentation.js';
import { ErrorBlock, SubagentBlock, ThinkingBlock, TraceClusterBlock } from './TraceBlocks.js';
import { ImageBlock, type InspectableImage } from './ImageMessageBlocks.js';
import { AssistantMessage, ContextMessage, SummaryMessage, UserMessage } from './MessageBlocks.js';
import { ToolBlock } from './ToolBlock.js';
import type { ChatViewLayout } from './chatViewTypes.js';
import type { ReplySelectionGestureHandler } from './replySelection.js';

export function getConversationRailKind(block: MessageBlock): 'user' | 'assistant' | undefined {
  if (block.type === 'user') {
    return 'user';
  }

  if (block.type === 'text' || (block.type === 'tool_use' && block.tool === 'ask_user_question')) {
    return 'assistant';
  }

  return undefined;
}

export function ChatRenderItemView({
  item,
  itemIndex,
  renderItemsLength,
  messageIndexOffset,
  messages,
  isStreaming,
  contentVisibilityStyle,
  layout,
  onForkMessage,
  onRewindMessage,
  onReplyToSelection,
  onHydrateMessage,
  hydratingMessageBlockIds,
  onOpenArtifact,
  activeArtifactId,
  onOpenCheckpoint,
  activeCheckpointId,
  onOpenFilePath,
  onSubmitAskUserQuestion,
  askUserQuestionDisplayMode,
  onResumeConversation,
  resumeConversationBusy,
  resumeConversationTitle,
  resumeConversationLabel,
  isInlineRunExpanded,
  onToggleInlineRun,
  onInspectImage,
  onSelectionGesture,
}: {
  item: ChatRenderItem;
  itemIndex: number;
  renderItemsLength: number;
  messageIndexOffset: number;
  messages: MessageBlock[];
  isStreaming: boolean;
  contentVisibilityStyle?: CSSProperties;
  layout: ChatViewLayout;
  onForkMessage?: (messageIndex: number) => Promise<void> | void;
  onRewindMessage?: (messageIndex: number) => Promise<void> | void;
  onReplyToSelection?: (selection: { text: string; messageIndex: number; blockId?: string }) => Promise<void> | void;
  onHydrateMessage?: (blockId: string) => Promise<void> | void;
  hydratingMessageBlockIds?: ReadonlySet<string>;
  onOpenArtifact?: (artifactId: string) => void;
  activeArtifactId?: string | null;
  onOpenCheckpoint?: (checkpointId: string) => void;
  activeCheckpointId?: string | null;
  onOpenFilePath?: (path: string) => void;
  onSubmitAskUserQuestion?: (presentation: AskUserQuestionPresentation, answers: AskUserQuestionAnswers) => Promise<void> | void;
  askUserQuestionDisplayMode: 'inline' | 'composer';
  onResumeConversation?: () => Promise<void> | void;
  resumeConversationBusy: boolean;
  resumeConversationTitle?: string | null;
  resumeConversationLabel: string;
  isInlineRunExpanded: (inlineRunKey: string) => boolean;
  onToggleInlineRun: (inlineRunKey: string) => void;
  onInspectImage: (image: InspectableImage) => void;
  onSelectionGesture?: ReplySelectionGestureHandler;
}) {
  const isTailItem = itemIndex === renderItemsLength - 1;

  if (item.type === 'trace_cluster') {
    const live = isStreaming && isTailItem;

    return (
      <div
        key={`trace-${messageIndexOffset + item.startIndex}-${messageIndexOffset + item.endIndex}`}
        data-chat-tail={isTailItem ? '1' : undefined}
        style={contentVisibilityStyle}
      >
        {item.blocks.map((_, offset) => {
          const absoluteIndex = messageIndexOffset + item.startIndex + offset;
          return <span key={`anchor-${absoluteIndex}`} id={`msg-${absoluteIndex}`} className="block h-0 overflow-hidden" aria-hidden />;
        })}
        <TraceClusterBlock
          clusterStartIndex={item.startIndex}
          blocks={item.blocks}
          summary={item.summary}
          live={live}
          onOpenArtifact={onOpenArtifact}
          activeArtifactId={activeArtifactId}
          onOpenCheckpoint={onOpenCheckpoint}
          activeCheckpointId={activeCheckpointId}
          onOpenFilePath={onOpenFilePath}
          onResume={isTailItem ? onResumeConversation : undefined}
          resumeBusy={resumeConversationBusy}
          resumeTitle={resumeConversationTitle}
          resumeLabel={resumeConversationLabel}
          isInlineRunExpanded={isInlineRunExpanded}
          onToggleInlineRun={onToggleInlineRun}
        />
      </div>
    );
  }

  const block = item.block;
  const absoluteIndex = messageIndexOffset + item.index;
  const autoOpen = shouldAutoOpenConversationBlock(block, item.index, messages.length, isStreaming);
  const showStreamingCursor = isStreaming && block.type === 'text' && item.index === messages.length - 1;

  const el = (() => {
    switch (block.type) {
      case 'user':
        return (
          <UserMessage
            block={block}
            messageIndex={absoluteIndex}
            onRewindMessage={onRewindMessage}
            onHydrateMessage={onHydrateMessage}
            hydratingMessageBlockIds={hydratingMessageBlockIds}
            onOpenFilePath={onOpenFilePath}
            onOpenCheckpoint={onOpenCheckpoint}
            onInspectImage={onInspectImage}
            layout={layout}
          />
        );
      case 'text':
        return (
          <AssistantMessage
            block={block}
            messageIndex={absoluteIndex}
            showCursor={showStreamingCursor}
            onRewindMessage={onRewindMessage}
            onForkMessage={onForkMessage}
            onOpenFilePath={onOpenFilePath}
            onOpenCheckpoint={onOpenCheckpoint}
            onSelectionGesture={onReplyToSelection ? onSelectionGesture : undefined}
            isInlineRunExpanded={isInlineRunExpanded}
            onToggleInlineRun={onToggleInlineRun}
            layout={layout}
          />
        );
      case 'context':
        return <ContextMessage block={block} messageIndex={absoluteIndex} onOpenFilePath={onOpenFilePath} onOpenCheckpoint={onOpenCheckpoint} onSelectionGesture={onReplyToSelection ? onSelectionGesture : undefined} />;
      case 'summary':
        return <SummaryMessage block={block} messageIndex={absoluteIndex} onOpenFilePath={onOpenFilePath} onOpenCheckpoint={onOpenCheckpoint} onSelectionGesture={onReplyToSelection ? onSelectionGesture : undefined} />;
      case 'thinking':
        return <ThinkingBlock block={block} autoOpen={autoOpen} />;
      case 'tool_use':
        return (
          <ToolBlock
            block={block}
            autoOpen={autoOpen}
            onOpenArtifact={onOpenArtifact}
            activeArtifactId={activeArtifactId}
            onOpenCheckpoint={onOpenCheckpoint}
            activeCheckpointId={activeCheckpointId}
            onOpenFilePath={onOpenFilePath}
            onHydrateMessage={onHydrateMessage}
            hydratingMessageBlockIds={hydratingMessageBlockIds}
            messages={messages}
            messageIndex={item.index}
            onSubmitAskUserQuestion={onSubmitAskUserQuestion}
            askUserQuestionDisplayMode={askUserQuestionDisplayMode}
          />
        );
      case 'subagent':
        return <SubagentBlock block={block} />;
      case 'image':
        return <ImageBlock block={block} onHydrateMessage={onHydrateMessage} hydratingMessageBlockIds={hydratingMessageBlockIds} onInspectImage={onInspectImage} />;
      case 'error':
        return (
          <ErrorBlock
            block={block}
            messageIndex={absoluteIndex}
            onResume={isTailItem ? onResumeConversation : undefined}
            resumeBusy={resumeConversationBusy}
            resumeTitle={resumeConversationTitle}
            resumeLabel={resumeConversationLabel}
            onOpenFilePath={onOpenFilePath}
            onSelectionGesture={onReplyToSelection ? onSelectionGesture : undefined}
          />
        );
      default:
        return null;
    }
  })();

  return el ? (
    <div
      key={absoluteIndex}
      id={`msg-${absoluteIndex}`}
      data-message-index={absoluteIndex}
      data-chat-tail={isTailItem ? '1' : undefined}
      data-conversation-rail-kind={getConversationRailKind(block)}
      style={contentVisibilityStyle}
    >
      {el}
    </div>
  ) : null;
}

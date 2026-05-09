import {
  AskUserQuestionToolBlock,
  describeAskUserQuestionState,
  readAskUserQuestionPresentation,
} from '@personal-agent/extensions/workbench';

export function AskUserQuestionTranscriptRenderer({
  block,
  context,
}: {
  block: never;
  context: {
    messages?: never[];
    messageIndex?: number;
    onSubmitAskUserQuestion?: (presentation: never, answers: never) => Promise<void> | void;
    askUserQuestionDisplayMode?: 'inline' | 'composer';
  };
}) {
  const presentation = readAskUserQuestionPresentation(block);
  if (!presentation) return null;
  const state = describeAskUserQuestionState(context.messages, context.messageIndex);
  return (
    <AskUserQuestionToolBlock
      block={block}
      presentation={presentation}
      state={state}
      onSubmit={context.onSubmitAskUserQuestion}
      mode={context.askUserQuestionDisplayMode ?? 'inline'}
    />
  );
}

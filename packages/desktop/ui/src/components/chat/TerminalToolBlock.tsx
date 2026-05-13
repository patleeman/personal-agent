import { memo } from 'react';

import type { MessageBlock } from '../../shared/types';
import { timeAgo } from '../../shared/utils';
import { readTerminalBashToolPresentation } from '../../transcript/terminalBashBlock';
import { cx, Pill } from '../ui';
import { MessageActions } from './MessageActions.js';

const TerminalToolBlock = memo(function TerminalToolBlock({
  block,
  onHydrateMessage,
  hydratingMessageBlockIds,
}: {
  block: Extract<MessageBlock, { type: 'tool_use' }>;
  onHydrateMessage?: (blockId: string) => Promise<void> | void;
  hydratingMessageBlockIds?: ReadonlySet<string>;
}) {
  const presentation = readTerminalBashToolPresentation(block);
  if (!presentation) {
    return null;
  }

  const isRunning = block.status === 'running' || !!block.running;
  const isError = block.status === 'error' || !!block.error || ((presentation.exitCode ?? 0) !== 0 && presentation.exitCode !== undefined);
  const blockId = block.id?.trim();
  const outputDeferred = Boolean(block.outputDeferred && blockId && onHydrateMessage);
  const hydratingDeferredOutput = Boolean(blockId && hydratingMessageBlockIds?.has(blockId));
  const hasBody = isRunning || block.output || outputDeferred;
  const copyText = block.output ? `$ ${presentation.command}\n${block.output}` : `$ ${presentation.command}`;
  const footerBits: string[] = [];

  if (presentation.cancelled) {
    footerBits.push('cancelled');
  } else if (presentation.exitCode !== undefined) {
    footerBits.push(`exit ${presentation.exitCode}`);
  } else if (isRunning) {
    footerBits.push('running');
  }

  if (presentation.truncated) {
    footerBits.push('truncated');
  }

  if (block.durationMs && !isRunning) {
    footerBits.push(`${(block.durationMs / 1000).toFixed(1)}s`);
  }

  return (
    <div className="group space-y-1.5">
      <div className={cx('ui-terminal-block', isError ? 'border-danger/35' : null)}>
        <div className="ui-terminal-block__chrome flex items-center gap-2 border-b px-3 py-2 text-[11px]">
          {isRunning ? (
            <span className="h-3.5 w-3.5 shrink-0 rounded-full border-[1.5px] border-current border-t-transparent animate-spin text-accent" />
          ) : (
            <span className={cx('w-3 shrink-0 text-center', isError ? 'text-danger' : 'text-accent')}>$</span>
          )}
          <span className="min-w-0 flex-1 break-all text-primary">{presentation.command}</span>
          {presentation.executionWrappers.map((wrapper) => (
            <Pill key={wrapper.id} tone="accent" mono>
              {wrapper.label ?? wrapper.id}
            </Pill>
          ))}
          {presentation.excludeFromContext && (
            <Pill tone="warning" mono>
              no context
            </Pill>
          )}
        </div>

        {hasBody && (
          <div className="px-3 py-2.5">
            {block.output ? (
              <pre
                className={cx('whitespace-pre-wrap break-all text-[11px] leading-relaxed', isError ? 'text-danger/85' : 'text-secondary')}
              >
                {block.output}
              </pre>
            ) : isRunning ? (
              <p className="text-[11px] italic leading-relaxed text-dim">Waiting for output…</p>
            ) : outputDeferred ? (
              <p className="text-[11px] italic leading-relaxed text-dim">Older terminal output is available on demand.</p>
            ) : null}
          </div>
        )}

        <div className="ui-terminal-block__chrome flex flex-wrap items-center gap-2 border-t px-3 py-2 text-[10px] text-dim">
          {footerBits.map((bit) => (
            <span key={bit}>{bit}</span>
          ))}
          {presentation.fullOutputPath && <span className="min-w-0 break-all text-dim/80">{presentation.fullOutputPath}</span>}
          {outputDeferred && blockId && (
            <button
              type="button"
              onClick={() => {
                void onHydrateMessage?.(blockId);
              }}
              disabled={hydratingDeferredOutput}
              className="ui-action-button text-[10px]"
            >
              {hydratingDeferredOutput ? 'Loading full output…' : 'Load full output'}
            </button>
          )}
          <span className="ml-auto">{timeAgo(block.ts)}</span>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <span className="flex-1" />
        <MessageActions blockText={block.output ?? ''} blockId={blockId} copyText={copyText} />
      </div>
    </div>
  );
});

export { TerminalToolBlock };

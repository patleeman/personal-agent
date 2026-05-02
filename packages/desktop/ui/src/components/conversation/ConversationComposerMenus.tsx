import { useEffect, useLayoutEffect, useRef } from 'react';
import { IconButton, Pill, cx } from '../ui';
import type { ModelInfo } from '../../shared/types';
import type { SlashMenuItem } from '../../commands/slashMenu';
import {
  MAX_MENTION_MENU_ITEMS,
  filterMentionItems,
  type MentionItem,
} from '../../conversation/conversationMentions';

const useMenuLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

export function ModelPicker({ models, currentModel, query, idx, onSelect, onClose }:
  { models: ModelInfo[]; currentModel: string; query: string; idx: number; onSelect: (id: string) => void; onClose: () => void }) {
  const groups: Record<string, ModelInfo[]> = {};
  for (const model of models) { (groups[model.provider] ??= []).push(model); }
  const selectedModel = models.length > 0 ? models[((idx % models.length) + models.length) % models.length] : null;
  const formatContext = (context: number) => context >= 1_000_000 ? `${context / 1_000_000}M` : `${context / 1_000}k`;

  return (
    <div className="ui-menu-shell">
      <div className="ui-menu-header">
        <p className="ui-section-label">Switch model</p>
        <IconButton onClick={onClose} title="Close model picker" aria-label="Close model picker" compact>
          <span className="text-[11px] font-mono">esc</span>
        </IconButton>
      </div>
      {models.length === 0 ? (
        <div className="px-3 py-4 text-[12px] text-dim">
          No models match <span className="font-mono text-secondary">{query}</span>
        </div>
      ) : Object.entries(groups).map(([provider, providerModels]) => (
        <div key={provider}>
          <p className="px-3 pt-2 pb-0.5 text-[9px] uppercase tracking-widest text-dim/60 font-semibold">{provider}</p>
          {providerModels.map((model) => {
            const isCurrent = model.id === currentModel;
            const isFocused = model.id === selectedModel?.id;
            return (
              <button
                key={model.id}
                onMouseDown={(event) => { event.preventDefault(); onSelect(model.id); }}
                className={cx('w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors', isFocused ? 'bg-elevated text-primary' : 'text-secondary hover:bg-elevated/50')}
              >
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isCurrent ? 'bg-accent' : 'bg-transparent border border-border-default'}`} />
                <span className="flex-1 text-[13px] font-medium truncate">{model.name}</span>
                <Pill tone={isCurrent ? 'accent' : 'muted'} mono>{model.id}</Pill>
                <span className="text-[10px] text-dim/60 shrink-0">{formatContext(model.context)}</span>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

export function SlashMenu({ items, idx, onSelect }: { items: SlashMenuItem[]; idx: number; onSelect: (item: SlashMenuItem) => void }) {
  if (!items.length) return null;

  const selectedIndex = idx % items.length;
  const selectedItemRef = useRef<HTMLButtonElement | null>(null);

  useMenuLayoutEffect(() => {
    selectedItemRef.current?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  return (
    <div className="ui-menu-shell max-h-[28rem] overflow-y-auto py-1.5">
      {items.map((item, itemIndex) => (
        <button
          key={item.key}
          ref={itemIndex === selectedIndex ? selectedItemRef : undefined}
          onMouseDown={(event) => { event.preventDefault(); onSelect(item); }}
          className={cx('w-full flex items-start gap-3 px-3 py-2.5 text-left transition-colors', itemIndex === selectedIndex ? 'bg-elevated text-primary' : 'text-secondary hover:bg-elevated/50')}
        >
          <span className="w-5 pt-0.5 text-center text-[13px] select-none text-dim/70">{item.icon}</span>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <span className="min-w-0 max-w-[26rem] truncate whitespace-nowrap font-mono text-[12px] text-accent">
                {item.displayCmd}
              </span>
              {item.source && (
                <span className="shrink-0 text-[10px] uppercase tracking-[0.14em] text-dim/60">
                  {item.source}
                </span>
              )}
            </div>
            <p className="mt-0.5 truncate text-[12px] text-dim/90">{item.desc}</p>
          </div>
        </button>
      ))}
    </div>
  );
}

export function MentionMenu({
  items,
  query,
  idx,
  onSelect,
}: {
  items: MentionItem[];
  query: string;
  idx: number;
  onSelect: (id: string) => void;
}) {
  const filtered = filterMentionItems(items, query, { limit: MAX_MENTION_MENU_ITEMS });
  if (!filtered.length) return null;

  const selectedIndex = idx % filtered.length;
  const selectedItemRef = useRef<HTMLButtonElement | null>(null);

  useMenuLayoutEffect(() => {
    selectedItemRef.current?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  return (
    <div className="ui-menu-shell max-h-[18rem] overflow-y-auto py-1.5">
      <div className="px-3 pt-2 pb-1">
        <p className="ui-section-label">Mention</p>
      </div>
      {filtered.map((item, index) => (
        <button
          key={`${item.kind}:${item.id}`}
          ref={index === selectedIndex ? selectedItemRef : undefined}
          onMouseDown={(event) => { event.preventDefault(); onSelect(item.id); }}
          className={cx('w-full flex items-start gap-3 px-3 py-2.5 text-left transition-colors', index === selectedIndex ? 'bg-elevated text-primary' : 'text-secondary hover:bg-elevated/50')}
        >
          <Pill tone="muted">{item.kind}</Pill>
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[13px] text-accent truncate">{item.id}</p>
            {(item.summary || (item.title && item.title !== item.label)) && (
              <p className="mt-0.5 truncate text-[12px] text-dim/90">
                {item.summary || item.title}
              </p>
            )}
          </div>
        </button>
      ))}
    </div>
  );
}

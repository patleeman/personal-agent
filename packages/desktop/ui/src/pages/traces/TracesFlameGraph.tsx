/**
 * Subagent Flame Graph — Shows nesting depth and duration
 */

export function TracesFlameGraph() {
  return (
    <div className="rounded-xl border border-border-subtle bg-surface overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border-subtle">
        <span className="text-[12px] font-semibold">🔥 Subagent Flame Graph</span>
        <span className="ml-auto text-[10px] text-dim bg-elevated px-2 py-0.5 rounded-full">Most expensive run</span>
      </div>
      <div className="p-4">
        <div className="space-y-0.5">
          <FlameLevel items={[{ label: 'main · refactor-auth · 4m 12s', flex: 4, cls: 'bg-accent/35' }]} />
          <FlameLevel
            items={[
              { label: 'code-review-subagent · 1m 48s', flex: 2.2, offset: 4, cls: 'bg-accent/50' },
              { label: 'test-runner · 1m 02s', flex: 1.8, offset: 3, cls: 'bg-accent/50' },
              { label: 'dep-check · 28s', flex: 0.8, offset: 2, cls: 'bg-accent/50' },
            ]}
          />
          <FlameLevel
            items={[
              { label: 'lint-review · 42s', flex: 1.4, offset: 4, cls: 'bg-accent/65' },
              { label: 'style-check · 18s', flex: 0.6, offset: 2, cls: 'bg-accent/65' },
              { label: 'unit-runner · 28s', flex: 0.8, offset: 3, cls: 'bg-accent/65' },
              { label: 'integration · 14s', flex: 0.5, offset: 2, cls: 'bg-accent/65' },
              { label: 'e2e · 10s', flex: 0.4, offset: 1, cls: 'bg-accent/65' },
            ]}
          />
          <FlameLevel
            items={[
              { label: 'eslint · 12s', flex: 0.5, offset: 4, cls: 'bg-accent/80' },
              { label: 'test-failed · 6s', flex: 0.3, offset: 1, cls: 'bg-danger/50' },
              { label: 'validator · 10s', flex: 0.4, offset: 3, cls: 'bg-accent/80' },
              { label: 'snapshot · 9s', flex: 0.4, offset: 3, cls: 'bg-accent/80' },
            ]}
          />
        </div>

        <div className="flex gap-4 text-[10px] text-dim mt-3 pt-3 border-t border-border-subtle">
          <span>
            Max depth: <strong className="text-primary">4</strong>
          </span>
          <span>
            Total subagent time: <strong className="text-primary">3m 28s</strong> (82% of run)
          </span>
          <span className="text-danger">◆ 1 failed subagent</span>
        </div>
      </div>
    </div>
  );
}

function FlameLevel({ items }: { items: Array<{ label: string; flex: number; offset?: number; cls: string }> }) {
  return (
    <div className="flex gap-0.5">
      {items.map((item, i) => (
        <div
          key={i}
          className={`h-4 rounded-sm text-[8px] flex items-center px-1 text-white/80 truncate ${item.cls}`}
          style={{ flex: item.flex, marginLeft: item.offset ? `${item.offset}%` : undefined }}
          title={item.label}
        >
          {item.label}
        </div>
      ))}
    </div>
  );
}

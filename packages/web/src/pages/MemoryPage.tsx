import { useCallback, useState } from 'react';
import { api } from '../api';
import { useApi } from '../hooks';
import type { MemoryAgentsItem, MemoryDocItem, MemorySkillItem } from '../types';

// ── File content viewer ───────────────────────────────────────────────────────

function FileContent({ path }: { path: string }) {
  const { data, loading, error } = useApi(
    useCallback(() => api.memoryFile(path), [path]),
  );

  if (loading) return (
    <div className="px-4 py-3 text-[11px] text-dim animate-pulse font-mono">Loading…</div>
  );
  if (error) return (
    <div className="px-4 py-3 text-[11px] text-danger/80 font-mono">Error: {error}</div>
  );
  return (
    <pre className="px-4 py-3 text-[11px] font-mono text-secondary leading-relaxed whitespace-pre-wrap break-words overflow-x-auto max-h-96 overflow-y-auto">
      {data?.content}
    </pre>
  );
}

// ── Section header ────────────────────────────────────────────────────────────

function SectionHeader({ label, count }: { label: string; count?: number }) {
  return (
    <div className="flex items-center gap-2 px-1 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-dim">{label}</p>
      {count !== undefined && (
        <span className="text-[10px] tabular-nums text-dim/50">{count}</span>
      )}
    </div>
  );
}

// ── Chevron ───────────────────────────────────────────────────────────────────

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="11" height="11" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      className={`shrink-0 text-dim transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
    >
      <path d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
    </svg>
  );
}

// ── Card wrapper ──────────────────────────────────────────────────────────────

function Card({ expanded, children }: { expanded: boolean; children: React.ReactNode }) {
  return (
    <div className={`rounded-xl border transition-colors ${
      expanded
        ? 'bg-elevated border-border-default'
        : 'bg-surface border-border-subtle hover:border-border-default'
    }`}>
      {children}
    </div>
  );
}

// ── AGENTS.md row ─────────────────────────────────────────────────────────────

function AgentsRow({ item, expanded, onToggle }: {
  item: MemoryAgentsItem;
  expanded: boolean;
  onToggle: () => void;
}) {
  // Extract human-readable label from path: "shared/AGENTS.md" or "datadog/AGENTS.md"
  const parts = item.path.split('/profiles/')[1]?.split('/agent/') ?? [];
  const label = parts.length >= 1 ? `${parts[0]}/AGENTS.md` : item.path;

  return (
    <Card expanded={expanded}>
      <button
        onClick={onToggle}
        disabled={!item.exists}
        className="w-full flex items-center gap-3 px-4 py-3 text-left"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"
          className="shrink-0 text-secondary opacity-70">
          <path d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 0 0 2.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75 2.25 2.25 0 0 0-.1-.664m-5.8 0A2.251 2.251 0 0 1 13.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25ZM6.75 12h.008v.008H6.75V12Zm0 3h.008v.008H6.75V15Zm0 3h.008v.008H6.75V18Z" />
        </svg>
        <span className="flex-1 text-[13px] font-medium text-primary font-mono truncate">{label}</span>
        {!item.exists
          ? <span className="text-[10px] text-dim">missing</span>
          : <Chevron open={expanded} />
        }
      </button>
      {expanded && item.exists && (
        <div className="border-t border-border-subtle">
          <FileContent path={item.path} />
        </div>
      )}
    </Card>
  );
}

// ── Skill row ─────────────────────────────────────────────────────────────────

function SkillRow({ item, expanded, onToggle }: {
  item: MemorySkillItem;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <Card expanded={expanded}>
      <button onClick={onToggle} className="w-full flex items-start gap-3 px-4 py-3 text-left">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[13px] font-medium text-primary font-mono">{item.name}</span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full border font-medium ${
              item.source === 'shared'
                ? 'text-teal bg-teal/10 border-teal/20'
                : 'text-accent bg-accent-bg border-accent/20'
            }`}>
              {item.source}
            </span>
          </div>
          {item.description && (
            <p className="text-[12px] text-secondary mt-0.5 leading-snug line-clamp-2">
              {item.description}
            </p>
          )}
        </div>
        <Chevron open={expanded} />
      </button>
      {expanded && (
        <div className="border-t border-border-subtle">
          <FileContent path={item.path} />
        </div>
      )}
    </Card>
  );
}

// ── Memory doc row ────────────────────────────────────────────────────────────

function MemoryDocRow({ item, expanded, onToggle }: {
  item: MemoryDocItem;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <Card expanded={expanded}>
      <button onClick={onToggle} className="w-full flex items-start gap-3 px-4 py-3 text-left">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[13px] font-medium text-primary">{item.title}</span>
            {item.id !== item.title && (
              <span className="text-[11px] font-mono text-dim">{item.id}</span>
            )}
          </div>
          {item.summary && (
            <p className="text-[12px] text-secondary mt-0.5 leading-snug line-clamp-2">
              {item.summary}
            </p>
          )}
          {item.tags.length > 0 && (
            <div className="flex items-center gap-1 flex-wrap mt-1.5">
              {item.tags.map(tag => (
                <span
                  key={tag}
                  className="text-[10px] px-1.5 py-0.5 rounded bg-surface text-dim border border-border-subtle"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>
        <Chevron open={expanded} />
      </button>
      {expanded && (
        <div className="border-t border-border-subtle">
          <FileContent path={item.path} />
        </div>
      )}
    </Card>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function MemoryPage() {
  const { data, loading, error, refetch } = useApi(api.memory);
  const [expandedPath, setExpandedPath] = useState<string | null>(null);

  function toggle(path: string) {
    setExpandedPath(prev => prev === path ? null : path);
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-base/95 backdrop-blur-sm border-b border-border-subtle px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-base font-semibold text-primary">Memory</h1>
          {data && (
            <p className="text-xs text-secondary mt-0.5 font-mono">
              <span className="text-accent">{data.profile}</span>
              {' · '}
              {data.skills.length} {data.skills.length === 1 ? 'skill' : 'skills'}
              {' · '}
              {data.memoryDocs.length} {data.memoryDocs.length === 1 ? 'doc' : 'docs'}
            </p>
          )}
        </div>
        <button
          onClick={refetch}
          className="text-xs text-secondary hover:text-primary transition-colors px-2 py-1 rounded hover:bg-surface"
        >
          ↻ Refresh
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">

        {loading && (
          <div className="flex items-center gap-2 text-sm text-dim py-8">
            <span className="animate-pulse">●</span>
            <span>Loading memory…</span>
          </div>
        )}

        {error && (
          <div className="py-8 text-sm text-danger/80">Failed to load memory: {error}</div>
        )}

        {!loading && data && (
          <>
            {/* Config */}
            <div>
              <SectionHeader label="Config" count={data.agentsMd.length} />
              <div className="space-y-2">
                {data.agentsMd.map(item => (
                  <AgentsRow
                    key={item.path}
                    item={item}
                    expanded={expandedPath === item.path}
                    onToggle={() => toggle(item.path)}
                  />
                ))}
              </div>
            </div>

            {/* Skills */}
            <div>
              <SectionHeader label="Skills" count={data.skills.length} />
              <div className="space-y-2">
                {data.skills.length === 0 && (
                  <p className="text-[12px] text-dim px-1">No skills found.</p>
                )}
                {data.skills.map(item => (
                  <SkillRow
                    key={item.path}
                    item={item}
                    expanded={expandedPath === item.path}
                    onToggle={() => toggle(item.path)}
                  />
                ))}
              </div>
            </div>

            {/* Memory docs */}
            <div>
              <SectionHeader label="Memory Docs" count={data.memoryDocs.length} />
              <div className="space-y-2">
                {data.memoryDocs.length === 0 && (
                  <p className="text-[12px] text-dim px-1">No memory docs found.</p>
                )}
                {data.memoryDocs.map(item => (
                  <MemoryDocRow
                    key={item.path}
                    item={item}
                    expanded={expandedPath === item.path}
                    onToggle={() => toggle(item.path)}
                  />
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

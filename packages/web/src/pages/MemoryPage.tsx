import { useNavigate, useLocation } from 'react-router-dom';
import { api } from '../api';
import { useApi } from '../hooks';
import type { MemoryAgentsItem, MemoryDocItem, MemorySkillItem } from '../types';

// ── Section header ────────────────────────────────────────────────────────────

function SectionHeader({ label, count }: { label: string; count?: number }) {
  return (
    <div className="flex items-center gap-2 px-2 pt-4 pb-1.5">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-dim">{label}</p>
      {count !== undefined && <span className="text-[10px] tabular-nums text-dim/50">{count}</span>}
    </div>
  );
}

// ── Row ───────────────────────────────────────────────────────────────────────

function MemoryRow({ icon, title, subtitle, badge, tags, path, selected, onClick }: {
  icon?: React.ReactNode;
  title: string;
  subtitle?: string;
  badge?: { text: string; cls: string };
  tags?: string[];
  path: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-start gap-4 px-4 py-3 -mx-2 rounded-lg text-left transition-colors ${
        selected ? 'bg-surface' : 'hover:bg-surface'
      }`}
    >
      {icon
        ? <span className="mt-0.5 shrink-0 text-secondary opacity-60">{icon}</span>
        : <span className="mt-1.5 w-2 h-2 rounded-full shrink-0 bg-border-default/60" />
      }
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="text-[13px] font-mono font-medium text-primary">{title}</span>
          {badge && <span className={`text-[11px] font-mono ${badge.cls}`}>{badge.text}</span>}
        </div>
        {subtitle && (
          <p className="text-[12px] text-secondary mt-0.5 leading-snug line-clamp-2">{subtitle}</p>
        )}
        {tags && tags.length > 0 && (
          <p className="text-[11px] text-dim mt-0.5 font-mono">{tags.join(' · ')}</p>
        )}
      </div>
    </button>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function MemoryPage() {
  const { data, loading, error, refetch } = useApi(api.memory);
  const navigate = useNavigate();
  const location = useLocation();
  const selectedPath = new URLSearchParams(location.search).get('item') ?? null;

  function select(path: string) {
    const next = selectedPath === path ? '/memory' : `/memory?item=${encodeURIComponent(path)}`;
    navigate(next, { replace: true });
  }

  const agentsIcon = (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 0 0 2.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75 2.25 2.25 0 0 0-.1-.664m-5.8 0A2.251 2.251 0 0 1 13.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25ZM6.75 12h.008v.008H6.75V12Zm0 3h.008v.008H6.75V15Zm0 3h.008v.008H6.75V18Z" />
    </svg>
  );

  return (
    <div className="flex flex-col h-full">
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
        <button onClick={refetch} className="text-xs text-secondary hover:text-primary transition-colors px-2 py-1 rounded hover:bg-surface">
          ↻ Refresh
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-2">
        {loading && (
          <div className="flex items-center gap-2 text-sm text-dim py-8">
            <span className="animate-pulse">●</span>
            <span>Loading memory…</span>
          </div>
        )}
        {error && <div className="py-8 text-sm text-danger/80">Failed to load memory: {error}</div>}

        {!loading && data && (
          <>
            {(() => {
              const existing = data.agentsMd.filter(i => i.exists);
              if (existing.length === 0) return null;
              const labelFor = (item: MemoryAgentsItem) => {
                const parts = item.path.split('/profiles/')[1]?.split('/agent/') ?? [];
                return parts.length >= 1 ? `${parts[0]}/AGENTS.md` : item.path;
              };
              return (
                <div>
                  <SectionHeader label="Config" count={existing.length} />
                  <div className="space-y-px">
                    {existing.map(item => (
                      <MemoryRow
                        key={item.path}
                        icon={agentsIcon}
                        title={labelFor(item)}
                        path={item.path}
                        selected={selectedPath === item.path}
                        onClick={() => select(item.path)}
                      />
                    ))}
                  </div>
                </div>
              );
            })()}

            <div>
              <SectionHeader label="Skills" count={data.skills.length} />
              <div className="space-y-px">
                {data.skills.length === 0 && <p className="text-[12px] text-dim px-2">No skills found.</p>}
                {data.skills.map((item: MemorySkillItem) => (
                  <MemoryRow
                    key={item.path}
                    title={item.name}
                    subtitle={item.description}
                    badge={{ text: item.source, cls: item.source === 'shared' ? 'text-teal' : 'text-accent' }}
                    path={item.path}
                    selected={selectedPath === item.path}
                    onClick={() => select(item.path)}
                  />
                ))}
              </div>
            </div>

            <div className="pb-4">
              <SectionHeader label="Memory Docs" count={data.memoryDocs.length} />
              <div className="space-y-px">
                {data.memoryDocs.length === 0 && <p className="text-[12px] text-dim px-2">No memory docs found.</p>}
                {data.memoryDocs.map((item: MemoryDocItem) => (
                  <MemoryRow
                    key={item.path}
                    title={item.title}
                    subtitle={item.summary}
                    tags={item.tags}
                    path={item.path}
                    selected={selectedPath === item.path}
                    onClick={() => select(item.path)}
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

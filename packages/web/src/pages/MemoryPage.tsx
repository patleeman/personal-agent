import type { ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useApi } from '../hooks';
import type { MemoryAgentsItem, MemoryDocItem, MemorySkillItem } from '../types';
import { ErrorState, ListButtonRow, LoadingState, PageHeader, PageHeading, SectionLabel, ToolbarButton } from '../components/ui';

function MemoryRow({
  icon,
  title,
  subtitle,
  badge,
  tags,
  selected,
  onClick,
}: {
  icon?: ReactNode;
  title: string;
  subtitle?: string;
  badge?: { text: string; cls: string };
  tags?: string[];
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <ListButtonRow
      onClick={onClick}
      selected={selected}
      className="w-full text-left"
      leading={
        icon
          ? <span className="mt-0.5 shrink-0 text-secondary opacity-60">{icon}</span>
          : <span className="mt-1.5 w-2 h-2 rounded-full shrink-0 bg-border-default/60" />
      }
    >
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className="ui-row-title-mono font-medium">{title}</span>
        {badge && <span className={`text-[11px] font-mono ${badge.cls}`}>{badge.text}</span>}
      </div>
      {subtitle && <p className="ui-row-summary line-clamp-2">{subtitle}</p>}
      {tags && tags.length > 0 && <p className="ui-row-meta">{tags.join(' · ')}</p>}
    </ListButtonRow>
  );
}

function SectionBlock({
  label,
  count,
  children,
}: {
  label: string;
  count?: number;
  children: ReactNode;
}) {
  return (
    <div>
      <SectionLabel label={label} count={count} className="px-2 pt-4 pb-1.5" />
      <div className="space-y-px">{children}</div>
    </div>
  );
}

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
      <PageHeader actions={<ToolbarButton onClick={() => { void refetch(); }}>↻ Refresh</ToolbarButton>}>
        <PageHeading
          title="Memory"
          meta={data && (
            <>
              <span className="text-accent">{data.profile}</span>
              {' · '}
              {data.skills.length} {data.skills.length === 1 ? 'skill' : 'skills'}
              {' · '}
              {data.memoryDocs.length} {data.memoryDocs.length === 1 ? 'doc' : 'docs'}
            </>
          )}
        />
      </PageHeader>

      <div className="flex-1 overflow-y-auto px-6 py-2">
        {loading && <LoadingState label="Loading memory…" />}
        {error && <ErrorState message={`Failed to load memory: ${error}`} />}

        {!loading && data && (
          <>
            {(() => {
              const existing = data.agentsMd.filter((item) => item.exists);
              if (existing.length === 0) return null;

              const labelFor = (item: MemoryAgentsItem) => {
                const parts = item.path.split('/profiles/')[1]?.split('/agent/') ?? [];
                return parts.length >= 1 ? `${parts[0]}/AGENTS.md` : item.path;
              };

              return (
                <SectionBlock label="Config" count={existing.length}>
                  {existing.map((item) => (
                    <MemoryRow
                      key={item.path}
                      icon={agentsIcon}
                      title={labelFor(item)}
                      selected={selectedPath === item.path}
                      onClick={() => select(item.path)}
                    />
                  ))}
                </SectionBlock>
              );
            })()}

            <SectionBlock label="Skills" count={data.skills.length}>
              {data.skills.length === 0 && <p className="ui-empty-body px-2 text-left">No skills found.</p>}
              {data.skills.map((item: MemorySkillItem) => (
                <MemoryRow
                  key={item.path}
                  title={item.name}
                  subtitle={item.description}
                  badge={{ text: item.source, cls: item.source === 'shared' ? 'text-teal' : 'text-accent' }}
                  selected={selectedPath === item.path}
                  onClick={() => select(item.path)}
                />
              ))}
            </SectionBlock>

            <div className="pb-4">
              <SectionBlock label="Memory Docs" count={data.memoryDocs.length}>
                {data.memoryDocs.length === 0 && <p className="ui-empty-body px-2 text-left">No memory docs found.</p>}
                {data.memoryDocs.map((item: MemoryDocItem) => (
                  <MemoryRow
                    key={item.path}
                    title={item.title}
                    subtitle={item.summary}
                    tags={item.tags}
                    selected={selectedPath === item.path}
                    onClick={() => select(item.path)}
                  />
                ))}
              </SectionBlock>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

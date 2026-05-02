import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../client/api';
import type { VaultSearchResult } from '../../shared/types';

function Ico({ d, size = 13 }: { d: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
      <path d={d} />
    </svg>
  );
}

const FILE_ICON = 'M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z';

export interface KbQuickOpenProps {
  onSelect: (id: string) => void;
  onClose: () => void;
}

function scoreResult(item: VaultSearchResult, query: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return 0;

  const name = item.name.toLowerCase();
  const basename = name.replace(/\.md$/, '');
  const path = item.id.toLowerCase();

  let score = 0;
  if (basename === q || name === q || name === `${q}.md`) score += 1_000;
  if (basename.startsWith(q) || name.startsWith(q)) score += 400;
  if (basename.includes(q) || name.includes(q)) score += 200;
  if (path.startsWith(q)) score += 120;
  if (path.includes(q)) score += 60;
  return score;
}

export function KbQuickOpen({ onSelect, onClose }: KbQuickOpenProps) {
  const [query, setQuery] = useState('');
  const [allFiles, setAllFiles] = useState<VaultSearchResult[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    api.vaultFiles().then(({ files }) => {
      const markdownFiles = files
        .filter((file) => file.kind === 'file' && file.name.endsWith('.md'))
        .map((file) => ({
          id: file.id,
          name: file.name,
          excerpt: file.id.split('/').slice(0, -1).join('/'),
          matchCount: 0,
        }));
      setAllFiles(markdownFiles);
    }).catch(() => setAllFiles([]));
  }, []);

  const results = useMemo(() => {
    const trimmed = query.trim();
    if (!trimmed) return allFiles.slice(0, 30);

    return allFiles
      .map((item) => ({ item, score: scoreResult(item, trimmed) }))
      .filter((item) => item.score > 0)
      .sort((left, right) => right.score - left.score || left.item.name.localeCompare(right.item.name))
      .slice(0, 30)
      .map((item) => item.item);
  }, [allFiles, query]);

  useEffect(() => { setSelectedIdx(0); }, [results]);

  return (
    <div className="kb-quickopen-backdrop" onClick={onClose}>
      <div className="kb-quickopen-modal" onClick={(e) => e.stopPropagation()}>
        <div className="kb-quickopen-input-wrap">
          <input
            ref={inputRef}
            type="text"
            placeholder="Open file…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') { e.preventDefault(); onClose(); }
              if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIdx((i) => Math.min(i + 1, results.length - 1)); }
              if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIdx((i) => Math.max(i - 1, 0)); }
              if (e.key === 'Enter') {
                e.preventDefault();
                const item = results[selectedIdx];
                if (item) {
                  onSelect(item.id);
                  onClose();
                }
              }
            }}
            className="kb-quickopen-input"
          />
        </div>
        <div className="kb-quickopen-results">
          {results.map((result, index) => (
            <button
              key={result.id}
              type="button"
              className={[
                'flex items-center gap-2 w-full px-4 py-2 text-left text-[13px]',
                index === selectedIdx ? 'bg-accent/15 text-primary' : 'text-secondary hover:bg-accent/8',
              ].join(' ')}
              onMouseEnter={() => setSelectedIdx(index)}
              onClick={() => {
                onSelect(result.id);
                onClose();
              }}
            >
              <Ico d={FILE_ICON} size={12} />
              <span className="flex-1 truncate">{result.name.replace(/\.md$/, '')}</span>
              {result.excerpt ? <span className="text-[11px] text-dim truncate max-w-[160px]">{result.excerpt}</span> : null}
            </button>
          ))}
          {results.length === 0 && (
            <p className="px-4 py-3 text-[12px] text-dim">No files found</p>
          )}
        </div>
      </div>
    </div>
  );
}

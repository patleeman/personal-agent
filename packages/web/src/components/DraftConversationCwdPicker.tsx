import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { summarizeConversationCwd } from '../conversationCwdHistory';
import { ToolbarButton, cx } from './ui';

const CWD_PICKER_SELECT_CLASS = 'h-8 rounded-lg border border-border-default/70 bg-surface/90 px-2.5 pr-8 text-[11px] font-medium text-primary shadow-sm outline-none transition-colors hover:border-border-default hover:bg-elevated focus-visible:border-accent/70 focus-visible:ring-2 focus-visible:ring-accent/15 disabled:cursor-default disabled:opacity-40';

function FolderIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3.75 7.5A1.5 1.5 0 0 1 5.25 6h4.018a1.5 1.5 0 0 1 1.06.44l1.172 1.17a1.5 1.5 0 0 0 1.06.44h6.19a1.5 1.5 0 0 1 1.5 1.5v7.95a1.5 1.5 0 0 1-1.5 1.5H5.25a1.5 1.5 0 0 1-1.5-1.5V7.5Z" />
      <path d="M3.75 9.75h16.5" />
    </svg>
  );
}

interface DraftConversationCwdPickerProps {
  value: string;
  recentCwds: string[];
  onChange: (cwd: string) => void;
  onClear: () => void;
  variant?: 'composer' | 'empty-state';
}

export function DraftConversationCwdPicker({
  value,
  recentCwds,
  onChange,
  onClear,
  variant = 'composer',
}: DraftConversationCwdPickerProps) {
  const [editing, setEditing] = useState(false);
  const [requestedCwd, setRequestedCwd] = useState(value);
  const [pickBusy, setPickBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const normalizedValue = value.trim();
  const hasExplicitCwd = normalizedValue.length > 0;

  useEffect(() => {
    if (!editing) {
      setRequestedCwd(value);
    }
  }, [editing, value]);

  const alternateCwds = useMemo(
    () => recentCwds.filter((cwd) => cwd !== normalizedValue),
    [normalizedValue, recentCwds],
  );
  const quickCwds = alternateCwds.slice(0, 3);
  const overflowCwds = alternateCwds.slice(3);

  async function pickCwd() {
    if (pickBusy) {
      return;
    }

    setPickBusy(true);
    setError(null);
    try {
      const result = await api.pickFolder(normalizedValue || undefined);
      if (result.cancelled || !result.path) {
        return;
      }

      onChange(result.path);
      setRequestedCwd(result.path);
      setEditing(false);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Could not choose a folder.');
    } finally {
      setPickBusy(false);
    }
  }

  function startEditing() {
    setRequestedCwd(value);
    setError(null);
    setEditing(true);
  }

  function cancelEditing() {
    setRequestedCwd(value);
    setError(null);
    setEditing(false);
  }

  function saveRequestedCwd() {
    onChange(requestedCwd.trim());
    setError(null);
    setEditing(false);
  }

  const summaryLabel = hasExplicitCwd
    ? normalizedValue
    : 'Using the saved default from Settings, or the current repo root if no default is saved.';
  const centered = variant === 'empty-state';

  return (
    <div className={cx(
      centered ? 'mx-auto mt-5 w-full max-w-[44rem] space-y-3' : 'border-b border-border-subtle px-3 py-3',
    )}>
      <div className={cx('flex flex-wrap items-start gap-3', centered && 'flex-col items-center gap-2 text-center')}>
        <div className={cx('min-w-0 flex-1', centered && 'flex-none')}>
          <div className={cx('flex items-center gap-2', centered && 'justify-center')}>
            <FolderIcon className="text-accent" />
            <span className="ui-section-label">Working directory</span>
          </div>
          <p
            className={cx(
              'mt-1.5 break-all text-[12px]',
              hasExplicitCwd ? 'font-mono text-primary' : 'text-secondary',
              centered && 'mx-auto max-w-[36rem]',
            )}
            title={hasExplicitCwd ? normalizedValue : summaryLabel}
          >
            {hasExplicitCwd ? normalizedValue : summaryLabel}
          </p>
        </div>

        <div className={cx('flex shrink-0 flex-wrap items-center gap-1.5', centered && 'justify-center')}>
          <ToolbarButton type="button" onClick={() => { void pickCwd(); }} disabled={pickBusy} className="min-h-0 px-2 py-1 text-[11px] text-accent">
            {pickBusy ? 'Choosing…' : 'Choose…'}
          </ToolbarButton>
          <ToolbarButton type="button" onClick={startEditing} disabled={pickBusy} className="min-h-0 px-2 py-1 text-[11px]">
            Edit path
          </ToolbarButton>
          {hasExplicitCwd && (
            <ToolbarButton type="button" onClick={onClear} disabled={pickBusy} className="min-h-0 px-2 py-1 text-[11px] text-danger">
              Clear
            </ToolbarButton>
          )}
        </div>
      </div>

      {!editing && (quickCwds.length > 0 || overflowCwds.length > 0) && (
        <div className={cx('mt-2.5 flex flex-wrap items-center gap-1.5', centered && 'justify-center')}>
          {quickCwds.map((cwd) => (
            <ToolbarButton
              key={cwd}
              type="button"
              onClick={() => {
                setError(null);
                onChange(cwd);
              }}
              className="min-h-0 max-w-[11rem] truncate px-2 py-1 text-[11px]"
              title={cwd}
            >
              {summarizeConversationCwd(cwd)}
            </ToolbarButton>
          ))}
          {overflowCwds.length > 0 && (
            <label className="relative inline-flex min-w-0 items-center">
              <span className="sr-only">Recent working directories</span>
              <select
                value=""
                onChange={(event) => {
                  const nextCwd = event.target.value.trim();
                  if (!nextCwd) {
                    return;
                  }

                  setError(null);
                  onChange(nextCwd);
                  event.target.value = '';
                }}
                className={cx(CWD_PICKER_SELECT_CLASS, 'max-w-[14rem] min-w-[10rem] appearance-none')}
                aria-label="Recent working directories"
              >
                <option value="">More directories…</option>
                {overflowCwds.map((cwd) => (
                  <option key={cwd} value={cwd}>{cwd}</option>
                ))}
              </select>
              <svg aria-hidden="true" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="pointer-events-none absolute right-3 text-dim/70">
                <path d="m6 9 6 6 6-6" />
              </svg>
            </label>
          )}
        </div>
      )}

      {editing && (
        <form
          className={cx('mt-2.5 space-y-2', centered && 'mx-auto w-full max-w-[32rem] text-left')}
          onSubmit={(event) => {
            event.preventDefault();
            saveRequestedCwd();
          }}
        >
          <input
            autoFocus
            value={requestedCwd}
            onChange={(event) => {
              setRequestedCwd(event.target.value);
              if (error) {
                setError(null);
              }
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                cancelEditing();
              }
            }}
            placeholder="~/workingdir/repo"
            spellCheck={false}
            disabled={pickBusy}
            aria-label="Draft conversation working directory"
            className="w-full rounded-lg border border-border-default bg-base px-3 py-2 text-[12px] font-mono text-primary focus:outline-none focus:border-accent/60 disabled:opacity-50"
          />
          <div className={cx('flex items-center justify-between gap-2', centered && 'flex-wrap')}>
            <p className="text-[11px] text-dim">Use an absolute, ~, or relative path.</p>
            <div className="flex items-center gap-1">
              <ToolbarButton type="button" onClick={cancelEditing} disabled={pickBusy} className="min-h-0 px-2 py-1 text-[11px]">
                Cancel
              </ToolbarButton>
              <ToolbarButton type="submit" disabled={pickBusy} className="min-h-0 px-2 py-1 text-[11px] text-accent">
                Save
              </ToolbarButton>
            </div>
          </div>
        </form>
      )}

      {error && <p className={cx('mt-2 text-[11px] text-danger/80', centered && 'text-center')}>{error}</p>}
    </div>
  );
}

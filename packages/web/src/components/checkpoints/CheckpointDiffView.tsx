import { useMemo } from 'react';
import type { ConversationCommitCheckpointFile } from '../../shared/types';
import { cx } from '../ui';

type ParsedPatchLine = {
  kind: 'meta' | 'hunk' | 'context' | 'add' | 'del';
  oldNumber?: number | null;
  newNumber?: number | null;
  text: string;
};

type SplitDiffRow =
  | { kind: 'hunk'; text: string }
  | { kind: 'context'; line: ParsedPatchLine }
  | { kind: 'change'; left: ParsedPatchLine | null; right: ParsedPatchLine | null };

function parsePatchLines(patch: string): ParsedPatchLine[] {
  const output: ParsedPatchLine[] = [];
  let oldLineNumber: number | null = null;
  let newLineNumber: number | null = null;

  for (const line of patch.replace(/\r\n/g, '\n').split('\n')) {
    if (line.length === 0 && output.length > 0 && output[output.length - 1]?.text === '') {
      continue;
    }

    const hunkMatch = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunkMatch) {
      oldLineNumber = Number.parseInt(hunkMatch[1] as string, 10);
      newLineNumber = Number.parseInt(hunkMatch[2] as string, 10);
      output.push({ kind: 'hunk', text: line });
      continue;
    }

    if (line.startsWith('+') && !line.startsWith('+++')) {
      output.push({ kind: 'add', oldNumber: null, newNumber: newLineNumber, text: line });
      newLineNumber = (newLineNumber ?? 0) + 1;
      continue;
    }

    if (line.startsWith('-') && !line.startsWith('---')) {
      output.push({ kind: 'del', oldNumber: oldLineNumber, newNumber: null, text: line });
      oldLineNumber = (oldLineNumber ?? 0) + 1;
      continue;
    }

    if (line.startsWith(' ')) {
      output.push({ kind: 'context', oldNumber: oldLineNumber, newNumber: newLineNumber, text: line });
      oldLineNumber = (oldLineNumber ?? 0) + 1;
      newLineNumber = (newLineNumber ?? 0) + 1;
      continue;
    }

    output.push({ kind: 'meta', text: line });
  }

  return output;
}

function buildSplitDiffRows(lines: ParsedPatchLine[]): SplitDiffRow[] {
  const rows: SplitDiffRow[] = [];
  let pendingDeletes: ParsedPatchLine[] = [];
  let pendingAdds: ParsedPatchLine[] = [];

  const flushPendingChanges = () => {
    if (pendingDeletes.length === 0 && pendingAdds.length === 0) {
      return;
    }

    const rowCount = Math.max(pendingDeletes.length, pendingAdds.length);
    for (let index = 0; index < rowCount; index += 1) {
      rows.push({
        kind: 'change',
        left: pendingDeletes[index] ?? null,
        right: pendingAdds[index] ?? null,
      });
    }

    pendingDeletes = [];
    pendingAdds = [];
  };

  for (const line of lines) {
    if (line.kind === 'meta') {
      continue;
    }

    if (line.kind === 'del') {
      pendingDeletes.push(line);
      continue;
    }

    if (line.kind === 'add') {
      pendingAdds.push(line);
      continue;
    }

    flushPendingChanges();

    if (line.kind === 'hunk') {
      rows.push({ kind: 'hunk', text: line.text });
      continue;
    }

    rows.push({ kind: 'context', line });
  }

  flushPendingChanges();
  return rows;
}

function displayPatchLineText(line: ParsedPatchLine): string {
  if ((line.kind === 'context' || line.kind === 'add' || line.kind === 'del') && line.text.length > 0) {
    return line.text.slice(1);
  }

  return line.text;
}

export function statusLabel(file: ConversationCommitCheckpointFile): string {
  switch (file.status) {
    case 'added':
      return 'Added';
    case 'deleted':
      return 'Deleted';
    case 'renamed':
      return 'Renamed';
    case 'copied':
      return 'Copied';
    case 'typechange':
      return 'Type change';
    case 'unmerged':
      return 'Unmerged';
    case 'modified':
      return 'Modified';
    default:
      return 'Changed';
  }
}

export function fileDisplayPath(file: ConversationCommitCheckpointFile): string {
  return file.previousPath && file.previousPath !== file.path
    ? `${file.previousPath} → ${file.path}`
    : file.path;
}

export function UnifiedDiffTable({ lines, filePath }: { lines: ParsedPatchLine[]; filePath: string }) {
  const visibleLines = lines.filter((line) => line.kind !== 'meta');

  return (
    <table className="w-full table-fixed border-collapse font-mono text-[11px] leading-5 text-primary">
      <tbody>
        {visibleLines.map((line, index) => {
          const toneClass = line.kind === 'add'
            ? 'bg-success/8 text-success'
            : line.kind === 'del'
              ? 'bg-danger/8 text-danger'
              : line.kind === 'hunk'
                ? 'bg-accent/8 text-accent'
                : '';

          return (
            <tr key={`${filePath}:unified:${index}`} className={cx('border-b border-border-subtle/60 align-top', toneClass)}>
              <td className="w-14 select-none px-3 py-1 text-right text-dim/80">{line.oldNumber ?? ''}</td>
              <td className="w-14 select-none px-3 py-1 text-right text-dim/80">{line.newNumber ?? ''}</td>
              <td className="whitespace-pre-wrap break-all px-3 py-1">{displayPatchLineText(line) || ' '}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function SplitDiffTable({ rows, filePath }: { rows: SplitDiffRow[]; filePath: string }) {
  return (
    <table className="w-full table-fixed border-collapse font-mono text-[11px] leading-5 text-primary">
      <tbody>
        {rows.map((row, index) => {
          if (row.kind === 'hunk') {
            return (
              <tr key={`${filePath}:hunk:${index}`} className="border-b border-border-subtle/60 bg-accent/8 text-accent">
                <td colSpan={4} className="px-3 py-1 whitespace-pre-wrap break-all">{row.text}</td>
              </tr>
            );
          }

          if (row.kind === 'context') {
            return (
              <tr key={`${filePath}:context:${index}`} className="border-b border-border-subtle/60 align-top">
                <td className="w-14 select-none px-3 py-1 text-right text-dim/80">{row.line.oldNumber ?? ''}</td>
                <td className="w-1/2 px-3 py-1 whitespace-pre-wrap break-all">{displayPatchLineText(row.line) || ' '}</td>
                <td className="w-14 select-none border-l border-border-subtle/60 px-3 py-1 text-right text-dim/80">{row.line.newNumber ?? ''}</td>
                <td className="w-1/2 px-3 py-1 whitespace-pre-wrap break-all">{displayPatchLineText(row.line) || ' '}</td>
              </tr>
            );
          }

          const leftToneClass = row.left?.kind === 'del' ? 'bg-danger/8 text-danger' : 'bg-base/30 text-dim/70';
          const rightToneClass = row.right?.kind === 'add' ? 'bg-success/8 text-success' : 'bg-base/30 text-dim/70';

          return (
            <tr key={`${filePath}:change:${index}`} className="border-b border-border-subtle/60 align-top">
              <td className={cx('w-14 select-none px-3 py-1 text-right text-dim/80', leftToneClass)}>{row.left?.oldNumber ?? ''}</td>
              <td className={cx('w-1/2 px-3 py-1 whitespace-pre-wrap break-all', leftToneClass)}>{row.left ? displayPatchLineText(row.left) : ' '}</td>
              <td className={cx('w-14 select-none border-l border-border-subtle/60 px-3 py-1 text-right text-dim/80', rightToneClass)}>{row.right?.newNumber ?? ''}</td>
              <td className={cx('w-1/2 px-3 py-1 whitespace-pre-wrap break-all', rightToneClass)}>{row.right ? displayPatchLineText(row.right) : ' '}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function CheckpointDiffSection({
  file,
  active = false,
  view,
  registerSection,
  stickyHeader = false,
  showActiveBadge = false,
  sectionClassName,
}: {
  file: ConversationCommitCheckpointFile;
  active?: boolean;
  view: 'unified' | 'split';
  registerSection?: (node: HTMLDivElement | null) => void;
  stickyHeader?: boolean;
  showActiveBadge?: boolean;
  sectionClassName?: string;
}) {
  const patchLines = useMemo(() => parsePatchLines(file.patch), [file.patch]);
  const splitRows = useMemo(() => buildSplitDiffRows(patchLines), [patchLines]);

  return (
    <section
      ref={registerSection}
      data-checkpoint-file-path={file.path}
      className={cx('scroll-mt-4 border-b border-border-subtle/80', active && 'bg-accent/3', sectionClassName)}
    >
      <div
        className={cx(
          'border-b border-border-subtle/60 px-4 py-3',
          stickyHeader && 'sticky top-0 z-10 bg-base/95 backdrop-blur supports-[backdrop-filter]:bg-base/88',
        )}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-[13px] font-medium text-primary" title={fileDisplayPath(file)}>{fileDisplayPath(file)}</p>
            <p className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-secondary">
              <span>{statusLabel(file)}</span>
              <span className="font-mono tabular-nums"><span className="text-success">+{file.additions}</span> <span className="text-danger">-{file.deletions}</span></span>
            </p>
          </div>
          {showActiveBadge && active ? <span className="text-[10px] uppercase tracking-[0.14em] text-accent">Current</span> : null}
        </div>
      </div>
      <div className="overflow-hidden bg-elevated/10">
        {view === 'split'
          ? <SplitDiffTable rows={splitRows} filePath={file.path} />
          : <UnifiedDiffTable lines={patchLines} filePath={file.path} />}
      </div>
    </section>
  );
}

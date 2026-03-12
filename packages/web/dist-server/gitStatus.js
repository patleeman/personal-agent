import { execFileSync } from 'node:child_process';
function runGitCommand(args, cwd) {
    return execFileSync('git', args, {
        cwd,
        stdio: ['ignore', 'pipe', 'ignore'],
        encoding: 'utf-8',
        timeout: 3000,
    });
}
function runGitCommandAllowFailure(args, cwd) {
    try {
        return {
            stdout: runGitCommand(args, cwd),
            exitCode: 0,
        };
    }
    catch (error) {
        const childError = error;
        const stdout = typeof childError.stdout === 'string'
            ? childError.stdout
            : Buffer.isBuffer(childError.stdout)
                ? childError.stdout.toString('utf-8')
                : '';
        return {
            stdout,
            exitCode: childError.status ?? 1,
        };
    }
}
export function countGitStatusEntries(output) {
    return output
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .length;
}
export function parseGitNumstat(output) {
    let linesAdded = 0;
    let linesDeleted = 0;
    for (const line of output.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) {
            continue;
        }
        const [addedRaw, deletedRaw] = trimmed.split('\t');
        const added = Number.parseInt(addedRaw ?? '', 10);
        const deleted = Number.parseInt(deletedRaw ?? '', 10);
        if (Number.isFinite(added)) {
            linesAdded += added;
        }
        if (Number.isFinite(deleted)) {
            linesDeleted += deleted;
        }
    }
    return { linesAdded, linesDeleted };
}
function parseNulSeparatedPaths(output) {
    return output
        .split('\0')
        .map((value) => value.trim())
        .filter((value) => value.length > 0);
}
function readUntrackedDiffSummary(cwd) {
    const untrackedPaths = parseNulSeparatedPaths(runGitCommand(['ls-files', '--others', '--exclude-standard', '-z'], cwd));
    return untrackedPaths.reduce((summary, filePath) => {
        const result = runGitCommandAllowFailure(['diff', '--no-index', '--numstat', '--', '/dev/null', filePath], cwd);
        if (result.exitCode !== 0 && result.exitCode !== 1) {
            return summary;
        }
        const fileSummary = parseGitNumstat(result.stdout);
        return {
            linesAdded: summary.linesAdded + fileSummary.linesAdded,
            linesDeleted: summary.linesDeleted + fileSummary.linesDeleted,
        };
    }, { linesAdded: 0, linesDeleted: 0 });
}
function hasHeadCommit(cwd) {
    return runGitCommandAllowFailure(['rev-parse', '--verify', 'HEAD'], cwd).exitCode === 0;
}
export function readGitStatusSummary(cwd) {
    try {
        const isWorkTree = runGitCommand(['rev-parse', '--is-inside-work-tree'], cwd).trim();
        if (isWorkTree !== 'true') {
            return null;
        }
    }
    catch {
        return null;
    }
    const branch = runGitCommandAllowFailure(['branch', '--show-current'], cwd).stdout.trim() || null;
    const changeCount = countGitStatusEntries(runGitCommand(['status', '--porcelain=v1'], cwd));
    const trackedSummary = hasHeadCommit(cwd)
        ? parseGitNumstat(runGitCommand(['diff', '--numstat', 'HEAD'], cwd))
        : (() => {
            const stagedSummary = parseGitNumstat(runGitCommand(['diff', '--cached', '--numstat'], cwd));
            const unstagedSummary = parseGitNumstat(runGitCommand(['diff', '--numstat'], cwd));
            return {
                linesAdded: stagedSummary.linesAdded + unstagedSummary.linesAdded,
                linesDeleted: stagedSummary.linesDeleted + unstagedSummary.linesDeleted,
            };
        })();
    const untrackedSummary = readUntrackedDiffSummary(cwd);
    return {
        branch,
        changeCount,
        linesAdded: trackedSummary.linesAdded + untrackedSummary.linesAdded,
        linesDeleted: trackedSummary.linesDeleted + untrackedSummary.linesDeleted,
    };
}

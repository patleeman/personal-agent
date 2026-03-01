import { describe, expect, it } from 'vitest';
import { buildMemoryCardPrompt, buildSummaryPrompt } from './memory-transcript.js';

describe('buildSummaryPrompt', () => {
  it('requests deterministic, retrieval-focused summaries while keeping flexible non-empty sections', () => {
    const prompt = buildSummaryPrompt({
      sessionFile: '/tmp/session.jsonl',
      sessionId: 'session-1',
      cwd: '/tmp/project',
      startedAt: '2026-03-01T00:00:00.000Z',
      endedAt: '2026-03-01T01:00:00.000Z',
      transcript: 'USER: make memory better',
    });

    expect(prompt).toContain('# Session session-1');
    expect(prompt).toContain('## Context');
    expect(prompt).toContain('## Durable Decisions');
    expect(prompt).toContain('## Supersedes');
    expect(prompt).toContain('## Decision Rationale and Tradeoffs');
    expect(prompt).toContain('## Contracts, Constraints, and Invariants');
    expect(prompt).toContain('## Pitfalls and Debugging Insights');
    expect(prompt).toContain('## Additional Notable Insights');
    expect(prompt).toContain('## Open Loops');
    expect(prompt).toContain('## Retrieval Tags');

    expect(prompt).toContain('Omit empty sections. Do not emit placeholder sections.');
    expect(prompt).toContain('Never write "unknown", "none", or "n/a" as section content.');
    expect(prompt).toContain('## Context must be 1–3 lines and include objective + affected subsystem(s) in objective terms.');
    expect(prompt).toContain('## Durable Decisions must be phrased as stable rules/contracts, not activity logs.');
    expect(prompt).toContain('## Open Loops must use actionable GitHub-style checkbox bullets: "- [ ] ...".');
    expect(prompt).toContain('Include key packages/files/functions/subsystems when they materially changed behavior, contracts, or architecture.');
    expect(prompt).toContain('Include ## Supersedes only when transcript evidence shows this session explicitly overrides prior decisions/behavior; include a session id when available, otherwise a short superseded description.');

    expect(prompt).not.toContain('## Commands and Tools');
    expect(prompt).not.toContain('## Files Touched');
    expect(prompt).not.toContain('Use exactly these headings');
    expect(prompt).not.toContain('sessionFile');
    expect(prompt).not.toContain('startedAt');
    expect(prompt).not.toContain('endedAt');
  });

  it('builds strict JSON memory card prompt', () => {
    const prompt = buildMemoryCardPrompt({
      sessionFile: '/tmp/session.jsonl',
      sessionId: 'session-2',
      cwd: '/tmp/project',
      transcript: 'USER: improve memory retrieval',
      summaryRelativePath: 'workspace/session-2.md',
    });

    expect(prompt).toContain('Return STRICT JSON only.');
    expect(prompt).toContain('"type": "memory_card"');
    expect(prompt).toContain('"summary_path": "<string>"');
    expect(prompt).toContain('open_loops: actionable unfinished tasks phrased as imperative tasks (no checkboxes).');
    expect(prompt).toContain('- summary_path: workspace/session-2.md');
  });
});

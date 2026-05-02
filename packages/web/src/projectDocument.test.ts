import { describe, expect, it } from 'vitest';
import { createEmptyProjectDocument, parseProjectDocument } from './projectDocument';

describe('parseProjectDocument', () => {
  it('splits the preferred requirements, plan, and completion sections', () => {
    const parsed = parseProjectDocument(`# Improve project layout\n\n## Requirements\n\n### Goal\n\nMake projects easier to scan.\n\n### Acceptance criteria\n\n- Three clear sections\n\n## Plan\n\n- Redesign the detail layout\n\n## Completion summary\n\nShipped the redesign.`);

    expect(parsed.title).toBe('Improve project layout');
    expect(parsed.requirements).toContain('### Goal');
    expect(parsed.requirements).toContain('Three clear sections');
    expect(parsed.plan).toContain('Redesign the detail layout');
    expect(parsed.completionSummary).toContain('Shipped the redesign.');
  });

  it('maps older brief headings into the new buckets', () => {
    const parsed = parseProjectDocument(`# Project brief\n\n## What this project is\n\nImprove the project UX.\n\n## Current state\n\nThe current layout is dense.\n\n## Open work\n\n- Collapse redundant sections\n\n## Recommended next step\n\nFlatten the layout.`);

    expect(parsed.requirements).toContain('Improve the project UX.');
    expect(parsed.plan).toContain('The current layout is dense.');
    expect(parsed.plan).toContain('Collapse redundant sections');
    expect(parsed.plan).toContain('Flatten the layout.');
    expect(parsed.completionSummary).toBe('');
  });

  it('treats headingless content as requirements by default', () => {
    const parsed = parseProjectDocument('Keep a simple durable project record.');

    expect(parsed.requirements).toBe('Keep a simple durable project record.');
    expect(parsed.plan).toBe('');
    expect(parsed.completionSummary).toBe('');
  });
});

describe('createEmptyProjectDocument', () => {
  it('creates a template with the three canonical sections', () => {
    const template = createEmptyProjectDocument('Improve project layout');

    expect(template).toContain('# Improve project layout');
    expect(template).toContain('## Requirements');
    expect(template).toContain('## Plan');
    expect(template).toContain('## Completion summary');
  });
});

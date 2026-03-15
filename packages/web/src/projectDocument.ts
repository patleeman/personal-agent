export interface ProjectDocumentSections {
  title?: string;
  requirements: string;
  plan: string;
  completionSummary: string;
}

function normalizeHeading(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function isRequirementsHeading(heading: string): boolean {
  const normalized = normalizeHeading(heading);
  return normalized === 'requirements'
    || normalized === 'request'
    || normalized === 'initial ask'
    || normalized === 'what this project is';
}

function isPlanHeading(heading: string): boolean {
  const normalized = normalizeHeading(heading);
  return normalized === 'plan'
    || normalized === 'generated plan'
    || normalized === 'current state'
    || normalized === 'open work'
    || normalized === 'important context'
    || normalized === 'recommended next step';
}

function isCompletionHeading(heading: string): boolean {
  const normalized = normalizeHeading(heading);
  return normalized === 'completion summary'
    || normalized === 'outcome'
    || normalized === 'results';
}

export function parseProjectDocument(content: string | undefined | null): ProjectDocumentSections {
  const normalized = (content ?? '').replace(/\r\n/g, '\n').trim();
  if (!normalized) {
    return {
      requirements: '',
      plan: '',
      completionSummary: '',
    };
  }

  const lines = normalized.split('\n');
  let lineIndex = 0;
  let title: string | undefined;

  const titleMatch = lines[0]?.match(/^#\s+(.+?)\s*$/);
  if (titleMatch) {
    title = titleMatch[1]?.trim();
    lineIndex = 1;
    while (lineIndex < lines.length && lines[lineIndex]?.trim().length === 0) {
      lineIndex += 1;
    }
  }

  const requirementsLines: string[] = [];
  const planLines: string[] = [];
  const completionLines: string[] = [];
  let currentBucket: 'requirements' | 'plan' | 'completionSummary' = 'requirements';

  for (; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex] ?? '';
    const headingMatch = line.match(/^##\s+(.+?)\s*$/);

    if (headingMatch) {
      const heading = headingMatch[1] ?? '';
      if (isRequirementsHeading(heading)) {
        currentBucket = 'requirements';
      } else if (isPlanHeading(heading)) {
        currentBucket = 'plan';
      } else if (isCompletionHeading(heading)) {
        currentBucket = 'completionSummary';
      } else {
        currentBucket = 'plan';
      }
      continue;
    }

    if (currentBucket === 'requirements') {
      requirementsLines.push(line);
    } else if (currentBucket === 'plan') {
      planLines.push(line);
    } else {
      completionLines.push(line);
    }
  }

  return {
    ...(title ? { title } : {}),
    requirements: requirementsLines.join('\n').trim(),
    plan: planLines.join('\n').trim(),
    completionSummary: completionLines.join('\n').trim(),
  };
}

export function createEmptyProjectDocument(title: string): string {
  const normalizedTitle = title.trim() || 'Project';

  return [
    `# ${normalizedTitle}`,
    '',
    '## Requirements',
    '',
    '### Goal',
    '',
    'Describe the core goal in one or two sentences.',
    '',
    '### Acceptance criteria',
    '',
    '- Add the concrete checks that define done.',
    '',
    '## Plan',
    '',
    '- Break the work into discrete chunks.',
    '- Capture the order of operations and notable risks.',
    '',
    '## Completion summary',
    '',
    'Use this section to summarize what shipped, what changed, and any follow-ups once the project is complete.',
    '',
  ].join('\n');
}

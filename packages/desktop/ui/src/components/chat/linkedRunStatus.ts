export function inferStatusFromLinkedRunDetail(detail: string | null | undefined): string | undefined {
  if (typeof detail !== 'string' || !detail) {
    return undefined;
  }

  const firstSegment = detail.split('·')[0]?.trim().toLowerCase();
  if (!firstSegment) {
    return undefined;
  }

  const knownStatus = ['queued', 'waiting', 'running', 'recovering', 'completed', 'failed', 'interrupted', 'cancelled'];
  return knownStatus.includes(firstSegment) ? firstSegment : undefined;
}

export function describeInlineRunStatus(status: unknown): {
  text: string;
  tone: 'accent' | 'success' | 'warning' | 'danger' | 'muted';
} {
  const statusText = typeof status === 'string' ? status : undefined;
  if (statusText === 'running') {
    return { text: 'running', tone: 'accent' };
  }
  if (statusText === 'recovering') {
    return { text: 'recovering', tone: 'warning' };
  }
  if (statusText === 'queued' || statusText === 'waiting') {
    return { text: statusText, tone: 'muted' };
  }
  if (statusText === 'completed') {
    return { text: 'completed', tone: 'success' };
  }
  if (statusText === 'failed' || statusText === 'interrupted') {
    return { text: statusText, tone: 'danger' };
  }
  if (statusText === 'cancelled') {
    return { text: 'cancelled', tone: 'muted' };
  }

  return {
    text: statusText?.trim().length ? statusText : 'mentioned',
    tone: 'muted',
  };
}

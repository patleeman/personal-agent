export function inferStatusFromLinkedRunDetail(detail: string | null | undefined): string | undefined {
  if (!detail) {
    return undefined;
  }

  const firstSegment = detail.split('·')[0]?.trim().toLowerCase();
  if (!firstSegment) {
    return undefined;
  }

  const knownStatus = ['queued', 'waiting', 'running', 'recovering', 'completed', 'failed', 'interrupted', 'cancelled'];
  return knownStatus.includes(firstSegment) ? firstSegment : undefined;
}

export function describeInlineRunStatus(status: string | undefined): {
  text: string;
  tone: 'accent' | 'success' | 'warning' | 'danger' | 'muted';
} {
  if (status === 'running') {
    return { text: 'running', tone: 'accent' };
  }
  if (status === 'recovering') {
    return { text: 'recovering', tone: 'warning' };
  }
  if (status === 'queued' || status === 'waiting') {
    return { text: status, tone: 'muted' };
  }
  if (status === 'completed') {
    return { text: 'completed', tone: 'success' };
  }
  if (status === 'failed' || status === 'interrupted') {
    return { text: status, tone: 'danger' };
  }
  if (status === 'cancelled') {
    return { text: 'cancelled', tone: 'muted' };
  }

  return {
    text: status?.trim().length ? status : 'linked',
    tone: 'muted',
  };
}

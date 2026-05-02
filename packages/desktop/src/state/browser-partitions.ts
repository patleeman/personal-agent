function sanitizePartitionToken(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'host'
  );
}

export function getHostBrowserPartition(hostId: string): string {
  return `persist:pa-host-${sanitizePartitionToken(hostId)}`;
}

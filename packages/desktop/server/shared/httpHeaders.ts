export function sanitizeContentDispositionFilename(fileName: string): string {
  const normalized = fileName
    .replace(/[\r\n]+/g, ' ')
    .replace(/["\\]+/g, '')
    .replace(/[^\x20-\x7E]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim();

  return normalized.length > 0 && /[a-z0-9]/i.test(normalized) ? normalized : 'download';
}

export function buildContentDispositionHeader(disposition: 'inline' | 'attachment', fileName: string): string {
  return `${disposition}; filename="${sanitizeContentDispositionFilename(fileName)}"`;
}

import { readFileSync } from 'fs';

export function readTailLines(path: string, lineCount: number): string {
  const text = readFileSync(path, 'utf-8').replace(/\r\n/g, '\n');
  const lines = text.split('\n');

  if (lines.length === 0) {
    return '';
  }

  return lines.slice(-lineCount).join('\n').trimEnd();
}

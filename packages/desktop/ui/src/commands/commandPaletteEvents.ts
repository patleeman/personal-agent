import type { CommandPaletteScope } from './commandPalette';

export const OPEN_COMMAND_PALETTE_EVENT = 'pa:command-palette-open';

export interface OpenCommandPaletteDetail {
  scope?: CommandPaletteScope;
  query?: string;
}

export function openCommandPalette(detail: OpenCommandPaletteDetail = {}): void {
  window.dispatchEvent(new CustomEvent<OpenCommandPaletteDetail>(OPEN_COMMAND_PALETTE_EVENT, { detail }));
}

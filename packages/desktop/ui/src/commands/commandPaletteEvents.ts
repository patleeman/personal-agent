import type { CommandPaletteScope } from './commandPalette';

export const OPEN_COMMAND_PALETTE_EVENT = 'pa:command-palette-open';

export interface OpenCommandPaletteDetail {
  scope?: CommandPaletteScope;
  query?: string;
}

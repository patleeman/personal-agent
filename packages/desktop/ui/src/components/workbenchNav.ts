export function shouldRenderExtensionToolPanelInWorkbenchNav(extensionId: string): boolean {
  return extensionId !== 'system-files';
}

export function labelForExtensionToolPanel(surface: { title?: string; label?: string }): string {
  return surface.title ?? surface.label ?? 'Extension';
}

export function iconGlyphForExtensionSurface(icon: string | undefined): string {
  switch (icon) {
    case 'automation':
      return '◷';
    case 'browser':
      return '◎';
    case 'database':
      return '▤';
    case 'diff':
      return '⇄';
    case 'file':
      return '□';
    case 'gear':
      return '⚙';
    case 'graph':
      return '⌁';
    case 'kanban':
      return '▦';
    case 'play':
      return '▶';
    case 'terminal':
      return '⌘';
    case 'sparkle':
    case 'app':
    default:
      return '✦';
  }
}

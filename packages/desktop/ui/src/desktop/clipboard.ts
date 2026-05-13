export async function writeClipboardText(text: string): Promise<void> {
  const desktopClipboard = window.personalAgentDesktop?.writeClipboardText;
  if (desktopClipboard) {
    const result = await desktopClipboard(text);
    if (!result.ok) {
      throw new Error(result.error || 'Copy to clipboard failed.');
    }
    return;
  }

  if (typeof navigator === 'undefined' || typeof navigator.clipboard?.writeText !== 'function') {
    throw new Error('Clipboard access is unavailable.');
  }

  await navigator.clipboard.writeText(text);
}

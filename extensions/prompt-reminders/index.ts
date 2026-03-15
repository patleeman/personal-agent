import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import { requirePromptCatalogEntryFromExtension } from '../_shared/prompt-catalog.js';

function shouldInjectCodeReferenceReminder(prompt: string): boolean {
  return /\b(audit|review|compare|align|walkthrough|explain|inspect|trace)\b|system prompt|prompt composition|code path|where in\b/i.test(prompt);
}

export default function promptRemindersExtension(pi: ExtensionAPI): void {
  pi.on('before_agent_start', (event) => {
    const prompt = event.prompt?.trim() ?? '';
    if (prompt.length === 0 || prompt.startsWith('/')) {
      return;
    }

    if (!shouldInjectCodeReferenceReminder(prompt)) {
      return;
    }

    return {
      message: {
        customType: 'code-references-reminder',
        content: requirePromptCatalogEntryFromExtension(import.meta.url, 'reminders/code-references.md'),
        display: false,
      },
    };
  });
}

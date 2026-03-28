import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import { requirePromptCatalogEntryFromExtension } from '../_shared/prompt-catalog.js';

function normalizePromptText(text: string): string {
  return text.replace(/\r\n/g, '\n').trim();
}

export function prioritizePromptSection(systemPrompt: string, prioritizedSection: string): string {
  const normalizedSection = normalizePromptText(prioritizedSection);
  const normalizedPrompt = normalizePromptText(systemPrompt);

  if (!normalizedSection) {
    return normalizedPrompt;
  }

  if (!normalizedPrompt) {
    return normalizedSection;
  }

  let remainingPrompt = normalizedPrompt;

  while (true) {
    const sectionIndex = remainingPrompt.indexOf(normalizedSection);
    if (sectionIndex < 0) {
      break;
    }

    const before = remainingPrompt.slice(0, sectionIndex).trim();
    const after = remainingPrompt.slice(sectionIndex + normalizedSection.length).trim();
    remainingPrompt = [before, after].filter((part) => part.length > 0).join('\n\n');
  }

  if (!remainingPrompt) {
    return normalizedSection;
  }

  return `${normalizedSection}\n\n${remainingPrompt}`;
}

export default function systemPromptPriorityExtension(pi: ExtensionAPI): void {
  const responseStyle = requirePromptCatalogEntryFromExtension(import.meta.url, 'system/30-output-style.md');

  pi.on('before_agent_start', (event) => {
    const prompt = event.prompt?.trim() ?? '';
    if (prompt.length === 0 || prompt.startsWith('/')) {
      return undefined;
    }

    const nextSystemPrompt = prioritizePromptSection(event.systemPrompt ?? '', responseStyle);
    if (nextSystemPrompt === normalizePromptText(event.systemPrompt ?? '')) {
      return undefined;
    }

    return {
      systemPrompt: nextSystemPrompt,
    };
  });
}

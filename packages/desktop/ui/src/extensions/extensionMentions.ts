import type { MentionItem } from '../conversation/conversationMentions';
import type { MemoryDocItem } from '../shared/types';
import { systemExtensionModules } from './systemExtensionModules';
import type { ExtensionMentionRegistration } from './types';

interface MentionProviderInput {
  memoryDocs: MemoryDocItem[];
}

type MentionProvider = (input: MentionProviderInput) => Promise<MentionItem[]> | MentionItem[];

export async function buildExtensionMentionItems(
  registrations: ExtensionMentionRegistration[],
  input: MentionProviderInput,
): Promise<MentionItem[]> {
  const groups = await Promise.all(
    registrations.map(async (registration) => {
      const loader = systemExtensionModules.get(registration.extensionId);
      if (!loader) return [];
      const module = await loader();
      const provider = module[registration.provider];
      if (typeof provider !== 'function') return [];
      return (provider as MentionProvider)(input);
    }),
  );
  return groups.flat();
}

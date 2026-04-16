import type {
  ConversationAutomationTemplateTodoItem,
  ConversationAutomationTodoItem,
  ConversationAutomationWorkflowPreset,
} from '../shared/types';

export interface ChecklistDraftItem {
  id: string;
  text: string;
}

export function formatChecklistItemText(item: ConversationAutomationTemplateTodoItem | ConversationAutomationTodoItem): string {
  return item.kind === 'instruction'
    ? item.text
    : `/skill:${item.skillName}${item.skillArgs ? ` ${item.skillArgs}` : ''}`;
}

export function summarizeChecklistText(text: string): string {
  const singleLine = text.trim().replace(/\s+/g, ' ');
  if (singleLine.length <= 72) {
    return singleLine || 'Untitled item';
  }
  return `${singleLine.slice(0, 69).trimEnd()}…`;
}

export function toChecklistDraftItems(items: Array<ConversationAutomationTemplateTodoItem | ConversationAutomationTodoItem>): ChecklistDraftItem[] {
  return items.map((item) => ({
    id: item.id,
    text: formatChecklistItemText(item),
  }));
}

export function checklistDraftItemsToTemplateItems(items: ChecklistDraftItem[]): ConversationAutomationTemplateTodoItem[] {
  return items
    .map((item) => ({ id: item.id, text: item.text.trim() }))
    .filter((item) => item.text.length > 0)
    .map((item) => ({
      id: item.id,
      kind: 'instruction' as const,
      label: summarizeChecklistText(item.text),
      text: item.text,
    }));
}

export function cloneChecklistDraftItems(items: ChecklistDraftItem[]): ChecklistDraftItem[] {
  return items.map((item) => ({ ...item }));
}

export function createChecklistDraftItem(text = ''): ChecklistDraftItem {
  return {
    id: `item-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    text,
  };
}

export function appendChecklistPresetItems(currentItems: ChecklistDraftItem[], preset: ConversationAutomationWorkflowPreset): ChecklistDraftItem[] {
  return [
    ...currentItems,
    ...toChecklistDraftItems(preset.items).map((item) => ({
      id: createChecklistDraftItem(item.text).id,
      text: item.text,
    })),
  ];
}

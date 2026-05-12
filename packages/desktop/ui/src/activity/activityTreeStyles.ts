import type { ActivityTreeItem } from './activityTree';
import type { ActivityTreePathModel } from './activityTreePaths';

export function buildActivityTreeUnsafeCss(pathModel: ActivityTreePathModel): string {
  const rules: string[] = [];

  for (const entry of pathModel.entries) {
    const rule = buildActivityTreeItemCssRule(entry.path, entry.item);
    if (rule) rules.push(rule);
  }

  return rules.join('\n');
}

function buildActivityTreeItemCssRule(path: string, item: ActivityTreeItem): string | null {
  const accentColor = sanitizeCssColor(item.accentColor);
  const backgroundColor = sanitizeCssColor(item.backgroundColor);
  if (!accentColor && !backgroundColor) return null;

  const declarations: string[] = [];
  if (accentColor) {
    declarations.push(`box-shadow: inset 2px 0 0 ${accentColor};`);
  }
  if (backgroundColor) {
    declarations.push(`background: ${backgroundColor};`);
  }

  return `button[data-item-path="${escapeCssString(path)}"] { ${declarations.join(' ')} }`;
}

function sanitizeCssColor(value: string | undefined): string | null {
  const color = value?.trim();
  if (!color) return null;

  if (/^#[0-9a-fA-F]{3,8}$/.test(color)) return color;
  if (/^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\)$/.test(color)) return color;
  if (/^color-mix\(in srgb, #[0-9a-fA-F]{3,8} \d{1,3}%, transparent\)$/.test(color)) return color;

  return null;
}

function escapeCssString(value: string): string {
  return value.replace(/["\\\n\r\f]/g, (character) => `\\${character}`);
}

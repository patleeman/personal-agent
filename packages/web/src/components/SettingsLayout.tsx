import type { ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { buildRailWidthStorageKey } from '../layoutSizing';
import { BrowserSplitLayout } from './BrowserSplitLayout';
import { ListLinkRow, SectionLabel } from './ui';

const SETTINGS_BROWSER_WIDTH_STORAGE_KEY = buildRailWidthStorageKey('settings-browser');
const SETTINGS_PAGE_SEARCH_PARAM = 'page';
const LEGACY_SETTINGS_PAGE_IDS = [
  'defaults',
  'appearance',
  'providers',
  'interface',
  'workspace',
  'system',
  'system-web-ui',
  'system-daemon',
] as const;

const SETTINGS_NAV_ITEMS = [
  {
    href: '/settings',
    label: 'Settings',
    summary: 'Profile, model, theme, providers, default cwd, and system controls on one page.',
  },
  {
    href: '/runs',
    label: 'Runs',
    summary: 'Durable background work and recovery review.',
  },
  {
    href: '/automations',
    label: 'Automations',
    summary: 'Browse scheduled prompts, one-time runs, and unattended automation.',
  },
  {
    href: '/tools',
    label: 'Tools',
    summary: 'Available tools, CLIs, MCP servers, and package sources.',
  },
  {
    href: '/instructions',
    label: 'Instructions',
    summary: 'Loaded AGENTS and other durable instruction sources.',
  },
] as const;

export type SettingsPageId = (typeof LEGACY_SETTINGS_PAGE_IDS)[number];

export function readSettingsPageId(search: string): SettingsPageId {
  const value = new URLSearchParams(search).get(SETTINGS_PAGE_SEARCH_PARAM)?.trim();
  if (LEGACY_SETTINGS_PAGE_IDS.some((item) => item === value)) {
    return value as SettingsPageId;
  }

  return 'defaults';
}

export function buildSettingsHref(_pageId: SettingsPageId): string {
  return '/settings';
}

function matchesSettingsRoute(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function SettingsNavigationRail() {
  const location = useLocation();

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 space-y-1 border-b border-border-subtle px-4 py-4">
        <p className="ui-card-title">Settings</p>
        <p className="ui-card-meta">Stable preferences and adjacent operational pages.</p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <div className="space-y-px">
          <SectionLabel label="Pages" className="px-2 pb-1" />
          {SETTINGS_NAV_ITEMS.map((item) => (
            <ListLinkRow
              key={item.href}
              to={item.href}
              selected={matchesSettingsRoute(location.pathname, item.href)}
            >
              <p className="ui-row-title">{item.label}</p>
              <p className="ui-row-summary">{item.summary}</p>
            </ListLinkRow>
          ))}
        </div>
      </div>
    </div>
  );
}

export function SettingsSplitLayout({ children }: { children: ReactNode }) {
  return (
    <BrowserSplitLayout
      storageKey={SETTINGS_BROWSER_WIDTH_STORAGE_KEY}
      initialWidth={248}
      minWidth={220}
      maxWidth={320}
      browser={<SettingsNavigationRail />}
      browserLabel="Settings navigation"
    >
      {children}
    </BrowserSplitLayout>
  );
}

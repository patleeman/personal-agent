import type { ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { buildRailWidthStorageKey } from '../layoutSizing';
import { BrowserSplitLayout } from './BrowserSplitLayout';
import { ListLinkRow, SectionLabel } from './ui';

const SETTINGS_BROWSER_WIDTH_STORAGE_KEY = buildRailWidthStorageKey('settings-browser');
const SETTINGS_PAGE_SEARCH_PARAM = 'page';

const SETTINGS_PAGE_ITEMS = [
  {
    id: 'defaults',
    label: 'Defaults',
    summary: 'Profile, model, cwd, and conversation title defaults.',
  },
  {
    id: 'appearance',
    label: 'Appearance',
    summary: 'Theme and other browser-local display preferences.',
  },
  {
    id: 'providers',
    label: 'Providers',
    summary: 'API keys, OAuth, and Codex plan usage.',
  },
  {
    id: 'interface',
    label: 'Interface',
    summary: 'Reset saved UI preferences and cached layout state.',
  },
  {
    id: 'workspace',
    label: 'Workspace',
    summary: 'Current repo root used by the web app runtime.',
  },
] as const;

const SETTINGS_CONTROL_CENTER_ITEMS = [
  {
    href: '/system',
    label: 'System',
    summary: 'Daemon state, sync health, and operational status.',
  },
  {
    href: '/runs',
    label: 'Runs',
    summary: 'Durable background work and recovery review.',
  },
  {
    href: '/scheduled',
    label: 'Scheduled tasks',
    summary: 'Browse cron jobs, one-time tasks, and unattended automation.',
  },
  {
    href: '/plans',
    label: 'Capabilities',
    summary: 'Todo presets and reusable automation patterns.',
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

export type SettingsPageId = (typeof SETTINGS_PAGE_ITEMS)[number]['id'];

const DEFAULT_SETTINGS_PAGE_ID: SettingsPageId = 'defaults';

export function readSettingsPageId(search: string): SettingsPageId {
  const value = new URLSearchParams(search).get(SETTINGS_PAGE_SEARCH_PARAM)?.trim();
  if (SETTINGS_PAGE_ITEMS.some((item) => item.id === value)) {
    return value as SettingsPageId;
  }

  return DEFAULT_SETTINGS_PAGE_ID;
}

export function buildSettingsHref(pageId: SettingsPageId): string {
  if (pageId === DEFAULT_SETTINGS_PAGE_ID) {
    return '/settings';
  }

  return `/settings?${SETTINGS_PAGE_SEARCH_PARAM}=${encodeURIComponent(pageId)}`;
}

function matchesSettingsRoute(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function SettingsNavigationRail() {
  const location = useLocation();
  const activePageId = location.pathname === '/settings' ? readSettingsPageId(location.search) : null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 space-y-1 border-b border-border-subtle px-4 py-4">
        <p className="ui-card-title">Settings</p>
        <p className="ui-card-meta">Navigate between settings pages and related control-center views.</p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 space-y-6">
        <div className="space-y-px">
          <SectionLabel label="Preferences" className="px-2 pb-1" />
          {SETTINGS_PAGE_ITEMS.map((page) => (
            <ListLinkRow
              key={page.id}
              to={buildSettingsHref(page.id)}
              selected={location.pathname === '/settings' && page.id === activePageId}
            >
              <p className="ui-row-title">{page.label}</p>
              <p className="ui-row-summary">{page.summary}</p>
            </ListLinkRow>
          ))}
        </div>

        <div className="space-y-px border-t border-border-subtle pt-4">
          <SectionLabel label="Control center" className="px-2 pb-1" />
          {SETTINGS_CONTROL_CENTER_ITEMS.map((item) => (
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

import type { ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { buildRailWidthStorageKey } from '../layoutSizing';
import { BrowserSplitLayout } from './BrowserSplitLayout';
import { ListLinkRow, SectionLabel } from './ui';

const SETTINGS_BROWSER_WIDTH_STORAGE_KEY = buildRailWidthStorageKey('settings-browser');
const SETTINGS_PAGE_SEARCH_PARAM = 'page';

export const SETTINGS_PAGE_ITEMS = [
  {
    id: 'defaults',
    navSection: 'preferences',
    label: 'Defaults',
    summary: 'Profile, model, cwd, and conversation title defaults.',
  },
  {
    id: 'appearance',
    navSection: 'preferences',
    label: 'Appearance',
    summary: 'Theme and other browser-local display preferences.',
  },
  {
    id: 'providers',
    navSection: 'preferences',
    label: 'Providers',
    summary: 'Custom providers, models, API keys, OAuth, and Codex plan usage.',
  },
  {
    id: 'interface',
    navSection: 'preferences',
    label: 'Interface',
    summary: 'Reset saved UI preferences and cached layout state.',
  },
  {
    id: 'workspace',
    navSection: 'preferences',
    label: 'Workspace',
    summary: 'Current repo root used by the web app runtime.',
  },
  {
    id: 'system',
    navSection: 'control-center',
    label: 'System',
    summary: 'Overview, health, and global operational controls.',
  },
  {
    id: 'system-web-ui',
    navSection: 'control-center',
    nested: true,
    label: 'Web UI',
    summary: 'Releases, desktop access, companion transport, and pairing.',
  },
  {
    id: 'system-daemon',
    navSection: 'control-center',
    nested: true,
    label: 'Daemon',
    summary: 'Runtime queue, module state, restart control, and logs.',
  },
  {
    id: 'system-sync',
    navSection: 'control-center',
    nested: true,
    label: 'Sync',
    summary: 'Repo tracking, sync warnings, manual runs, and logs.',
  },
] as const;

const SETTINGS_CONTROL_CENTER_ITEMS = [
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
    label: 'Reminder Presets',
    summary: 'Reusable reminder presets and default automation stacks.',
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

export function getSettingsPage(pageId: SettingsPageId) {
  return SETTINGS_PAGE_ITEMS.find((page) => page.id === pageId) ?? SETTINGS_PAGE_ITEMS[0];
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
  const preferencePages = SETTINGS_PAGE_ITEMS.filter((page) => page.navSection === 'preferences');
  const controlCenterPages = SETTINGS_PAGE_ITEMS.filter((page) => page.navSection === 'control-center');

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 space-y-1 border-b border-border-subtle px-4 py-4">
        <p className="ui-card-title">Settings</p>
        <p className="ui-card-meta">Navigate between stable preferences and control-center views.</p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto space-y-6 px-4 py-4">
        <div className="space-y-px">
          <SectionLabel label="Preferences" className="px-2 pb-1" />
          {preferencePages.map((page) => (
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
          {controlCenterPages.map((page) => (
            <ListLinkRow
              key={page.id}
              to={buildSettingsHref(page.id)}
              selected={location.pathname === '/settings' && page.id === activePageId}
              className={page.nested ? 'ml-3' : undefined}
            >
              <p className="ui-row-title">{page.label}</p>
              <p className="ui-row-summary">{page.summary}</p>
            </ListLinkRow>
          ))}
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

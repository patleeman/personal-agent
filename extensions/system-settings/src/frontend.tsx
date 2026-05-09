import { useEffect } from 'react';

import { SettingsPage } from './SettingsPage';

type SettingsSectionId = 'settings-providers' | 'settings-desktop' | 'settings-keyboard';

function SettingsSectionPage({ sectionIds }: { sectionIds: SettingsSectionId[] }) {
  useEffect(() => {
    window.requestAnimationFrame(() => document.getElementById(sectionIds[0])?.scrollIntoView({ block: 'start' }));
  }, [sectionIds]);

  return <SettingsPage sectionIds={sectionIds} />;
}

export { SettingsPage };

export function ProviderSettingsPage() {
  return <SettingsSectionPage sectionIds={['settings-providers']} />;
}

export function DesktopSettingsPage() {
  return <SettingsSectionPage sectionIds={['settings-desktop', 'settings-keyboard']} />;
}

import { useEffect } from 'react';

import { SettingsPage } from '../../../packages/desktop/ui/src/pages/SettingsPage';

type SettingsSectionId = 'settings-providers' | 'settings-dictation' | 'settings-desktop' | 'settings-keyboard';

function SettingsSectionPage({ sectionIds }: { sectionIds: SettingsSectionId[] }) {
  useEffect(() => {
    window.requestAnimationFrame(() => document.getElementById(sectionIds[0])?.scrollIntoView({ block: 'start' }));
  }, [sectionIds]);

  return <SettingsPage sectionIds={sectionIds} />;
}

export function ProviderSettingsPage() {
  return <SettingsSectionPage sectionIds={['settings-providers']} />;
}

export function DictationSettingsPage() {
  return <SettingsSectionPage sectionIds={['settings-dictation']} />;
}

export function DesktopSettingsPage() {
  return <SettingsSectionPage sectionIds={['settings-desktop', 'settings-keyboard']} />;
}

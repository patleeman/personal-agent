import { useEffect } from 'react';

import { SettingsPage } from '../../../packages/desktop/ui/src/pages/SettingsPage';

function SettingsSectionPage({ sectionId }: { sectionId: string }) {
  useEffect(() => {
    window.requestAnimationFrame(() => document.getElementById(sectionId)?.scrollIntoView({ block: 'start' }));
  }, [sectionId]);

  return <SettingsPage />;
}

export function ProviderSettingsPage() {
  return <SettingsSectionPage sectionId="settings-providers" />;
}

export function DictationSettingsPage() {
  return <SettingsSectionPage sectionId="settings-dictation" />;
}

export function DesktopSettingsPage() {
  return <SettingsSectionPage sectionId="settings-desktop" />;
}

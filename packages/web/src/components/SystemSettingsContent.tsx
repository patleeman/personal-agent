import { isDesktopShell } from '../desktopBridge';
import type { SystemComponentId } from '../systemSelection';
import { SystemServiceSection } from './SystemContextPanel';
import { SectionLabel } from './ui';

export function SystemSettingsContent({ componentId: _componentId }: { componentId?: SystemComponentId }) {
  const desktopShell = isDesktopShell();

  if (desktopShell) {
    return (
      <div className="space-y-6">
        <div className="space-y-1">
          <SectionLabel label="Local runtime" />
          <p className="ui-card-meta max-w-3xl">
            The menu bar app keeps the local runtime warm while it stays open.
          </p>
        </div>

        <div className="rounded-2xl border border-border-subtle bg-surface px-5 py-5 shadow-sm space-y-3">
          <div className="space-y-1">
            <h3 className="text-[15px] font-medium text-primary">Desktop-owned background runtime</h3>
            <p className="text-[13px] leading-6 text-secondary">
              Personal Agent now treats the Electron app as the local Mac product surface. Keep the menu bar app running for background work instead of managing separate launchd or systemd services.
            </p>
          </div>
          <p className="ui-card-meta">
            The local daemon and web runtime stay internal to the desktop shell here, so separate service controls are hidden from this page.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <SectionLabel label="Runtime services" />
        <p className="ui-card-meta max-w-3xl">
          Web UI and daemon status, logs, and companion transport settings stay inline here.
        </p>
      </div>

      <div className="space-y-6">
        <SystemServiceSection componentId="web-ui" id="settings-system-web-ui" />
        <SystemServiceSection componentId="daemon" id="settings-system-daemon" />
      </div>
    </div>
  );
}

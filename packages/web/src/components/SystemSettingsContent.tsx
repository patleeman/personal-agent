import type { SystemComponentId } from '../systemSelection';
import { SystemServiceSection } from './SystemContextPanel';
import { SectionLabel } from './ui';

export function SystemSettingsContent({ componentId: _componentId }: { componentId?: SystemComponentId }) {
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <SectionLabel label="Runtime services" />
        <p className="ui-card-meta max-w-3xl">
          Web UI and daemon status, restart controls, logs, and companion transport settings stay inline here.
        </p>
      </div>

      <div className="space-y-6">
        <SystemServiceSection componentId="web-ui" id="settings-system-web-ui" />
        <SystemServiceSection componentId="daemon" id="settings-system-daemon" />
      </div>
    </div>
  );
}

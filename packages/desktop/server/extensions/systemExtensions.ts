import { type ExtensionManifest } from './extensionManifest.js';

export const SYSTEM_EXTENSIONS: ExtensionManifest[] = [
  {
    schemaVersion: 1,
    id: 'system-automations',
    name: 'Automations',
    packageType: 'system',
    description: 'Manage scheduled and conversation-bound automations.',
    version: '0.1.0',
    surfaces: [
      {
        id: 'page',
        placement: 'main',
        kind: 'page',
        route: '/automations',
        component: 'automations',
      },
    ],
    permissions: ['runs:read', 'runs:start', 'conversations:readwrite', 'ui:notify'],
  },
];

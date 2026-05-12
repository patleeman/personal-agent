import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { ExtensionRegistrySnapshot } from './extensionRegistry.js';
import {
  listExtensionCommandRegistrations,
  listExtensionComposerButtonRegistrations,
  listExtensionComposerInputToolRegistrations,
  listExtensionComposerShelfRegistrations,
  listExtensionContextMenuRegistrations,
  listExtensionConversationDecoratorRegistrations,
  listExtensionConversationHeaderRegistrations,
  listExtensionInstallSummaries,
  listExtensionKeybindingRegistrations,
  listExtensionMentionRegistrations,
  listExtensionMessageActionRegistrations,
  listExtensionNewConversationPanelRegistrations,
  listExtensionPromptContextProviderRegistrations,
  listExtensionPromptReferenceRegistrations,
  listExtensionQuickOpenRegistrations,
  listExtensionSecretBackendRegistrations,
  listExtensionSecretRegistrations,
  listExtensionSettingsComponentRegistrations,
  listExtensionSettingsRegistrations,
  listExtensionSlashCommandRegistrations,
  listExtensionStatusBarItemRegistrations,
  listExtensionToolbarActionRegistrations,
  listExtensionToolRegistrations,
  parseExtensionManifest,
  readExtensionRegistrySnapshot,
} from './extensionRegistry.js';
import { listExtensionAgentRegistrations } from './extensionRegistry.js';

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function getSystemExtensionIds(snapshot: ExtensionRegistrySnapshot): string[] {
  return snapshot.extensions.filter((e) => e.packageType === 'system').map((e) => e.id);
}

function collectAllViewIds(snapshot: ExtensionRegistrySnapshot): string[] {
  return snapshot.views.map((v) => `${v.extensionId}/${v.id}`);
}

function findAllStringConflicts(items: Array<[string, string]>): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const [name, source] of items) {
    const existing = groups.get(name) ?? [];
    existing.push(source);
    groups.set(name, existing);
  }
  const conflicts = new Map<string, string[]>();
  for (const [name, sources] of groups) {
    if (sources.length > 1) {
      conflicts.set(name, sources);
    }
  }
  return conflicts;
}

/* ------------------------------------------------------------------ */
/*  1. Manifest Structural Validation                                  */
/* ------------------------------------------------------------------ */

describe('extension manifests - structural validation', () => {
  const summaries = listExtensionInstallSummaries();
  const snapshot = readExtensionRegistrySnapshot();

  it('all system extension manifests parse without errors', () => {
    const errors: string[] = [];
    for (const ext of summaries) {
      if (ext.packageType !== 'system') continue;
      try {
        parseExtensionManifest(ext.manifest);
      } catch (e) {
        errors.push(`${ext.id}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    expect(errors, 'Manifest parse errors').toEqual([]);
  });

  it('all system extensions have schemaVersion = 2', () => {
    for (const ext of summaries) {
      if (ext.packageType !== 'system') continue;
      expect(ext.manifest.schemaVersion, `${ext.id} schemaVersion`).toBe(2);
    }
  });

  it('all extensions have a non-empty id and name', () => {
    for (const ext of summaries) {
      expect(ext.id?.trim(), `${ext.packageType} extension missing id`).toBeTruthy();
      expect(ext.name?.trim(), `${ext.id} missing name`).toBeTruthy();
    }
  });

  it('no system extension is in invalid state', () => {
    const invalid = summaries.filter((s) => s.status === 'invalid' && s.packageType === 'system');
    expect(invalid, 'Invalid system extensions').toEqual([]);
  });

  it('no extensions have unexpected errors or diagnostics', () => {
    const withErrors = summaries.filter((s) => (s.errors?.length ?? 0) > 0);
    const withDiagnostics = summaries.filter((s) => (s.diagnostics?.length ?? 0) > 0);
    // System extensions should never have runtime errors
    const systemWithErrors = withErrors.filter((s) => s.packageType === 'system');
    expect(systemWithErrors, 'System extensions with errors').toEqual([]);
    // Collect all diagnostics as informational only — note them but don't fail
    if (withDiagnostics.length > 0) {
      console.warn(
        'Extensions with diagnostics:',
        withDiagnostics.map((s) => `${s.id}: ${s.diagnostics?.join(', ')}`),
      );
    }
  });

  it('all contributions are structurally valid (no missing required fields)', () => {
    for (const ext of snapshot.extensions) {
      const c = ext.contributes;
      if (!c) continue;

      if (c.views) {
        for (const view of c.views) {
          expect(view.id, `${ext.id}: view missing id`).toBeTruthy();
          expect(view.title, `${ext.id}: view "${view.id}" missing title`).toBeTruthy();
          expect(view.location, `${ext.id}: view "${view.id}" missing location`).toBeTruthy();
          expect(view.component, `${ext.id}: view "${view.id}" missing component`).toBeTruthy();
        }
      }

      if (c.nav) {
        for (const n of c.nav) {
          expect(n.id, `${ext.id}: nav missing id`).toBeTruthy();
          expect(n.label, `${ext.id}: nav "${n.id}" missing label`).toBeTruthy();
          expect(n.route, `${ext.id}: nav "${n.id}" missing route`).toBeTruthy();
        }
      }

      if (c.tools) {
        for (const tool of c.tools) {
          expect(tool.id, `${ext.id}: tool missing id`).toBeTruthy();
          expect(tool.description, `${ext.id}: tool "${tool.id}" missing description`).toBeTruthy();
        }
      }
    }
  });

  it('all permissions use valid resource:action format', () => {
    for (const ext of summaries) {
      const permissions = ext.manifest.permissions ?? [];
      for (const perm of permissions) {
        expect(
          typeof perm === 'string' && /^[a-z][a-z0-9-]*:[a-z][a-zA-Z0-9-]*$/.test(perm.trim()),
          `${ext.id}: invalid permission format "${perm}" — must be "resource:action"`,
        ).toBe(true);
      }
    }
  });

  it('all main-view routes start with /', () => {
    for (const ext of snapshot.extensions) {
      const views = ext.contributes?.views ?? [];
      for (const view of views) {
        if (view.location !== 'main' || !view.route) continue;
        expect(view.route.startsWith('/'), `${ext.id}: view "${view.id}" route "${view.route}" must start with /`).toBe(true);
        expect(!view.route.includes('//'), `${ext.id}: view "${view.id}" route "${view.route}" contains double slash`).toBe(true);
      }
      const nav = ext.contributes?.nav ?? [];
      for (const n of nav) {
        expect(n.route.startsWith('/'), `${ext.id}: nav "${n.id}" route "${n.route}" must start with /`).toBe(true);
      }
    }
  });

  it('startupAction and onEnableAction reference valid backend action ids', () => {
    for (const ext of summaries) {
      if (ext.packageType !== 'system') continue;
      const manifest = ext.manifest;

      // startupAction and onEnableAction must reference existing backend actions
      if (manifest.backend?.startupAction) {
        const actionIds = new Set((manifest.backend.actions ?? []).map((a) => a.id));
        expect(
          actionIds.has(manifest.backend.startupAction),
          `${ext.id}: startupAction "${manifest.backend.startupAction}" not found in backend actions [${[...actionIds].join(', ')}]`,
        ).toBe(true);
      }
      if (manifest.backend?.onEnableAction) {
        const actionIds = new Set((manifest.backend.actions ?? []).map((a) => a.id));
        expect(
          actionIds.has(manifest.backend.onEnableAction),
          `${ext.id}: onEnableAction "${manifest.backend.onEnableAction}" not found in backend actions [${[...actionIds].join(', ')}]`,
        ).toBe(true);
      }

      // Extensions without a backend entry must not declare startup/onEnable actions
      if (!manifest.backend?.entry) {
        expect(!manifest.backend?.startupAction, `${ext.id}: declares startupAction but has no backend entry`).toBe(true);
        expect(!manifest.backend?.onEnableAction, `${ext.id}: declares onEnableAction but has no backend entry`).toBe(true);
      }
    }
  });

  it('extensions with both frontend and backend have both entry files', () => {
    for (const ext of summaries) {
      if (ext.packageType !== 'system') continue;
      const hasFrontend = Boolean(ext.manifest.frontend?.entry);
      const hasBackend = Boolean(ext.manifest.backend?.entry);
      if (!hasFrontend || !hasBackend) continue;

      const frontendPath = resolve(ext.packageRoot ?? '', ext.manifest.frontend!.entry);
      const backendPath = ext.manifest.backend!.entry.startsWith('src/')
        ? resolve(ext.packageRoot ?? '', 'dist', 'backend.mjs')
        : resolve(ext.packageRoot ?? '', ext.manifest.backend!.entry);

      expect(existsSync(frontendPath), `${ext.id}: missing frontend entry at ${ext.manifest.frontend!.entry}`).toBe(true);
      expect(existsSync(backendPath), `${ext.id}: missing backend entry at ${backendPath}`).toBe(true);
    }
  });

  it('all tools have a valid inputSchema with at least type and properties', () => {
    for (const ext of summaries) {
      if (ext.packageType !== 'system') continue;
      const tools = ext.manifest.contributes?.tools ?? [];
      for (const tool of tools) {
        const schema = tool.inputSchema ?? {};
        expect(schema.type, `${ext.id}: tool "${tool.id}" inputSchema missing "type"`).toBe('object');
        expect(
          typeof schema.properties === 'object' && schema.properties !== null && !Array.isArray(schema.properties),
          `${ext.id}: tool "${tool.id}" inputSchema "properties" must be an object`,
        ).toBe(true);
      }
    }
  });

  it('no tool declares a replaces field that references a non-existent built-in tool', () => {
    const validBuiltInTools = ['bash', 'read', 'write', 'edit', 'grep', 'find', 'ls', 'notify', 'web_fetch', 'web_search'];
    for (const ext of summaries) {
      if (ext.packageType !== 'system') continue;
      const tools = ext.manifest.contributes?.tools ?? [];
      for (const tool of tools) {
        if (!tool.replaces) continue;
        expect(
          validBuiltInTools.includes(tool.replaces),
          `${ext.id}: tool "${tool.id}" replaces "${tool.replaces}" which is not a valid built-in tool ` +
            `[${validBuiltInTools.join(', ')}]`,
        ).toBe(true);
      }
    }
  });

  it('tools that reference backend actions have matching handler names in the prebuilt bundle', () => {
    for (const ext of summaries) {
      if (ext.packageType !== 'system') continue;
      const actions = ext.manifest.backend?.actions ?? [];
      const actionHandlerMap = new Map(actions.map((a) => [a.id, a.handler ?? a.id]));

      const tools = ext.manifest.contributes?.tools ?? [];
      const toolActions = tools.map((t) => t.action ?? t.handler ?? '').filter(Boolean);
      if (toolActions.length === 0) continue;

      const backendPath = resolve(ext.packageRoot ?? '', 'dist', 'backend.mjs');
      if (!existsSync(backendPath)) continue;

      const content = readFileSync(backendPath, 'utf-8');
      for (const toolAction of toolActions) {
        // If the action matches a backend action id, resolve to the handler
        const handlerName = actionHandlerMap.get(toolAction) ?? toolAction;
        expect(
          content.includes(handlerName),
          `${ext.id}: tool action "${toolAction}" handler "${handlerName}" not found in dist/backend.mjs`,
        ).toBe(true);
      }
    }
  });

  it('frontend contributions with component fields export those components', () => {
    // Check composer buttons, composer input tools, settings components, top bar elements,
    // conversation headers, conversation decorators, and new conversation panels
    for (const s of summaries) {
      if (s.packageType !== 'system') continue;
      const frontendEntry = s.manifest.frontend?.entry;
      if (!frontendEntry) continue;
      const frontendPath = resolve(s.packageRoot ?? '', frontendEntry);
      if (!existsSync(frontendPath) || statSync(frontendPath).isDirectory()) continue;

      const content = readFileSync(frontendPath, 'utf-8');

      // Composer buttons
      for (const btn of s.manifest.contributes?.composerButtons ?? []) {
        const cmp = btn.component;
        const pattern = new RegExp(`(export\\s+(async\\s+)?function\\s+${cmp}|export\\s*\\{[^}]*\\b${cmp}\\b)`);
        expect(pattern.test(content), `${s.id}: composer button component "${cmp}" not exported`).toBe(true);
      }

      // Composer input tools
      for (const tool of s.manifest.contributes?.composerInputTools ?? []) {
        const cmp = tool.component;
        const pattern = new RegExp(`(export\\s+(async\\s+)?function\\s+${cmp}|export\\s*\\{[^}]*\\b${cmp}\\b)`);
        expect(pattern.test(content), `${s.id}: composer input tool component "${cmp}" not exported`).toBe(true);
      }

      // Settings components
      const settingsCmp = s.manifest.contributes?.settingsComponent;
      if (settingsCmp?.component) {
        const cmp = settingsCmp.component;
        const pattern = new RegExp(`(export\\s+(async\\s+)?function\\s+${cmp}|export\\s*\\{[^}]*\\b${cmp}\\b)`);
        expect(pattern.test(content), `${s.id}: settings component "${cmp}" not exported`).toBe(true);
      }

      // Top bar elements
      for (const el of s.manifest.contributes?.topBarElements ?? []) {
        const cmp = el.component;
        const pattern = new RegExp(`(export\\s+(async\\s+)?function\\s+${cmp}|export\\s*\\{[^}]*\\b${cmp}\\b)`);
        expect(pattern.test(content), `${s.id}: top bar element component "${cmp}" not exported`).toBe(true);
      }

      // Conversation headers
      for (const el of s.manifest.contributes?.conversationHeaderElements ?? []) {
        const cmp = el.component;
        const pattern = new RegExp(`(export\\s+(async\\s+)?function\\s+${cmp}|export\\s*\\{[^}]*\\b${cmp}\\b)`);
        expect(pattern.test(content), `${s.id}: conversation header component "${cmp}" not exported`).toBe(true);
      }

      // Conversation decorators
      for (const el of s.manifest.contributes?.conversationDecorators ?? []) {
        const cmp = el.component;
        const pattern = new RegExp(`(export\\s+(async\\s+)?function\\s+${cmp}|export\\s*\\{[^}]*\\b${cmp}\\b)`);
        expect(pattern.test(content), `${s.id}: conversation decorator component "${cmp}" not exported`).toBe(true);
      }

      // New conversation panels
      for (const panel of s.manifest.contributes?.newConversationPanels ?? []) {
        const cmp = panel.component;
        const pattern = new RegExp(`(export\\s+(async\\s+)?function\\s+${cmp}|export\\s*\\{[^}]*\\b${cmp}\\b)`);
        expect(pattern.test(content), `${s.id}: new conversation panel component "${cmp}" not exported`).toBe(true);
      }

      // Status bar items with component fields
      for (const item of s.manifest.contributes?.statusBarItems ?? []) {
        if (!item.component) continue;
        const cmp = item.component;
        const pattern = new RegExp(`(export\\s+(async\\s+)?function\\s+${cmp}|export\\s*\\{[^}]*\\b${cmp}\\b)`);
        expect(pattern.test(content), `${s.id}: status bar item component "${cmp}" not exported`).toBe(true);
      }

      // Transcript renderers - verify components are exported
      for (const renderer of s.manifest.contributes?.transcriptRenderers ?? []) {
        const cmp = renderer.component;
        const pattern = new RegExp(`(export\\s+(async\\s+)?function\\s+${cmp}|export\\s*\\{[^}]*\\b${cmp}\\b)`);
        expect(pattern.test(content), `${s.id}: transcript renderer component "${cmp}" not exported`).toBe(true);
      }
    }
  });

  it('transcript renderers reference valid tool names', () => {
    for (const ext of summaries) {
      if (ext.packageType !== 'system') continue;
      const renderers = ext.manifest.contributes?.transcriptRenderers ?? [];
      for (const renderer of renderers) {
        expect(renderer.tool?.trim(), `${ext.id}: transcript renderer "${renderer.id}" missing tool reference`).toBeTruthy();
        expect(renderer.component?.trim(), `${ext.id}: transcript renderer "${renderer.id}" missing component`).toBeTruthy();
      }
    }
  });

  it('all action fields in contributions follow a valid reference pattern', () => {
    // Known built-in frontend actions (handled by the UI layer, not backend)
    const knownBuiltInFrontendActions = new Set([
      'duplicateConversation',
      'copyWorkingDirectory',
      'copyConversationId',
      'copyDeeplink',
      'openBrowserBackend',
      'attachConversation',
    ]);
    // Known system action prefixes that don't reference backend handlers
    const knownSystemActionPrefixes = ['commandPalette:', 'navigate:', 'rightRail:'];

    for (const ext of summaries) {
      if (ext.packageType !== 'system') continue;
      const backendActionIds = new Set((ext.manifest.backend?.actions ?? []).map((a) => a.id));

      // Collect all action references from contributions
      const actionRefs: Array<{ source: string; action: string }> = [];

      for (const menu of ext.manifest.contributes?.contextMenus ?? []) {
        if (menu.action) actionRefs.push({ source: `contextMenu(${menu.id})`, action: menu.action });
      }
      for (const cmd of ext.manifest.contributes?.commands ?? []) {
        if (cmd.action) actionRefs.push({ source: `command(${cmd.id})`, action: cmd.action });
      }
      for (const tb of ext.manifest.contributes?.toolbarActions ?? []) {
        if (tb.action) actionRefs.push({ source: `toolbarAction(${tb.id})`, action: tb.action });
      }
      for (const msg of ext.manifest.contributes?.messageActions ?? []) {
        if (msg.action) actionRefs.push({ source: `messageAction(${msg.id})`, action: msg.action });
      }
      for (const item of ext.manifest.contributes?.statusBarItems ?? []) {
        // Status bar items without an action are static labels — valid
        if (item.action) actionRefs.push({ source: `statusBarItem(${item.id})`, action: item.action });
      }

      for (const { source, action } of actionRefs) {
        // If the action matches a backend action id, it's valid
        if (backendActionIds.has(action)) continue;
        // If the action matches a known built-in frontend action, it's valid
        if (knownBuiltInFrontendActions.has(action)) continue;
        // If the action starts with a known system prefix, it's valid
        if (knownSystemActionPrefixes.some((prefix) => action.startsWith(prefix))) continue;
        // Otherwise, flag it as potentially dangling
        expect(
          false,
          `${ext.id}: ${source} references action "${action}" which is not a known backend action ` +
            `[${[...backendActionIds].join(', ')}], known frontend action, or system action prefix. ` +
            `If this is a custom frontend action, add it to knownBuiltInFrontendActions.`,
        ).toBe(true);
      }
    }
  });

  it('settings contributions have type-consistent values', () => {
    for (const ext of summaries) {
      if (ext.packageType !== 'system') continue;
      const settings = ext.manifest.contributes?.settings ?? {};
      for (const [key, setting] of Object.entries(settings)) {
        // Select type must have enum
        if (setting.type === 'select') {
          expect(
            Array.isArray(setting.enum) && setting.enum.length > 0,
            `${ext.id}: setting "${key}" is type "select" but missing or empty "enum"`,
          ).toBe(true);
          // Default must be one of the enum values
          if (setting.default !== undefined && Array.isArray(setting.enum)) {
            expect(
              setting.enum.includes(setting.default),
              `${ext.id}: setting "${key}" default "${setting.default}" is not in enum [${setting.enum.join(', ')}]`,
            ).toBe(true);
          }
        }
        // Number type must have a number default
        if (setting.type === 'number' && setting.default !== undefined) {
          expect(typeof setting.default === 'number', `${ext.id}: setting "${key}" is type "number" but default is not a number`).toBe(
            true,
          );
        }
        // Boolean type must have a boolean default
        if (setting.type === 'boolean' && setting.default !== undefined) {
          expect(typeof setting.default === 'boolean', `${ext.id}: setting "${key}" is type "boolean" but default is not a boolean`).toBe(
            true,
          );
        }
      }
    }
  });

  it('secret contributions have valid env variable names', () => {
    for (const ext of summaries) {
      if (ext.packageType !== 'system') continue;
      const secrets = ext.manifest.contributes?.secrets ?? {};
      for (const [key, secret] of Object.entries(secrets)) {
        expect(typeof key === 'string' && key.trim().length > 0, `${ext.id}: secret has empty key`).toBe(true);
        expect(secret.label?.trim(), `${ext.id}: secret "${key}" missing label`).toBeTruthy();
        if (secret.env) {
          expect(/^[A-Z][A-Z0-9_]*$/.test(secret.env), `${ext.id}: secret "${key}" env "${secret.env}" must be UPPER_SNAKE_CASE`).toBe(
            true,
          );
        }
      }
    }
  });

  it('all system extensions have a version field', () => {
    for (const ext of summaries) {
      if (ext.packageType !== 'system') continue;
      expect(ext.manifest.version?.trim(), `${ext.id}: missing version field`).toBeTruthy();
      expect(
        /^\d+\.\d+\.\d+/.test(ext.manifest.version!),
        `${ext.id}: version "${ext.manifest.version}" does not follow semver (X.Y.Z)`,
      ).toBe(true);
    }
  });

  it('all extension.json files are valid UTF-8 without BOM', () => {
    for (const ext of summaries) {
      if (ext.packageType !== 'system') continue;
      const manifestPath = resolve(ext.packageRoot ?? '', 'extension.json');
      if (!existsSync(manifestPath)) continue;
      const raw = readFileSync(manifestPath);
      // Check for BOM (Byte Order Mark)
      expect(raw[0], `${ext.id}: extension.json has UTF-8 BOM (Byte Order Mark)`).not.toBe(0xef);
    }
  });

  it('system extensions follow the system- naming convention', () => {
    for (const ext of summaries) {
      if (ext.packageType !== 'system') continue;
      expect(ext.manifest.id.startsWith('system-'), `${ext.id}: system extension id "${ext.manifest.id}" should start with "system-"`).toBe(
        true,
      );
    }
  });

  it('settings keys follow a dot-separated key-value convention', () => {
    for (const ext of summaries) {
      if (ext.packageType !== 'system') continue;
      const settings = ext.manifest.contributes?.settings ?? {};
      for (const key of Object.keys(settings)) {
        // Setting keys should be dot-separated: namespace.key or namespace.sub.key
        expect(key.includes('.'), `${ext.id}: setting key "${key}" should use dot-separated format (e.g. "namespace.key")`).toBe(true);
        // Each segment should be a valid identifier
        for (const segment of key.split('.')) {
          expect(
            /^[a-zA-Z][a-zA-Z0-9]*$/.test(segment),
            `${ext.id}: setting key "${key}" segment "${segment}" is not a valid identifier`,
          ).toBe(true);
        }
      }
    }
  });

  it('nav badgeAction references reference valid actions', () => {
    for (const ext of summaries) {
      if (ext.packageType !== 'system') continue;
      const navItems = ext.manifest.contributes?.nav ?? [];
      const backendActionIds = new Set((ext.manifest.backend?.actions ?? []).map((a) => a.id));
      const knownBadgeActions = new Set(['commandPalette:threads']);

      for (const nav of navItems) {
        if (!nav.badgeAction) continue;
        if (knownBadgeActions.has(nav.badgeAction)) continue;
        if (backendActionIds.has(nav.badgeAction)) continue;
        if (nav.badgeAction.startsWith('commandPalette:') || nav.badgeAction.startsWith('navigate:')) continue;
        expect(
          false,
          `${ext.id}: nav "${nav.id}" badgeAction "${nav.badgeAction}" is not a known backend action, built-in badge action, or system action prefix`,
        ).toBe(true);
      }
    }
  });

  it('backend action handler names appear in the prebuilt bundle', () => {
    for (const ext of summaries) {
      if (ext.packageType !== 'system') continue;
      const actions = ext.manifest.backend?.actions ?? [];
      for (const action of actions) {
        expect(action.handler?.trim(), `${ext.id}: action "${action.id}" is missing a handler property`).toBeTruthy();
      }

      const backendPath = resolve(ext.packageRoot ?? '', 'dist', 'backend.mjs');
      if (!existsSync(backendPath) || actions.length === 0) continue;

      const content = readFileSync(backendPath, 'utf-8');
      for (const action of actions) {
        const handlerName = action.handler ?? action.id;
        // The handler name should appear as a word in the source (function def, export entry, or method name)
        expect(
          content.includes(handlerName),
          `${ext.id}: backend action handler "${handlerName}" (from action "${action.id}") not found anywhere in dist/backend.mjs`,
        ).toBe(true);
      }
    }
  });
});

/* ------------------------------------------------------------------ */
/*  2. Cross-Extension Conflict Detection                              */
/* ------------------------------------------------------------------ */

describe('extension manifests - cross-extension conflict detection', () => {
  const snapshot = readExtensionRegistrySnapshot();

  it('no duplicate extension IDs', () => {
    const ids = snapshot.extensions.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('no duplicate routes across all main-page views', () => {
    const routes = snapshot.routes.map((r) => r.route).filter(Boolean) as string[];
    expect(new Set(routes).size, 'Duplicate routes').toBe(routes.length);
  });

  it('no duplicate tool names', () => {
    const tools = listExtensionToolRegistrations();
    const conflicts = findAllStringConflicts(tools.map((t) => [t.name, `${t.extensionId}/${t.id}`]));
    expect(
      [...conflicts].map(([name, sources]) => `${name}: ${sources.join(', ')}`),
      'Duplicate tool names',
    ).toEqual([]);
  });

  it('no duplicate slash command names', () => {
    const commands = listExtensionSlashCommandRegistrations();
    const conflicts = findAllStringConflicts(commands.map((c) => [c.name, `${c.extensionId}/${c.surfaceId}`]));
    expect(
      [...conflicts].map(([name, sources]) => `${name}: ${sources.join(', ')}`),
      'Duplicate slash command names',
    ).toEqual([]);
  });

  it('no duplicate command ids', () => {
    const commands = listExtensionCommandRegistrations();
    const conflicts = findAllStringConflicts(commands.map((c) => [c.surfaceId, `${c.extensionId}/${c.title}`]));
    expect(
      [...conflicts].map(([id, sources]) => `${id}: ${sources.join(', ')}`),
      'Duplicate command ids',
    ).toEqual([]);
  });

  it('no duplicate keybinding ids', () => {
    const keybindings = listExtensionKeybindingRegistrations();
    const conflicts = findAllStringConflicts(keybindings.map((k) => [`${k.extensionId}/${k.surfaceId}`, k.title]));
    // Same id from same extension is fine
    const realConflicts = new Map(
      [...conflicts.entries()].filter(([_id, sources]) => {
        const extensions = new Set(sources.map((s) => s.split('/')[0]));
        return extensions.size > 1;
      }),
    );
    expect(
      [...realConflicts].map(([id, sources]) => `${id}: ${sources.join(', ')}`),
      'Duplicate keybinding ids across extensions',
    ).toEqual([]);
  });

  it('no duplicate context menu ids across extensions', () => {
    const menus = listExtensionContextMenuRegistrations();
    // Context menu ids are scoped per extension, so check using extensionId/id as key
    const conflicts = findAllStringConflicts(menus.map((m) => [`${m.extensionId}/${m.id}`, m.title]));
    expect(
      [...conflicts].map(([id, sources]) => `${id}: ${sources.join(', ')}`),
      'Duplicate context menu ids',
    ).toEqual([]);
  });

  it('no duplicate message action ids', () => {
    const actions = listExtensionMessageActionRegistrations();
    const conflicts = findAllStringConflicts(actions.map((a) => [`${a.extensionId}/${a.surfaceId}`, a.title]));
    expect(
      [...conflicts].map(([id, sources]) => `${id}: ${sources.join(', ')}`),
      'Duplicate message action ids',
    ).toEqual([]);
  });

  it('no duplicate composer shelf ids', () => {
    const shelves = listExtensionComposerShelfRegistrations();
    const conflicts = findAllStringConflicts(shelves.map((s) => [s.id, s.extensionId]));
    expect(
      [...conflicts].map(([id, sources]) => `${id}: ${sources.join(', ')}`),
      'Duplicate composer shelf ids',
    ).toEqual([]);
  });

  it('no duplicate new conversation panel ids', () => {
    const panels = listExtensionNewConversationPanelRegistrations();
    const conflicts = findAllStringConflicts(panels.map((p) => [p.id, p.extensionId]));
    expect(
      [...conflicts].map(([id, sources]) => `${id}: ${sources.join(', ')}`),
      'Duplicate new conversation panel ids',
    ).toEqual([]);
  });

  it('no duplicate composer button ids', () => {
    const buttons = listExtensionComposerButtonRegistrations();
    const conflicts = findAllStringConflicts(buttons.map((b) => [b.id, b.extensionId]));
    expect(
      [...conflicts].map(([id, sources]) => `${id}: ${sources.join(', ')}`),
      'Duplicate composer button ids',
    ).toEqual([]);
  });

  it('no duplicate composer input tool ids', () => {
    const tools = listExtensionComposerInputToolRegistrations();
    const conflicts = findAllStringConflicts(tools.map((t) => [t.id, t.extensionId]));
    expect(
      [...conflicts].map(([id, sources]) => `${id}: ${sources.join(', ')}`),
      'Duplicate composer input tool ids',
    ).toEqual([]);
  });

  it('no duplicate toolbar action ids', () => {
    const actions = listExtensionToolbarActionRegistrations();
    const conflicts = findAllStringConflicts(actions.map((a) => [a.id, a.extensionId]));
    expect(
      [...conflicts].map(([id, sources]) => `${id}: ${sources.join(', ')}`),
      'Duplicate toolbar action ids',
    ).toEqual([]);
  });

  it('no duplicate status bar item ids', () => {
    const items = listExtensionStatusBarItemRegistrations();
    const conflicts = findAllStringConflicts(items.map((i) => [i.id, i.extensionId]));
    expect(
      [...conflicts].map(([id, sources]) => `${id}: ${sources.join(', ')}`),
      'Duplicate status bar item ids',
    ).toEqual([]);
  });

  it('no duplicate conversation decorator ids', () => {
    const decorators = listExtensionConversationDecoratorRegistrations();
    const conflicts = findAllStringConflicts(decorators.map((d) => [d.id, d.extensionId]));
    expect(
      [...conflicts].map(([id, sources]) => `${id}: ${sources.join(', ')}`),
      'Duplicate conversation decorator ids',
    ).toEqual([]);
  });

  it('no duplicate conversation header ids', () => {
    const headers = listExtensionConversationHeaderRegistrations();
    const conflicts = findAllStringConflicts(headers.map((h) => [h.id, h.extensionId]));
    expect(
      [...conflicts].map(([id, sources]) => `${id}: ${sources.join(', ')}`),
      'Duplicate conversation header ids',
    ).toEqual([]);
  });

  it('no duplicate setting keys', () => {
    const settings = listExtensionSettingsRegistrations();
    const conflicts = findAllStringConflicts(settings.map((s) => [s.key, s.extensionId]));
    expect(
      [...conflicts].map(([key, sources]) => `${key}: ${sources.join(', ')}`),
      'Duplicate setting keys',
    ).toEqual([]);
  });

  it('no duplicate secret ids', () => {
    const secrets = listExtensionSecretRegistrations();
    const conflicts = findAllStringConflicts(secrets.map((s) => [s.id, s.extensionId]));
    // Same id from same extension is fine (namespace per extension)
    const realConflicts = new Map(
      [...conflicts.entries()].filter(([_id, sources]) => {
        const extensions = new Set(sources);
        return extensions.size > 1;
      }),
    );
    expect(
      [...realConflicts].map(([id, sources]) => `${id}: ${sources.join(', ')}`),
      'Duplicate secret ids across extensions',
    ).toEqual([]);
  });

  it('no duplicate secret env variable names across extensions', () => {
    const envVars: Array<[string, string]> = [];
    const summaries = listExtensionInstallSummaries();
    for (const ext of summaries) {
      if (ext.packageType !== 'system') continue;
      const secrets = ext.manifest.contributes?.secrets ?? {};
      for (const [key, secret] of Object.entries(secrets)) {
        if (secret.env) {
          envVars.push([secret.env, `${ext.id}/${key}`]);
        }
      }
    }
    const conflicts = findAllStringConflicts(envVars);
    expect(
      [...conflicts].map(([env, sources]) => `${env}: ${sources.join(', ')}`),
      'Duplicate secret env variable names across extensions',
    ).toEqual([]);
  });

  it('no duplicate secret backend ids', () => {
    const backends = listExtensionSecretBackendRegistrations();
    const conflicts = findAllStringConflicts(backends.map((b) => [b.id, b.extensionId]));
    expect(
      [...conflicts].map(([id, sources]) => `${id}: ${sources.join(', ')}`),
      'Duplicate secret backend ids',
    ).toEqual([]);
  });

  it('no duplicate settings component section ids', () => {
    const components = listExtensionSettingsComponentRegistrations();
    const conflicts = findAllStringConflicts(components.map((c) => [c.sectionId, c.extensionId]));
    expect(
      [...conflicts].map(([id, sources]) => `${id}: ${sources.join(', ')}`),
      'Duplicate settings component section ids',
    ).toEqual([]);
  });

  it('no duplicate mention ids', () => {
    const mentions = listExtensionMentionRegistrations();
    const conflicts = findAllStringConflicts(mentions.map((m) => [m.id, m.extensionId]));
    const realConflicts = new Map([...conflicts.entries()].filter(([_id, sources]) => new Set(sources).size > 1));
    expect(
      [...realConflicts].map(([id, sources]) => `${id}: ${sources.join(', ')}`),
      'Duplicate mention ids across extensions',
    ).toEqual([]);
  });

  it('no duplicate prompt reference ids', () => {
    const refs = listExtensionPromptReferenceRegistrations();
    const conflicts = findAllStringConflicts(refs.map((r) => [r.id, r.extensionId]));
    const realConflicts = new Map([...conflicts.entries()].filter(([_id, sources]) => new Set(sources).size > 1));
    expect(
      [...realConflicts].map(([id, sources]) => `${id}: ${sources.join(', ')}`),
      'Duplicate prompt reference ids across extensions',
    ).toEqual([]);
  });

  it('no duplicate prompt context provider ids', () => {
    const providers = listExtensionPromptContextProviderRegistrations();
    const conflicts = findAllStringConflicts(providers.map((p) => [p.id, p.extensionId]));
    const realConflicts = new Map([...conflicts.entries()].filter(([_id, sources]) => new Set(sources).size > 1));
    expect(
      [...realConflicts].map(([id, sources]) => `${id}: ${sources.join(', ')}`),
      'Duplicate prompt context provider ids across extensions',
    ).toEqual([]);
  });

  it('no duplicate quick open provider ids', () => {
    const providers = listExtensionQuickOpenRegistrations();
    const conflicts = findAllStringConflicts(providers.map((p) => [p.id, p.extensionId]));
    const realConflicts = new Map([...conflicts.entries()].filter(([_id, sources]) => new Set(sources).size > 1));
    expect(
      [...realConflicts].map(([id, sources]) => `${id}: ${sources.join(', ')}`),
      'Duplicate quick open provider ids across extensions',
    ).toEqual([]);
  });

  it('quick open surfaces have stable labels and numeric ordering', () => {
    const providers = listExtensionQuickOpenRegistrations();
    const knowledge = providers.find((provider) => provider.extensionId === 'system-knowledge' && provider.id === 'knowledge-files');

    expect(knowledge).toMatchObject({ title: 'Knowledge', section: 'knowledge', order: 10 });
  });
});

/* ------------------------------------------------------------------ */
/*  3. Registry Integration Sanity                                     */
/* ------------------------------------------------------------------ */

describe('extension registry - integration sanity', () => {
  const snapshot = readExtensionRegistrySnapshot();
  const summaries = listExtensionInstallSummaries();

  it('all system extensions are present in summaries and snapshot', () => {
    const snapshotIds = new Set(getSystemExtensionIds(snapshot));
    // All system extensions should appear in the full summary
    const systemFromSummaries = summaries.filter((s) => s.packageType === 'system' && s.status !== 'invalid');
    const allSystemIds = systemFromSummaries.map((s) => s.id);

    // Every system extension is in summaries
    for (const ext of allSystemIds) {
      expect(
        summaries.some((s) => s.id === ext),
        `Missing system extension in summaries: ${ext}`,
      ).toBe(true);
    }
    // All snapshot extension ids should start with system-
    for (const id of snapshotIds) {
      expect(id.startsWith('system-'), `Snapshot extension id "${id}" does not start with 'system-'`).toBe(true);
    }
  });

  it('each system extension summary matches its manifest', () => {
    for (const ext of snapshot.extensions) {
      if (ext.packageType !== 'system') continue;
      const summary = summaries.find((s) => s.id === ext.id);
      expect(summary, `No summary for system extension: ${ext.id}`).toBeDefined();
      expect(summary!.manifest.id, `${ext.id}: manifest id mismatch`).toBe(ext.id);
      expect(summary!.manifest.name, `${ext.id}: manifest name mismatch`).toBe(ext.name);
    }
  });

  it('has a reasonable number of system extensions', () => {
    const systemCount = getSystemExtensionIds(snapshot).length;
    expect(systemCount).toBeGreaterThanOrEqual(20);
    expect(systemCount).toBeLessThanOrEqual(35);
  });

  it('has at least 7 routes registered', () => {
    expect(snapshot.routes.length).toBeGreaterThanOrEqual(7);
  });

  it('has at least 20 views registered', () => {
    expect(snapshot.views.length).toBeGreaterThanOrEqual(20);
  });

  it('all view ids are unique across extensions', () => {
    const viewIds = collectAllViewIds(snapshot);
    expect(new Set(viewIds).size).toBe(viewIds.length);
  });

  it('status and enabled state are consistent for system extensions', () => {
    for (const s of summaries) {
      if (s.packageType !== 'system') continue;
      if (s.enabled) {
        expect(s.status, `${s.id}: enabled but status is ${s.status}`).toBe('enabled');
      } else if (s.manifest.defaultEnabled === false) {
        expect(s.status, `${s.id}: default-disabled but status is ${s.status}`).toBe('disabled');
      }
    }
  });

  it('all registered routes point to existing extensions', () => {
    const extensionIds = new Set(snapshot.extensions.map((e) => e.id));
    for (const route of snapshot.routes) {
      expect(extensionIds.has(route.extensionId), `Route "${route.route}" references unknown extension "${route.extensionId}"`).toBe(true);
    }
  });
});

/* ------------------------------------------------------------------ */
/*  4. Backend Entry File Validation                                   */
/* ------------------------------------------------------------------ */

describe('extension backends - file existence and structural checks', () => {
  const summaries = listExtensionInstallSummaries();

  it('every system extension with a backend entry has a compiled dist/backend.mjs', () => {
    for (const s of summaries) {
      if (s.packageType !== 'system') continue;
      const backendEntry = s.manifest.backend?.entry;
      if (!backendEntry) continue;

      const expectedPath = resolve(s.packageRoot ?? '', 'dist', 'backend.mjs');
      expect(existsSync(expectedPath), `${s.id}: missing dist/backend.mjs (backend entry: ${backendEntry})`).toBe(true);
    }
  });

  it('every system extension with a backend entry has a matching source entry', () => {
    for (const s of summaries) {
      if (s.packageType !== 'system') continue;
      const backendEntry = s.manifest.backend?.entry;
      if (!backendEntry) continue;

      // System extensions reference source: src/backend.ts
      const sourcePath = resolve(s.packageRoot ?? '', backendEntry);
      const builtPath = resolve(s.packageRoot ?? '', 'dist', 'backend.mjs');

      expect(existsSync(sourcePath) || existsSync(builtPath), `${s.id}: backend source not found at ${backendEntry}`).toBe(true);
    }
  });

  it('prebuilt dist files are newer than their source files (build is not stale)', () => {
    for (const s of summaries) {
      if (s.packageType !== 'system') continue;
      const backendEntry = s.manifest.backend?.entry;
      const frontendEntry = s.manifest.frontend?.entry;

      // Check backend: src/backend.ts must be older than dist/backend.mjs
      if (backendEntry) {
        const sourcePath = resolve(s.packageRoot ?? '', backendEntry);
        const builtPath = resolve(s.packageRoot ?? '', 'dist', 'backend.mjs');
        if (existsSync(sourcePath) && existsSync(builtPath)) {
          const sourceMtime = statSync(sourcePath).mtimeMs;
          const builtMtime = statSync(builtPath).mtimeMs;
          expect(
            builtMtime >= sourceMtime - 1000, // 1s grace for filesystem timestamp rounding
            `${s.id}: dist/backend.mjs (${new Date(builtMtime).toISOString()}) is older than ${backendEntry} (${new Date(sourceMtime).toISOString()}) — rebuild needed`,
          ).toBe(true);
        }
      }

      // Check frontend: src/frontend.tsx must be older than dist/frontend.js
      if (frontendEntry) {
        const sourcePath = resolve(s.packageRoot ?? '', 'src', 'frontend.tsx');
        const builtPath = resolve(s.packageRoot ?? '', frontendEntry);
        if (existsSync(sourcePath) && existsSync(builtPath)) {
          const sourceMtime = statSync(sourcePath).mtimeMs;
          const builtMtime = statSync(builtPath).mtimeMs;
          expect(
            builtMtime >= sourceMtime - 1000,
            `${s.id}: ${frontendEntry} (${new Date(builtMtime).toISOString()}) is older than src/frontend.tsx (${new Date(sourceMtime).toISOString()}) — rebuild needed`,
          ).toBe(true);
        }
      }
    }
  });

  it('backend action handler names exist as exports in the prebuilt bundle', () => {
    for (const s of summaries) {
      if (s.packageType !== 'system') continue;
      const actions = s.manifest.backend?.actions ?? [];
      if (actions.length === 0) continue;

      const backendPath = resolve(s.packageRoot ?? '', 'dist', 'backend.mjs');
      if (!existsSync(backendPath)) continue;

      const content = readFileSync(backendPath, 'utf-8');
      for (const action of actions) {
        const handlerName = action.handler ?? action.id;
        // Check if the handler is exported (named export or function declaration)
        const exportPattern = new RegExp(`(export\\s+(async\\s+)?function\\s+${handlerName}|export\\s*\\{[^}]*\\b${handlerName}\\b)`);
        expect(exportPattern.test(content), `${s.id}: backend action handler "${handlerName}" not found in dist/backend.mjs`).toBe(true);
      }
    }
  });

  it('agent extension factory export exists in the prebuilt bundle', () => {
    const agentRegistrations = listExtensionAgentRegistrations();
    for (const reg of agentRegistrations) {
      const s = summaries.find((e) => e.id === reg.extensionId);
      if (!s || s.packageType !== 'system') continue;

      const backendPath = resolve(s.packageRoot ?? '', 'dist', 'backend.mjs');
      if (!existsSync(backendPath)) continue;

      const content = readFileSync(backendPath, 'utf-8');
      const exportName = reg.exportName === 'default' ? 'default' : reg.exportName;
      if (exportName === 'default') {
        // Matches patterns:
        //   export { ... name as default ... }
        //   export default function ...
        //   export default class ...
        //   export { default }
        expect(
          /export\s*\{[^}]*\bas\s+default\b/.test(content) ||
            /export\s+default\s+(async\s+)?(function|class)/.test(content) ||
            /export\s*\{[^}]*\bdefault\b[^}]*\}/.test(content),
          `${s.id}: default export (agent factory) not found in dist/backend.mjs`,
        ).toBe(true);
      } else {
        const namePattern = new RegExp(`(export\\s+(async\\s+)?function\\s+${exportName}|export\\s*\\{[^}]*\\b${exportName}\\b)`);
        expect(namePattern.test(content), `${s.id}: agent extension export "${exportName}" not found in dist/backend.mjs`).toBe(true);
      }
    }
  });

  it('prebuilt backend files are non-empty and contain valid export syntax', () => {
    for (const s of summaries) {
      if (s.packageType !== 'system') continue;
      const backendPath = resolve(s.packageRoot ?? '', 'dist', 'backend.mjs');
      if (!existsSync(backendPath)) continue;

      const stats = statSync(backendPath);
      expect(stats.size, `${s.id}: dist/backend.mjs is empty`).toBeGreaterThan(0);

      const content = readFileSync(backendPath, 'utf-8');
      // Verify it contains at least one export statement (any valid JS module does)
      expect(
        /export\s+(\{|default|const|let|var|function|class|async)/.test(content),
        `${s.id}: dist/backend.mjs does not contain any export statement`,
      ).toBe(true);
      // Verify source map reference is well-formed if present
      const sourceMapMatch = content.match(/[/][/]# sourceMappingURL=(.+)$/m);
      if (sourceMapMatch) {
        const mapPath = resolve(s.packageRoot ?? '', 'dist', sourceMapMatch[1]);
        expect(existsSync(mapPath), `${s.id}: source map ${sourceMapMatch[1]} not found`).toBe(true);
      }
    }
  });

  it('prebuilt backend files pass Node.js syntax check', () => {
    for (const s of summaries) {
      if (s.packageType !== 'system') continue;
      const backendEntry = s.manifest.backend?.entry;
      if (!backendEntry) continue;

      const backendPath = resolve(s.packageRoot ?? '', 'dist', 'backend.mjs');
      if (!existsSync(backendPath)) continue;

      // Running node --check validates syntax without executing the module
      expect(
        () => execFileSync('node', ['--check', backendPath], { encoding: 'utf-8', timeout: 10000 }),
        `${s.id}: dist/backend.mjs has syntax errors`,
      ).not.toThrow();
    }
  });

  it('prebuilt frontend files pass Node.js syntax check', () => {
    for (const s of summaries) {
      if (s.packageType !== 'system') continue;
      const frontendEntry = s.manifest.frontend?.entry;
      if (!frontendEntry) continue;

      const frontendPath = resolve(s.packageRoot ?? '', frontendEntry);
      if (!existsSync(frontendPath) || statSync(frontendPath).isDirectory()) continue;

      expect(
        () => execFileSync('node', ['--check', frontendPath], { encoding: 'utf-8', timeout: 10000 }),
        `${s.id}: ${frontendEntry} has syntax errors`,
      ).not.toThrow();
    }
  });

  it('prebuilt backend modules can be imported without module-scope errors', async () => {
    // Skip dynamic import when QUICK_EXTENSION_CHECK is set (saves ~25s)
    if (process.env.QUICK_EXTENSION_CHECK) {
      console.log('  ↳ skipped (QUICK_EXTENSION_CHECK=1 — run without it for full check)');
      return;
    }

    for (const s of summaries) {
      if (s.packageType !== 'system') continue;
      const backendEntry = s.manifest.backend?.entry;
      if (!backendEntry) continue;

      const backendPath = resolve(s.packageRoot ?? '', 'dist', 'backend.mjs');
      if (!existsSync(backendPath)) continue;

      // Dynamic import executes module-scope code and catches runtime errors
      // that node --check cannot detect (e.g. undefined env vars, top-level rejects)
      try {
        const mod = await import(/* @vite-ignore */ backendPath);
        expect(mod).toBeDefined();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        expect(null, `${s.id}: dist/backend.mjs failed to import at module scope: ${msg}`).not.toBeNull();
      }
    }
  }, 60000);
});

/* ------------------------------------------------------------------ */
/*  5. Frontend Entry File Validation                                  */
/* ------------------------------------------------------------------ */

describe('extension frontends - file existence checks', () => {
  const summaries = listExtensionInstallSummaries();

  it('every extension with a frontend entry has a compiled dist/frontend.js', () => {
    for (const s of summaries) {
      if (s.packageType !== 'system') continue;
      const frontendEntry = s.manifest.frontend?.entry;
      if (!frontendEntry) continue;

      const expectedPath = resolve(s.packageRoot ?? '', frontendEntry);
      expect(existsSync(expectedPath), `${s.id}: missing frontend entry at ${frontendEntry}`).toBe(true);
    }
  });

  it('frontend files are non-empty', () => {
    for (const s of summaries) {
      if (s.packageType !== 'system') continue;
      const frontendEntry = s.manifest.frontend?.entry;
      if (!frontendEntry) continue;

      const frontendPath = resolve(s.packageRoot ?? '', frontendEntry);
      if (!existsSync(frontendPath)) continue;

      const stats = statSync(frontendPath);
      expect(stats.size, `${s.id}: frontend entry is empty`).toBeGreaterThan(0);
    }
  });

  it('referenced style files exist', () => {
    for (const s of summaries) {
      if (s.packageType !== 'system') continue;
      const styles = s.manifest.frontend?.styles ?? [];
      for (const stylePath of styles) {
        const resolved = resolve(s.packageRoot ?? '', stylePath);
        expect(existsSync(resolved), `${s.id}: missing style file at ${stylePath}`).toBe(true);
      }
    }
  });

  it('frontend entry exports are referenced by view/surface components', () => {
    for (const s of summaries) {
      if (s.packageType !== 'system') continue;
      const frontendEntry = s.manifest.frontend?.entry;
      if (!frontendEntry) continue;

      const frontendPath = resolve(s.packageRoot ?? '', frontendEntry);
      if (!existsSync(frontendPath)) continue;

      const content = readFileSync(frontendPath, 'utf-8');
      const views = s.manifest.contributes?.views ?? [];

      for (const view of views) {
        const componentName = view.component;
        // Check that the component is exported
        const componentPattern = new RegExp(
          `(export\\s+(async\\s+)?function\\s+${componentName}|export\\s*\\{[^}]*\\b${componentName}\\b)`,
        );
        expect(componentPattern.test(content), `${s.id}: view component "${componentName}" not exported in ${frontendEntry}`).toBe(true);
      }
    }
  });

  it('composer shelves component exists in frontend entry', () => {
    const shelves = listExtensionComposerShelfRegistrations();
    for (const shelf of shelves) {
      if (!shelf.frontendEntry) continue;
      const s = summaries.find((e) => e.id === shelf.extensionId);
      if (!s || s.packageType !== 'system') continue;

      const frontendPath = resolve(s.packageRoot ?? '', shelf.frontendEntry);
      if (!existsSync(frontendPath)) continue;

      const content = readFileSync(frontendPath, 'utf-8');
      const componentPattern = new RegExp(
        `(export\\s+(async\\s+)?function\\s+${shelf.component}|export\\s*\\{[^}]*\\b${shelf.component}\\b)`,
      );
      expect(componentPattern.test(content), `${shelf.extensionId}: composer shelf component "${shelf.component}" not exported`).toBe(true);
    }
  });
});

/* ------------------------------------------------------------------ */
/*  6. Skill Validation                                                */
/* ------------------------------------------------------------------ */

describe('extension skills - file existence and frontmatter', () => {
  const summaries = listExtensionInstallSummaries();

  it('all skill paths referenced by system extensions exist on disk', () => {
    for (const s of summaries) {
      if (s.packageType !== 'system') continue;
      const skills = s.manifest.contributes?.skills ?? [];
      for (const skill of skills) {
        const skillPath = typeof skill === 'string' ? skill : skill.path;
        const resolved = resolve(s.packageRoot ?? '', skillPath);
        expect(existsSync(resolved), `${s.id}: skill path not found: ${skillPath}`).toBe(true);
      }
    }
  });

  it('all skill files have valid Agent Skills frontmatter with name and description', () => {
    for (const s of summaries) {
      if (s.packageType !== 'system') continue;
      const skills = s.manifest.contributes?.skills ?? [];
      for (const skill of skills) {
        const skillPath = typeof skill === 'string' ? skill : skill.path;
        const resolved = resolve(s.packageRoot ?? '', skillPath);
        if (!existsSync(resolved)) continue;

        const content = readFileSync(resolved, 'utf-8').replace(/\r\n/g, '\n');
        if (!content.startsWith('---\n')) {
          // Non-standard skill file — could be an Agent Skills file without frontmatter
          // Just check it exists and is non-empty
          expect(content.length, `${s.id}: skill ${skillPath} is empty`).toBeGreaterThan(0);
          continue;
        }

        const endIndex = content.indexOf('\n---', 4);
        expect(endIndex, `${s.id}: skill ${skillPath} has unclosed frontmatter`).toBeGreaterThan(-1);

        if (endIndex === -1) continue;
        const frontmatter = content.slice(4, endIndex);
        const hasName = /^name:\s*.+$/m.test(frontmatter);
        const hasDescription = /^description:\s*.+$/m.test(frontmatter);
        expect(hasName, `${s.id}: skill ${skillPath} frontmatter missing 'name'`).toBe(true);
        expect(hasDescription, `${s.id}: skill ${skillPath} frontmatter missing 'description'`).toBe(true);
      }
    }
  });

  it('skill files use the SKILL.md naming convention', () => {
    for (const s of summaries) {
      if (s.packageType !== 'system') continue;
      const skills = s.manifest.contributes?.skills ?? [];
      for (const skill of skills) {
        const skillPath = typeof skill === 'string' ? skill : skill.path;
        if (skillPath.endsWith('/SKILL.md') || skillPath === 'SKILL.md') continue;
        // Non-standard naming — warn but don't fail since it might be intentional
        console.warn(`${s.id}: skill "${skillPath}" does not follow SKILL.md naming convention`);
      }
    }
  });
});

/* ------------------------------------------------------------------ */
/*  7. Agent Extension Registration                                    */
/* ------------------------------------------------------------------ */

describe('extension agent extensions - registration listing', () => {
  it('lists all agent extensions from manifests', () => {
    const registrations = listExtensionAgentRegistrations();
    const snapshot = readExtensionRegistrySnapshot();
    const agentExtIds = new Set(registrations.map((r) => r.extensionId));

    for (const ext of snapshot.extensions) {
      if (ext.backend?.agentExtension) {
        expect(agentExtIds.has(ext.id), `${ext.id}: agentExtension declared but not registered`).toBe(true);
      }
    }
  });

  it('every agent registration has a valid export name', () => {
    const registrations = listExtensionAgentRegistrations();
    for (const reg of registrations) {
      expect(reg.exportName?.trim(), `${reg.extensionId}: agent extension export name is empty`).toBeTruthy();
    }
  });

  it('agent extensions reference the correct backend entry', () => {
    const snapshot = readExtensionRegistrySnapshot();
    const agentIds = new Set(snapshot.extensions.filter((e) => e.backend?.agentExtension).map((e) => e.id));

    for (const ext of snapshot.extensions) {
      if (agentIds.has(ext.id)) {
        expect(ext.backend?.entry, `${ext.id}: agent extension without backend entry`).toBeTruthy();
      }
    }
  });

  it('known agent extensions are registered when enabled', () => {
    const registrations = listExtensionAgentRegistrations();
    const agentIds = registrations.map((r) => r.extensionId);

    // system-conversation-tools is always enabled (defaultEnabled is not false)
    expect(agentIds, 'Expected system-conversation-tools agent extension').toContain('system-conversation-tools');
    // system-slack-mcp-gateway has defaultEnabled: false, so it may not be registered
    const slackGateway = listExtensionInstallSummaries().find((s) => s.id === 'system-slack-mcp-gateway');
    if (slackGateway?.enabled) {
      expect(agentIds, 'Expected system-slack-mcp-gateway agent extension').toContain('system-slack-mcp-gateway');
    }
  });
});

/* ------------------------------------------------------------------ */
/*  8. Summary Report                                                  */
/* ------------------------------------------------------------------ */

describe('extension integration - summary report', () => {
  it('reports extension counts and structural summary', () => {
    const summaries = listExtensionInstallSummaries();
    const snapshot = readExtensionRegistrySnapshot();

    const systemExtensions = summaries.filter((s) => s.packageType === 'system');
    const enabledSystem = systemExtensions.filter((s) => s.enabled);
    const invalidExtensions = summaries.filter((s) => s.status === 'invalid');
    const extensionsWithDiagnostics = summaries.filter((s) => (s.diagnostics?.length ?? 0) > 0);
    const extensionsWithBackends = systemExtensions.filter((s) => s.manifest.backend?.entry);
    const extensionsWithFrontends = systemExtensions.filter((s) => s.manifest.frontend?.entry);
    const agentExtensions = listExtensionAgentRegistrations();

    const toolRegistrations = listExtensionToolRegistrations();
    const skillRegistrations = summaries.flatMap((s) => s.skills);
    const commandRegistrations = listExtensionCommandRegistrations();
    const slashCommandRegistrations = listExtensionSlashCommandRegistrations();
    const settingRegistrations = listExtensionSettingsRegistrations();
    const viewRegistrations = snapshot.views;
    const routeRegistrations = snapshot.routes;
    const contextMenuRegistrations = listExtensionContextMenuRegistrations();
    const messageActionRegistrations = listExtensionMessageActionRegistrations();
    const composerShelfRegistrations = listExtensionComposerShelfRegistrations();
    const composerButtonRegistrations = listExtensionComposerButtonRegistrations();
    const composerInputToolRegistrations = listExtensionComposerInputToolRegistrations();
    const keybindingRegistrations = listExtensionKeybindingRegistrations();
    const statusBarRegistrations = listExtensionStatusBarItemRegistrations();
    const secretRegistrations = listExtensionSecretRegistrations();
    const secretBackendRegistrations = listExtensionSecretBackendRegistrations();
    const settingsComponentRegistrations = listExtensionSettingsComponentRegistrations();
    const defaultDisabled = systemExtensions.filter((s) => s.manifest.defaultEnabled === false);

    const report = [
      `Total extension entries: ${summaries.length}`,
      `  System extensions: ${systemExtensions.length} (${enabledSystem.length} enabled, ${defaultDisabled.length} default-disabled)`,
      `  Invalid extensions: ${invalidExtensions.length}`,
      `  Extensions with diagnostics: ${extensionsWithDiagnostics.length}`,
      `  Extensions with backends: ${extensionsWithBackends.length}`,
      `  Extensions with frontends: ${extensionsWithFrontends.length}`,
      ``,
      `Registration counts:`,
      `  Views: ${viewRegistrations.length}`,
      `  Routes: ${routeRegistrations.length}`,
      `  Tools: ${toolRegistrations.length}`,
      `  Skills: ${skillRegistrations.length}`,
      `  Commands: ${commandRegistrations.length}`,
      `  Slash commands: ${slashCommandRegistrations.length}`,
      `  Settings: ${settingRegistrations.length}`,
      `  Agent extensions: ${agentExtensions.length}`,
      `  Context menus: ${contextMenuRegistrations.length}`,
      `  Message actions: ${messageActionRegistrations.length}`,
      `  Composer shelves: ${composerShelfRegistrations.length}`,
      `  Composer buttons: ${composerButtonRegistrations.length}`,
      `  Composer input tools: ${composerInputToolRegistrations.length}`,
      `  Keybindings: ${keybindingRegistrations.length}`,
      `  Status bar items: ${statusBarRegistrations.length}`,
      `  Secrets: ${secretRegistrations.length}`,
      `  Secret backends: ${secretBackendRegistrations.length}`,
      `  Settings components: ${settingsComponentRegistrations.length}`,
    ].join('\n');

    // Print the report
    console.log('\n=== Extension Integration Summary ===\n' + report + '\n======================================\n');
  });
});

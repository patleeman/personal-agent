import type { Express } from 'express';
import { getProfilesRoot, updateUnifiedNode } from '@personal-agent/core';
import { listProfiles } from '@personal-agent/resources';
import {
  listNodeBrowserData,
  readNodeBrowserDetail,
} from '../knowledge/nodes.js';
import { logError } from '../middleware/index.js';
import { persistSettingsWrite } from '../ui/settingsPersistence.js';
import {
  readSavedWebUiPreferences,
  writeSavedWebUiPreferences,
  type SavedNodeBrowserViewPreference,
} from '../ui/webUiPreferences.js';
import { invalidateAppTopics } from '../shared/appEvents.js';
import type { ServerRouteContext } from './context.js';

function resolveRequestedProfile(
  viewProfile: unknown,
  context: Pick<ServerRouteContext, 'getCurrentProfile' | 'getRepoRoot'>,
): string {
  const requested = typeof viewProfile === 'string' ? viewProfile.trim() : '';
  if (!requested) {
    return context.getCurrentProfile();
  }

  const availableProfiles = listProfiles({
    repoRoot: context.getRepoRoot(),
    profilesRoot: getProfilesRoot(),
  });
  if (!availableProfiles.includes(requested)) {
    throw new Error(`Unknown profile: ${requested}`);
  }

  return requested;
}

function slugifyViewName(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'view';
}

function readViewName(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readViewSearch(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readRelationshipType(value: unknown): string {
  return typeof value === 'string'
    ? value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    : '';
}

function normalizeRelationships(value: unknown): Array<{ type: string; targetId: string }> {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  const relationships: Array<{ type: string; targetId: string }> = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      continue;
    }

    const type = readRelationshipType((entry as { type?: unknown }).type);
    const targetId = typeof (entry as { targetId?: unknown }).targetId === 'string'
      ? (entry as { targetId: string }).targetId.trim().toLowerCase()
      : '';
    if (!type || !targetId) {
      continue;
    }

    const key = `${type}:${targetId}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    relationships.push({ type, targetId });
  }

  return relationships.sort((left, right) => left.type.localeCompare(right.type) || left.targetId.localeCompare(right.targetId));
}

function readSavedNodeViews(context: Pick<ServerRouteContext, 'getCurrentProfileSettingsFile'>): SavedNodeBrowserViewPreference[] {
  return readSavedWebUiPreferences(context.getCurrentProfileSettingsFile()).nodeBrowserViews;
}

function writeSavedNodeViews(
  views: SavedNodeBrowserViewPreference[],
  context: Pick<ServerRouteContext, 'getCurrentProfileSettingsFile'>,
): SavedNodeBrowserViewPreference[] {
  return persistSettingsWrite(
    (settingsFile) => writeSavedWebUiPreferences({ nodeBrowserViews: views }, settingsFile),
    { runtimeSettingsFile: context.getCurrentProfileSettingsFile() },
  ).nodeBrowserViews;
}

function upsertSavedNodeView(
  input: { id?: string; name: string; search: string },
  context: Pick<ServerRouteContext, 'getCurrentProfileSettingsFile'>,
): SavedNodeBrowserViewPreference[] {
  const name = readViewName(input.name);
  if (!name) {
    throw new Error('name is required');
  }

  const search = readViewSearch(input.search);
  const existing = readSavedNodeViews(context);
  const now = new Date().toISOString();
  const explicitId = typeof input.id === 'string' ? input.id.trim() : '';
  const match = existing.find((view) => view.id === explicitId)
    ?? existing.find((view) => view.name.toLowerCase() === name.toLowerCase());
  const next = match
    ? existing.map((view) => view.id === match.id ? { ...view, name, search, updatedAt: now } : view)
    : [...existing, {
      id: explicitId || `${slugifyViewName(name)}-${Date.now()}`,
      name,
      search,
      createdAt: now,
      updatedAt: now,
    }];
  return writeSavedNodeViews(next, context);
}

function deleteSavedNodeView(
  viewId: string,
  context: Pick<ServerRouteContext, 'getCurrentProfileSettingsFile'>,
): SavedNodeBrowserViewPreference[] {
  return writeSavedNodeViews(readSavedNodeViews(context).filter((view) => view.id !== viewId), context);
}

function handleRouteError(err: unknown, res: { status: (code: number) => { json: (value: unknown) => void } }, fallbackStatus = 500): void {
  const message = err instanceof Error ? err.message : String(err);
  logError('request handler error', { message, stack: err instanceof Error ? err.stack : undefined });
  const status = message.startsWith('Unknown profile:')
    ? 400
    : message.startsWith('Node not found:') || message.startsWith('No node found with id:')
      ? 404
      : message.startsWith('name is required')
        ? 400
        : fallbackStatus;
  res.status(status).json({ error: message });
}

export function registerNodeRoutes(
  router: Pick<Express, 'get' | 'post' | 'patch' | 'delete'>,
  context: Pick<ServerRouteContext, 'getCurrentProfile' | 'getRepoRoot' | 'getCurrentProfileSettingsFile'>,
): void {
  router.get('/api/nodes', (req, res) => {
    try {
      const profile = resolveRequestedProfile(req.query.viewProfile, context);
      res.json(listNodeBrowserData(profile));
    } catch (err) {
      handleRouteError(err, res);
    }
  });

  router.get('/api/nodes/views', (_req, res) => {
    try {
      res.json({ views: readSavedNodeViews(context) });
    } catch (err) {
      handleRouteError(err, res);
    }
  });

  router.post('/api/nodes/views', (req, res) => {
    try {
      const views = upsertSavedNodeView({
        id: req.body?.id,
        name: req.body?.name,
        search: req.body?.search,
      }, context);
      res.json({ views });
    } catch (err) {
      handleRouteError(err, res);
    }
  });

  router.delete('/api/nodes/views/:viewId', (req, res) => {
    try {
      res.json({ views: deleteSavedNodeView(req.params.viewId, context) });
    } catch (err) {
      handleRouteError(err, res);
    }
  });

  router.get('/api/nodes/:nodeId', (req, res) => {
    try {
      const profile = resolveRequestedProfile(req.query.viewProfile, context);
      res.json(readNodeBrowserDetail(profile, String(req.params.nodeId).trim().toLowerCase()));
    } catch (err) {
      handleRouteError(err, res);
    }
  });

  router.patch('/api/nodes/:nodeId', (req, res) => {
    try {
      const profile = resolveRequestedProfile(req.query.viewProfile, context);
      const nodeId = String(req.params.nodeId).trim().toLowerCase();
      updateUnifiedNode({
        id: nodeId,
        ...(typeof req.body?.status === 'string' ? { status: req.body.status } : {}),
        ...(Array.isArray(req.body?.addTags)
          ? { addTags: req.body.addTags.filter((entry: unknown): entry is string => typeof entry === 'string') }
          : {}),
        ...(Array.isArray(req.body?.removeTags)
          ? { removeTags: req.body.removeTags.filter((entry: unknown): entry is string => typeof entry === 'string') }
          : {}),
        ...(Object.prototype.hasOwnProperty.call(req.body ?? {}, 'parent')
          ? { parent: typeof req.body.parent === 'string' && req.body.parent.trim().length > 0 ? req.body.parent.trim().toLowerCase() : null }
          : {}),
        ...(Object.prototype.hasOwnProperty.call(req.body ?? {}, 'relationships')
          ? { relationships: normalizeRelationships(req.body.relationships) }
          : {}),
      });
      invalidateAppTopics('projects');
      res.json(readNodeBrowserDetail(profile, nodeId));
    } catch (err) {
      handleRouteError(err, res);
    }
  });
}

/**
 * Workspace routes
 *
 * Browse workspace files, git status, and git operations.
 */

import type { Express } from 'express';
import type { ServerRouteContext } from './context.js';
import {
  readWorkspaceSnapshot,
  readWorkspaceGitStatus,
  readWorkspaceGitDiff,
  stageWorkspaceGitPath,
  unstageWorkspaceGitPath,
  stageAllWorkspaceGitChanges,
  unstageAllWorkspaceGitChanges,
  readWorkspaceGitDraftSource,
  commitWorkspaceGitChanges,
  readWorkspaceFile,
  readWorkspacePreviewAsset,
  writeWorkspaceFile,
  retainWorkspaceWatch,
} from '../workspace/workspaceBrowser.js';
import { DEFAULT_RUNTIME_SETTINGS_FILE as SETTINGS_FILE } from '../ui/settingsPersistence.js';
import { invalidateAppTopics, logError } from '../middleware/index.js';

let _getDefaultWebCwd: () => string = () => process.cwd();
let _resolveRequestedCwd: (cwd: string | undefined, defaultCwd: string) => string | undefined = () => undefined;
let _draftWorkspaceCommitMessage: (input: { draftSource: ReturnType<typeof import('../workspace/workspaceBrowser.js').readWorkspaceGitDraftSource>; authFile: string; settingsFile: string }) => Promise<unknown>;
let _authFile: string;

function initializeWorkspaceRoutesContext(
  context: Pick<ServerRouteContext, 'getDefaultWebCwd' | 'resolveRequestedCwd' | 'draftWorkspaceCommitMessage' | 'getAuthFile'>,
): void {
  _getDefaultWebCwd = context.getDefaultWebCwd;
  _resolveRequestedCwd = context.resolveRequestedCwd;
  _draftWorkspaceCommitMessage = context.draftWorkspaceCommitMessage;
  _authFile = context.getAuthFile();
}

export function registerWorkspaceRoutes(
  router: Pick<Express, 'get' | 'post'>,
  context: Pick<ServerRouteContext, 'getDefaultWebCwd' | 'resolveRequestedCwd' | 'draftWorkspaceCommitMessage' | 'getAuthFile'>,
): void {
  initializeWorkspaceRoutesContext(context);
  router.get('/api/workspace', (req, res) => {
    try {
      const defaultWebCwd = _getDefaultWebCwd();
      const cwd = typeof req.query.cwd === 'string' && req.query.cwd.trim().length > 0
        ? req.query.cwd
        : defaultWebCwd;
      const resolvedCwd = _resolveRequestedCwd(cwd, defaultWebCwd) ?? defaultWebCwd;
      const snapshot = readWorkspaceSnapshot(resolvedCwd);
      retainWorkspaceWatch(snapshot.root);
      res.json(snapshot);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status = message.startsWith('Directory does not exist:') || message.startsWith('Not a directory:')
        ? 400
        : 500;
      logError('request handler error', { message, stack: err instanceof Error ? err.stack : undefined });
      res.status(status).json({ error: message });
    }
  });

  router.get('/api/workspace/git-status', (req, res) => {
    try {
      const defaultWebCwd = _getDefaultWebCwd();
      const cwd = typeof req.query.cwd === 'string' && req.query.cwd.trim().length > 0
        ? req.query.cwd
        : defaultWebCwd;
      const resolvedCwd = _resolveRequestedCwd(cwd, defaultWebCwd) ?? defaultWebCwd;
      const summary = readWorkspaceGitStatus(resolvedCwd);
      retainWorkspaceWatch(summary.root);
      res.json(summary);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status = message.startsWith('Directory does not exist:') || message.startsWith('Not a directory:')
        ? 400
        : 500;
      logError('request handler error', { message, stack: err instanceof Error ? err.stack : undefined });
      res.status(status).json({ error: message });
    }
  });

  router.get('/api/workspace/git-diff', (req, res) => {
    try {
      const defaultWebCwd = _getDefaultWebCwd();
      const cwd = typeof req.query.cwd === 'string' && req.query.cwd.trim().length > 0
        ? req.query.cwd
        : defaultWebCwd;
      const path = typeof req.query.path === 'string' ? req.query.path.trim() : '';
      const scope = typeof req.query.scope === 'string' ? req.query.scope.trim() : '';
      if (!path) { res.status(400).json({ error: 'path required' }); return; }
      const validScopes = new Set(['staged', 'unstaged', 'untracked', 'conflicted']);
      if (!validScopes.has(scope)) {
        res.status(400).json({ error: 'scope required' }); return;
      }
      const resolvedCwd = _resolveRequestedCwd(cwd, defaultWebCwd) ?? defaultWebCwd;
      const detail = readWorkspaceGitDiff({ cwd: resolvedCwd, path, scope: scope as 'staged' | 'unstaged' | 'untracked' | 'conflicted' });
      retainWorkspaceWatch(detail.root);
      res.json(detail);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status = message === 'path required' || message === 'scope required'
        || message.startsWith('Git repository required.') || message.startsWith('Directory does not exist:')
        || message.startsWith('Not a directory:') || message.startsWith('Path is outside the workspace root:')
        || message.startsWith('Git status entry not found for path:')
        || message.startsWith('No staged change found for path:')
        || message.startsWith('No unstaged change found for path:')
        || message.startsWith('No untracked change found for path:')
        || message.startsWith('No conflicted change found for path:')
        ? 400
        : 500;
      logError('request handler error', { message, stack: err instanceof Error ? err.stack : undefined });
      res.status(status).json({ error: message });
    }
  });

  router.post('/api/workspace/git/stage', (req, res) => {
    try {
      const defaultWebCwd = _getDefaultWebCwd();
      const { cwd: requestedCwd, path } = req.body as { cwd?: string; path?: string };
      if (typeof path !== 'string' || path.trim().length === 0) { res.status(400).json({ error: 'path required' }); return; }
      const resolvedCwd = _resolveRequestedCwd(requestedCwd, defaultWebCwd) ?? defaultWebCwd;
      const summary = stageWorkspaceGitPath({ cwd: resolvedCwd, path });
      retainWorkspaceWatch(summary.root);
      invalidateAppTopics('workspace');
      res.json(summary);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status = message === 'path required' || message === 'Git repository required.'
        || message.startsWith('Directory does not exist:') || message.startsWith('Not a directory:')
        || message.startsWith('Path is outside the workspace root:')
        ? 400
        : 500;
      logError('request handler error', { message, stack: err instanceof Error ? err.stack : undefined });
      res.status(status).json({ error: message });
    }
  });

  router.post('/api/workspace/git/unstage', (req, res) => {
    try {
      const defaultWebCwd = _getDefaultWebCwd();
      const { cwd: requestedCwd, path } = req.body as { cwd?: string; path?: string };
      if (typeof path !== 'string' || path.trim().length === 0) { res.status(400).json({ error: 'path required' }); return; }
      const resolvedCwd = _resolveRequestedCwd(requestedCwd, defaultWebCwd) ?? defaultWebCwd;
      const summary = unstageWorkspaceGitPath({ cwd: resolvedCwd, path });
      retainWorkspaceWatch(summary.root);
      invalidateAppTopics('workspace');
      res.json(summary);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status = message === 'path required' || message === 'Git repository required.'
        || message.startsWith('Directory does not exist:') || message.startsWith('Not a directory:')
        || message.startsWith('Path is outside the workspace root:')
        ? 400
        : 500;
      logError('request handler error', { message, stack: err instanceof Error ? err.stack : undefined });
      res.status(status).json({ error: message });
    }
  });

  router.post('/api/workspace/git/stage-all', (req, res) => {
    try {
      const defaultWebCwd = _getDefaultWebCwd();
      const { cwd: requestedCwd } = req.body as { cwd?: string };
      const resolvedCwd = _resolveRequestedCwd(requestedCwd, defaultWebCwd) ?? defaultWebCwd;
      const summary = stageAllWorkspaceGitChanges(resolvedCwd);
      retainWorkspaceWatch(summary.root);
      invalidateAppTopics('workspace');
      res.json(summary);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status = message === 'Git repository required.'
        || message.startsWith('Directory does not exist:') || message.startsWith('Not a directory:')
        ? 400
        : 500;
      logError('request handler error', { message, stack: err instanceof Error ? err.stack : undefined });
      res.status(status).json({ error: message });
    }
  });

  router.post('/api/workspace/git/unstage-all', (req, res) => {
    try {
      const defaultWebCwd = _getDefaultWebCwd();
      const { cwd: requestedCwd } = req.body as { cwd?: string };
      const resolvedCwd = _resolveRequestedCwd(requestedCwd, defaultWebCwd) ?? defaultWebCwd;
      const summary = unstageAllWorkspaceGitChanges(resolvedCwd);
      retainWorkspaceWatch(summary.root);
      invalidateAppTopics('workspace');
      res.json(summary);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status = message === 'Git repository required.'
        || message.startsWith('Directory does not exist:') || message.startsWith('Not a directory:')
        ? 400
        : 500;
      logError('request handler error', { message, stack: err instanceof Error ? err.stack : undefined });
      res.status(status).json({ error: message });
    }
  });

  router.post('/api/workspace/git/draft-commit-message', async (req, res) => {
    try {
      const defaultWebCwd = _getDefaultWebCwd();
      const { cwd: requestedCwd } = req.body as { cwd?: string };
      const resolvedCwd = _resolveRequestedCwd(requestedCwd, defaultWebCwd) ?? defaultWebCwd;
      const draft = await _draftWorkspaceCommitMessage({
        draftSource: readWorkspaceGitDraftSource(resolvedCwd),
        authFile: _authFile,
        settingsFile: SETTINGS_FILE,
      });
      res.json(draft);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status = message === 'Git repository required.'
        || message === 'No staged changes available for commit drafting.'
        || message.startsWith('Directory does not exist:') || message.startsWith('Not a directory:')
        ? 400
        : 500;
      logError('request handler error', { message, stack: err instanceof Error ? err.stack : undefined });
      res.status(status).json({ error: message });
    }
  });

  router.post('/api/workspace/git/commit', (req, res) => {
    try {
      const defaultWebCwd = _getDefaultWebCwd();
      const { cwd: requestedCwd, message } = req.body as { cwd?: string; message?: string };
      if (typeof message !== 'string' || message.trim().length === 0) { res.status(400).json({ error: 'message required' }); return; }
      const resolvedCwd = _resolveRequestedCwd(requestedCwd, defaultWebCwd) ?? defaultWebCwd;
      const result = commitWorkspaceGitChanges({ cwd: resolvedCwd, message });
      retainWorkspaceWatch(result.root);
      invalidateAppTopics('workspace');
      res.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status = message === 'message required' || message === 'Git repository required.'
        || message === 'Resolve conflicts before committing.'
        || message === 'Stage at least one change before committing.'
        || message === 'Commit message subject is required.'
        || message.startsWith('Directory does not exist:') || message.startsWith('Not a directory:')
        ? 400
        : 500;
      logError('request handler error', { message, stack: err instanceof Error ? err.stack : undefined });
      res.status(status).json({ error: message });
    }
  });

  router.get('/api/workspace/file', (req, res) => {
    try {
      const defaultWebCwd = _getDefaultWebCwd();
      const cwd = typeof req.query.cwd === 'string' && req.query.cwd.trim().length > 0
        ? req.query.cwd
        : defaultWebCwd;
      const path = typeof req.query.path === 'string' ? req.query.path.trim() : '';
      if (!path) { res.status(400).json({ error: 'path required' }); return; }
      const resolvedCwd = _resolveRequestedCwd(cwd, defaultWebCwd) ?? defaultWebCwd;
      const detail = readWorkspaceFile({ cwd: resolvedCwd, path });
      retainWorkspaceWatch(detail.root);
      res.json(detail);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status = message === 'path required' || message.startsWith('Directory does not exist:')
        || message.startsWith('Not a directory:') || message.startsWith('Path is outside the workspace root:')
        ? 400
        : 500;
      logError('request handler error', { message, stack: err instanceof Error ? err.stack : undefined });
      res.status(status).json({ error: message });
    }
  });

  router.get('/api/workspace/file/asset', (req, res) => {
    try {
      const defaultWebCwd = _getDefaultWebCwd();
      const cwd = typeof req.query.cwd === 'string' && req.query.cwd.trim().length > 0
        ? req.query.cwd
        : defaultWebCwd;
      const path = typeof req.query.path === 'string' ? req.query.path.trim() : '';
      if (!path) { res.status(400).json({ error: 'path required' }); return; }
      const resolvedCwd = _resolveRequestedCwd(cwd, defaultWebCwd) ?? defaultWebCwd;
      const asset = readWorkspacePreviewAsset({ cwd: resolvedCwd, path });
      retainWorkspaceWatch(asset.root);
      res.type(asset.mimeType);
      res.sendFile(asset.filePath);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status = message === 'path required' || message === 'Preview unavailable for this file type.'
        || message.startsWith('File does not exist:') || message.startsWith('Directory does not exist:')
        || message.startsWith('Not a directory:') || message.startsWith('Path is outside the workspace root:')
        ? 400
        : 500;
      logError('request handler error', { message, stack: err instanceof Error ? err.stack : undefined });
      res.status(status).json({ error: message });
    }
  });

  router.post('/api/workspace/file', (req, res) => {
    try {
      const defaultWebCwd = _getDefaultWebCwd();
      const { cwd: requestedCwd, path, content } = req.body as { cwd?: string; path?: string; content?: string };
      if (typeof path !== 'string' || path.trim().length === 0) { res.status(400).json({ error: 'path required' }); return; }
      if (typeof content !== 'string') { res.status(400).json({ error: 'content required' }); return; }
      const resolvedCwd = _resolveRequestedCwd(requestedCwd, defaultWebCwd) ?? defaultWebCwd;
      const detail = writeWorkspaceFile({ cwd: resolvedCwd, path, content });
      retainWorkspaceWatch(detail.root);
      invalidateAppTopics('workspace');
      res.json(detail);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status = message === 'path required' || message === 'content required'
        || message.startsWith('Directory does not exist:') || message.startsWith('Not a directory:')
        || message.startsWith('Path is outside the workspace root:')
        ? 400
        : 500;
      logError('request handler error', { message, stack: err instanceof Error ? err.stack : undefined });
      res.status(status).json({ error: message });
    }
  });
}

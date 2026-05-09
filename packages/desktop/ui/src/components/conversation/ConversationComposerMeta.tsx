import { useEffect, useRef, useState } from 'react';

import { api } from '../../client/api';
import { createNativeExtensionClient } from '../../extensions/nativePaClient';
import { useExtensionRegistry } from '../../extensions/useExtensionRegistry';
import type { GatewayState } from '../../shared/types';
import { cx } from '../ui';
import { BrowsePathButton, ChatBubbleIcon, FolderIcon, RemoteExecutionIcon } from './ConversationComposerChrome';
import { ConversationContextUsageIndicator, type ConversationContextUsageTokens } from './ConversationContextUsageIndicator';

export type ConversationGitSummaryPresentation =
  | { kind: 'none' }
  | { kind: 'summary'; text: string }
  | { kind: 'diff'; added: string; deleted: string };

export function ConversationComposerMeta({
  showExecutionTargetPicker,
  selectedExecutionTargetId,
  executionTargetOptions,
  continueInBusy,
  onSelectExecutionTarget,
  remoteOperationInlineStatus,
  remoteOperationStatusKind,
  draft,
  hasDraftCwd,
  selectedExecutionTargetIsRemote,
  selectedExecutionTargetLabel,
  draftCwdValue,
  draftCwdError,
  draftCwdPickBusy,
  availableDraftWorkspacePaths,
  onDraftRemoteCwdChange,
  onClearDraftCwdSelection,
  onSelectDraftWorkspace,
  onPickDraftCwd,
  conversationCwdEditorOpen,
  currentCwd,
  currentCwdLabel,
  conversationCwdDraft,
  conversationCwdError,
  conversationCwdBusy,
  conversationCwdPickBusy,
  onConversationCwdDraftChange,
  onSubmitConversationCwdChange,
  onCancelConversationCwdEdit,
  onPickConversationCwd,
  onBeginConversationCwdEdit,
  branchLabel,
  gitSummaryPresentation,
  hasGitSummary,
  sessionTokens,
  conversationId,
  conversationTitle,
  openGatewayPickerSignal,
}: {
  showExecutionTargetPicker: boolean;
  selectedExecutionTargetId: string;
  executionTargetOptions: Array<{ value: string; label: string }>;
  continueInBusy: boolean;
  onSelectExecutionTarget: (targetId: string) => void;
  remoteOperationInlineStatus: string | null;
  remoteOperationStatusKind: 'error' | 'info' | null;
  draft: boolean;
  hasDraftCwd: boolean;
  selectedExecutionTargetIsRemote: boolean;
  selectedExecutionTargetLabel: string;
  draftCwdValue: string;
  draftCwdError: string | null;
  draftCwdPickBusy: boolean;
  availableDraftWorkspacePaths: string[];
  onDraftRemoteCwdChange: (value: string) => void;
  onClearDraftCwdSelection: () => void;
  onSelectDraftWorkspace: (workspacePath: string) => void;
  onPickDraftCwd: () => void;
  conversationCwdEditorOpen: boolean;
  currentCwd: string | null;
  currentCwdLabel: string;
  conversationCwdDraft: string;
  conversationCwdError: string | null;
  conversationCwdBusy: boolean;
  conversationCwdPickBusy: boolean;
  onConversationCwdDraftChange: (value: string) => void;
  onSubmitConversationCwdChange: () => void;
  onCancelConversationCwdEdit: () => void;
  onPickConversationCwd: () => void;
  onBeginConversationCwdEdit: () => void;
  branchLabel: string | null;
  gitSummaryPresentation: ConversationGitSummaryPresentation;
  hasGitSummary: boolean;
  sessionTokens: ConversationContextUsageTokens | null;
  conversationId?: string | null;
  conversationTitle?: string;
  openGatewayPickerSignal?: string | null;
}) {
  const { statusBarItems } = useExtensionRegistry();
  const leftStatusItems = statusBarItems.filter((item) => item.alignment === 'left');
  const rightStatusItems = statusBarItems.filter((item) => item.alignment === 'right');
  const [moreOpen, setMoreOpen] = useState(false);
  const [gatewayOnlyOpen, setGatewayOnlyOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (openGatewayPickerSignal) {
      setMoreOpen(true);
      setGatewayOnlyOpen(true);
    }
  }, [openGatewayPickerSignal]);

  useEffect(() => {
    if (!moreOpen || typeof document === 'undefined') {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (target instanceof Node && menuRef.current?.contains(target)) {
        return;
      }

      setMoreOpen(false);
      setGatewayOnlyOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setMoreOpen(false);
        setGatewayOnlyOpen(false);
      }
    }

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [moreOpen]);

  return (
    <div className="conversation-composer-meta mt-1.5 flex min-h-4 flex-row items-center justify-between gap-2 overflow-visible px-3 text-[10px] text-dim">
      <div className="flex min-w-0 flex-1 flex-nowrap items-center gap-2 overflow-hidden">
        {remoteOperationInlineStatus ? (
          <span className={cx(remoteOperationStatusKind === 'error' ? 'text-danger/85' : 'text-accent/80')}>
            {remoteOperationInlineStatus}
          </span>
        ) : null}

        {draft ? (
          <div className="flex min-w-0 max-w-full flex-1 items-center gap-1.5 xl:max-w-[26rem] xl:flex-none">
            {hasDraftCwd ? <FolderIcon className="shrink-0 text-dim/70" /> : <ChatBubbleIcon className="shrink-0 text-dim/70" />}
            {selectedExecutionTargetIsRemote ? (
              <>
                <label className="sr-only" htmlFor="draft-composer-remote-cwd">
                  Remote workspace path
                </label>
                <input
                  id="draft-composer-remote-cwd"
                  value={draftCwdValue}
                  onChange={(event) => {
                    onDraftRemoteCwdChange(event.target.value);
                  }}
                  placeholder="~/workingdir/project"
                  spellCheck={false}
                  className="h-7 min-w-0 w-full rounded-md border border-border-subtle bg-surface/45 px-2 text-[11px] font-mono text-primary outline-none transition-colors focus:border-accent/50 xl:max-w-[22rem]"
                  aria-label="Remote workspace path"
                />
                <BrowsePathButton
                  busy={draftCwdPickBusy}
                  onClick={onPickDraftCwd}
                  title={draftCwdPickBusy ? 'Choosing folder…' : `Choose directory on ${selectedExecutionTargetLabel}`}
                  ariaLabel={`Choose directory on ${selectedExecutionTargetLabel}`}
                />
              </>
            ) : (
              <>
                <label className="sr-only" htmlFor="draft-composer-cwd">
                  Workspace folder
                </label>
                <div className="relative min-w-0 flex-1 xl:max-w-[22rem]">
                  <select
                    id="draft-composer-cwd"
                    value={draftCwdValue}
                    onChange={(event) => {
                      const nextWorkspacePath = event.target.value.trim();
                      if (!nextWorkspacePath) {
                        onClearDraftCwdSelection();
                        return;
                      }
                      onSelectDraftWorkspace(nextWorkspacePath);
                    }}
                    className="h-7 w-full min-w-0 truncate appearance-none rounded-md bg-transparent pl-1 pr-6 text-[11px] font-mono text-secondary outline-none transition-colors hover:bg-surface/45 hover:text-primary focus-visible:bg-surface/55 focus-visible:text-primary"
                  >
                    <option value="">Chat</option>
                    {availableDraftWorkspacePaths.map((workspacePath) => (
                      <option key={workspacePath} value={workspacePath}>
                        {workspacePath}
                      </option>
                    ))}
                  </select>
                  <svg
                    aria-hidden="true"
                    width="10"
                    height="10"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-dim/70"
                  >
                    <path d="m6 9 6 6 6-6" />
                  </svg>
                </div>
                <BrowsePathButton
                  busy={draftCwdPickBusy}
                  onClick={onPickDraftCwd}
                  title={draftCwdPickBusy ? 'Choosing folder…' : 'Choose folder'}
                  ariaLabel="Choose folder"
                />
              </>
            )}
          </div>
        ) : conversationCwdEditorOpen ? (
          <form
            className="flex min-w-0 max-w-full flex-1 items-center gap-1.5 xl:max-w-[26rem] xl:flex-none"
            onSubmit={(event) => {
              event.preventDefault();
              onSubmitConversationCwdChange();
            }}
          >
            <FolderIcon className="shrink-0 text-dim/70" />
            <input
              autoFocus
              value={conversationCwdDraft}
              onChange={(event) => {
                onConversationCwdDraftChange(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault();
                  onCancelConversationCwdEdit();
                }
              }}
              placeholder={currentCwd ?? '~/workingdir/repo'}
              spellCheck={false}
              aria-label="Conversation working directory"
              className="h-7 min-w-0 w-full rounded-md border border-border-subtle bg-surface/45 px-2 text-[11px] font-mono text-primary outline-none transition-colors focus:border-accent/50 xl:max-w-[22rem]"
              disabled={conversationCwdBusy || conversationCwdPickBusy}
            />
            <BrowsePathButton
              busy={conversationCwdBusy || conversationCwdPickBusy}
              onClick={onPickConversationCwd}
              title={conversationCwdPickBusy ? 'Choosing folder…' : 'Choose folder'}
              ariaLabel="Choose folder"
            />
            <button
              type="submit"
              className="h-7 rounded-md px-2 text-[10px] text-accent transition-colors hover:bg-surface/45 disabled:opacity-50"
              disabled={conversationCwdBusy || conversationCwdPickBusy}
            >
              {conversationCwdBusy ? 'Switching…' : 'Switch'}
            </button>
            <button
              type="button"
              className="h-7 rounded-md px-2 text-[10px] text-secondary transition-colors hover:bg-surface/45 hover:text-primary disabled:opacity-50"
              onClick={onCancelConversationCwdEdit}
              disabled={conversationCwdBusy || conversationCwdPickBusy}
            >
              Cancel
            </button>
          </form>
        ) : (
          <button
            type="button"
            onClick={onBeginConversationCwdEdit}
            className="flex min-w-0 max-w-full flex-1 items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-secondary transition-colors hover:bg-surface/45 hover:text-primary xl:w-[26rem] xl:flex-none"
            title={currentCwd ? `Working directory: ${currentCwd}` : 'Set working directory'}
          >
            <FolderIcon className="shrink-0 text-dim/70" />
            <span className="ui-truncate-start min-w-0 flex-1 font-mono text-[11px]">{currentCwdLabel || 'Set working directory'}</span>
          </button>
        )}

        {(draft ? draftCwdError : conversationCwdError) ? (
          <span className="text-danger/85">{draft ? draftCwdError : conversationCwdError}</span>
        ) : null}
      </div>

      {leftStatusItems.length > 0 && (
        <div className="flex shrink-0 items-center gap-2">
          {leftStatusItems.map((item) => (
            <StatusBarItem key={item.id} item={item} />
          ))}
        </div>
      )}
      <div className="flex shrink-0 items-center justify-end gap-2 text-right">
        {!draft && branchLabel ? (
          <span className="max-w-[8rem] truncate font-mono" title={branchLabel}>
            {branchLabel}
          </span>
        ) : null}
        {!draft && hasGitSummary ? (
          gitSummaryPresentation.kind === 'diff' ? (
            <span className="font-mono tabular-nums">
              <span className="text-success">{gitSummaryPresentation.added}</span>
              <span className="text-dim">/</span>
              <span className="text-danger">{gitSummaryPresentation.deleted}</span>
            </span>
          ) : gitSummaryPresentation.kind === 'summary' ? (
            <span className="font-mono tabular-nums">{gitSummaryPresentation.text}</span>
          ) : null
        ) : null}
        {sessionTokens ? <ConversationContextUsageIndicator tokens={sessionTokens} /> : null}
        <div className="relative" ref={menuRef}>
          <button
            type="button"
            className="flex h-7 w-7 items-center justify-center rounded-md text-secondary transition-colors hover:bg-surface/45 hover:text-primary"
            aria-label="Conversation options"
            title="Conversation options"
            onClick={() => {
              setGatewayOnlyOpen(false);
              setMoreOpen((current) => !current);
            }}
          >
            <MoreIcon />
          </button>
          {moreOpen ? (
            <div className="absolute bottom-8 right-0 z-30 w-72 rounded-xl border border-border-default bg-surface p-2 text-left text-[12px] shadow-2xl">
              {showExecutionTargetPicker && !gatewayOnlyOpen ? (
                <label className="block px-2 py-1.5 text-[11px] text-secondary">
                  Run on
                  <span className="relative mt-1 flex min-w-0 items-center">
                    <RemoteExecutionIcon className="pointer-events-none absolute left-2 text-dim/70" />
                    <select
                      value={selectedExecutionTargetId}
                      onChange={(event) => {
                        onSelectExecutionTarget(event.target.value);
                      }}
                      disabled={continueInBusy}
                      aria-label="Execution target"
                      className="h-8 w-full appearance-none rounded-md border border-border-subtle bg-surface/45 pl-7 pr-7 text-[12px] text-primary outline-none focus:border-accent/50 disabled:opacity-50"
                    >
                      {executionTargetOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </span>
                </label>
              ) : null}
              {!draft && conversationId ? (
                <GatewayComposerControl
                  conversationId={conversationId}
                  conversationTitle={conversationTitle}
                  standalone={gatewayOnlyOpen || !showExecutionTargetPicker}
                />
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
      {rightStatusItems.length > 0 &&
        rightStatusItems.map((item) => (
          <StatusBarItem key={item.id} item={item} />
        ))}
    </div>
  );
}

function StatusBarItem({ item }: { item: { extensionId: string; id: string; label: string; action?: string } }) {
  const [busy, setBusy] = useState(false);
  const paClient = useRef<ReturnType<typeof createNativeExtensionClient> | null>(null);
  if (!paClient.current) paClient.current = createNativeExtensionClient(item.extensionId);

  if (!item.action) {
    return <span className="shrink-0 truncate font-mono max-w-[6rem]">{item.label}</span>;
  }

  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => {
        setBusy(true);
        void paClient
          .current!.extension.invoke(item.action, {})
          .catch(() => {})
          .finally(() => setBusy(false));
      }}
      className="shrink-0 truncate max-w-[6rem] font-mono text-secondary transition-colors hover:text-primary disabled:opacity-50"
      title={item.label}
    >
      {busy ? `${item.label}…` : item.label}
    </button>
  );
}

type GatewayProviderChoice = 'telegram' | 'slack_mcp';

function GatewayComposerControl({
  conversationId,
  conversationTitle,
  standalone = false,
}: {
  conversationId: string;
  conversationTitle?: string;
  standalone?: boolean;
}) {
  const [state, setState] = useState<GatewayState | null>(null);
  const [provider, setProvider] = useState<GatewayProviderChoice>('telegram');
  const [busy, setBusy] = useState(false);
  const connection = state?.connections.find((item) => item.provider === provider) ?? null;
  const binding = state?.bindings.find((item) => item.provider === provider && item.conversationId === conversationId) ?? null;
  const existingBinding = state?.bindings.find((item) => item.provider === provider) ?? null;
  const chatTarget = state?.chatTargets.find((item) => item.provider === provider && item.connectionId === connection?.id) ?? null;
  const externalChatId = chatTarget?.externalChatId || existingBinding?.externalChatId || '';
  const externalChatLabel = chatTarget?.externalChatLabel || existingBinding?.externalChatLabel || externalChatId;

  useEffect(() => {
    let cancelled = false;
    api
      .gateways()
      .then((next) => {
        if (!cancelled) setState(next);
      })
      .catch(() => {
        if (!cancelled) setState(null);
      });
    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  async function attach() {
    if (!externalChatId) return;
    setBusy(true);
    try {
      setState(
        await api.attachGatewayConversation({
          provider,
          conversationId,
          ...(conversationTitle ? { conversationTitle } : {}),
          externalChatId,
          externalChatLabel,
        }),
      );
    } finally {
      setBusy(false);
    }
  }

  async function detach() {
    setBusy(true);
    try {
      setState(await api.detachGatewayConversation(conversationId, provider));
    } finally {
      setBusy(false);
    }
  }

  const providerLabel = provider === 'telegram' ? 'Telegram' : 'Slack';
  const statusLabel = connection ? connection.status.replace(/_/g, ' ') : 'not configured';

  return (
    <div className={cx(standalone ? 'px-2 py-1.5' : 'border-t border-border-subtle px-2 py-2')}>
      <label className="block text-[11px] text-secondary">
        Gateway
        <select
          value={provider}
          onChange={(event) => setProvider(event.target.value as GatewayProviderChoice)}
          className="mt-1 h-8 w-full rounded-md border border-border-subtle bg-surface/45 px-2 text-[12px] text-primary outline-none focus:border-accent/50"
        >
          <option value="telegram">Telegram</option>
          <option value="slack_mcp">Slack</option>
        </select>
      </label>
      <div className="mt-2 rounded-lg bg-surface/35 px-2 py-1.5 text-[11px] text-dim">
        <p>Status: {statusLabel}</p>
        <p className="truncate">Target: {externalChatLabel || 'No saved target'}</p>
        {binding ? <p className="text-accent">Attached to this thread</p> : null}
      </div>
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          className="ui-toolbar-button rounded-lg px-3 py-1.5 text-[12px] shadow-none"
          onClick={attach}
          disabled={busy || !externalChatId}
        >
          {busy ? 'Working…' : binding ? `Reattach ${providerLabel}` : `Attach ${providerLabel}`}
        </button>
        <button
          type="button"
          className="ui-toolbar-button rounded-lg px-3 py-1.5 text-[12px] shadow-none"
          onClick={detach}
          disabled={busy || !binding}
        >
          Detach
        </button>
      </div>
    </div>
  );
}

function MoreIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 12h.01" />
      <path d="M19 12h.01" />
      <path d="M5 12h.01" />
    </svg>
  );
}

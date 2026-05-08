import type { GatewayConnection, GatewayEvent, GatewayState, GatewayThreadBinding, SessionMeta } from '@personal-agent/extensions/data';
import { api, CONVERSATION_LAYOUT_CHANGED_EVENT, readConversationLayout, timeAgoCompact } from '@personal-agent/extensions/data';
import { AppPageIntro, AppPageLayout, ToolbarButton } from '@personal-agent/extensions/ui';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

const EMPTY_GATEWAY_STATE: GatewayState = { providers: [], connections: [], bindings: [], events: [], chatTargets: [] };
const INPUT_CLASS =
  'w-full rounded-lg border border-border-subtle bg-surface/70 px-3 py-2 text-[13px] text-primary shadow-none transition-colors focus:border-accent/50 focus:bg-surface focus:outline-none disabled:opacity-50';

export function GatewaysPage() {
  const [state, setState] = useState<GatewayState>(EMPTY_GATEWAY_STATE);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [telegramTokenState, setTelegramTokenState] = useState<{ configured: boolean } | null>(null);
  const [telegramTokenLoading, setTelegramTokenLoading] = useState(true);
  const [telegramTokenError, setTelegramTokenError] = useState<string | null>(null);
  const [telegramTokenDraft, setTelegramTokenDraft] = useState('');
  const [telegramTokenEditing, setTelegramTokenEditing] = useState(false);
  const [telegramTokenNotice, setTelegramTokenNotice] = useState<string | null>(null);
  const [telegramTokenSaveError, setTelegramTokenSaveError] = useState<string | null>(null);
  const [telegramChatNotice, setTelegramChatNotice] = useState<string | null>(null);
  const [telegramChatError, setTelegramChatError] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [openThreadIds, setOpenThreadIds] = useState(() => readGatewayOpenThreadIds());
  const [telegramChatIdDraft, setTelegramChatIdDraft] = useState('');
  const [telegramThreadId, setTelegramThreadId] = useState('');

  const telegramConnection = state.connections.find((c) => c.provider === 'telegram') ?? null;
  const telegramBinding = telegramConnection
    ? (state.bindings.find((b) => b.connectionId === telegramConnection.id && b.provider === 'telegram') ?? null)
    : null;
  const telegramChatTarget = telegramConnection
    ? (state.chatTargets.find((target) => target.connectionId === telegramConnection.id && target.provider === 'telegram') ?? null)
    : null;
  const configuredTelegramChatId = telegramChatTarget?.externalChatId || telegramBinding?.externalChatId || '';
  const openThreadIdSet = useMemo(() => new Set(openThreadIds), [openThreadIds]);
  const openSessions = useMemo(() => {
    const byId = new Map(sessions.map((session) => [session.id, session]));
    return openThreadIds.map((threadId) => byId.get(threadId)).filter((session): session is SessionMeta => Boolean(session));
  }, [openThreadIds, sessions]);
  const slackConnection = state.connections.find((c) => c.provider === 'slack_mcp') ?? null;
  const slackBinding = slackConnection
    ? (state.bindings.find((b) => b.connectionId === slackConnection.id && b.provider === 'slack_mcp') ?? null)
    : null;
  const slackChatTarget = slackConnection
    ? (state.chatTargets.find((t) => t.connectionId === slackConnection.id && t.provider === 'slack_mcp') ?? null)
    : null;
  const configuredSlackChannelId = slackChatTarget?.externalChatId || slackBinding?.externalChatId || '';
  const configuredSlackChannelLabel = slackChatTarget?.externalChatLabel || slackBinding?.externalChatLabel || configuredSlackChannelId;
  const [slackAuthState, setSlackAuthState] = useState<{ authenticated: boolean } | null>(null);
  const [slackAuthLoading, setSlackAuthLoading] = useState(true);
  const [slackAuthError, setSlackAuthError] = useState<string | null>(null);
  const [slackAuthNotice, setSlackAuthNotice] = useState<string | null>(null);
  const [slackInput, setSlackInput] = useState('');
  const [slackChannelNotice, setSlackChannelNotice] = useState<string | null>(null);
  const [slackChannelError, setSlackChannelError] = useState<string | null>(null);
  const [slackThreadId, setSlackThreadId] = useState('');

  useEffect(() => {
    let cancelled = false;
    api
      .gateways()
      .then((next) => {
        if (!cancelled) setState(next);
      })
      .catch((err) => {
        if (!cancelled) setError(formatGatewayError(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    function handleConversationLayoutChanged() {
      setOpenThreadIds(readGatewayOpenThreadIds());
    }

    window.addEventListener(CONVERSATION_LAYOUT_CHANGED_EVENT, handleConversationLayoutChanged);
    return () => window.removeEventListener(CONVERSATION_LAYOUT_CHANGED_EVENT, handleConversationLayoutChanged);
  }, []);

  useEffect(() => {
    if (configuredTelegramChatId && !telegramChatIdDraft.trim()) {
      setTelegramChatIdDraft(configuredTelegramChatId);
    }
  }, [configuredTelegramChatId, telegramChatIdDraft]);

  useEffect(() => {
    let cancelled = false;
    api
      .sessions()
      .then((next) => {
        if (cancelled) return;
        setSessions(next);
      })
      .catch((err) => {
        if (!cancelled) setSessionsError(formatGatewayError(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setTelegramThreadId((current) => {
      if (current && openThreadIdSet.has(current)) {
        return current;
      }

      if (telegramBinding?.conversationId && openThreadIdSet.has(telegramBinding.conversationId)) {
        return telegramBinding.conversationId;
      }

      return openSessions[0]?.id ?? '';
    });
  }, [openSessions, openThreadIdSet, telegramBinding?.conversationId]);

  useEffect(() => {
    let cancelled = false;
    api
      .telegramGatewayToken()
      .then((next) => {
        if (!cancelled) setTelegramTokenState(next);
      })
      .catch((err) => {
        if (!cancelled) setTelegramTokenError(formatGatewayError(err));
      })
      .finally(() => {
        if (!cancelled) setTelegramTokenLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    api
      .slackMcpAuthState()
      .then((next) => {
        if (!cancelled) setSlackAuthState(next);
      })
      .catch((err) => {
        if (!cancelled) setSlackAuthError(formatGatewayError(err));
      })
      .finally(() => {
        if (!cancelled) setSlackAuthLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setSlackThreadId((current) => {
      if (current && openThreadIdSet.has(current)) return current;
      if (slackBinding?.conversationId && openThreadIdSet.has(slackBinding.conversationId)) return slackBinding.conversationId;
      return openSessions[0]?.id ?? '';
    });
  }, [openSessions, openThreadIdSet, slackBinding?.conversationId]);

  async function saveTelegramToken() {
    const token = telegramTokenDraft.trim();
    if (!token) {
      setTelegramTokenSaveError('Telegram bot token is required.');
      return;
    }

    setBusy('telegram-token-save');
    setTelegramTokenNotice(null);
    setTelegramTokenSaveError(null);
    setTelegramChatNotice(null);
    try {
      const result = await api.saveTelegramGatewayToken(token);
      setState(result.state);
      setTelegramTokenState({ configured: result.configured });
      setTelegramTokenDraft('');
      setTelegramTokenEditing(false);
      setTelegramTokenNotice('Telegram bot saved. The gateway will attach chats when messages arrive.');
    } catch (err) {
      setTelegramTokenSaveError(formatGatewayError(err));
    } finally {
      setBusy(null);
    }
  }

  async function removeTelegramToken() {
    const confirmed = window.confirm('Remove the Telegram bot token and stop the gateway?');
    if (!confirmed) return;

    setBusy('telegram-token-remove');
    setTelegramTokenNotice(null);
    setTelegramTokenSaveError(null);
    setTelegramChatNotice(null);
    setTelegramChatError(null);
    try {
      const result = await api.deleteTelegramGatewayToken();
      setState(result.state);
      setTelegramTokenState({ configured: result.configured });
      setTelegramTokenDraft('');
      setTelegramTokenEditing(false);
      setTelegramTokenNotice('Telegram bot removed.');
    } catch (err) {
      setTelegramTokenSaveError(formatGatewayError(err));
    } finally {
      setBusy(null);
    }
  }

  async function updateTelegram(enabled: boolean) {
    setBusy(enabled ? 'resume' : 'pause');
    setError(null);
    try {
      setState(await api.updateGatewayConnection('telegram', { status: enabled ? 'active' : 'paused', enabled }));
    } catch (err) {
      setError(formatGatewayError(err));
    } finally {
      setBusy(null);
    }
  }

  async function detachTelegram() {
    if (!telegramBinding) return;
    setBusy('detach');
    setError(null);
    try {
      setState(await api.detachGatewayConversation(telegramBinding.conversationId, 'telegram'));
    } catch (err) {
      setError(formatGatewayError(err));
    } finally {
      setBusy(null);
    }
  }

  async function saveTelegramChatConfig() {
    const chatId = telegramChatIdDraft.trim();
    if (!chatId) {
      setTelegramChatError('Enter a Telegram chat ID.');
      return;
    }

    setBusy('telegram-chat-save');
    setTelegramChatNotice(null);
    setTelegramChatError(null);
    try {
      setState(await api.saveTelegramGatewayChat(chatId));
      setTelegramChatNotice('Telegram chat ID saved.');
    } catch (err) {
      setTelegramChatError(formatGatewayError(err));
    } finally {
      setBusy(null);
    }
  }

  async function attachTelegramChat() {
    const chatId = configuredTelegramChatId;
    const thread = sessions.find((session) => session.id === telegramThreadId) ?? null;
    if (!telegramThreadId) {
      if (telegramBinding) {
        await detachTelegram();
        return;
      }
      setError('Choose an open thread or leave it detached.');
      return;
    }
    if (!chatId || !thread) {
      setError('Save a Telegram chat ID and choose an open thread.');
      return;
    }

    setBusy('telegram-attach');
    setError(null);
    try {
      setState(
        await api.attachGatewayConversation({
          provider: 'telegram',
          conversationId: thread.id,
          conversationTitle: thread.title || thread.id,
          externalChatId: chatId,
          externalChatLabel: chatId,
        }),
      );
      setTelegramChatIdDraft('');
    } catch (err) {
      setError(formatGatewayError(err));
    } finally {
      setBusy(null);
    }
  }

  async function connectSlack() {
    setBusy('slack-connect');
    setSlackAuthNotice(null);
    setSlackAuthError(null);
    try {
      const result = await api.connectSlackMcp();
      setState(result.state);
      setSlackAuthState({ authenticated: result.authenticated });
      setSlackAuthNotice('Slack connected. Search for a channel to attach.');
    } catch (err) {
      setSlackAuthError(formatGatewayError(err));
    } finally {
      setBusy(null);
    }
  }

  async function disconnectSlack() {
    const confirmed = window.confirm('Disconnect Slack and remove stored credentials?');
    if (!confirmed) return;
    setBusy('slack-disconnect');
    setSlackAuthNotice(null);
    setSlackAuthError(null);
    try {
      const result = await api.disconnectSlackMcp();
      setState(result.state);
      setSlackAuthState({ authenticated: result.authenticated });
      setSlackInput('');
      setSlackAuthNotice('Slack disconnected.');
    } catch (err) {
      setSlackAuthError(formatGatewayError(err));
    } finally {
      setBusy(null);
    }
  }

  function parseSlackChannelInput(raw: string): { id: string; name: string } | null {
    const trimmed = raw.trim();
    // Slack archive URL: https://xxx.slack.com/archives/C0B1AHPH4ET
    const urlMatch = trimmed.match(/\/archives\/(C[A-Z0-9]+)/i);
    if (urlMatch) return { id: urlMatch[1].toUpperCase(), name: urlMatch[1].toUpperCase() };
    // Raw channel ID (starts with C followed by alphanumeric)
    if (/^C[A-Z0-9]{8,}$/i.test(trimmed)) return { id: trimmed.toUpperCase(), name: trimmed.toUpperCase() };
    return null;
  }

  async function saveSlackChannel() {
    const parsed = parseSlackChannelInput(slackInput);
    if (!parsed) return;
    setBusy('slack-channel-save');
    setSlackChannelError(null);
    setSlackChannelNotice(null);
    try {
      setState(await api.saveSlackMcpChannel({ channelId: parsed.id, channelLabel: parsed.name }));
      setSlackInput('');
      setSlackChannelNotice(`Channel ${parsed.name} saved.`);
    } catch (err) {
      setSlackChannelError(formatGatewayError(err));
    } finally {
      setBusy(null);
    }
  }

  async function attachSlackThread() {
    const thread = sessions.find((s) => s.id === slackThreadId) ?? null;
    if (!slackThreadId) {
      if (slackBinding) {
        await detachSlack();
        return;
      }
      setError('Choose an open thread or leave it detached.');
      return;
    }
    if (!configuredSlackChannelId || !thread) {
      setError('Save a Slack channel and choose an open thread.');
      return;
    }
    setBusy('slack-attach');
    setError(null);
    try {
      setState(
        await api.attachSlackMcpChannel({
          conversationId: thread.id,
          conversationTitle: thread.title || thread.id,
          externalChatId: configuredSlackChannelId,
          externalChatLabel: configuredSlackChannelLabel,
        }),
      );
    } catch (err) {
      setError(formatGatewayError(err));
    } finally {
      setBusy(null);
    }
  }

  async function detachSlack() {
    if (!slackBinding) return;
    setBusy('slack-detach');
    setError(null);
    try {
      setState(await api.detachGatewayConversation(slackBinding.conversationId, 'slack_mcp'));
    } catch (err) {
      setError(formatGatewayError(err));
    } finally {
      setBusy(null);
    }
  }

  const slackAuthenticated = slackAuthState?.authenticated === true;
  const telegramConfigured = telegramTokenState?.configured === true;
  const showTelegramTokenEditor = !telegramConfigured || telegramTokenEditing;

  return (
    <div className="h-full overflow-y-auto">
      <AppPageLayout shellClassName="max-w-[72rem]" contentClassName="space-y-10">
        <AppPageIntro title="Gateways" summary="Configure external apps and route them into conversation threads." />

        {error ? <p className="text-[13px] text-danger">{error}</p> : null}
        {loading ? <p className="text-[13px] text-dim">Loading…</p> : null}

        <section className="max-w-4xl">
          <h2 className="text-[18px] font-semibold tracking-tight text-primary">Telegram</h2>
          <div className="mt-3 space-y-3 border-t border-border-subtle pt-5">
            <p className="text-[13px] text-secondary">
              Configure one bot and one Telegram chat, then attach that chat to whichever thread should handle it right now.
            </p>
            {telegramTokenLoading && !telegramTokenState ? <p className="text-[13px] text-dim">Loading Telegram config…</p> : null}
            {telegramTokenError && !telegramTokenState ? (
              <p className="text-[13px] text-danger">Failed to load Telegram config: {telegramTokenError}</p>
            ) : null}
            <p className="text-[13px] text-secondary">
              Status:{' '}
              <span className={telegramTokenState?.configured ? 'text-success' : 'text-dim'}>
                {telegramTokenState?.configured ? 'Bot token stored' : 'No bot token stored'}
              </span>
            </p>
            {showTelegramTokenEditor ? (
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                <label className="min-w-0 flex-1 text-[12px] text-secondary">
                  Bot token
                  <input
                    type="password"
                    value={telegramTokenDraft}
                    onChange={(event) => setTelegramTokenDraft(event.target.value)}
                    placeholder="123456:ABC-DEF…"
                    className={`${INPUT_CLASS} mt-1`}
                    disabled={busy !== null}
                  />
                </label>
                <div className="flex shrink-0 gap-2">
                  <ToolbarButton
                    className="rounded-lg px-3 py-1.5 text-[12px] shadow-none"
                    disabled={busy !== null || telegramTokenDraft.trim().length === 0}
                    onClick={saveTelegramToken}
                  >
                    {busy === 'telegram-token-save' ? 'Saving…' : telegramConfigured ? 'Save token' : 'Add bot'}
                  </ToolbarButton>
                  {telegramConfigured ? (
                    <ToolbarButton
                      className="rounded-lg px-3 py-1.5 text-[12px] shadow-none"
                      disabled={busy !== null}
                      onClick={() => {
                        setTelegramTokenDraft('');
                        setTelegramTokenEditing(false);
                        setTelegramTokenSaveError(null);
                      }}
                    >
                      Cancel
                    </ToolbarButton>
                  ) : null}
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                <ToolbarButton
                  className="rounded-lg px-3 py-1.5 text-[12px] shadow-none"
                  disabled={busy !== null}
                  onClick={() => {
                    setTelegramTokenEditing(true);
                    setTelegramTokenNotice(null);
                    setTelegramTokenSaveError(null);
                    setTelegramChatNotice(null);
                  }}
                >
                  Replace token
                </ToolbarButton>
                <ToolbarButton
                  className="rounded-lg px-3 py-1.5 text-[12px] shadow-none"
                  disabled={busy !== null}
                  onClick={removeTelegramToken}
                >
                  {busy === 'telegram-token-remove' ? 'Removing…' : 'Remove bot'}
                </ToolbarButton>
              </div>
            )}
            {telegramTokenNotice ? <p className="text-[12px] text-success">{telegramTokenNotice}</p> : null}
            {telegramTokenSaveError ? <p className="text-[12px] text-danger">{telegramTokenSaveError}</p> : null}

            <div className="border-t border-border-subtle pt-4">
              <h3 className="text-[13px] font-medium text-primary">Chat config</h3>
              <p className="mt-1 text-[12px] text-secondary">Send a message to your bot, then save that Telegram chat ID here.</p>
              <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                <label className="min-w-0 text-[12px] text-secondary">
                  Chat ID
                  <input
                    value={telegramChatIdDraft}
                    onChange={(event) => {
                      setTelegramChatIdDraft(event.target.value);
                      setTelegramChatNotice(null);
                      setTelegramChatError(null);
                    }}
                    placeholder="123456789"
                    className={`${INPUT_CLASS} mt-1`}
                    disabled={busy !== null}
                  />
                </label>
                <ToolbarButton
                  className="rounded-lg px-3 py-1.5 text-[12px] shadow-none"
                  disabled={busy !== null || !telegramTokenState?.configured || !telegramChatIdDraft.trim()}
                  onClick={saveTelegramChatConfig}
                >
                  {busy === 'telegram-chat-save' ? 'Saving…' : configuredTelegramChatId ? 'Save chat ID' : 'Add chat ID'}
                </ToolbarButton>
              </div>
              {telegramChatNotice ? <p className="mt-2 text-[12px] text-success">{telegramChatNotice}</p> : null}
              {telegramChatError ? <p className="mt-2 text-[12px] text-danger">{telegramChatError}</p> : null}
            </div>

            <div className="border-t border-border-subtle pt-4">
              <h3 className="text-[13px] font-medium text-primary">Thread attachment</h3>
              <p className="mt-1 text-[12px] text-secondary">Swap the saved Telegram chat between conversation threads as needed.</p>
              {sessionsError ? <p className="mt-2 text-[12px] text-danger">Failed to load threads: {sessionsError}</p> : null}
              <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                <label className="min-w-0 text-[12px] text-secondary">
                  Thread
                  <select
                    className={`${INPUT_CLASS} mt-1`}
                    value={telegramThreadId}
                    onChange={(event) => setTelegramThreadId(event.target.value)}
                    disabled={busy !== null || sessions.length === 0}
                  >
                    <option value="">No thread (detached)</option>
                    {openSessions.map((session) => (
                      <option key={session.id} value={session.id}>
                        {session.title || session.id}
                      </option>
                    ))}
                  </select>
                </label>
                <ToolbarButton
                  className="rounded-lg px-3 py-1.5 text-[12px] shadow-none"
                  disabled={busy !== null || !configuredTelegramChatId || (!telegramThreadId && !telegramBinding)}
                  onClick={attachTelegramChat}
                >
                  {busy === 'telegram-attach'
                    ? 'Attaching…'
                    : !telegramThreadId && telegramBinding
                      ? 'Detach thread'
                      : telegramBinding
                        ? 'Update attachment'
                        : 'Attach thread'}
                </ToolbarButton>
              </div>
            </div>
            {telegramBinding ? (
              <GatewayRow
                connection={telegramConnection}
                binding={telegramBinding}
                busy={busy}
                icon="TG"
                iconBg="bg-sky-500"
                title="Telegram"
                targetLabel="Chat ID"
                onPause={() => updateTelegram(false)}
                onResume={() => updateTelegram(true)}
                onDetach={detachTelegram}
                showPauseResume
              />
            ) : null}
          </div>
        </section>

        {/* Slack MCP gateway */}
        <section className="max-w-4xl">
          <h2 className="text-[18px] font-semibold tracking-tight text-primary">Slack MCP</h2>
          <div className="mt-3 space-y-3 border-t border-border-subtle pt-5">
            <p className="text-[13px] text-secondary">
              Connect via Slack OAuth, pick a channel, then attach it to whichever thread should handle incoming messages.
            </p>

            {/* Auth */}
            {slackAuthLoading && !slackAuthState ? <p className="text-[13px] text-dim">Loading Slack config…</p> : null}
            {slackAuthError && !slackAuthState ? (
              <p className="text-[13px] text-danger">Failed to load Slack config: {slackAuthError}</p>
            ) : null}
            <p className="text-[13px] text-secondary">
              Status:{' '}
              <span className={slackAuthenticated ? 'text-success' : 'text-dim'}>{slackAuthenticated ? 'Connected' : 'Not connected'}</span>
            </p>
            <div className="flex flex-wrap gap-2">
              {!slackAuthenticated ? (
                <ToolbarButton className="rounded-lg px-3 py-1.5 text-[12px] shadow-none" disabled={busy !== null} onClick={connectSlack}>
                  {busy === 'slack-connect' ? 'Connecting…' : 'Connect Slack'}
                </ToolbarButton>
              ) : (
                <ToolbarButton
                  className="rounded-lg px-3 py-1.5 text-[12px] shadow-none"
                  disabled={busy !== null}
                  onClick={disconnectSlack}
                >
                  {busy === 'slack-disconnect' ? 'Disconnecting…' : 'Disconnect'}
                </ToolbarButton>
              )}
            </div>
            {slackAuthNotice ? <p className="text-[12px] text-success">{slackAuthNotice}</p> : null}
            {slackAuthError && slackAuthState ? <p className="text-[12px] text-danger">{slackAuthError}</p> : null}

            {/* Channel picker */}
            {slackAuthenticated ? (
              <div className="border-t border-border-subtle pt-4">
                <h3 className="text-[13px] font-medium text-primary">Channel config</h3>
                <p className="mt-1 text-[12px] text-secondary">
                  Paste a Slack channel URL or channel ID (C…). In Slack, right-click a channel → Copy link.
                </p>
                <div className="mt-3 flex gap-2">
                  <input
                    className="min-w-0 flex-1 rounded-lg border border-border-subtle bg-surface/70 px-3 py-1.5 text-[13px] text-primary placeholder:text-dim outline-none transition-colors focus:border-accent/50 disabled:opacity-50"
                    value={slackInput}
                    onChange={(e) => setSlackInput(e.target.value)}
                    placeholder="https://…/archives/C… or C0B1AHPH4ET"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void saveSlackChannel();
                    }}
                    disabled={busy !== null}
                  />
                  <ToolbarButton
                    className="rounded-lg px-3 py-1.5 text-[12px] shadow-none"
                    onClick={saveSlackChannel}
                    disabled={busy !== null || !parseSlackChannelInput(slackInput)}
                  >
                    {busy === 'slack-channel-save' ? 'Saving…' : 'Save'}
                  </ToolbarButton>
                </div>
                {slackChannelNotice ? <p className="mt-2 text-[12px] text-success">{slackChannelNotice}</p> : null}
                {slackChannelError ? <p className="mt-2 text-[12px] text-danger">{slackChannelError}</p> : null}
              </div>
            ) : null}

            {/* Thread attachment — mirrors Telegram */}
            {slackAuthenticated ? (
              <div className="border-t border-border-subtle pt-4">
                <h3 className="text-[13px] font-medium text-primary">Thread attachment</h3>
                <p className="mt-1 text-[12px] text-secondary">Attach the saved channel to whichever thread should handle it right now.</p>
                {sessionsError ? <p className="mt-2 text-[12px] text-danger">Failed to load threads: {sessionsError}</p> : null}
                <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                  <label className="min-w-0 text-[12px] text-secondary">
                    Thread
                    <select
                      className={`${INPUT_CLASS} mt-1`}
                      value={slackThreadId}
                      onChange={(e) => setSlackThreadId(e.target.value)}
                      disabled={busy !== null || sessions.length === 0}
                    >
                      <option value="">No thread (detached)</option>
                      {openSessions.map((session) => (
                        <option key={session.id} value={session.id}>
                          {session.title || session.id}
                        </option>
                      ))}
                    </select>
                  </label>
                  <ToolbarButton
                    className="rounded-lg px-3 py-1.5 text-[12px] shadow-none"
                    disabled={busy !== null || !configuredSlackChannelId || (!slackThreadId && !slackBinding)}
                    onClick={attachSlackThread}
                  >
                    {busy === 'slack-attach'
                      ? 'Attaching…'
                      : !slackThreadId && slackBinding
                        ? 'Detach thread'
                        : slackBinding
                          ? 'Update attachment'
                          : 'Attach thread'}
                  </ToolbarButton>
                </div>
              </div>
            ) : null}

            {/* Status row when connected */}
            {slackBinding && slackConnection ? (
              <GatewayRow
                connection={slackConnection}
                binding={slackBinding}
                busy={busy}
                icon="SL"
                iconBg="bg-purple-600"
                title="Slack MCP"
                targetLabel="Slack channel"
                onDetach={detachSlack}
              />
            ) : null}
          </div>
        </section>

        {/* Activity */}
        <GatewayActivity events={state.events} />
      </AppPageLayout>
    </div>
  );
}

function GatewayRow({
  connection,
  binding,
  busy,
  icon,
  iconBg,
  title,
  targetLabel,
  onPause,
  onResume,
  onDetach,
  showPauseResume = false,
}: {
  connection: GatewayConnection;
  binding: GatewayThreadBinding | null;
  busy: string | null;
  icon: string;
  iconBg: string;
  title: string;
  targetLabel: string;
  onPause?: () => void;
  onResume?: () => void;
  onDetach: () => void;
  showPauseResume?: boolean;
}) {
  const active = connection.enabled && (connection.status === 'active' || connection.status === 'connected');
  const statusDot =
    connection.status === 'needs_attention'
      ? 'bg-danger'
      : connection.status === 'paused'
        ? 'bg-warning'
        : active
          ? 'bg-success'
          : 'bg-dim';
  const statusLabel =
    connection.status === 'needs_attention'
      ? 'Needs attention'
      : connection.status === 'paused'
        ? 'Paused'
        : active
          ? 'Active'
          : formatStatus(connection.status);

  return (
    <div className="grid gap-3 border-t border-border-subtle py-5 first:border-t-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start sm:gap-6">
      <div className="flex min-w-0 items-center gap-3">
        <div className={`grid h-7 w-7 shrink-0 place-items-center rounded-md text-[10px] font-bold text-white ${iconBg}`}>{icon}</div>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="text-[14px] font-medium">{title}</span>
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${statusDot}`} />
          <span className="text-[13px] text-secondary">{statusLabel}</span>
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        {binding ? (
          <Link
            className="ui-toolbar-button rounded-lg px-3 py-1.5 text-[12px] shadow-none"
            to={`/conversations/${encodeURIComponent(binding.conversationId)}`}
          >
            Open thread
          </Link>
        ) : null}
        {binding ? (
          <ToolbarButton className="rounded-lg px-3 py-1.5 text-[12px] shadow-none" onClick={onDetach} disabled={busy !== null}>
            Detach
          </ToolbarButton>
        ) : null}
        {showPauseResume && onPause && onResume ? (
          <ToolbarButton
            className="rounded-lg px-3 py-1.5 text-[12px] shadow-none"
            onClick={active ? onPause : onResume}
            disabled={busy !== null}
          >
            {active ? 'Pause' : 'Resume'}
          </ToolbarButton>
        ) : null}
      </div>
      <dl className="grid grid-cols-3 gap-6 text-[13px] sm:col-span-2 max-sm:grid-cols-1">
        <GatewayMeta label="Thread" value={binding?.conversationTitle || binding?.conversationId || '—'} muted={!binding} />
        <GatewayMeta
          label={targetLabel}
          value={binding?.externalChatLabel || binding?.externalChatId || '—'}
          muted={!binding?.externalChatId}
        />
        <GatewayMeta label="Updated" value={timeAgoCompact(connection.updatedAt)} />
      </dl>
    </div>
  );
}

function GatewayMeta({ label, value, muted = false }: { label: string; value: string; muted?: boolean }) {
  return (
    <div>
      <dt className="text-[10px] font-semibold uppercase tracking-[0.14em] text-dim">{label}</dt>
      <dd className={`mt-1 truncate ${muted ? 'text-secondary' : 'text-primary'}`}>{value}</dd>
    </div>
  );
}

function GatewayActivity({ events }: { events: GatewayEvent[] }) {
  const rows = useMemo(() => events.slice(0, 10), [events]);
  return (
    <section className="max-w-4xl">
      <div className="flex items-baseline justify-between">
        <h2 className="text-[18px] font-semibold tracking-tight text-primary">Recent activity</h2>
        <p className="text-[12px] text-dim">Last 100 retained</p>
      </div>
      <div className="mt-3 border-t border-border-subtle">
        {rows.length === 0 ? (
          <p className="py-6 text-[14px] text-secondary">No activity yet.</p>
        ) : (
          rows.map((event) => (
            <div key={event.id} className="flex items-baseline gap-6 border-t border-border-subtle py-3 text-[13px] first:border-t-0">
              <span className="w-20 shrink-0 text-[12px] text-dim">{timeAgoCompact(event.createdAt)}</span>
              <span className="min-w-0 flex-1">{event.message}</span>
              <span className="shrink-0 text-[12px] text-secondary">{formatActivityKind(event.kind)}</span>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function formatStatus(status: string): string {
  return status.replace(/_/g, ' ');
}

function formatActivityKind(kind: string): string {
  const normalized = kind.replace(/_/g, ' ');
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function formatGatewayError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return /Unexpected token.*doctype|not valid JSON/i.test(message) ? 'Gateway API is unavailable in this preview.' : message;
}

function readGatewayOpenThreadIds(): string[] {
  const layout = readConversationLayout();
  return [...layout.pinnedSessionIds, ...layout.sessionIds];
}

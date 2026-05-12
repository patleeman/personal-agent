import type { NativeExtensionClient } from '@personal-agent/extensions';
import type { GatewayState, SessionMeta } from '@personal-agent/extensions/data';
import { api } from '@personal-agent/extensions/data';
import { AppPageIntro, AppPageLayout, ToolbarButton } from '@personal-agent/extensions/ui';
import { useCallback, useEffect, useMemo, useState } from 'react';

const INPUT_CLASS =
  'w-full rounded-lg border border-border-subtle bg-surface/70 px-3 py-2 text-[13px] text-primary shadow-none transition-colors focus:border-accent/50 focus:bg-surface focus:outline-none disabled:opacity-50';
const EMPTY_GATEWAY_STATE: GatewayState = { providers: [], connections: [], bindings: [], events: [], chatTargets: [] };

interface SlackMcpGatewayPageProps {
  pa: NativeExtensionClient;
}

export function SlackMcpGatewayPage({ pa }: SlackMcpGatewayPageProps) {
  const [state, setState] = useState<GatewayState>(EMPTY_GATEWAY_STATE);
  const [auth, setAuth] = useState<{ authenticated: boolean } | null>(null);
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [channelId, setChannelId] = useState('');
  const [conversationId, setConversationId] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    const [nextState, nextAuth, nextSessions] = await Promise.all([
      pa.extension.invoke('state') as Promise<GatewayState>,
      pa.extension.invoke('authState') as Promise<{ authenticated: boolean }>,
      api.sessions(),
    ]);
    setState(nextState);
    setAuth(nextAuth);
    setSessions(nextSessions);
  }, [pa]);

  useEffect(() => {
    void refresh().catch((err) => setError(String(err)));
  }, [refresh]);

  const slackConnection = state.connections.find((connection) => connection.provider === 'slack_mcp') ?? null;
  const slackBinding = slackConnection
    ? (state.bindings.find((binding) => binding.connectionId === slackConnection.id && binding.provider === 'slack_mcp') ?? null)
    : null;
  const slackChatTarget = slackConnection
    ? (state.chatTargets.find((target) => target.connectionId === slackConnection.id && target.provider === 'slack_mcp') ?? null)
    : null;
  const configuredChannelId = slackChatTarget?.externalChatId || slackBinding?.externalChatId || '';
  const selectedSession = useMemo(() => sessions.find((session) => session.id === conversationId), [conversationId, sessions]);

  async function run(label: string, fn: () => Promise<unknown>) {
    setBusy(label);
    setError(null);
    try {
      await fn();
      await refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      pa.ui.notify({ type: 'error', message, source: 'slack-mcp-gateway' });
    } finally {
      setBusy(null);
    }
  }

  return (
    <AppPageLayout
      intro={
        <AppPageIntro
          eyebrow="Experimental"
          title="Slack MCP Gateway"
          description="Connect a Slack channel to PA conversations through the Slack MCP server. This extension is off by default; disable it when you are not actively testing."
        />
      }
      actions={
        <ToolbarButton onClick={() => void refresh()} disabled={busy !== null}>
          Refresh
        </ToolbarButton>
      }
    >
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-8 py-6 text-[13px] text-secondary">
        {error ? <div className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-danger">{error}</div> : null}

        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-primary">Authentication</h2>
          <p>Slack MCP is {auth?.authenticated ? 'authenticated' : 'not authenticated'}.</p>
          <div className="flex gap-2">
            <ToolbarButton onClick={() => void run('connect', () => pa.extension.invoke('connect'))} disabled={busy !== null}>
              {auth?.authenticated ? 'Reconnect' : 'Connect Slack'}
            </ToolbarButton>
            <ToolbarButton
              onClick={() => void run('disconnect', () => pa.extension.invoke('disconnect'))}
              disabled={busy !== null || !auth?.authenticated}
            >
              Disconnect
            </ToolbarButton>
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-primary">Channel</h2>
          <p>
            Current channel: <span className="font-mono text-primary">{configuredChannelId || 'none'}</span>
          </p>
          <div className="flex gap-2">
            <input
              className={INPUT_CLASS}
              value={channelId}
              onChange={(event) => setChannelId(event.target.value)}
              placeholder="Slack channel ID, e.g. C0123ABC"
            />
            <ToolbarButton
              onClick={() => void run('save-channel', () => pa.extension.invoke('saveChannel', { channelId }))}
              disabled={busy !== null || !channelId.trim()}
            >
              Save
            </ToolbarButton>
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-primary">Conversation binding</h2>
          <select className={INPUT_CLASS} value={conversationId} onChange={(event) => setConversationId(event.target.value)}>
            <option value="">Select a conversation…</option>
            {sessions.map((session) => (
              <option key={session.id} value={session.id}>
                {session.title || session.id}
              </option>
            ))}
          </select>
          <ToolbarButton
            onClick={() =>
              void run('attach', () =>
                pa.extension.invoke('attach', {
                  conversationId,
                  conversationTitle: selectedSession?.title,
                  externalChatId: configuredChannelId || channelId,
                }),
              )
            }
            disabled={busy !== null || !conversationId || !(configuredChannelId || channelId).trim()}
          >
            Attach channel
          </ToolbarButton>
        </section>
      </div>
    </AppPageLayout>
  );
}

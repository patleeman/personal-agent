import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { api } from '../../client/api';
import type { GatewayState } from '../../shared/types';

interface ConversationGatewayAttachActionProps {
  conversationId: string;
  conversationTitle: string;
}

export function ConversationGatewayAttachAction({ conversationId, conversationTitle }: ConversationGatewayAttachActionProps) {
  const [state, setState] = useState<GatewayState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

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
  }, []);

  const telegram = useMemo(() => {
    const connection = state?.connections.find((candidate) => candidate.provider === 'telegram') ?? null;
    const binding = connection
      ? (state?.bindings.find((candidate) => candidate.provider === 'telegram' && candidate.connectionId === connection.id) ?? null)
      : null;
    const chatTarget = connection
      ? (state?.chatTargets.find((candidate) => candidate.provider === 'telegram' && candidate.connectionId === connection.id) ?? null)
      : null;
    const chatId = chatTarget?.externalChatId || binding?.externalChatId || '';
    const chatLabel = chatTarget?.externalChatLabel || binding?.externalChatLabel || chatId;
    return { connection, binding, chatId, chatLabel };
  }, [state]);

  if (!state) {
    return null;
  }

  if (!telegram.connection || !telegram.chatId) {
    return (
      <div className="flex flex-wrap items-center gap-2 text-[12px] text-secondary">
        <Link className="ui-toolbar-button rounded-lg px-3 py-1.5 text-[12px] shadow-none" to="/gateways">
          Set up gateway
        </Link>
      </div>
    );
  }

  const attachedHere = telegram.binding?.conversationId === conversationId;

  async function attachTelegram() {
    if (!telegram.chatId) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const next = await api.attachGatewayConversation({
        provider: 'telegram',
        conversationId,
        conversationTitle,
        externalChatId: telegram.chatId,
        externalChatLabel: telegram.chatLabel,
      });
      setState(next);
      setNotice('Telegram attached to this thread.');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function detachTelegram() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const next = await api.detachGatewayConversation(conversationId, 'telegram');
      setState(next);
      setNotice('Telegram detached.');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-[12px] text-secondary">
      {attachedHere ? (
        <>
          <span className="text-success">Telegram attached</span>
          <button
            type="button"
            className="ui-toolbar-button rounded-lg px-3 py-1.5 text-[12px] shadow-none"
            onClick={detachTelegram}
            disabled={busy}
          >
            {busy ? 'Detaching…' : 'Detach'}
          </button>
        </>
      ) : (
        <button
          type="button"
          className="ui-toolbar-button rounded-lg px-3 py-1.5 text-[12px] shadow-none"
          onClick={attachTelegram}
          disabled={busy}
        >
          {busy ? 'Attaching…' : telegram.binding ? 'Move Telegram here' : 'Attach Telegram'}
        </button>
      )}
      {notice ? <span className="text-success">{notice}</span> : null}
      {error ? <span className="text-danger">{error}</span> : null}
    </div>
  );
}

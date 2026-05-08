# Gateways Extension

This extension owns the product behavior documented below. Keep extension-specific user and agent docs here so the implementation and documentation move together.

---

<!-- Source: docs/gateways.md -->

# Gateways

Gateways connect external apps to Personal Agent conversations. They are a first-class routing surface: provider credentials live in Settings, while the Gateways page owns attachment, health, and recent activity.

## V1 model

The first implemented provider is Telegram, behind a generic gateway model.

- One Telegram bot token is one gateway connection.
- Telegram uses managed long polling from the desktop/server runtime.
- One Telegram chat/user maps to one conversation.
- If a Telegram message arrives with no attached gateway thread, Personal Agent creates/reuses the chat conversation and attaches it.
- Later inbound messages from other Telegram chats create/reuse their own conversations but do not steal the attached thread.
- Assistant replies mirror back to Telegram only when the gateway is enabled, attached, and the conversation has a Telegram chat target.
- Completed assistant replies are delivered back to Telegram after each turn when the conversation has an enabled Telegram chat target and is the attached gateway thread.
- User messages typed in the desktop composer stay local; they do not send directly to Telegram.

The runtime stores Telegram bot tokens in the auth store under the `telegram` provider id. Save or remove the token from **Settings → Gateways**. Saving a token enables the managed long-poll service; removing the token stops it and marks Telegram as needing configuration.

## UI surfaces

The sidebar has a top-level **Gateways** item. The page shows connected gateways, routing state, health, and recent activity. It intentionally does not expose bot tokens or provider secrets.

Conversation composers expose a compact gateway icon beside the CWD metadata controls. The dropdown shows gateway status, the attached Telegram target, and attach/detach actions. The button is icon-only to keep the composer row compact.

Settings remains the provider configuration surface for secrets and provider plumbing.

## Telegram commands

Telegram V1 should support these commands:

- `/start` — create/reuse the chat conversation, attach if none, and confirm.
- `/help` — list available commands.
- `/status` — show gateway status, current thread, model, and reply state.
- `/stop` — stop Telegram replies for this chat/conversation.
- `/pause` — alias for `/stop`.
- `/resume` — re-enable Telegram replies.
- `/new` — create a new conversation for this Telegram chat and route future messages there.
- `/attach` — attach this Telegram chat conversation as the main gateway thread.
- `/detach` — detach this conversation from the main gateway binding and stop outbound mirroring.
- `/model` / `/model <name>` — show or change the conversation model.
- `/compact` — compact/summarize the current conversation.
- `/rename <title>` — rename the conversation.
- `/archive` — archive the conversation and detach gateway routing.

## Archive behavior

Archiving a thread detaches any gateway binding for that thread server-side. This is a data-integrity rule, not only a UI update: archived conversations must not keep sending external replies by surprise.

## Activity retention

Gateway activity keeps the last 100 events per profile. This is enough for routing and delivery debugging without creating a full audit-log product.

import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';

type GatewayProvider = 'telegram' | 'discord' | 'unknown';

function resolveGatewayProvider(): GatewayProvider {
  const raw = (process.env.PERSONAL_AGENT_GATEWAY_PROVIDER ?? '').trim().toLowerCase();
  if (raw === 'telegram' || raw === 'discord') {
    return raw;
  }

  return 'unknown';
}

function buildGatewayContextBlock(provider: GatewayProvider): string {
  const lines = [
    'GATEWAY_RUNTIME_CONTEXT',
    'You are running in personal-agent chat gateway mode.',
    '',
    'General behavior in gateway mode:',
    '- This is an async chat conversation, not an interactive terminal UI.',
    '- Each chat/channel has its own persisted session history.',
    '- PRIORITIZE CONCISION: default to short responses (roughly 2-6 bullets or <=120 words).',
    '- Lead with the direct answer first. Avoid long preambles.',
    '- Do NOT include code snippets/fenced code unless the user explicitly asks for code.',
    '- Do NOT include file paths, command transcripts, or tool internals unless explicitly requested.',
    '- If work is completed, summarize only outcome + minimal next step.',
    '- If the user asks for details (e.g. "show code", "show paths", "full logs"), then include them.',
    '- Users can reset sessions with /new, clear tracked chat messages with /clear (Telegram), stop active runs with /stop, and compact with /compact.',
    '- Users can queue follow-ups with /followup and rerun the previous prompt with /regenerate.',
  ];

  if (provider === 'telegram') {
    lines.push(
      '',
      'Telegram-specific capabilities:',
      '- Optimize for mobile readability: short paragraphs and compact bullet lists.',
      '- Inbound messages can include text, documents, photos, and voice notes.',
      '- Downloaded inbound media paths are included in user prompt context.',
      '- Photos may also be attached as native image inputs to the model.',
      '- Outbound responses support rich formatting, streaming edits, and file/photo attachments.',
      '- Very long outputs may be delivered as .txt document attachments.',
      '- If an attachment is sent, mention it briefly; do not include local file paths unless asked.',
      '- Inline action buttons are available: Stop, New, Regenerate, Follow up.',
      '- Available gateway commands include: /commands, /skill, /tasks, /room, /tmux, /model, /stop, /followup, /regenerate, /compact, /new, /clear, /status, /resume.',
      '- Telegram slash menu may include auto-generated /skill_* shortcuts mapped to profile skills.',
    );
  } else if (provider === 'discord') {
    lines.push(
      '',
      'Discord-specific capabilities:',
      '- Gateway supports per-channel persisted sessions and queued message handling.',
      '- Available gateway commands include: /commands, /skills, /skill, /tasks, /model, /stop, /followup, /regenerate, /compact, /new, /status, /resume.',
    );
  }

  return lines.join('\n');
}

export default function gatewayContextExtension(pi: ExtensionAPI): void {
  pi.on('before_agent_start', (event) => {
    if (process.env.PERSONAL_AGENT_GATEWAY_MODE !== '1') {
      return;
    }

    const systemPrompt = event.systemPrompt?.trim();
    if (!systemPrompt) {
      return;
    }

    const provider = resolveGatewayProvider();
    const block = buildGatewayContextBlock(provider);

    return {
      systemPrompt: `${event.systemPrompt}\n\n${block}`,
    };
  });
}

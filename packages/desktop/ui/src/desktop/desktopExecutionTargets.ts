import type { DesktopConnectionsState, DesktopHostRecord } from '../shared/types';

export interface ConversationExecutionTargetOption {
  value: string;
  label: string;
}

export function buildContinueInExecutionTargetOptions(
  connections: DesktopConnectionsState | null | undefined,
): ConversationExecutionTargetOption[] {
  if (!connections) {
    return [];
  }

  return [
    { value: 'local', label: 'Local' },
    ...connections.hosts.map((host) => ({ value: host.id, label: host.label })),
  ];
}

export function resolveConversationExecutionTargetOptions(input: {
  continueInOptions: ConversationExecutionTargetOption[];
  hasDesktopBridge: boolean;
  currentRemoteHostId?: string | null;
  currentRemoteHostLabel?: string | null;
  currentRemoteConversationId?: string | null;
}): ConversationExecutionTargetOption[] {
  const baseOptions = input.continueInOptions.length > 0
    ? [...input.continueInOptions]
    : (input.hasDesktopBridge ? [{ value: 'local', label: 'Local' }] : []);
  const currentRemoteHostId = input.currentRemoteHostId?.trim() || '';
  const currentRemoteHostLabel = input.currentRemoteHostLabel?.trim() || currentRemoteHostId;
  const currentRemoteConversationId = input.currentRemoteConversationId?.trim() || '';

  if (currentRemoteHostId && !baseOptions.some((option) => option.value === currentRemoteHostId)) {
    baseOptions.push({ value: currentRemoteHostId, label: currentRemoteHostLabel });
  } else if (!currentRemoteHostId && currentRemoteConversationId) {
    const fallbackRemoteValue = buildRemoteConversationExecutionTargetId(currentRemoteConversationId);
    if (!baseOptions.some((option) => option.value === fallbackRemoteValue)) {
      baseOptions.push({ value: fallbackRemoteValue, label: 'Remote' });
    }
  }

  return baseOptions;
}

export function buildRemoteConversationExecutionTargetId(remoteConversationId: string): string {
  return `remote-conversation:${remoteConversationId}`;
}

export function resolveSelectedConversationExecutionTargetId(input: {
  draft: boolean;
  draftExecutionTargetId: string;
  currentRemoteHostId?: string | null;
  currentRemoteConversationId?: string | null;
}): string {
  if (input.draft) {
    return input.draftExecutionTargetId;
  }

  const currentRemoteHostId = input.currentRemoteHostId?.trim() || '';
  if (currentRemoteHostId) {
    return currentRemoteHostId;
  }

  const currentRemoteConversationId = input.currentRemoteConversationId?.trim() || '';
  return currentRemoteConversationId
    ? buildRemoteConversationExecutionTargetId(currentRemoteConversationId)
    : 'local';
}

export function findSelectedExecutionTargetHost(input: {
  selectedTargetId: string;
  connections: DesktopConnectionsState | null | undefined;
}): Extract<DesktopHostRecord, { kind: 'ssh' }> | null {
  return input.selectedTargetId === 'local'
    ? null
    : input.connections?.hosts.find((host) => host.id === input.selectedTargetId) ?? null;
}

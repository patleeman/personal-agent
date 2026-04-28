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
}): ConversationExecutionTargetOption[] {
  const baseOptions = input.continueInOptions.length > 0
    ? [...input.continueInOptions]
    : (input.hasDesktopBridge ? [{ value: 'local', label: 'Local' }] : []);
  const currentRemoteHostId = input.currentRemoteHostId?.trim() || '';
  const currentRemoteHostLabel = input.currentRemoteHostLabel?.trim() || currentRemoteHostId;

  if (currentRemoteHostId && !baseOptions.some((option) => option.value === currentRemoteHostId)) {
    baseOptions.push({ value: currentRemoteHostId, label: currentRemoteHostLabel });
  }

  return baseOptions;
}

export function findSelectedExecutionTargetHost(input: {
  selectedTargetId: string;
  connections: DesktopConnectionsState | null | undefined;
}): Extract<DesktopHostRecord, { kind: 'ssh' }> | null {
  return input.selectedTargetId === 'local'
    ? null
    : input.connections?.hosts.find((host) => host.id === input.selectedTargetId) ?? null;
}

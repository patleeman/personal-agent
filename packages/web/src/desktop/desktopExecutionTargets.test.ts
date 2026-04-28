import { describe, expect, it } from 'vitest';
import type { DesktopConnectionsState } from '../shared/types';
import {
  buildContinueInExecutionTargetOptions,
  findSelectedExecutionTargetHost,
  resolveConversationExecutionTargetOptions,
} from './desktopExecutionTargets';

const connections: DesktopConnectionsState = {
  hosts: [
    { id: 'host-a', label: 'Host A', kind: 'ssh', sshTarget: 'host-a.example.com' },
    { id: 'host-b', label: 'Host B', kind: 'ssh', sshTarget: 'host-b.example.com' },
  ],
};

describe('desktop execution target helpers', () => {
  it('builds continue-in options from desktop connections', () => {
    expect(buildContinueInExecutionTargetOptions(connections)).toEqual([
      { value: 'local', label: 'Local' },
      { value: 'host-a', label: 'Host A' },
      { value: 'host-b', label: 'Host B' },
    ]);
    expect(buildContinueInExecutionTargetOptions(null)).toEqual([]);
  });

  it('keeps the current remote target available even when connections are stale', () => {
    expect(resolveConversationExecutionTargetOptions({
      continueInOptions: [{ value: 'local', label: 'Local' }],
      hasDesktopBridge: true,
      currentRemoteHostId: ' host-z ',
      currentRemoteHostLabel: ' Host Z ',
    })).toEqual([
      { value: 'local', label: 'Local' },
      { value: 'host-z', label: 'Host Z' },
    ]);
  });

  it('falls back to local when the desktop bridge exists without loaded options', () => {
    expect(resolveConversationExecutionTargetOptions({
      continueInOptions: [],
      hasDesktopBridge: true,
    })).toEqual([{ value: 'local', label: 'Local' }]);
    expect(resolveConversationExecutionTargetOptions({
      continueInOptions: [],
      hasDesktopBridge: false,
    })).toEqual([]);
  });

  it('finds selected remote hosts from connection state', () => {
    expect(findSelectedExecutionTargetHost({ selectedTargetId: 'local', connections })).toBeNull();
    expect(findSelectedExecutionTargetHost({ selectedTargetId: 'host-b', connections })).toBe(connections.hosts[1]);
    expect(findSelectedExecutionTargetHost({ selectedTargetId: 'missing', connections })).toBeNull();
  });
});

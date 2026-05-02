export type LiveSessionSurfaceType = 'desktop_web' | 'mobile_web';

interface LiveSurfacePresenceRecord {
  surfaceId: string;
  surfaceType: LiveSessionSurfaceType;
  connectedAt: string;
  connections: number;
}

export interface LiveSessionPresence {
  surfaceId: string;
  surfaceType: LiveSessionSurfaceType;
  connectedAt: string;
}

export interface LiveSessionPresenceState {
  surfaces: LiveSessionPresence[];
  controllerSurfaceId: string | null;
  controllerSurfaceType: LiveSessionSurfaceType | null;
  controllerAcquiredAt: string | null;
}

export class LiveSessionControlError extends Error {
  constructor(message = 'This conversation is controlled by another surface. Take over here to continue.') {
    super(message);
    this.name = 'LiveSessionControlError';
  }
}

export interface LiveSessionPresenceHost {
  presenceBySurfaceId?: Map<string, LiveSurfacePresenceRecord>;
  controllerSurfaceId?: string | null;
  controllerAcquiredAt?: string | null;
}

export function createLiveSessionPresenceHost(): Required<LiveSessionPresenceHost> {
  return {
    presenceBySurfaceId: new Map<string, LiveSurfacePresenceRecord>(),
    controllerSurfaceId: null,
    controllerAcquiredAt: null,
  };
}

export function ensureLiveSessionPresenceMap(host: LiveSessionPresenceHost): Map<string, LiveSurfacePresenceRecord> {
  host.presenceBySurfaceId ??= new Map<string, LiveSurfacePresenceRecord>();
  host.controllerSurfaceId ??= null;
  host.controllerAcquiredAt ??= null;
  return host.presenceBySurfaceId;
}

export function buildLiveSessionPresenceState(host: LiveSessionPresenceHost): LiveSessionPresenceState {
  const presenceBySurfaceId = ensureLiveSessionPresenceMap(host);
  const surfaces = [...presenceBySurfaceId.values()]
    .sort((left, right) => {
      const byConnectedAt = left.connectedAt.localeCompare(right.connectedAt);
      return byConnectedAt !== 0 ? byConnectedAt : left.surfaceId.localeCompare(right.surfaceId);
    })
    .map((surface) => ({
      surfaceId: surface.surfaceId,
      surfaceType: surface.surfaceType,
      connectedAt: surface.connectedAt,
    }));
  const controller = host.controllerSurfaceId ? (presenceBySurfaceId.get(host.controllerSurfaceId) ?? null) : null;

  return {
    surfaces,
    controllerSurfaceId: controller?.surfaceId ?? null,
    controllerSurfaceType: controller?.surfaceType ?? null,
    controllerAcquiredAt: controller ? (host.controllerAcquiredAt ?? null) : null,
  };
}

export function registerLiveSessionSurface(
  host: LiveSessionPresenceHost,
  input: {
    surfaceId: string;
    surfaceType: LiveSessionSurfaceType;
  },
): boolean {
  const surfaceId = input.surfaceId.trim();
  if (!surfaceId) {
    return false;
  }

  const presenceBySurfaceId = ensureLiveSessionPresenceMap(host);
  const existing = presenceBySurfaceId.get(surfaceId);
  if (existing) {
    existing.connections += 1;
    if (existing.surfaceType !== input.surfaceType) {
      existing.surfaceType = input.surfaceType;
      return true;
    }
    return false;
  }

  presenceBySurfaceId.set(surfaceId, {
    surfaceId,
    surfaceType: input.surfaceType,
    connectedAt: new Date().toISOString(),
    connections: 1,
  });

  const currentController = host.controllerSurfaceId ? (presenceBySurfaceId.get(host.controllerSurfaceId) ?? null) : null;
  const shouldAdoptController = !currentController || currentController.surfaceType === input.surfaceType;

  if (shouldAdoptController && host.controllerSurfaceId !== surfaceId) {
    host.controllerSurfaceId = surfaceId;
    host.controllerAcquiredAt = new Date().toISOString();
  }

  return true;
}

export function removeLiveSessionSurface(host: LiveSessionPresenceHost, surfaceId: string): boolean {
  const trimmedSurfaceId = surfaceId.trim();
  if (!trimmedSurfaceId) {
    return false;
  }

  const presenceBySurfaceId = ensureLiveSessionPresenceMap(host);
  const existing = presenceBySurfaceId.get(trimmedSurfaceId);
  if (!existing) {
    return false;
  }

  if (existing.connections > 1) {
    existing.connections -= 1;
    return false;
  }

  presenceBySurfaceId.delete(trimmedSurfaceId);

  if (host.controllerSurfaceId === trimmedSurfaceId) {
    host.controllerSurfaceId = null;
    host.controllerAcquiredAt = null;
  }

  return true;
}

export function assertLiveSessionSurfaceCanControl(host: LiveSessionPresenceHost, surfaceId?: string): void {
  if (!surfaceId) {
    return;
  }

  const trimmedSurfaceId = surfaceId.trim();
  if (!trimmedSurfaceId) {
    throw new LiveSessionControlError('Surface id is required to control this conversation.');
  }

  const presenceBySurfaceId = ensureLiveSessionPresenceMap(host);
  if (!presenceBySurfaceId.has(trimmedSurfaceId)) {
    throw new LiveSessionControlError();
  }

  if (!host.controllerSurfaceId) {
    throw new LiveSessionControlError('No surface is currently controlling this conversation. Take over here to continue.');
  }

  if (host.controllerSurfaceId !== trimmedSurfaceId) {
    throw new LiveSessionControlError();
  }
}

export function takeOverLiveSessionSurface(
  host: LiveSessionPresenceHost,
  surfaceId: string,
): { changed: boolean; state: LiveSessionPresenceState } {
  const trimmedSurfaceId = surfaceId.trim();
  const presenceBySurfaceId = ensureLiveSessionPresenceMap(host);
  if (!trimmedSurfaceId || !presenceBySurfaceId.has(trimmedSurfaceId)) {
    throw new LiveSessionControlError('Open the conversation on this surface before taking control.');
  }

  const changed = host.controllerSurfaceId !== trimmedSurfaceId;
  if (changed) {
    host.controllerSurfaceId = trimmedSurfaceId;
    host.controllerAcquiredAt = new Date().toISOString();
  }

  return {
    changed,
    state: buildLiveSessionPresenceState(host),
  };
}

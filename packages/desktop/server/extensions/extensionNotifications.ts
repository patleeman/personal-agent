/**
 * Extension notification system.
 *
 * Provides two notification channels for extensions:
 *   1. System/OS notifications — visible in the notification centre (macOS, etc.)
 *   2. Dock badge count — numeric badge on the app icon
 *
 * Both require the desktop main process IPC bridge.
 */

import type { ExtensionBackendNotifyInput } from './extensionBackend.js';

// ── In-memory badge state ─────────────────────────────────────────────────────

/**
 * Accumulated badge count from all extensions.
 * The desktop app reads this value to set the dock badge.
 */
let aggregatedBadgeCount = 0;
const extensionBadgeCounters = new Map<string, number>();

// ── Badge API ─────────────────────────────────────────────────────────────────

/**
 * Set or clear a badge counter for a specific extension.
 * Negative values are clamped to 0.
 */
export function setExtensionBadge(extensionId: string, count: number): { badge: number; aggregated: number } {
  const clamped = Math.max(0, Math.floor(count));
  extensionBadgeCounters.set(extensionId, clamped);
  aggregatedBadgeCount = computeAggregatedBadge();
  broadcastBadgeUpdate();
  return { badge: clamped, aggregated: aggregatedBadgeCount };
}

/**
 * Clear badge for a specific extension.
 */
export function clearExtensionBadge(extensionId: string): void {
  extensionBadgeCounters.delete(extensionId);
  aggregatedBadgeCount = computeAggregatedBadge();
  broadcastBadgeUpdate();
}

/**
 * Get the current aggregated badge count.
 */
export function getAggregatedBadgeCount(): number {
  return aggregatedBadgeCount;
}

function computeAggregatedBadge(): number {
  let total = 0;
  for (const count of extensionBadgeCounters.values()) {
    total += count;
  }
  return total;
}

// ── Desktop IPC bridge ────────────────────────────────────────────────────────

type BadgeUpdateListener = (count: number) => void;
type SystemNotificationListener = (notification: { title: string; body: string; subtitle?: string; extensionId?: string }) => void;

const badgeListeners = new Set<BadgeUpdateListener>();
const notificationListeners = new Set<SystemNotificationListener>();

/**
 * Register a listener for badge count changes.
 * Used by the Electron main process IPC bridge.
 */
export function onBadgeChanged(listener: BadgeUpdateListener): () => void {
  badgeListeners.add(listener);
  return () => badgeListeners.delete(listener);
}

/**
 * Register a listener for system notification requests.
 * Used by the Electron main process IPC bridge.
 */
export function onSystemNotification(listener: SystemNotificationListener): () => void {
  notificationListeners.add(listener);
  return () => notificationListeners.delete(listener);
}

function broadcastBadgeUpdate(): void {
  for (const listener of badgeListeners) {
    try {
      listener(aggregatedBadgeCount);
    } catch {
      // Listener cleanup is the owner's responsibility
    }
  }
}

// ── Notification API ──────────────────────────────────────────────────────────

export interface SystemNotification {
  title: string;
  body: string;
  subtitle?: string;
  /** If true, the notification persists until acknowledged. */
  persistent?: boolean;
  /** Optional action payload delivered when the user clicks the notification. */
  actionPayload?: unknown;
}

/**
 * Request a system notification.
 * Returns true if at least one listener received the notification.
 */
export function sendSystemNotification(extensionId: string, notification: SystemNotification): boolean {
  if (notificationListeners.size === 0) return false;

  for (const listener of notificationListeners) {
    try {
      listener({ ...notification, extensionId });
    } catch {
      // Individual listener failure is non-fatal
    }
  }
  return true;
}

/**
 * Check whether system notification support is available (at least one listener).
 */
export function isSystemNotificationAvailable(): boolean {
  return notificationListeners.size > 0;
}

/**
 * Convenience: convert an extension backend notify input to a system notification.
 */
export function sendNotifyAsSystemNotification(extensionId: string, input: ExtensionBackendNotifyInput): boolean {
  const body = typeof input.message === 'string' ? input.message : '';
  const title = input.title ?? extensionId;

  return sendSystemNotification(extensionId, {
    title,
    body,
    subtitle: input.subtitle,
    persistent: input.persistent,
    actionPayload: input.actionPayload,
  });
}

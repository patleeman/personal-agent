/**
 * Inter-extension event bus.
 *
 * Extensions can subscribe to named events and publish events that
 * other extensions receive.  Events are delivered asynchronously to
 * all subscribers via their registered handler functions.
 *
 * This is not a message queue — delivery is best-effort and handlers
 * run concurrently.  A failing handler never blocks other subscribers.
 */

import { invalidateAppTopics } from '../shared/appEvents.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ExtensionEvent {
  /** Arbitrary event name, e.g. "task:completed", "knowledge:synced". */
  event: string;
  /** Free-form payload. */
  payload: unknown;
  /** Extension that published the event. */
  sourceExtensionId: string;
  /** ISO-8601 timestamp. */
  publishedAt: string;
}

export type ExtensionEventSubscriber = (event: ExtensionEvent) => void | Promise<void>;

export interface ExtensionSubscription {
  extensionId: string;
  pattern: string;
  unsubscribe: () => void;
}

// ── Registry ──────────────────────────────────────────────────────────────────

interface SubscriptionEntry {
  handler: ExtensionEventSubscriber;
  extensionId: string;
  pattern: string;
}

const subscriptions = new Set<SubscriptionEntry>();

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Subscribe an extension to one or more event patterns.
 *
 * Patterns use a simple glob-like syntax:
 *   "task:*"       — matches "task:completed", "task:failed", etc.
 *   "knowledge:*"  — matches "knowledge:synced", "knowledge:updated", etc.
 *   "*"            — matches everything
 *   "specific:event" — literal match
 */
export function subscribeExtensionEvents(extensionId: string, pattern: string, handler: ExtensionEventSubscriber): ExtensionSubscription {
  const entry: SubscriptionEntry = { handler, extensionId, pattern };
  subscriptions.add(entry);

  return {
    extensionId,
    pattern,
    unsubscribe: () => {
      subscriptions.delete(entry);
    },
  };
}

function patternMatches(pattern: string, eventName: string): boolean {
  if (pattern === '*') return true;
  if (pattern === eventName) return true;

  // Simple glob: "prefix:*" matches "prefix:anything"
  if (pattern.endsWith(':*')) {
    const prefix = pattern.slice(0, -2);
    return eventName.startsWith(prefix) && eventName.length > prefix.length && eventName[prefix.length] === ':';
  }

  return false;
}

/**
 * Publish an event to all matching subscribers.
 */
export async function publishExtensionEvent(sourceExtensionId: string, event: string, payload: unknown): Promise<void> {
  const envelope: ExtensionEvent = {
    event,
    payload,
    sourceExtensionId,
    publishedAt: new Date().toISOString(),
  };

  await Promise.all(
    [...subscriptions]
      .filter((entry) => patternMatches(entry.pattern, event))
      .map((entry) =>
        Promise.resolve(entry.handler(envelope)).catch((error) => {
          console.error(
            `[extension-event-bus] error in "${entry.extensionId}" handler ` +
              `for event "${event}" (pattern "${entry.pattern}"): ${(error as Error).message}`,
          );
        }),
      ),
  );
}

/**
 * Remove all subscriptions for a given extension (e.g. on shutdown / disable).
 */
export function unsubscribeExtensionEvents(extensionId: string): void {
  for (const entry of subscriptions) {
    if (entry.extensionId === extensionId) {
      subscriptions.delete(entry);
    }
  }
}

/**
 * List current subscriptions (for extension manager UI / debugging).
 */
export function listExtensionEventSubscriptions(): Array<{
  extensionId: string;
  pattern: string;
}> {
  return [...subscriptions].map((entry) => ({
    extensionId: entry.extensionId,
    pattern: entry.pattern,
  }));
}

import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';

interface RendererTelemetryEvent {
  category: string;
  name: string;
  route?: string;
  sessionId?: string;
  status?: number;
  durationMs?: number;
  count?: number;
  value?: number;
  metadata?: Record<string, unknown>;
}

function postTelemetry(event: RendererTelemetryEvent): void {
  try {
    const body = JSON.stringify(event);
    if (navigator.sendBeacon) {
      const blob = new Blob([body], { type: 'application/json' });
      if (navigator.sendBeacon('/api/telemetry/event', blob)) return;
    }

    void fetch('/api/telemetry/event', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    // Telemetry must never affect renderer behavior.
  }
}

export function recordRendererTelemetry(event: RendererTelemetryEvent): void {
  postTelemetry(event);
}

function readNavigationTiming(): Record<string, unknown> | undefined {
  const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
  if (!nav) return undefined;
  return {
    type: nav.type,
    domContentLoadedMs: Math.round(nav.domContentLoadedEventEnd),
    loadEventMs: Math.round(nav.loadEventEnd),
    transferSize: nav.transferSize,
    encodedBodySize: nav.encodedBodySize,
  };
}

export function useRouteTelemetry(): void {
  const location = useLocation();
  const previous = useRef<{ route: string; startedAt: number } | null>(null);

  useEffect(() => {
    const route = `${location.pathname}${location.search}`;
    const now = performance.now();
    const prior = previous.current;

    if (prior) {
      recordRendererTelemetry({
        category: 'navigation',
        name: 'route_leave',
        route: prior.route,
        durationMs: Math.max(0, Math.round(now - prior.startedAt)),
        metadata: { nextRoute: route },
      });
    }

    recordRendererTelemetry({
      category: 'navigation',
      name: 'route_view',
      route,
      metadata: {
        referrerRoute: prior?.route,
        viewport: { width: window.innerWidth, height: window.innerHeight },
        navigation: prior ? undefined : readNavigationTiming(),
      },
    });

    previous.current = { route, startedAt: now };
  }, [location.pathname, location.search]);

  useEffect(() => {
    const onVisibilityChange = () => {
      recordRendererTelemetry({
        category: 'renderer',
        name: 'visibility_change',
        route: `${location.pathname}${location.search}`,
        metadata: { visibilityState: document.visibilityState },
      });
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [location.pathname, location.search]);
}

import { DESKTOP_API_STREAM_EVENT, getDesktopBridge } from './desktopBridge';

export interface EventSourceLike {
  onopen: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent<string>) => void) | null;
  onerror: ((event: Event) => void) | null;
  readonly readyState: number;
  close(): void;
}

let desktopEnvironmentPromise: Promise<{ activeHostKind?: string } | null> | null = null;

async function readDesktopEnvironment() {
  const bridge = getDesktopBridge();
  if (!bridge) {
    return null;
  }

  if (!desktopEnvironmentPromise) {
    desktopEnvironmentPromise = bridge.getEnvironment().catch(() => null);
  }

  return desktopEnvironmentPromise;
}

interface DesktopApiStreamEnvelope {
  subscriptionId: string;
  event: {
    type: 'open' | 'message' | 'error' | 'close';
    data?: string;
    message?: string;
  };
}

export class DesktopApiEventSource implements EventSourceLike {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;

  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  readyState = DesktopApiEventSource.CONNECTING;

  private readonly bridge = getDesktopBridge();
  private subscriptionId: string | null = null;
  private nativeSource: EventSource | null = null;
  private closed = false;
  private readonly handleDesktopStreamEvent = (event: Event) => {
    const customEvent = event as CustomEvent<DesktopApiStreamEnvelope>;
    const detail = customEvent.detail;
    if (!detail || detail.subscriptionId !== this.subscriptionId) {
      return;
    }

    switch (detail.event.type) {
      case 'open':
        this.readyState = DesktopApiEventSource.OPEN;
        this.onopen?.(new Event('open'));
        return;
      case 'message':
        this.onmessage?.(new MessageEvent('message', { data: detail.event.data ?? '' }));
        return;
      case 'error':
        this.readyState = DesktopApiEventSource.CONNECTING;
        this.onerror?.(new Event('error'));
        return;
      case 'close':
        this.readyState = DesktopApiEventSource.CLOSED;
        this.detachDesktopListener();
        return;
    }
  };

  constructor(private readonly path: string) {
    void this.initialize();
  }

  close(): void {
    this.closed = true;
    this.readyState = DesktopApiEventSource.CLOSED;

    if (this.nativeSource) {
      this.nativeSource.close();
      this.nativeSource = null;
    }

    this.detachDesktopListener();
    if (this.subscriptionId && this.bridge) {
      void this.bridge.unsubscribeApiStream(this.subscriptionId).catch(() => {
        // Ignore best-effort stream teardown failures.
      });
    }
    this.subscriptionId = null;
  }

  private async initialize(): Promise<void> {
    const environment = await readDesktopEnvironment();
    if (this.closed) {
      return;
    }

    if (!this.bridge || environment?.activeHostKind !== 'local') {
      this.attachNativeSource();
      return;
    }

    this.attachDesktopListener();
    try {
      const { subscriptionId } = await this.bridge.subscribeApiStream(this.path);
      if (this.closed) {
        void this.bridge.unsubscribeApiStream(subscriptionId).catch(() => {
          // Ignore best-effort stream teardown failures.
        });
        return;
      }

      this.subscriptionId = subscriptionId;
    } catch {
      this.readyState = DesktopApiEventSource.CONNECTING;
      this.onerror?.(new Event('error'));
    }
  }

  private attachNativeSource(): void {
    const nativeSource = new EventSource(this.path);
    this.nativeSource = nativeSource;
    nativeSource.onopen = (event) => {
      this.readyState = nativeSource.readyState;
      this.onopen?.(event);
    };
    nativeSource.onmessage = (event) => {
      this.readyState = nativeSource.readyState;
      this.onmessage?.(event as MessageEvent<string>);
    };
    nativeSource.onerror = (event) => {
      this.readyState = nativeSource.readyState;
      this.onerror?.(event);
    };
  }

  private attachDesktopListener(): void {
    window.addEventListener(DESKTOP_API_STREAM_EVENT, this.handleDesktopStreamEvent as EventListener);
  }

  private detachDesktopListener(): void {
    window.removeEventListener(DESKTOP_API_STREAM_EVENT, this.handleDesktopStreamEvent as EventListener);
  }
}

export function createDesktopAwareEventSource(path: string): EventSourceLike {
  return new DesktopApiEventSource(path);
}

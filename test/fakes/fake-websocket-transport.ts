import type {
  IntronWebSocketConnection,
  IntronWebSocketEventMap,
  IntronWebSocketState,
  IntronWebSocketTransport,
} from '../../src/index.js';

export class FakeWebSocketConnection implements IntronWebSocketConnection {
  public readonly sent: (string | Uint8Array)[] = [];
  public readonly handlerCounts = new Map<
    keyof IntronWebSocketEventMap,
    number
  >();
  public state: IntronWebSocketState = 'open';
  private readonly handlers = new Map<
    keyof IntronWebSocketEventMap,
    Set<(payload: unknown) => void>
  >();

  public send(data: string | Uint8Array): Promise<void> {
    this.sent.push(data);

    return Promise.resolve();
  }

  public close(code?: number, reason?: string): Promise<void> {
    if (this.state === 'closed') {
      return Promise.resolve();
    }

    this.state = 'closed';
    this.emit('close', {
      ...(code === undefined ? {} : { code }),
      ...(reason === undefined ? {} : { reason }),
    });

    return Promise.resolve();
  }

  public on<EventName extends keyof IntronWebSocketEventMap>(
    event: EventName,
    handler: (payload: IntronWebSocketEventMap[EventName]) => void,
  ): () => void {
    const handlers =
      this.handlers.get(event) ?? new Set<(payload: unknown) => void>();
    const wrappedHandler = (payload: unknown) => {
      handler(payload as IntronWebSocketEventMap[EventName]);
    };
    handlers.add(wrappedHandler);
    this.handlers.set(event, handlers);
    this.handlerCounts.set(event, handlers.size);

    return () => {
      handlers.delete(wrappedHandler);
      this.handlerCounts.set(event, handlers.size);
    };
  }

  public emit<EventName extends keyof IntronWebSocketEventMap>(
    event: EventName,
    payload: IntronWebSocketEventMap[EventName],
  ): void {
    for (const handler of this.handlers.get(event) ?? []) {
      handler(payload);
    }
  }
}

export class FakeWebSocketTransport implements IntronWebSocketTransport {
  public readonly connects: {
    readonly url: URL;
    readonly headers?: Readonly<Record<string, string>>;
    readonly signal?: AbortSignal;
  }[] = [];
  public readonly connection = new FakeWebSocketConnection();
  private closed = false;

  public connect(options: {
    readonly url: URL;
    readonly headers?: Readonly<Record<string, string>>;
    readonly signal?: AbortSignal;
  }): Promise<IntronWebSocketConnection> {
    this.connects.push({
      url: new URL(options.url.toString()),
      ...(options.headers === undefined ? {} : { headers: options.headers }),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });

    return Promise.resolve(this.connection);
  }

  public close(): Promise<void> {
    this.closed = true;

    return Promise.resolve();
  }

  public isClosed(): boolean {
    return this.closed;
  }
}

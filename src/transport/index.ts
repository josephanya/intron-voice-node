import type { Readable } from 'node:stream';

/**
 * HTTP request shape used by injectable SDK transports.
 */
export interface IntronHttpRequest {
  /** HTTP method for the request. */
  readonly method: string;
  /** Fully qualified request URL. */
  readonly url: URL;
  /** HTTP request headers. */
  readonly headers: Readonly<Record<string, string>>;
  /** Optional request body. */
  readonly body?: BodyInit | AsyncIterable<Uint8Array>;
  /** Optional cancellation signal. */
  readonly signal?: AbortSignal;
}

/**
 * HTTP response shape returned by injectable SDK transports.
 */
export interface IntronHttpResponse {
  /** HTTP status code. */
  readonly status: number;
  /** HTTP response headers. */
  readonly headers: Headers;
  /** Complete response body bytes. */
  readonly body: Uint8Array;
}

/**
 * Injectable HTTP transport used by the SDK.
 */
export interface IntronHttpTransport {
  /** Sends an HTTP request. */
  send(request: IntronHttpRequest): Promise<IntronHttpResponse>;
  /** Releases transport resources. */
  close(): Promise<void>;
}

/**
 * Retry policy used by REST requests.
 */
export interface IntronHttpRetryPolicy {
  /** Maximum number of retry attempts after the initial request fails. */
  readonly maxRetries: number;
  /** Initial exponential backoff delay in milliseconds. */
  readonly initialDelayMs: number;
  /** Maximum backoff delay in milliseconds. */
  readonly maxDelayMs: number;
  /** Multiplier applied to the exponential backoff delay. */
  readonly backoffMultiplier: number;
  /** Jitter ratio applied around the computed delay. */
  readonly jitterRatio: number;
  /** Random source used for jitter. */
  readonly random: () => number;
}

/**
 * Per-request retry options.
 */
export interface IntronHttpRequestRetryOptions {
  /** Whether this request may retry when the failure is retryable. */
  readonly enabled?: boolean;
  /** Maximum number of retry attempts after the initial request fails. */
  readonly maxRetries?: number;
}

/**
 * Default clock implementation backed by the Node.js runtime timers.
 */
export class IntronSystemClock implements IntronClock {
  /** Returns the current timestamp in milliseconds. */
  public now(): number {
    return Date.now();
  }

  /** Schedules a callback with `setTimeout`. */
  public setTimeout(callback: () => void, delayMs: number): IntronTimerHandle {
    const timeout = setTimeout(callback, delayMs);

    return {
      clear: () => {
        clearTimeout(timeout);
      },
    };
  }
}

/**
 * Default HTTP transport backed by the Node.js global `fetch` implementation.
 */
export class IntronFetchHttpTransport implements IntronHttpTransport {
  /** Sends an HTTP request with global `fetch`. */
  public async send(request: IntronHttpRequest): Promise<IntronHttpResponse> {
    const response = await fetch(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      signal: request.signal,
      ...(isAsyncIterableBody(request.body) ? { duplex: 'half' } : {}),
    } as RequestInit & { readonly duplex?: 'half' });
    const body = new Uint8Array(await response.arrayBuffer());

    return {
      status: response.status,
      headers: response.headers,
      body,
    };
  }

  /** Releases transport resources. */
  public close(): Promise<void> {
    return Promise.resolve();
  }
}

function isAsyncIterableBody(
  body: IntronHttpRequest['body'],
): body is AsyncIterable<Uint8Array> {
  return (
    body !== undefined &&
    typeof body === 'object' &&
    Symbol.asyncIterator in body
  );
}

/**
 * States exposed by an injectable WebSocket connection.
 */
export type IntronWebSocketState = 'connecting' | 'open' | 'closing' | 'closed';

/**
 * Event payloads emitted by an injectable WebSocket connection.
 */
export interface IntronWebSocketEventMap {
  /** Connection opened. */
  readonly open: undefined;
  /** Binary or text message received. */
  readonly message: string | Uint8Array;
  /** Connection closed. */
  readonly close: { readonly code?: number; readonly reason?: string };
  /** Transport-level error. */
  readonly error: unknown;
}

/**
 * Injectable WebSocket connection used by streaming SDK workflows.
 */
export interface IntronWebSocketConnection {
  /** Current connection state. */
  readonly state: IntronWebSocketState;
  /** Sends a text or binary message. */
  send(data: string | Uint8Array): Promise<void>;
  /** Closes the connection. */
  close(code?: number, reason?: string): Promise<void>;
  /** Subscribes to connection events and returns an unsubscribe function. */
  on<EventName extends keyof IntronWebSocketEventMap>(
    event: EventName,
    handler: (payload: IntronWebSocketEventMap[EventName]) => void,
  ): () => void;
}

/**
 * Injectable WebSocket transport used by the SDK.
 */
export interface IntronWebSocketTransport {
  /** Opens a WebSocket connection. */
  connect(options: {
    readonly url: URL;
    readonly headers?: Readonly<Record<string, string>>;
    readonly signal?: AbortSignal;
  }): Promise<IntronWebSocketConnection>;
  /** Releases transport resources. */
  close(): Promise<void>;
}

/**
 * Handle returned by injectable timer schedulers.
 */
export interface IntronTimerHandle {
  /** Cancels the scheduled callback. */
  clear(): void;
}

/**
 * Injectable clock and timer scheduler used by timeout and polling flows.
 */
export interface IntronClock {
  /** Returns the current timestamp in milliseconds. */
  now(): number;
  /** Schedules a callback and returns a cancellable handle. */
  setTimeout(callback: () => void, delayMs: number): IntronTimerHandle;
}

/**
 * File upload source backed by a local path.
 */
export interface IntronPathUploadSource {
  /** Upload source kind. */
  readonly kind: 'path';
  /** Local filesystem path. */
  readonly path: string;
  /** Optional filename sent to the service. */
  readonly filename?: string;
  /** Optional content type sent to the service. */
  readonly contentType?: string;
}

/**
 * File upload source backed by bytes already in memory.
 */
export interface IntronBufferUploadSource {
  /** Upload source kind. */
  readonly kind: 'buffer';
  /** File content bytes. */
  readonly data: Uint8Array;
  /** Filename sent to the service. */
  readonly filename: string;
  /** Optional content type sent to the service. */
  readonly contentType?: string;
}

/**
 * File upload source backed by a Node.js readable stream.
 */
export interface IntronStreamUploadSource {
  /** Upload source kind. */
  readonly kind: 'stream';
  /** File content stream. */
  readonly stream: Readable;
  /** Filename sent to the service. */
  readonly filename: string;
  /** Optional content type sent to the service. */
  readonly contentType?: string;
}

/**
 * File upload source backed by an async iterable of byte chunks.
 */
export interface IntronAsyncIterableUploadSource {
  /** Upload source kind. */
  readonly kind: 'asyncIterable';
  /** File content chunks. */
  readonly data: AsyncIterable<Uint8Array>;
  /** Filename sent to the service. */
  readonly filename: string;
  /** Optional content type sent to the service. */
  readonly contentType?: string;
}

/**
 * Supported file upload sources for SDK multipart operations.
 */
export type IntronFileUploadSource =
  | IntronPathUploadSource
  | IntronBufferUploadSource
  | IntronStreamUploadSource
  | IntronAsyncIterableUploadSource;

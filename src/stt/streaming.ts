import {
  IntronApiError,
  IntronProtocolError,
  createIntronTransportError,
} from '../errors/index.js';
import type { IntronWebSocketConnection } from '../transport/index.js';
import type {
  SttStreamingAudioSource,
  SttStreamingEvent,
  SttStreamingOptions,
  SttStreamingServerMessageType,
  SttStreamingSession,
  SttTranscriptEvent,
} from './types.js';
import { SttSessionState } from './types.js';

const DEFAULT_STREAMING_SAMPLE_RATE = 16_000;
const DEFAULT_STREAMING_BIT_RATE = 16;
const DEFAULT_STREAMING_CHANNELS = 1;
const DEFAULT_STREAMING_LANGUAGE = 'en';
const MIN_STREAMING_CHUNK_BYTES = 1024;
const MAX_STREAMING_CHUNK_BYTES = 32 * 1024;
const STREAMING_ERROR_MESSAGE_TYPES = new Set<string>([
  'ERROR',
  'INPUT_ERROR',
  'AUTHENTICATION_ERROR',
  'RESOURCE_EXHAUSTED',
  'QUOTA_EXCEEDED',
  'SESSION_TIME_LIMIT_EXCEEDED',
  'CHUNCK_SIZE_TOO_SMALL',
  'CHUNK_SIZE_TOO_LARGE',
  'INSUFFICIENT_AUDIO_ACTIVITY',
  'CHUNK_ID_MISMATCH_WITH_TOTAL',
]);

/** Creates the streaming STT WebSocket URL with documented query defaults. */
export function createSttStreamingUrl(
  baseUrl: URL,
  options: Pick<
    SttStreamingOptions,
    'sampleRate' | 'bitRate' | 'channels' | 'language'
  >,
): URL {
  const url = new URL(baseUrl.toString());
  const basePath = url.pathname.endsWith('/')
    ? url.pathname
    : `${url.pathname}/`;

  url.pathname = `${basePath}stt/v1/stream`;
  url.searchParams.set(
    'sample_rate',
    String(options.sampleRate ?? DEFAULT_STREAMING_SAMPLE_RATE),
  );
  url.searchParams.set(
    'bit_rate',
    String(options.bitRate ?? DEFAULT_STREAMING_BIT_RATE),
  );
  url.searchParams.set(
    'num_channels',
    String(options.channels ?? DEFAULT_STREAMING_CHANNELS),
  );
  url.searchParams.set(
    'use_language_asr_input',
    options.language ?? DEFAULT_STREAMING_LANGUAGE,
  );

  return url;
}

/** Validates streaming STT options before opening a socket. */
export function validateSttStreamingOptions(
  options: SttStreamingOptions,
): void {
  validatePositiveInteger(options.sampleRate, 'sampleRate');
  validatePositiveInteger(options.bitRate, 'bitRate');
  validatePositiveInteger(options.channels, 'channels');
}

/** Creates a typed streaming session around an open WebSocket connection. */
export function createSttStreamingSession(options: {
  readonly connection: IntronWebSocketConnection;
  readonly audio: SttStreamingAudioSource;
  readonly channels?: number;
  readonly signal?: AbortSignal;
}): SttStreamingSession {
  return new IntronSttStreamingSession(options);
}

class IntronSttStreamingSession implements SttStreamingSession {
  public readonly events = new AsyncEventQueue<SttStreamingEvent>();
  public readonly transcriptEvents = new AsyncEventQueue<SttTranscriptEvent>();
  private readonly connection: IntronWebSocketConnection;
  private readonly audio: SttStreamingAudioSource;
  private readonly channels: number;
  private readonly signal: AbortSignal | undefined;
  private readonly unsubscribeHandlers: (() => void)[] = [];
  private resolveReady: (() => void) | undefined;
  private rejectReady: ((error: Error) => void) | undefined;
  private readonly ready: Promise<void>;
  private nextAckId = 1;
  private commitSent = false;
  private closed = false;
  private currentState = SttSessionState.Connecting;

  public constructor(options: {
    readonly connection: IntronWebSocketConnection;
    readonly audio: SttStreamingAudioSource;
    readonly channels?: number;
    readonly signal?: AbortSignal;
  }) {
    this.connection = options.connection;
    this.audio = options.audio;
    this.channels = options.channels ?? DEFAULT_STREAMING_CHANNELS;
    this.signal = options.signal;
    this.ready = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    this.ready.catch(() => undefined);
    this.unsubscribeHandlers.push(
      this.connection.on('message', (message) => {
        this.handleMessage(message);
      }),
      this.connection.on('close', (close) => {
        this.handleClose(close);
      }),
      this.connection.on('error', (cause) => {
        this.handleTransportError(cause);
      }),
    );

    if (this.signal?.aborted === true) {
      void this.cancelFromSignal();
    } else {
      this.signal?.addEventListener('abort', this.abortListener, {
        once: true,
      });
      void this.pumpAudio();
    }
  }

  public get state(): SttSessionState {
    return this.currentState;
  }

  public async close(): Promise<void> {
    if (this.closed) {
      return;
    }

    this.closed = true;
    this.signal?.removeEventListener('abort', this.abortListener);
    this.rejectReady?.(
      new IntronProtocolError({
        message: 'Intron STT streaming session was closed before ready.',
        operation: 'stt.startStreamingTranscription',
      }),
    );

    if (
      this.connection.state === 'open' &&
      this.currentState !== SttSessionState.Cancelled
    ) {
      await this.sendCommit();
    }

    this.currentState = SttSessionState.Completed;
    await this.connection.close();
    this.disposeSubscriptions();
    this.events.close();
    this.transcriptEvents.close();
  }

  public async [Symbol.asyncDispose](): Promise<void> {
    await this.close();
  }

  private readonly abortListener = (): void => {
    void this.cancelFromSignal();
  };

  private async cancelFromSignal(): Promise<void> {
    if (this.currentState === SttSessionState.Cancelled) {
      return;
    }

    this.currentState = SttSessionState.Cancelled;
    this.closed = true;
    const error = createIntronTransportError(
      this.signal?.reason ??
        new DOMException('Intron request was cancelled.', 'AbortError'),
      'stt.startStreamingTranscription',
    );
    this.rejectReady?.(error);
    this.events.push({ type: 'transport_error', error });
    await this.connection.close();
    this.disposeSubscriptions();
    this.events.close();
    this.transcriptEvents.close();
  }

  private async pumpAudio(): Promise<void> {
    try {
      for await (const chunk of toAsyncIterable(this.audio)) {
        if (this.closed) {
          return;
        }

        validateStreamingAudioChunk(chunk, this.channels);
        await this.ready;

        await this.sendAudioChunk(chunk);
      }

      if (!this.closed) {
        await this.ready;
        await this.sendCommit();
      }
    } catch (cause) {
      this.fail(toStreamingError(cause));
    }
  }

  private async sendAudioChunk(chunk: Uint8Array): Promise<void> {
    this.currentState = SttSessionState.Active;
    await this.connection.send(
      JSON.stringify({
        message_type: 'INPUT_AUDIO_CHUNK',
        audio_base_64: Buffer.from(chunk).toString('base64'),
        ack_id: this.nextAckId,
      }),
    );
    this.nextAckId += 1;
  }

  private async sendCommit(): Promise<void> {
    if (this.commitSent || this.connection.state !== 'open') {
      return;
    }

    this.commitSent = true;
    this.currentState = SttSessionState.Committing;
    await this.connection.send(JSON.stringify({ message_type: 'COMMIT' }));
  }

  private handleMessage(message: string | Uint8Array): void {
    const event = parseStreamingMessage(message);

    if (event.type === 'protocol_error') {
      this.events.push(event);
      return;
    }

    if (event.type === 'session_created') {
      this.currentState = SttSessionState.Ready;
      this.resolveReady?.();
    }

    if (
      event.type === 'partial_transcript' ||
      event.type === 'committed_transcript'
    ) {
      this.transcriptEvents.push(event);

      if (event.type === 'committed_transcript') {
        this.currentState = SttSessionState.Completed;
      }
    }

    if (event.type === 'server_error') {
      this.currentState = SttSessionState.Failed;
      this.closed = true;
      this.rejectReady?.(event.error);
      this.events.push(event);
      void this.connection.close();
      this.disposeSubscriptions();
      this.events.close();
      this.transcriptEvents.close();
      return;
    }

    this.events.push(event);
  }

  private handleClose(close: {
    readonly code?: number;
    readonly reason?: string;
  }): void {
    if (this.currentState === SttSessionState.Cancelled) {
      return;
    }

    if (this.currentState !== SttSessionState.Completed) {
      this.currentState = this.commitSent
        ? SttSessionState.Completed
        : SttSessionState.Failed;
    }

    this.rejectReady?.(
      new IntronProtocolError({
        message: 'Intron STT streaming socket closed before session creation.',
        operation: 'stt.startStreamingTranscription',
      }),
    );
    this.closed = true;
    this.events.push({
      type: 'closed',
      ...(close.code === undefined ? {} : { code: close.code }),
      ...(close.reason === undefined ? {} : { reason: close.reason }),
    });
    this.disposeSubscriptions();
    this.events.close();
    this.transcriptEvents.close();
  }

  private handleTransportError(cause: unknown): void {
    this.fail(
      createIntronTransportError(cause, 'stt.startStreamingTranscription'),
    );
  }

  private fail(error: Error): void {
    if (this.currentState === SttSessionState.Cancelled) {
      return;
    }

    this.currentState = SttSessionState.Failed;
    this.closed = true;
    this.rejectReady?.(error);
    this.events.push({ type: 'transport_error', error });
    void this.connection.close();
    this.disposeSubscriptions();
    this.events.close();
    this.transcriptEvents.close();
  }

  private disposeSubscriptions(): void {
    while (this.unsubscribeHandlers.length > 0) {
      this.unsubscribeHandlers.pop()?.();
    }
    this.signal?.removeEventListener('abort', this.abortListener);
  }
}

class AsyncEventQueue<T> implements AsyncIterable<T> {
  private readonly values: T[] = [];
  private readonly waiters: ((value: IteratorResult<T>) => void)[] = [];
  private closed = false;

  public push(value: T): void {
    if (this.closed) {
      return;
    }

    const waiter = this.waiters.shift();

    if (waiter !== undefined) {
      waiter({ done: false, value });
      return;
    }

    this.values.push(value);
  }

  public close(): void {
    if (this.closed) {
      return;
    }

    this.closed = true;

    while (this.waiters.length > 0) {
      this.waiters.shift()?.({ done: true, value: undefined });
    }
  }

  public [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        const value = this.values.shift();

        if (value !== undefined) {
          return Promise.resolve({ done: false, value });
        }

        if (this.closed) {
          return Promise.resolve({ done: true, value: undefined });
        }

        return new Promise<IteratorResult<T>>((resolve) => {
          this.waiters.push(resolve);
        });
      },
    };
  }
}

function parseStreamingMessage(
  message: string | Uint8Array,
): SttStreamingEvent {
  let value: unknown;

  try {
    value = JSON.parse(decodeMessage(message)) as unknown;
  } catch (cause) {
    return {
      type: 'protocol_error',
      error: new IntronProtocolError({
        message: 'Intron STT streaming message was not valid JSON.',
        operation: 'stt.parseStreamingMessage',
        cause,
      }),
    };
  }

  if (value === null || typeof value !== 'object') {
    return protocolEvent(
      'Intron STT streaming message was not an object.',
      value,
    );
  }

  const fields = value as Record<string, unknown>;
  const messageType = fields.message_type;

  if (typeof messageType !== 'string') {
    return protocolEvent(
      'Intron STT streaming message did not include a message_type.',
      value,
    );
  }

  switch (messageType) {
    case 'SESSION_CREATED': {
      const sessionId = readString(fields, 'session_id', 'sessionId');

      return {
        type: 'session_created',
        messageType,
        raw: value,
        ...(sessionId === undefined ? {} : { sessionId }),
      };
    }
    case 'AUDIO_CHUCK_ACK': {
      const ackId = readNumber(fields, 'ack_id', 'ackId');

      return {
        type: 'audio_chunk_ack',
        messageType,
        raw: value,
        ...(ackId === undefined ? {} : { ackId }),
      };
    }
    case 'PARTIAL_TRANSCRIPT':
      return {
        type: 'partial_transcript',
        messageType,
        transcript: readTranscript(fields),
        raw: value,
      };
    case 'COMMITTED_TRANSCRIPT':
      return {
        type: 'committed_transcript',
        messageType,
        transcript: readTranscript(fields),
        raw: value,
      };
    default:
      if (STREAMING_ERROR_MESSAGE_TYPES.has(messageType)) {
        return {
          type: 'server_error',
          messageType: messageType as SttStreamingServerMessageType,
          error: new IntronProtocolError({
            message:
              readString(fields, 'message', 'error', 'detail') ??
              `Intron STT streaming server returned ${messageType}.`,
            code: messageType,
            operation: 'stt.streamingServerMessage',
          }),
          raw: value,
        } as SttStreamingEvent;
      }

      return protocolEvent(
        `Unsupported Intron STT streaming message_type: ${messageType}.`,
        value,
      );
  }
}

function protocolEvent(message: string, raw: unknown): SttStreamingEvent {
  return {
    type: 'protocol_error',
    error: new IntronProtocolError({
      message,
      operation: 'stt.parseStreamingMessage',
    }),
    raw,
  };
}

function readTranscript(fields: Record<string, unknown>): string {
  return (
    readString(
      fields,
      'transcript',
      'text',
      'audio_transcript',
      'partial_transcript',
      'committed_transcript',
    ) ?? ''
  );
}

function validateStreamingAudioChunk(
  chunk: Uint8Array,
  channels: number,
): void {
  if (chunk.byteLength < MIN_STREAMING_CHUNK_BYTES) {
    throw new IntronProtocolError({
      message: 'STT streaming audio chunks must be at least 1024 bytes.',
      operation: 'stt.validateStreamingAudioChunk',
    });
  }

  if (chunk.byteLength > MAX_STREAMING_CHUNK_BYTES) {
    throw new IntronProtocolError({
      message: 'STT streaming audio chunks must not exceed 32768 bytes.',
      operation: 'stt.validateStreamingAudioChunk',
    });
  }

  if (chunk.byteLength % (2 * channels) !== 0) {
    throw new IntronProtocolError({
      message:
        'STT streaming PCM16 chunks must align to complete sample frames.',
      operation: 'stt.validateStreamingAudioChunk',
    });
  }
}

function validatePositiveInteger(
  value: number | undefined,
  field: string,
): void {
  if (value === undefined) {
    return;
  }

  if (!Number.isInteger(value) || value <= 0) {
    throw new IntronProtocolError({
      message: `STT streaming ${field} must be a positive integer.`,
      operation: 'stt.validateStreamingOptions',
    });
  }
}

function decodeMessage(message: string | Uint8Array): string {
  return typeof message === 'string'
    ? message
    : new TextDecoder().decode(message);
}

async function* toAsyncIterable(
  source: SttStreamingAudioSource,
): AsyncIterable<Uint8Array> {
  if (isWebReadableStream(source)) {
    const reader = source.getReader();

    try {
      for (;;) {
        const result = await reader.read();

        if (result.done) {
          return;
        }

        yield result.value;
      }
    } finally {
      reader.releaseLock();
    }

    return;
  }

  for await (const chunk of source) {
    if (chunk instanceof Uint8Array) {
      yield chunk;
      continue;
    }

    if (typeof chunk === 'string') {
      yield Buffer.from(chunk);
      continue;
    }

    yield Buffer.from(chunk as ArrayBufferLike);
  }
}

function isWebReadableStream(
  source: SttStreamingAudioSource,
): source is ReadableStream<Uint8Array> {
  return (
    typeof ReadableStream !== 'undefined' && source instanceof ReadableStream
  );
}

function readString(
  fields: Record<string, unknown>,
  ...keys: readonly string[]
): string | undefined {
  for (const key of keys) {
    const value = fields[key];

    if (typeof value === 'string') {
      return value;
    }
  }

  return undefined;
}

function readNumber(
  fields: Record<string, unknown>,
  ...keys: readonly string[]
): number | undefined {
  for (const key of keys) {
    const value = fields[key];

    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
  }

  return undefined;
}

function toStreamingError(cause: unknown): Error {
  return cause instanceof Error
    ? cause
    : new IntronApiError({
        message: 'Intron STT streaming operation failed.',
        cause,
        operation: 'stt.startStreamingTranscription',
      });
}

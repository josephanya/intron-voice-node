import {
  IntronApiError,
  IntronProtocolError,
  createIntronTransportError,
} from '../errors/index.js';
import type {
  IntronClock,
  IntronTimerHandle,
  IntronWebSocketConnection,
} from '../transport/index.js';
import type {
  TtsAudioChunk,
  TtsOutputAudioFormat,
  TtsStreamingEvent,
  TtsStreamingOptions,
  TtsStreamingServerMessageType,
  TtsStreamingSession,
} from './types.js';
import { TtsSessionState } from './types.js';

const DEFAULT_TTS_OUTPUT_AUDIO_FORMAT: TtsOutputAudioFormat = 'wav';
const MIN_TEXT_CHUNK_CHARACTERS = 10;
const MAX_TEXT_CHUNK_CHARACTERS = 100;
const DEFAULT_ROLLOVER_INTERVAL_MS = 270_000;
const DEFAULT_MAX_BUFFERED_TEXT_CHARACTERS = 4096;
const DEFAULT_MAX_RECONNECT_ATTEMPTS = 3;
const DEFAULT_RECONNECT_INITIAL_DELAY_MS = 250;
const DEFAULT_RECONNECT_MAX_DELAY_MS = 5_000;
const TTS_OUTPUT_AUDIO_FORMATS = new Set<string>(['wav', 'opus']);
const TTS_VOICE_GENDERS = new Set<string>(['male', 'female']);
const STREAMING_ERROR_MESSAGE_TYPES = new Set<string>([
  'ERROR',
  'INPUT_ERROR',
  'AUTHENTICATION_ERROR',
  'RESOURCE_EXHAUSTED',
  'QUOTA_EXCEEDED',
  'SESSION_TIME_LIMIT_EXCEEDED',
]);

type ReconnectReason =
  'rollover' | 'transport_close' | 'transport_error' | 'session_time_limit';

interface BufferedTextChunk {
  readonly text: string;
  readonly characterLength: number;
  readonly ackId: number;
}

type ParsedTtsStreamingEvent =
  | {
      readonly type: 'session_created';
      readonly messageType: 'SESSION_CREATED';
      readonly sessionId?: string;
      readonly raw: unknown;
    }
  | {
      readonly type: 'text_chunk_ack';
      readonly messageType: 'TEXT_CHUNK_ACK';
      readonly ackId?: number;
      readonly raw: unknown;
    }
  | {
      readonly type: 'audio_chunk';
      readonly messageType: 'FETCH_AUDIO_CHUNK';
      readonly chunk: TtsAudioChunk;
      readonly raw: unknown;
    }
  | {
      readonly type: 'committed_audio';
      readonly messageType: 'COMMITTED_AUDIO';
      readonly chunk?: TtsAudioChunk;
      readonly raw: unknown;
    }
  | {
      readonly type: 'server_error';
      readonly messageType: Exclude<
        TtsStreamingServerMessageType,
        | 'SESSION_CREATED'
        | 'TEXT_CHUNK_ACK'
        | 'FETCH_AUDIO_CHUNK'
        | 'COMMITTED_AUDIO'
      >;
      readonly error: Error;
      readonly raw: unknown;
    }
  | {
      readonly type: 'protocol_error';
      readonly error: Error;
      readonly raw?: unknown;
    };

/** Creates the streaming TTS WebSocket URL with documented query fields. */
export function createTtsStreamingUrl(
  baseUrl: URL,
  options: Pick<
    TtsStreamingOptions,
    'voiceAccent' | 'voiceGender' | 'voiceLanguage' | 'outputAudioFormat'
  >,
): URL {
  const url = new URL(baseUrl.toString());
  const basePath = url.pathname.endsWith('/')
    ? url.pathname
    : `${url.pathname}/`;

  url.pathname = `${basePath}tts/v1/stream`;
  url.searchParams.set('voice_accent', options.voiceAccent);
  url.searchParams.set('voice_gender', options.voiceGender);
  url.searchParams.set('voice_language', options.voiceLanguage);
  url.searchParams.set(
    'output_audio_format',
    options.outputAudioFormat ?? DEFAULT_TTS_OUTPUT_AUDIO_FORMAT,
  );

  return url;
}

/** Validates streaming TTS options before opening a socket. */
export function validateTtsStreamingOptions(
  options: TtsStreamingOptions,
): void {
  validateIdentifier(options.voiceLanguage, 'voiceLanguage');
  validateIdentifier(options.voiceAccent, 'voiceAccent');
  validatePositiveInteger(options.rolloverIntervalMs, 'rolloverIntervalMs');
  validatePositiveInteger(
    options.maxBufferedTextCharacters,
    'maxBufferedTextCharacters',
  );
  validateNonNegativeInteger(
    options.maxReconnectAttempts,
    'maxReconnectAttempts',
  );
  validatePositiveInteger(
    options.reconnectInitialDelayMs,
    'reconnectInitialDelayMs',
  );
  validatePositiveInteger(options.reconnectMaxDelayMs, 'reconnectMaxDelayMs');

  if (!TTS_VOICE_GENDERS.has(options.voiceGender)) {
    throw new IntronProtocolError({
      message: 'TTS streaming voiceGender must be male or female.',
      operation: 'tts.validateStreamingOptions',
    });
  }

  if (
    options.outputAudioFormat !== undefined &&
    !TTS_OUTPUT_AUDIO_FORMATS.has(options.outputAudioFormat)
  ) {
    throw new IntronProtocolError({
      message: 'TTS streaming outputAudioFormat must be wav or opus.',
      operation: 'tts.validateStreamingOptions',
    });
  }
}

/** Creates a typed streaming session around an open TTS WebSocket. */
export function createTtsStreamingSession(options: {
  readonly connection: IntronWebSocketConnection;
  readonly connect: () => Promise<IntronWebSocketConnection>;
  readonly clock: IntronClock;
  readonly signal?: AbortSignal;
  readonly rolloverIntervalMs?: number;
  readonly maxBufferedTextCharacters?: number;
  readonly maxReconnectAttempts?: number;
  readonly reconnectInitialDelayMs?: number;
  readonly reconnectMaxDelayMs?: number;
}): TtsStreamingSession {
  return new IntronTtsStreamingSession(options);
}

class IntronTtsStreamingSession implements TtsStreamingSession {
  public readonly events = new AsyncEventQueue<TtsStreamingEvent>();
  public readonly audioChunks = new AsyncEventQueue<TtsAudioChunk>();
  private connection: IntronWebSocketConnection;
  private readonly connect: () => Promise<IntronWebSocketConnection>;
  private readonly clock: IntronClock;
  private readonly signal: AbortSignal | undefined;
  private readonly rolloverIntervalMs: number;
  private readonly maxBufferedTextCharacters: number;
  private readonly maxReconnectAttempts: number;
  private readonly reconnectInitialDelayMs: number;
  private readonly reconnectMaxDelayMs: number;
  private readonly bufferedText: BufferedTextChunk[] = [];
  private readonly unsubscribeHandlers: (() => void)[] = [];
  private resolveReady: (() => void) | undefined;
  private rejectReady: ((error: Error) => void) | undefined;
  private ready: Promise<void>;
  private rolloverTimer: IntronTimerHandle | undefined;
  private bufferedTextCharacters = 0;
  private reconnecting = false;
  private sending = false;
  private closeExpected = false;
  private nextAckId = 1;
  private nextFetchChunkId = 1;
  private commitSent = false;
  private currentSessionIndex = 0;
  private closed = false;
  private currentState = TtsSessionState.Connecting;

  public constructor(options: {
    readonly connection: IntronWebSocketConnection;
    readonly connect: () => Promise<IntronWebSocketConnection>;
    readonly clock: IntronClock;
    readonly signal?: AbortSignal;
    readonly rolloverIntervalMs?: number;
    readonly maxBufferedTextCharacters?: number;
    readonly maxReconnectAttempts?: number;
    readonly reconnectInitialDelayMs?: number;
    readonly reconnectMaxDelayMs?: number;
  }) {
    this.connection = options.connection;
    this.connect = options.connect;
    this.clock = options.clock;
    this.signal = options.signal;
    this.rolloverIntervalMs =
      options.rolloverIntervalMs ?? DEFAULT_ROLLOVER_INTERVAL_MS;
    this.maxBufferedTextCharacters =
      options.maxBufferedTextCharacters ?? DEFAULT_MAX_BUFFERED_TEXT_CHARACTERS;
    this.maxReconnectAttempts =
      options.maxReconnectAttempts ?? DEFAULT_MAX_RECONNECT_ATTEMPTS;
    this.reconnectInitialDelayMs =
      options.reconnectInitialDelayMs ?? DEFAULT_RECONNECT_INITIAL_DELAY_MS;
    this.reconnectMaxDelayMs =
      options.reconnectMaxDelayMs ?? DEFAULT_RECONNECT_MAX_DELAY_MS;
    this.ready = this.createReadyPromise();
    this.subscribeToConnection();
    this.scheduleRollover();

    if (this.signal?.aborted === true) {
      void this.cancelFromSignal();
    } else {
      this.signal?.addEventListener('abort', this.abortListener, {
        once: true,
      });
    }
  }

  public get state(): TtsSessionState {
    return this.currentState;
  }

  public get sessionIndex(): number {
    return this.currentSessionIndex;
  }

  public async sendText(text: string): Promise<void> {
    validateTtsTextChunk(text);

    if (this.closed) {
      throw new IntronProtocolError({
        message: 'Intron TTS streaming session is closed.',
        operation: 'tts.sendStreamingText',
      });
    }

    this.bufferText({
      text,
      characterLength: text.length,
      ackId: this.nextAckId,
    });
    this.nextAckId += 1;
    await this.flushBufferedText();
  }

  public async fetchAudioChunk(chunkId?: number): Promise<void> {
    if (this.closed) {
      throw new IntronProtocolError({
        message: 'Intron TTS streaming session is closed.',
        operation: 'tts.fetchStreamingAudioChunk',
      });
    }

    const requestedChunkId = chunkId ?? this.nextFetchChunkId;
    validatePositiveInteger(requestedChunkId, 'chunkId');
    await this.ready;
    await this.connection.send(
      JSON.stringify({
        message_type: 'FETCH_AUDIO_CHUNK',
        chunk_id: requestedChunkId,
      }),
    );
    this.nextFetchChunkId = Math.max(
      this.nextFetchChunkId,
      requestedChunkId + 1,
    );
  }

  public async commit(): Promise<void> {
    await this.ready;
    await this.sendCommit();
  }

  public async close(): Promise<void> {
    if (this.closed) {
      return;
    }

    this.closed = true;
    this.closeExpected = true;
    this.rolloverTimer?.clear();
    this.signal?.removeEventListener('abort', this.abortListener);
    this.rejectReady?.(
      new IntronProtocolError({
        message: 'Intron TTS streaming session was closed before ready.',
        operation: 'tts.startStreamingSpeech',
      }),
    );

    if (
      this.connection.state === 'open' &&
      this.currentState !== TtsSessionState.Cancelled
    ) {
      await this.sendCommit();
    }

    this.currentState = TtsSessionState.Completed;
    await this.connection.close();
    this.disposeSubscriptions();
    this.events.close();
    this.audioChunks.close();
  }

  public async [Symbol.asyncDispose](): Promise<void> {
    await this.close();
  }

  private readonly abortListener = (): void => {
    void this.cancelFromSignal();
  };

  private async cancelFromSignal(): Promise<void> {
    if (this.currentState === TtsSessionState.Cancelled) {
      return;
    }

    this.currentState = TtsSessionState.Cancelled;
    this.closed = true;
    this.closeExpected = true;
    this.rolloverTimer?.clear();
    const error = createIntronTransportError(
      this.signal?.reason ??
        new DOMException('Intron request was cancelled.', 'AbortError'),
      'tts.startStreamingSpeech',
    );
    this.rejectReady?.(error);
    this.events.push({ type: 'transport_error', error });
    await this.connection.close();
    this.disposeSubscriptions();
    this.events.close();
    this.audioChunks.close();
  }

  private bufferText(chunk: BufferedTextChunk): void {
    if (
      this.bufferedTextCharacters + chunk.characterLength >
      this.maxBufferedTextCharacters
    ) {
      throw new IntronProtocolError({
        message: 'TTS streaming text buffer limit exceeded.',
        operation: 'tts.streamingTextBuffer',
      });
    }

    this.bufferedText.push(chunk);
    this.bufferedTextCharacters += chunk.characterLength;
  }

  private async flushBufferedText(): Promise<void> {
    if (this.sending || this.closed) {
      return;
    }

    this.sending = true;

    try {
      await this.ready;

      while (this.bufferedText.length > 0) {
        const buffered = this.bufferedText.shift();

        if (buffered === undefined) {
          break;
        }

        this.bufferedTextCharacters -= buffered.characterLength;
        this.currentState = TtsSessionState.Active;
        await this.connection.send(
          JSON.stringify({
            message_type: 'INPUT_TEXT_CHUNK',
            text: buffered.text,
            ack_id: buffered.ackId,
          }),
        );
      }
    } catch (cause) {
      if (this.reconnecting) {
        return;
      }

      this.fail(toStreamingError(cause));
    } finally {
      this.sending = false;
    }
  }

  private async sendCommit(): Promise<void> {
    if (this.commitSent || this.connection.state !== 'open') {
      return;
    }

    this.commitSent = true;
    this.currentState = TtsSessionState.Committing;
    await this.connection.send(JSON.stringify({ message_type: 'COMMIT' }));
  }

  private createReadyPromise(): Promise<void> {
    const ready = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    ready.catch(() => undefined);

    return ready;
  }

  private subscribeToConnection(): void {
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
  }

  private scheduleRollover(): void {
    this.rolloverTimer?.clear();
    this.rolloverTimer = this.clock.setTimeout(() => {
      void this.reconnect('rollover');
    }, this.rolloverIntervalMs);
  }

  private handleMessage(message: string | Uint8Array): void {
    const event = parseTtsStreamingMessage(message);

    if (event.type === 'protocol_error') {
      this.events.push(event);
      return;
    }

    if (event.type === 'session_created') {
      this.currentState = TtsSessionState.Ready;
      this.resolveReady?.();
      this.events.push({ ...event, sessionIndex: this.currentSessionIndex });
      void this.flushBufferedText();
      return;
    }

    if (event.type === 'audio_chunk') {
      this.audioChunks.push(event.chunk);
      this.events.push({ ...event, sessionIndex: this.currentSessionIndex });
      return;
    }

    if (event.type === 'committed_audio') {
      if (event.chunk !== undefined) {
        this.audioChunks.push(event.chunk);
      }

      this.currentState = TtsSessionState.Completed;
      this.events.push({ ...event, sessionIndex: this.currentSessionIndex });
      this.audioChunks.close();
      return;
    }

    if (event.type === 'server_error') {
      this.events.push({ ...event, sessionIndex: this.currentSessionIndex });

      if (event.messageType === 'SESSION_TIME_LIMIT_EXCEEDED') {
        void this.reconnect('session_time_limit');
        return;
      }

      this.currentState = TtsSessionState.Failed;
      this.closed = true;
      this.closeExpected = true;
      this.rolloverTimer?.clear();
      this.rejectReady?.(event.error);
      void this.connection.close();
      this.disposeSubscriptions();
      this.events.close();
      this.audioChunks.close();
      return;
    }

    this.events.push({ ...event, sessionIndex: this.currentSessionIndex });
  }

  private handleClose(close: {
    readonly code?: number;
    readonly reason?: string;
  }): void {
    if (this.currentState === TtsSessionState.Cancelled) {
      return;
    }

    if (!this.closeExpected && !this.closed) {
      this.events.push({
        type: 'closed',
        sessionIndex: this.currentSessionIndex,
        ...(close.code === undefined ? {} : { code: close.code }),
        ...(close.reason === undefined ? {} : { reason: close.reason }),
      });
      void this.reconnect('transport_close');
      return;
    }

    if (this.closeExpected && this.reconnecting) {
      return;
    }

    if (this.currentState !== TtsSessionState.Completed) {
      this.currentState = this.commitSent
        ? TtsSessionState.Completed
        : TtsSessionState.Failed;
    }

    this.rejectReady?.(
      new IntronProtocolError({
        message: 'Intron TTS streaming socket closed before session creation.',
        operation: 'tts.startStreamingSpeech',
      }),
    );
    this.closed = true;
    this.rolloverTimer?.clear();
    this.events.push({
      type: 'closed',
      sessionIndex: this.currentSessionIndex,
      ...(close.code === undefined ? {} : { code: close.code }),
      ...(close.reason === undefined ? {} : { reason: close.reason }),
    });
    this.disposeSubscriptions();
    this.events.close();
    this.audioChunks.close();
  }

  private handleTransportError(cause: unknown): void {
    if (this.closed) {
      return;
    }

    void this.reconnect('transport_error', cause);
  }

  private async reconnect(
    reason: ReconnectReason,
    cause?: unknown,
  ): Promise<void> {
    if (this.closed || this.reconnecting) {
      return;
    }

    this.reconnecting = true;
    this.currentState = TtsSessionState.Reconnecting;
    this.rolloverTimer?.clear();
    this.rejectReady?.(
      createIntronTransportError(
        cause ?? new Error(`Intron TTS streaming reconnect: ${reason}.`),
        'tts.startStreamingSpeech',
      ),
    );
    this.ready = this.createReadyPromise();

    try {
      if (this.connection.state === 'open') {
        this.closeExpected = true;
        await this.sendCommit();
      }

      this.closeExpected = true;
      await this.connection.close();
      this.disposeConnectionSubscriptions();

      for (
        let attempt = 1;
        attempt <= this.maxReconnectAttempts;
        attempt += 1
      ) {
        if (this.signal?.aborted === true) {
          return;
        }

        this.events.push({
          type: 'reconnecting',
          reason,
          sessionIndex: this.currentSessionIndex,
          nextSessionIndex: this.currentSessionIndex + 1,
          attempt,
        });

        if (attempt > 1) {
          await waitForDelay(
            this.clock,
            Math.min(
              this.reconnectInitialDelayMs * 2 ** (attempt - 2),
              this.reconnectMaxDelayMs,
            ),
            this.signal,
          );
        }

        try {
          this.connection = await this.connect();
          this.currentSessionIndex += 1;
          this.commitSent = false;
          this.closeExpected = false;
          this.subscribeToConnection();
          this.scheduleRollover();
          this.currentState = TtsSessionState.Connecting;
          this.reconnecting = false;
          void this.flushBufferedText();
          return;
        } catch (connectCause) {
          if (attempt === this.maxReconnectAttempts) {
            this.fail(toStreamingError(connectCause));
            return;
          }
        }
      }

      this.fail(
        new IntronProtocolError({
          message: 'Intron TTS streaming reconnect attempts were exhausted.',
          operation: 'tts.reconnectStreamingSpeech',
        }),
      );
    } catch (reconnectCause) {
      this.fail(toStreamingError(reconnectCause));
    } finally {
      this.reconnecting = false;
    }
  }

  private fail(error: Error): void {
    if (this.currentState === TtsSessionState.Cancelled) {
      return;
    }

    this.currentState = TtsSessionState.Failed;
    this.closed = true;
    this.closeExpected = true;
    this.rolloverTimer?.clear();
    this.rejectReady?.(error);
    this.events.push({ type: 'transport_error', error });
    void this.connection.close();
    this.disposeSubscriptions();
    this.events.close();
    this.audioChunks.close();
  }

  private disposeSubscriptions(): void {
    this.disposeConnectionSubscriptions();
    this.signal?.removeEventListener('abort', this.abortListener);
  }

  private disposeConnectionSubscriptions(): void {
    while (this.unsubscribeHandlers.length > 0) {
      this.unsubscribeHandlers.pop()?.();
    }
  }
}

function validateTtsTextChunk(text: string): void {
  if (text.length < MIN_TEXT_CHUNK_CHARACTERS) {
    throw new IntronProtocolError({
      message: 'TTS streaming text chunks must be at least 10 characters.',
      operation: 'tts.validateStreamingTextChunk',
    });
  }

  if (text.length > MAX_TEXT_CHUNK_CHARACTERS) {
    throw new IntronProtocolError({
      message: 'TTS streaming text chunks must not exceed 100 characters.',
      operation: 'tts.validateStreamingTextChunk',
    });
  }
}

function parseTtsStreamingMessage(
  message: string | Uint8Array,
): ParsedTtsStreamingEvent {
  let value: unknown;

  try {
    value = JSON.parse(decodeMessage(message)) as unknown;
  } catch (cause) {
    return {
      type: 'protocol_error',
      error: new IntronProtocolError({
        message: 'Intron TTS streaming message was not valid JSON.',
        operation: 'tts.parseStreamingMessage',
        cause,
      }),
    };
  }

  if (value === null || typeof value !== 'object') {
    return protocolEvent(
      'Intron TTS streaming message was not an object.',
      value,
    );
  }

  const fields = value as Record<string, unknown>;
  const messageType = fields.message_type;

  if (typeof messageType !== 'string') {
    return protocolEvent(
      'Intron TTS streaming message did not include a message_type.',
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
    case 'TEXT_CHUNK_ACK': {
      const ackId = readNumber(fields, 'ack_id', 'ackId');

      return {
        type: 'text_chunk_ack',
        messageType,
        raw: value,
        ...(ackId === undefined ? {} : { ackId }),
      };
    }
    case 'FETCH_AUDIO_CHUNK':
      return {
        type: 'audio_chunk',
        messageType,
        chunk: parseAudioChunk(fields, value),
        raw: value,
      };
    case 'COMMITTED_AUDIO': {
      const chunk = maybeParseAudioChunk(fields, value);

      return {
        type: 'committed_audio',
        messageType,
        raw: value,
        ...(chunk === undefined ? {} : { chunk }),
      };
    }
    default:
      if (STREAMING_ERROR_MESSAGE_TYPES.has(messageType)) {
        return {
          type: 'server_error',
          messageType: messageType as TtsStreamingServerMessageType,
          error: new IntronProtocolError({
            message:
              readString(fields, 'message', 'error', 'detail') ??
              `Intron TTS streaming server returned ${messageType}.`,
            code: messageType,
            operation: 'tts.streamingServerMessage',
          }),
          raw: value,
        } as ParsedTtsStreamingEvent;
      }

      return protocolEvent(
        `Unsupported Intron TTS streaming message_type: ${messageType}.`,
        value,
      );
  }
}

function maybeParseAudioChunk(
  fields: Record<string, unknown>,
  raw: unknown,
): TtsAudioChunk | undefined {
  const audioBase64 = readString(
    fields,
    'audio_base_64',
    'audio_base64',
    'audio',
    'audio_chunk',
  );

  if (audioBase64 === undefined) {
    return undefined;
  }

  return createAudioChunk(fields, raw, audioBase64);
}

function parseAudioChunk(
  fields: Record<string, unknown>,
  raw: unknown,
): TtsAudioChunk {
  const chunk = maybeParseAudioChunk(fields, raw);

  if (chunk === undefined) {
    throw new IntronProtocolError({
      message: 'Intron TTS audio chunk did not include audio bytes.',
      operation: 'tts.parseStreamingAudioChunk',
    });
  }

  return chunk;
}

function createAudioChunk(
  fields: Record<string, unknown>,
  raw: unknown,
  audioBase64: string,
): TtsAudioChunk {
  const chunkId = readNumber(fields, 'chunk_id', 'chunkId');

  return {
    ...(chunkId === undefined ? {} : { chunkId }),
    audio: Buffer.from(audioBase64, 'base64'),
    raw,
  };
}

function protocolEvent(message: string, raw: unknown): ParsedTtsStreamingEvent {
  return {
    type: 'protocol_error',
    error: new IntronProtocolError({
      message,
      operation: 'tts.parseStreamingMessage',
    }),
    raw,
  };
}

function waitForDelay(
  clock: IntronClock,
  delayMs: number,
  signal: AbortSignal | undefined,
): Promise<void> {
  if (delayMs <= 0) {
    return Promise.resolve();
  }

  if (signal?.aborted === true) {
    return Promise.reject(toStreamingError(signal.reason));
  }

  return new Promise<void>((resolve, reject) => {
    const timer = clock.setTimeout(() => {
      signal?.removeEventListener('abort', abortListener);
      resolve();
    }, delayMs);
    const abortListener = () => {
      timer.clear();
      reject(toStreamingError(signal?.reason));
    };

    signal?.addEventListener('abort', abortListener, { once: true });
  });
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

function validateIdentifier(value: string, field: string): void {
  if (!/^[A-Za-z][A-Za-z0-9_-]*$/u.test(value)) {
    throw new IntronProtocolError({
      message: `TTS streaming ${field} must be a non-empty language or accent identifier.`,
      operation: 'tts.validateStreamingOptions',
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
      message: `TTS streaming ${field} must be a positive integer.`,
      operation: 'tts.validateStreamingOptions',
    });
  }
}

function validateNonNegativeInteger(
  value: number | undefined,
  field: string,
): void {
  if (value === undefined) {
    return;
  }

  if (!Number.isInteger(value) || value < 0) {
    throw new IntronProtocolError({
      message: `TTS streaming ${field} must be a non-negative integer.`,
      operation: 'tts.validateStreamingOptions',
    });
  }
}

function decodeMessage(message: string | Uint8Array): string {
  return typeof message === 'string'
    ? message
    : new TextDecoder().decode(message);
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
        message: 'Intron TTS streaming operation failed.',
        cause,
        operation: 'tts.startStreamingSpeech',
      });
}

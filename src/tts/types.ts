import type { IntronRequestOptions } from '../client/types.js';

/** Supported TTS output audio formats. */
export type TtsOutputAudioFormat = 'wav' | 'opus';

/** Supported TTS voice gender values. */
export type TtsVoiceGender = 'male' | 'female';

/** Processing states returned by the TTS queued workflow. */
export type TtsProcessingStatus =
  | 'TTS_TEXT_AUDIO_QUEUED'
  | 'TTS_TEXT_AUDIO_PENDING'
  | 'TTS_TEXT_AUDIO_PROCESSING'
  | 'TTS_TEXT_AUDIO_GENERATED'
  | 'TTS_TEXT_AUDIO_PROCESSING_FAILED';

/** Safe request metadata preserved from TTS operations. */
export interface TtsRequestMetadata {
  /** HTTP status code returned by the service. */
  readonly status: number;
  /** Service request identifier when available. */
  readonly requestId?: string;
}

/** Common TTS text and voice controls. */
export interface TtsSynthesisOptions {
  /** Text to synthesize. Must be 1 to 4096 characters. */
  readonly text: string;
  /** Language code for the voice and input text. */
  readonly voiceLanguage: string;
  /** Voice accent value from the Intron-supported catalog. */
  readonly voiceAccent: string;
  /** Voice gender. */
  readonly voiceGender: TtsVoiceGender;
  /** Output format. Defaults to the service default, currently WAV. */
  readonly outputAudioFormat?: TtsOutputAudioFormat;
  /** Optional cancellation signal. */
  readonly signal?: AbortSignal;
  /** Retry behavior for the request. */
  readonly retry?: IntronRequestOptions['retry'];
}

/** Options for synchronous TTS generation. */
export interface TtsGenerateOptions extends TtsSynthesisOptions {
  /** Download the returned audio path immediately into `audio`. Defaults to false. */
  readonly downloadAudio?: boolean;
}

/** Options for queued TTS generation. */
export interface TtsQueueOptions extends TtsSynthesisOptions {}

/** Queued TTS job returned after text upload. */
export interface TtsJob {
  /** Text identifier used by the status endpoint. */
  readonly textId: string;
  /** Safe request metadata. */
  readonly request: TtsRequestMetadata;
}

/** Failure details returned by TTS status payloads when available. */
export interface TtsFailureDetails {
  /** Human-readable failure message when returned. */
  readonly message?: string;
  /** Service-defined failure code when returned. */
  readonly code?: string;
  /** Original failure payload for forward-compatible consumers. */
  readonly raw?: unknown;
}

/** Options for checking queued TTS status. */
export interface TtsStatusOptions {
  /** Download the returned audio path immediately into `audio`. Defaults to false. */
  readonly downloadAudio?: boolean;
  /** Optional cancellation signal. */
  readonly signal?: AbortSignal;
  /** Retry behavior for the status request. */
  readonly retry?: IntronRequestOptions['retry'];
}

/** Status payload for queued or generated TTS audio. */
export interface TtsJobStatus {
  /** Text identifier used by the status endpoint when returned by the service. */
  readonly textId?: string;
  /** Current processing status when returned by the service. */
  readonly status?: TtsProcessingStatus;
  /** Remote audio path returned by the service. Treat as ephemeral. */
  readonly audioPath?: string;
  /** Downloaded audio bytes when `downloadAudio` is true. */
  readonly audio?: Uint8Array;
  /** Generated audio duration in seconds when returned. */
  readonly audioDurationSeconds?: number;
  /** Failure details when processing fails and the service returns them. */
  readonly failure?: TtsFailureDetails;
  /** Safe request metadata. */
  readonly request: TtsRequestMetadata;
  /** Original response payload for forward-compatible consumers. */
  readonly raw: unknown;
}

/** Terminal successful TTS result. */
export interface TtsResult extends TtsJobStatus {
  /** Terminal successful processing status. */
  readonly status: 'TTS_TEXT_AUDIO_GENERATED';
}

/** Options for waiting until queued TTS reaches a terminal state. */
export interface WaitForSpeechOptions extends TtsStatusOptions {
  /** Text identifier returned by enqueue. */
  readonly textId: string;
  /** Polling interval in milliseconds. Defaults to 2000. */
  readonly pollingIntervalMs?: number;
  /** Overall wait timeout in milliseconds. */
  readonly timeoutMs?: number;
  /** Callback invoked after every status response. */
  readonly onStatus?: (status: TtsJobStatus) => void;
}

/** TTS streaming session lifecycle states. */
export enum TtsSessionState {
  Connecting = 'connecting',
  Ready = 'ready',
  Active = 'active',
  Committing = 'committing',
  Reconnecting = 'reconnecting',
  Completed = 'completed',
  Failed = 'failed',
  Cancelled = 'cancelled',
}

/** Options for streaming TTS synthesis over WebSocket. */
export interface TtsStreamingOptions {
  /** Language code for the voice and input text. */
  readonly voiceLanguage: string;
  /** Voice accent value from the Intron-supported catalog. */
  readonly voiceAccent: string;
  /** Voice gender. */
  readonly voiceGender: TtsVoiceGender;
  /** Output format. Defaults to the service default, currently WAV. */
  readonly outputAudioFormat?: TtsOutputAudioFormat;
  /** Optional cancellation signal. */
  readonly signal?: AbortSignal;
  /** Rollover interval in milliseconds. Defaults to 270000. */
  readonly rolloverIntervalMs?: number;
  /** Maximum queued text characters while reconnecting. Defaults to 4096. */
  readonly maxBufferedTextCharacters?: number;
  /** Maximum reconnect attempts for one interruption. Defaults to 3. */
  readonly maxReconnectAttempts?: number;
  /** Initial reconnect backoff delay in milliseconds. Defaults to 250. */
  readonly reconnectInitialDelayMs?: number;
  /** Maximum reconnect backoff delay in milliseconds. Defaults to 5000. */
  readonly reconnectMaxDelayMs?: number;
}

/** Documented TTS streaming server message types. */
export type TtsStreamingServerMessageType =
  | 'SESSION_CREATED'
  | 'TEXT_CHUNK_ACK'
  | 'FETCH_AUDIO_CHUNK'
  | 'COMMITTED_AUDIO'
  | 'ERROR'
  | 'INPUT_ERROR'
  | 'AUTHENTICATION_ERROR'
  | 'RESOURCE_EXHAUSTED'
  | 'QUOTA_EXCEEDED'
  | 'SESSION_TIME_LIMIT_EXCEEDED';

/** Audio payload emitted by streaming TTS. */
export interface TtsAudioChunk {
  /** Audio chunk identifier when returned by the service. */
  readonly chunkId?: number;
  /** Decoded audio bytes. */
  readonly audio: Uint8Array;
  /** Original server payload for forward-compatible consumers. */
  readonly raw: unknown;
}

/** Typed events emitted by streaming TTS sessions. */
export type TtsStreamingEvent =
  | {
      readonly type: 'session_created';
      readonly messageType: 'SESSION_CREATED';
      readonly sessionIndex: number;
      readonly sessionId?: string;
      readonly raw: unknown;
    }
  | {
      readonly type: 'text_chunk_ack';
      readonly messageType: 'TEXT_CHUNK_ACK';
      readonly sessionIndex: number;
      readonly ackId?: number;
      readonly raw: unknown;
    }
  | {
      readonly type: 'audio_chunk';
      readonly messageType: 'FETCH_AUDIO_CHUNK';
      readonly sessionIndex: number;
      readonly chunk: TtsAudioChunk;
      readonly raw: unknown;
    }
  | {
      readonly type: 'committed_audio';
      readonly messageType: 'COMMITTED_AUDIO';
      readonly sessionIndex: number;
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
      readonly sessionIndex: number;
      readonly error: Error;
      readonly raw: unknown;
    }
  | {
      readonly type: 'protocol_error';
      readonly error: Error;
      readonly raw?: unknown;
    }
  | {
      readonly type: 'reconnecting';
      readonly reason:
        | 'rollover'
        | 'transport_close'
        | 'transport_error'
        | 'session_time_limit';
      readonly sessionIndex: number;
      readonly nextSessionIndex: number;
      readonly attempt: number;
    }
  | { readonly type: 'transport_error'; readonly error: Error }
  | {
      readonly type: 'closed';
      readonly sessionIndex: number;
      readonly code?: number;
      readonly reason?: string;
    };

/** Active TTS streaming session. */
export interface TtsStreamingSession extends AsyncDisposable {
  /** All streaming lifecycle, audio, and error events. */
  readonly events: AsyncIterable<TtsStreamingEvent>;
  /** Decoded audio chunks only. */
  readonly audioChunks: AsyncIterable<TtsAudioChunk>;
  /** Current lifecycle state. */
  readonly state: TtsSessionState;
  /** Zero-based index of the active streaming WebSocket session. */
  readonly sessionIndex: number;
  /** Sends a 10-100 character text chunk. */
  sendText(text: string): Promise<void>;
  /** Requests an audio chunk by ID. When omitted, the next sequential ID is used. */
  fetchAudioChunk(chunkId?: number): Promise<void>;
  /** Commits pending text and asks the service to finalize audio. */
  commit(): Promise<void>;
  /** Commits pending text and closes the socket. */
  close(): Promise<void>;
}

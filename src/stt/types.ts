import type { Readable } from 'node:stream';

import type { IntronRequestOptions } from '../client/types.js';
import type { IntronSttLanguageCode } from '../languages.js';
import type { IntronFileUploadSource } from '../transport/index.js';

/**
 * Processing states returned by the asynchronous STT file workflow.
 */
export type SttProcessingStatus =
  | 'FILE_QUEUED'
  | 'FILE_PENDING'
  | 'FILE_PROCESSING'
  | 'FILE_TRANSCRIBED'
  | 'FILE_PROCESSING_FAILED';

/**
 * Documented STT post-processing category values.
 */
export type SttFileCategory =
  | 'file_category_general'
  | 'file_category_telehealth'
  | 'file_category_procedure'
  | 'file_category_call_center'
  | 'file_category_legal'
  | 'file_category_meeting_notes';

/**
 * Optional server-side post-processing controls for asynchronous STT uploads.
 */
export interface SttPostProcessingOptions {
  /** Request transcript summarization. Defaults to omitted. */
  readonly summary?: boolean;
  /** Treat the transcript as a spoken question and return an answer. */
  readonly answer?: boolean;
  /** Additional documented post-processing fields sent as TRUE/FALSE strings. */
  readonly flags?: Readonly<Record<string, boolean>>;
}

/**
 * Options for asynchronous STT file upload.
 */
export interface SttUploadOptions {
  /** Audio file source. */
  readonly source: IntronFileUploadSource;
  /** Input ASR language code. */
  readonly language?: IntronSttLanguageCode;
  /** Whether diarization should be enabled. Defaults to omitted. */
  readonly diarization?: boolean;
  /** Custom post-processing template identifier. */
  readonly templateId?: string;
  /** Documented post-processing category. */
  readonly category?: SttFileCategory | (string & Record<never, never>);
  /** Whether LLM corrections should be disabled. Defaults to omitted. */
  readonly disableLlmCorrections?: boolean;
  /** Optional server-side post-processing options. */
  readonly postProcessing?: SttPostProcessingOptions;
  /** Maximum bytes buffered for stream and async-iterable sources. */
  readonly maxStreamBufferBytes?: number;
  /** Optional cancellation signal. */
  readonly signal?: AbortSignal;
  /** Retry behavior for the upload request. */
  readonly retry?: IntronRequestOptions['retry'];
}

/**
 * Options for synchronous STT file transcription.
 */
export interface SttSyncUploadOptions extends SttUploadOptions {
  /**
   * Caller-provided audio duration metadata in seconds.
   *
   * The synchronous endpoint only supports audio of 120 seconds or less. The SDK
   * validates this field when provided; it does not measure audio duration.
   */
  readonly audioDurationSeconds?: number;
}

/**
 * Safe request metadata preserved from STT operations.
 */
export interface SttRequestMetadata {
  /** HTTP status code returned by the service. */
  readonly status: number;
  /** Service request identifier when available. */
  readonly requestId?: string;
}

/**
 * Queued asynchronous STT job returned after upload.
 */
export interface SttJob {
  /** File identifier used by the status endpoint. */
  readonly fileId: string;
  /** Current processing status when returned by the service. */
  readonly status?: SttProcessingStatus;
  /** Audio file name associated with the job. */
  readonly audioFileName?: string;
  /** Safe request metadata. */
  readonly request: SttRequestMetadata;
}

/**
 * Status payload for an asynchronous STT job.
 */
export interface SttJobStatus extends SttJob {
  /** Transcript text when transcription has completed. */
  readonly transcript?: string;
  /** Processed audio duration in seconds when returned by the service. */
  readonly processedDuration?: number;
  /** Structured or textual post-processing data returned by the service. */
  readonly postProcessing?: unknown;
  /** Original safe response fields for forward-compatible consumers. */
  readonly raw: unknown;
}

/**
 * Terminal successful asynchronous STT result.
 */
export interface SttResult extends SttJobStatus {
  /** Terminal successful processing status. */
  readonly status: 'FILE_TRANSCRIBED';
}

/**
 * Options for checking asynchronous STT file status.
 */
export interface SttFileStatusOptions {
  /** Request structured post-processing output when supported. */
  readonly structuredPostProcessing?: boolean;
  /** Optional cancellation signal. */
  readonly signal?: AbortSignal;
  /** Retry behavior for the status request. */
  readonly retry?: IntronRequestOptions['retry'];
}

/**
 * Options for waiting until asynchronous transcription reaches a terminal state.
 */
export interface WaitForTranscriptionOptions extends SttFileStatusOptions {
  /** File identifier returned by upload. */
  readonly fileId: string;
  /** Polling interval in milliseconds. Defaults to 2000. */
  readonly pollingIntervalMs?: number;
  /** Overall wait timeout in milliseconds. */
  readonly timeoutMs?: number;
  /** Callback invoked after every status response. */
  readonly onStatus?: (status: SttJobStatus) => void;
}

/** STT streaming session lifecycle states. */
export enum SttSessionState {
  Connecting = 'connecting',
  Ready = 'ready',
  Active = 'active',
  Committing = 'committing',
  Reconnecting = 'reconnecting',
  Completed = 'completed',
  Failed = 'failed',
  Cancelled = 'cancelled',
}

/** Audio sources accepted by streaming STT. */
export type SttStreamingAudioSource =
  AsyncIterable<Uint8Array> | Readable | ReadableStream<Uint8Array>;

/** Options for streaming STT transcription. */
export interface SttStreamingOptions {
  /** PCM16 little-endian audio chunks. */
  readonly audio: SttStreamingAudioSource;
  /** Input audio sample rate in Hz. Defaults to 16000. */
  readonly sampleRate?: number;
  /** Input PCM bit depth. Defaults to 16. */
  readonly bitRate?: number;
  /** Number of input channels. Defaults to 1. */
  readonly channels?: number;
  /** Input language code. Defaults to `en`. */
  readonly language?: IntronSttLanguageCode;
  /** Optional cancellation signal. */
  readonly signal?: AbortSignal;
  /** Rollover interval in milliseconds. Defaults to 270000. */
  readonly rolloverIntervalMs?: number;
  /** Maximum audio bytes buffered while reconnecting. Defaults to 1048576. */
  readonly maxReconnectBufferBytes?: number;
  /** Maximum reconnect attempts for one interruption. Defaults to 3. */
  readonly maxReconnectAttempts?: number;
  /** Initial reconnect backoff delay in milliseconds. Defaults to 250. */
  readonly reconnectInitialDelayMs?: number;
  /** Maximum reconnect backoff delay in milliseconds. Defaults to 5000. */
  readonly reconnectMaxDelayMs?: number;
}

/** Documented STT streaming server message types. */
export type SttStreamingServerMessageType =
  | 'SESSION_CREATED'
  | 'AUDIO_CHUCK_ACK'
  | 'PARTIAL_TRANSCRIPT'
  | 'COMMITTED_TRANSCRIPT'
  | 'ERROR'
  | 'INPUT_ERROR'
  | 'AUTHENTICATION_ERROR'
  | 'RESOURCE_EXHAUSTED'
  | 'QUOTA_EXCEEDED'
  | 'SESSION_TIME_LIMIT_EXCEEDED'
  | 'CHUNCK_SIZE_TOO_SMALL'
  | 'CHUNK_SIZE_TOO_LARGE'
  | 'INSUFFICIENT_AUDIO_ACTIVITY'
  | 'CHUNK_ID_MISMATCH_WITH_TOTAL';

/** Transcript events emitted by streaming STT. */
export type SttTranscriptEvent =
  | {
      readonly type: 'partial_transcript';
      readonly messageType: 'PARTIAL_TRANSCRIPT';
      readonly sessionIndex: number;
      readonly transcript: string;
      readonly raw: unknown;
    }
  | {
      readonly type: 'committed_transcript';
      readonly messageType: 'COMMITTED_TRANSCRIPT';
      readonly sessionIndex: number;
      readonly transcript: string;
      readonly raw: unknown;
    };

/** Typed events emitted by streaming STT sessions. */
export type SttStreamingEvent =
  | {
      readonly type: 'session_created';
      readonly messageType: 'SESSION_CREATED';
      readonly sessionIndex: number;
      readonly sessionId?: string;
      readonly raw: unknown;
    }
  | {
      readonly type: 'audio_chunk_ack';
      readonly messageType: 'AUDIO_CHUCK_ACK';
      readonly sessionIndex: number;
      readonly ackId?: number;
      readonly raw: unknown;
    }
  | SttTranscriptEvent
  | {
      readonly type: 'server_error';
      readonly messageType: Exclude<
        SttStreamingServerMessageType,
        | 'SESSION_CREATED'
        | 'AUDIO_CHUCK_ACK'
        | 'PARTIAL_TRANSCRIPT'
        | 'COMMITTED_TRANSCRIPT'
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

/** Active STT streaming session. */
export interface SttStreamingSession extends AsyncDisposable {
  /** All streaming lifecycle, transcript, and error events. */
  readonly events: AsyncIterable<SttStreamingEvent>;
  /** Partial and committed transcript events only. */
  readonly transcriptEvents: AsyncIterable<SttTranscriptEvent>;
  /** Current lifecycle state. */
  readonly state: SttSessionState;
  /** Zero-based index of the active streaming WebSocket session. */
  readonly sessionIndex: number;
  /** Commits pending audio and closes the socket. */
  close(): Promise<void>;
}

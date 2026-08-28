import type { IntronRequestOptions } from '../client/types.js';
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
  readonly language?: string;
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

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

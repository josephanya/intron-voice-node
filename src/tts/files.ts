import { IntronProtocolError } from '../errors/index.js';
import type {
  TtsGenerateOptions,
  TtsJob,
  TtsJobStatus,
  TtsOutputAudioFormat,
  TtsProcessingStatus,
  TtsQueueOptions,
  TtsRequestMetadata,
  TtsResult,
  TtsSynthesisOptions,
} from './types.js';

const MAX_TTS_TEXT_CHARACTERS = 4096;
const TTS_OUTPUT_AUDIO_FORMATS = new Set<string>(['wav', 'opus']);
const TTS_VOICE_GENDERS = new Set<string>(['male', 'female']);
const TTS_PROCESSING_STATUSES = new Set<string>([
  'TTS_TEXT_AUDIO_QUEUED',
  'TTS_TEXT_AUDIO_PENDING',
  'TTS_TEXT_AUDIO_PROCESSING',
  'TTS_TEXT_AUDIO_GENERATED',
  'TTS_TEXT_AUDIO_PROCESSING_FAILED',
]);

/** Validates synchronous TTS generation options. */
export function validateTtsGenerateOptions(options: TtsGenerateOptions): void {
  validateTtsSynthesisOptions(options);
}

/** Validates queued TTS generation options. */
export function validateTtsQueueOptions(options: TtsQueueOptions): void {
  validateTtsSynthesisOptions(options);
}

/** Builds the documented TTS JSON request body. */
export function createTtsSynthesisJson(options: TtsSynthesisOptions): {
  readonly text: string;
  readonly voice_language: string;
  readonly voice_accent: string;
  readonly voice_gender: string;
  readonly output_audio_format?: TtsOutputAudioFormat;
} {
  return {
    text: options.text,
    voice_language: options.voiceLanguage,
    voice_accent: options.voiceAccent,
    voice_gender: options.voiceGender,
    ...(options.outputAudioFormat === undefined
      ? {}
      : { output_audio_format: options.outputAudioFormat }),
  };
}

/** Parses a queued TTS response. */
export function parseTtsJob(
  value: unknown,
  request: TtsRequestMetadata,
): TtsJob {
  const fields = readResponseData(value);
  const textId = readString(fields, 'text_id', 'textId');

  if (textId === undefined) {
    throw new IntronProtocolError({
      message: 'Intron TTS queue response did not include text_id.',
      operation: 'tts.parseQueuedText',
    });
  }

  return { textId, request };
}

/** Parses a TTS status or generate response. */
export function parseTtsJobStatus(
  value: unknown,
  request: TtsRequestMetadata,
): TtsJobStatus {
  const fields = readResponseData(value);
  const textId = readString(fields, 'text_id', 'textId');
  const status = readTtsStatus(fields);
  const audioPath = readString(fields, 'audio_path', 'audioPath');
  const audioDurationSeconds = readNumber(
    fields,
    'audio_duration_in_seconds',
    'audioDurationSeconds',
  );
  const failure = readFailure(fields);

  return {
    ...(textId === undefined ? {} : { textId }),
    ...(status === undefined ? {} : { status }),
    ...(audioPath === undefined ? {} : { audioPath }),
    ...(audioDurationSeconds === undefined ? {} : { audioDurationSeconds }),
    ...(failure === undefined ? {} : { failure }),
    request,
    raw: value,
  };
}

/** Returns true when a queued TTS status is terminal. */
export function isTerminalTtsStatus(
  status: TtsProcessingStatus | undefined,
): boolean {
  return (
    status === 'TTS_TEXT_AUDIO_GENERATED' ||
    status === 'TTS_TEXT_AUDIO_PROCESSING_FAILED'
  );
}

/** Converts a status payload to a successful TTS result. */
export function toTtsResult(status: TtsJobStatus): TtsResult {
  if (status.status !== 'TTS_TEXT_AUDIO_GENERATED') {
    throw new IntronProtocolError({
      message: 'Intron TTS processing did not complete successfully.',
      operation: 'tts.toTtsResult',
    });
  }

  return status as TtsResult;
}

/** Attaches downloaded audio bytes to a parsed TTS status. */
export function withTtsAudio(
  status: TtsJobStatus,
  audio: Uint8Array | undefined,
): TtsJobStatus {
  if (audio === undefined) {
    return status;
  }

  return { ...status, audio };
}

function validateTtsSynthesisOptions(options: TtsSynthesisOptions): void {
  if (options.text.length === 0) {
    throw new IntronProtocolError({
      message: 'TTS text is required.',
      operation: 'tts.validateSynthesisOptions',
    });
  }

  if (options.text.length > MAX_TTS_TEXT_CHARACTERS) {
    throw new IntronProtocolError({
      message: 'TTS text must not exceed 4096 characters.',
      operation: 'tts.validateSynthesisOptions',
    });
  }

  validateIdentifier(options.voiceLanguage, 'voiceLanguage');
  validateIdentifier(options.voiceAccent, 'voiceAccent');

  if (!TTS_VOICE_GENDERS.has(options.voiceGender)) {
    throw new IntronProtocolError({
      message: 'TTS voiceGender must be male or female.',
      operation: 'tts.validateSynthesisOptions',
    });
  }

  if (
    options.outputAudioFormat !== undefined &&
    !TTS_OUTPUT_AUDIO_FORMATS.has(options.outputAudioFormat)
  ) {
    throw new IntronProtocolError({
      message: 'TTS outputAudioFormat must be wav or opus.',
      operation: 'tts.validateSynthesisOptions',
    });
  }
}

function validateIdentifier(value: string, field: string): void {
  if (!/^[A-Za-z][A-Za-z0-9_-]*$/u.test(value)) {
    throw new IntronProtocolError({
      message: `TTS ${field} must be a non-empty language or accent identifier.`,
      operation: 'tts.validateSynthesisOptions',
    });
  }
}

function readResponseData(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object') {
    throw new IntronProtocolError({
      message: 'Intron TTS response was not an object.',
      operation: 'tts.parseResponse',
    });
  }

  const fields = value as Record<string, unknown>;
  const data = fields.data;

  if (data !== null && typeof data === 'object') {
    return data as Record<string, unknown>;
  }

  return fields;
}

function readTtsStatus(
  fields: Record<string, unknown>,
): TtsProcessingStatus | undefined {
  const status = readString(fields, 'processing_status', 'processingStatus');

  if (status === undefined) {
    return undefined;
  }

  if (!TTS_PROCESSING_STATUSES.has(status)) {
    throw new IntronProtocolError({
      message: `Unsupported Intron TTS processing status: ${status}.`,
      operation: 'tts.parseStatus',
    });
  }

  return status as TtsProcessingStatus;
}

function readFailure(fields: Record<string, unknown>):
  | {
      readonly message?: string;
      readonly code?: string;
      readonly raw?: unknown;
    }
  | undefined {
  const raw = fields.failure_details ?? fields.failure ?? fields.error;
  const message = readString(
    fields,
    'failure_message',
    'failure_reason',
    'error',
    'message',
  );
  const code = readString(fields, 'failure_code', 'code');

  if (raw === undefined && message === undefined && code === undefined) {
    return undefined;
  }

  return {
    ...(message === undefined ? {} : { message }),
    ...(code === undefined ? {} : { code }),
    ...(raw === undefined ? {} : { raw }),
  };
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

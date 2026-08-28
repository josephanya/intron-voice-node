import { openAsBlob } from 'node:fs';
import { basename, extname } from 'node:path';

import { IntronApiError, IntronProtocolError } from '../errors/index.js';
import type { IntronFileUploadSource } from '../transport/index.js';
import type {
  SttJob,
  SttJobStatus,
  SttProcessingStatus,
  SttRequestMetadata,
  SttResult,
  SttSyncUploadOptions,
  SttUploadOptions,
} from './types.js';

const SUPPORTED_AUDIO_EXTENSIONS = new Set([
  '.wav',
  '.mp3',
  '.mp4',
  '.m4a',
  '.ogg',
  '.webm',
  '.flac',
]);
const DEFAULT_STREAM_BUFFER_LIMIT_BYTES = 25 * 1024 * 1024;
const MAX_SYNC_AUDIO_DURATION_SECONDS = 120;
const TERMINAL_SUCCESS_STATUS = 'FILE_TRANSCRIBED';
const TERMINAL_FAILURE_STATUS = 'FILE_PROCESSING_FAILED';

/**
 * Error raised when synchronous transcription times out but returns a file ID.
 */
export class SttSyncTranscriptionUnavailableError extends IntronApiError {
  /** File identifier that can be used with the asynchronous status endpoint. */
  public readonly fileId: string;
  /** Parsed status payload returned by the synchronous endpoint. */
  public readonly job: SttJobStatus;

  /**
   * Creates a sync fallback error with the file ID preserved.
   *
   * @param options - Parsed job payload and retry metadata.
   */
  public constructor(options: {
    readonly job: SttJobStatus;
    readonly retryAfter?: number;
  }) {
    super({
      message:
        'Intron synchronous transcription timed out; use fileId with getFileStatus or waitForTranscription.',
      status: 503,
      retryable: true,
      operation: 'stt.transcribeAudioFileSync',
      ...(options.retryAfter === undefined
        ? {}
        : { retryAfter: options.retryAfter }),
      ...(options.job.request.requestId === undefined
        ? {}
        : { requestId: options.job.request.requestId }),
    });
    this.fileId = options.job.fileId;
    this.job = options.job;
  }
}

/**
 * Creates the documented multipart body for STT file upload.
 *
 * @param options - STT upload options.
 */
export async function createSttUploadFormData(
  options: SttUploadOptions,
): Promise<FormData> {
  const filename = getUploadFilename(options.source);
  validateAudioFilename(filename);

  const formData = new FormData();
  formData.set('audio_file_name', filename);
  formData.set(
    'audio_file_blob',
    await createUploadBlob(options.source, options.maxStreamBufferBytes),
    filename,
  );
  appendOptionalField(formData, 'use_language_asr_input', options.language);
  appendBooleanField(formData, 'use_diarization', options.diarization);
  appendOptionalField(formData, 'use_template_id', options.templateId);
  appendOptionalField(formData, 'use_category', options.category);
  appendBooleanField(
    formData,
    'use_disable_llm_corrections',
    options.disableLlmCorrections,
  );
  appendBooleanField(formData, 'get_summary', options.postProcessing?.summary);
  appendBooleanField(formData, 'get_answer', options.postProcessing?.answer);

  for (const [field, enabled] of Object.entries(
    options.postProcessing?.flags ?? {},
  )) {
    appendBooleanField(formData, field, enabled);
  }

  return formData;
}

/**
 * Validates caller-provided synchronous endpoint duration metadata.
 *
 * @param options - Synchronous upload options.
 */
export function validateSyncUploadOptions(options: SttSyncUploadOptions): void {
  const duration = options.audioDurationSeconds;

  if (duration === undefined) {
    return;
  }

  if (!Number.isFinite(duration) || duration < 0) {
    throw new IntronProtocolError({
      message: 'Audio duration metadata must be a finite non-negative number.',
      operation: 'stt.validateSyncAudioFile',
    });
  }

  if (duration > MAX_SYNC_AUDIO_DURATION_SECONDS) {
    throw new IntronProtocolError({
      message:
        'The synchronous STT endpoint only supports audio of 120 seconds or less.',
      operation: 'stt.validateSyncAudioFile',
    });
  }
}

/**
 * Parses an asynchronous STT upload response into a typed job.
 *
 * @param value - Parsed JSON response.
 * @param request - Safe request metadata.
 */
export function parseSttJob(
  value: unknown,
  request: SttRequestMetadata,
): SttJob {
  const fields = getResponseFields(value);
  const fileId = readString(fields, 'file_id', 'fileId', 'id');

  if (fileId === undefined || fileId.length === 0) {
    throw new IntronProtocolError({
      message: 'Intron STT upload response did not include a file id.',
      operation: 'stt.uploadAudioFile',
    });
  }

  const status = parseProcessingStatus(
    readString(fields, 'processing_status', 'file_status', 'status'),
  );
  const audioFileName = readString(
    fields,
    'audio_file_name',
    'audioFileName',
    'filename',
  );

  return {
    fileId,
    request,
    ...(status === undefined ? {} : { status }),
    ...(audioFileName === undefined ? {} : { audioFileName }),
  };
}

/**
 * Parses an asynchronous STT status response into a typed status object.
 *
 * @param value - Parsed JSON response.
 * @param request - Safe request metadata.
 */
export function parseSttJobStatus(
  value: unknown,
  request: SttRequestMetadata,
): SttJobStatus {
  const fields = getResponseFields(value);
  const job = parseSttJob(value, request);
  const transcript = readString(
    fields,
    'transcript',
    'text',
    'transcription',
    'audio_transcript',
  );
  const processedDuration = readNumber(
    fields,
    'processed_duration',
    'processedDuration',
    'audio_duration',
    'duration',
    'processed_audio_duration_in_seconds',
  );
  const postProcessing = readFirstDefined(
    fields,
    'structured_post_processing',
    'post_processing',
    'postProcessing',
    'summary',
    'transcript_answer',
  );

  return {
    ...job,
    raw: value,
    ...(transcript === undefined ? {} : { transcript }),
    ...(processedDuration === undefined ? {} : { processedDuration }),
    ...(postProcessing === undefined ? {} : { postProcessing }),
  };
}

/**
 * Returns true when a status is terminal.
 *
 * @param status - STT processing status.
 */
export function isTerminalSttStatus(
  status: SttProcessingStatus | undefined,
): boolean {
  return (
    status === TERMINAL_SUCCESS_STATUS || status === TERMINAL_FAILURE_STATUS
  );
}

/**
 * Converts a terminal successful status to an STT result.
 *
 * @param status - Terminal status payload.
 */
export function toSttResult(status: SttJobStatus): SttResult {
  if (status.status !== TERMINAL_SUCCESS_STATUS) {
    throw new IntronProtocolError({
      message: `Intron STT processing ended with status ${status.status ?? 'UNKNOWN'}.`,
      operation: 'stt.waitForTranscription',
    });
  }

  return {
    ...status,
    status: TERMINAL_SUCCESS_STATUS,
  };
}

/**
 * Validates a documented STT upload file extension.
 *
 * @param filename - File name sent to the service.
 */
export function validateAudioFilename(filename: string): void {
  const extension = extname(filename).toLowerCase();

  if (!SUPPORTED_AUDIO_EXTENSIONS.has(extension)) {
    throw new IntronProtocolError({
      message: `Unsupported audio file format: ${extension.length === 0 ? 'missing extension' : extension}.`,
      operation: 'stt.validateAudioFile',
    });
  }
}

function getUploadFilename(source: IntronFileUploadSource): string {
  if (source.kind === 'path') {
    return source.filename ?? basename(source.path);
  }

  return source.filename;
}

async function createUploadBlob(
  source: IntronFileUploadSource,
  maxStreamBufferBytes: number | undefined,
): Promise<Blob> {
  const type = source.contentType ?? '';

  if (source.kind === 'path') {
    return openAsBlob(source.path, { type });
  }

  if (source.kind === 'buffer') {
    return new Blob([toArrayBuffer(source.data)], { type });
  }

  const chunks = await collectUploadChunks(
    source.kind === 'stream' ? source.stream : source.data,
    maxStreamBufferBytes ?? DEFAULT_STREAM_BUFFER_LIMIT_BYTES,
  );

  return new Blob(chunks.map(toArrayBuffer), { type });
}

function toArrayBuffer(chunk: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(chunk.byteLength);
  new Uint8Array(copy).set(chunk);

  return copy;
}

async function collectUploadChunks(
  source: AsyncIterable<Uint8Array>,
  maxBytes: number,
): Promise<Uint8Array[]> {
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  for await (const chunk of source) {
    totalBytes += chunk.byteLength;

    if (totalBytes > maxBytes) {
      throw new IntronProtocolError({
        message: `Stream upload source exceeded the configured ${String(maxBytes)} byte buffer limit.`,
        operation: 'stt.prepareUpload',
      });
    }

    chunks.push(chunk);
  }

  return chunks;
}

function appendOptionalField(
  formData: FormData,
  field: string,
  value: string | undefined,
): void {
  if (value !== undefined) {
    formData.set(field, value);
  }
}

function appendBooleanField(
  formData: FormData,
  field: string,
  value: boolean | undefined,
): void {
  if (value !== undefined) {
    formData.set(field, value ? 'TRUE' : 'FALSE');
  }
}

function getResponseFields(value: unknown): Record<string, unknown> {
  if (value !== null && typeof value === 'object') {
    const fields = value as Record<string, unknown>;

    if (fields.data !== null && typeof fields.data === 'object') {
      return fields.data as Record<string, unknown>;
    }

    return fields;
  }

  throw new IntronProtocolError({
    message: 'Intron STT response was not an object.',
    operation: 'stt.parseResponse',
  });
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

function readFirstDefined(
  fields: Record<string, unknown>,
  ...keys: readonly string[]
): unknown {
  for (const key of keys) {
    if (fields[key] !== undefined) {
      return fields[key];
    }
  }

  return undefined;
}

function parseProcessingStatus(
  value: string | undefined,
): SttProcessingStatus | undefined {
  if (
    value === 'FILE_QUEUED' ||
    value === 'FILE_PENDING' ||
    value === 'FILE_PROCESSING' ||
    value === TERMINAL_SUCCESS_STATUS ||
    value === TERMINAL_FAILURE_STATUS
  ) {
    return value;
  }

  return undefined;
}

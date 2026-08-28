import { inspect } from 'node:util';

import {
  IntronApiError,
  IntronAuthenticationError,
  IntronProtocolError,
  createIntronHttpError,
  createIntronTransportError,
} from '../errors/index.js';
import type {
  IntronClock,
  IntronHttpRequest,
  IntronHttpTransport,
} from '../transport/index.js';
import {
  IntronFetchHttpTransport,
  IntronSystemClock,
} from '../transport/index.js';
import {
  createSttUploadFormData,
  isTerminalSttStatus,
  parseSttJob,
  parseSttJobStatus,
  toSttResult,
} from '../stt/files.js';
import type {
  SttFileStatusOptions,
  SttJob,
  SttJobStatus,
  SttRequestMetadata,
  SttResult,
  SttUploadOptions,
  WaitForTranscriptionOptions,
} from '../stt/types.js';
import type {
  IntronAuthOptions,
  IntronClientConfig,
  IntronJsonRequestOptions,
  IntronMultipartRequestOptions,
  IntronResolvedClientConfig,
  IntronTokenProvider,
} from './types.js';

const DEFAULT_API_BASE_URL = 'https://infer.voice.intron.io';
const DEFAULT_WEBSOCKET_BASE_URL = 'wss://infer.voice.intron.io';
const DEFAULT_RETRY_POLICY = Object.freeze({
  maxRetries: 2,
  initialDelayMs: 250,
  maxDelayMs: 5_000,
  backoffMultiplier: 2,
  jitterRatio: 0.2,
  random: Math.random,
});
const JSON_CONTENT_TYPE = 'application/json; charset=utf-8';

interface IntronClientSecrets {
  readonly apiKey?: string;
  readonly tokenProvider?: IntronTokenProvider;
}

interface IntronParsedHttpResponse<ResponseBody> {
  readonly status: number;
  readonly headers: Headers;
  readonly body: ResponseBody;
}

/**
 * Root SDK client for Intron Voice API workflows.
 *
 * Phase 0 establishes construction and public contracts only; protocol-specific
 * methods are introduced in later phases.
 */
export class IntronClient {
  private readonly config: IntronResolvedClientConfig;
  private readonly httpTransport: IntronHttpTransport;
  private readonly clock: IntronClock;
  private readonly secrets: IntronClientSecrets;

  /**
   * Creates a client instance without contacting the Intron service.
   *
   * @param config - Client configuration and injectable dependencies.
   */
  public constructor(config: IntronClientConfig = {}) {
    const apiKey = config.apiKey?.trim();
    const hasApiKey = apiKey !== undefined && apiKey.length > 0;
    const hasTokenProvider = config.tokenProvider !== undefined;

    if (!hasApiKey && !hasTokenProvider) {
      throw new IntronAuthenticationError({
        message: 'Intron credentials are required.',
        operation: 'client.configure',
      });
    }

    if (hasApiKey && hasTokenProvider) {
      throw new IntronAuthenticationError({
        message: 'Provide either apiKey or tokenProvider, not both.',
        operation: 'client.configure',
      });
    }

    this.config = Object.freeze({
      apiBaseUrl: normalizeBaseUrl(config.apiBaseUrl ?? DEFAULT_API_BASE_URL),
      websocketBaseUrl: normalizeBaseUrl(
        config.websocketBaseUrl ?? DEFAULT_WEBSOCKET_BASE_URL,
      ),
      ...(config.connectTimeout === undefined
        ? {}
        : { connectTimeout: config.connectTimeout }),
      ...(config.requestTimeout === undefined
        ? {}
        : { requestTimeout: config.requestTimeout }),
      ...(config.receiveTimeout === undefined
        ? {}
        : { receiveTimeout: config.receiveTimeout }),
      retryPolicy: Object.freeze({
        ...DEFAULT_RETRY_POLICY,
        ...config.retryPolicy,
      }),
    });
    this.httpTransport = config.httpTransport ?? new IntronFetchHttpTransport();
    this.clock = config.clock ?? new IntronSystemClock();
    this.secrets = Object.freeze({
      ...(apiKey === undefined ? {} : { apiKey }),
      ...(config.tokenProvider === undefined
        ? {}
        : { tokenProvider: config.tokenProvider }),
    });
  }

  /**
   * Returns the immutable, secret-free configuration used by the client.
   */
  public getConfig(): IntronResolvedClientConfig {
    return this.config;
  }

  /**
   * Resolves the bearer Authorization header for a request or connection.
   *
   * @param options - Optional cancellation controls.
   */
  public async resolveAuthorizationHeader(
    options: IntronAuthOptions = {},
  ): Promise<string> {
    const token =
      this.secrets.apiKey ?? (await this.resolveProviderToken(options));

    return `Bearer ${token}`;
  }

  /**
   * Sends an authenticated JSON REST request and parses a JSON response.
   *
   * @param options - JSON request options.
   */
  public async requestJson<ResponseBody>(
    options: IntronJsonRequestOptions,
  ): Promise<ResponseBody> {
    return (await this.requestJsonResponse<ResponseBody>(options)).body;
  }

  /**
   * Sends an authenticated multipart REST request and parses a JSON response.
   *
   * @param options - Multipart request options.
   */
  public async requestMultipart<ResponseBody>(
    options: IntronMultipartRequestOptions,
  ): Promise<ResponseBody> {
    return (await this.requestMultipartResponse<ResponseBody>(options)).body;
  }

  /**
   * Uploads an audio file for asynchronous transcription.
   *
   * @param options - Upload options.
   */
  public async uploadAudioFile(options: SttUploadOptions): Promise<SttJob> {
    const response = await this.requestMultipartResponse<unknown>({
      method: 'POST',
      path: '/file/v1/upload',
      formData: await createSttUploadFormData(options),
      operation: 'stt.uploadAudioFile',
      retry: options.retry ?? false,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });

    return parseSttJob(response.body, createRequestMetadata(response));
  }

  /**
   * Gets the status and result fields for an asynchronous transcription job.
   *
   * @param fileId - File identifier returned by {@link uploadAudioFile}.
   * @param options - Optional status request controls.
   */
  public async getFileStatus(
    fileId: string,
    options: SttFileStatusOptions = {},
  ): Promise<SttJobStatus> {
    const response = await this.requestJsonResponse<unknown>({
      method: 'GET',
      path: `/file/v1/status/${encodeURIComponent(fileId)}`,
      query: {
        ...(options.structuredPostProcessing === undefined
          ? {}
          : {
              get_structured_post_processing: options.structuredPostProcessing
                ? 't'
                : 'f',
            }),
      },
      operation: 'stt.getFileStatus',
      retry: options.retry ?? true,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });

    return parseSttJobStatus(response.body, createRequestMetadata(response));
  }

  /**
   * Polls file status until transcription succeeds or fails.
   *
   * @param options - Polling controls.
   */
  public async waitForTranscription(
    options: WaitForTranscriptionOptions,
  ): Promise<SttResult> {
    const startedAt = this.clock.now();
    const pollingIntervalMs = options.pollingIntervalMs ?? 2_000;

    for (;;) {
      throwIfAborted(options.signal);

      if (
        options.timeoutMs !== undefined &&
        this.clock.now() - startedAt > options.timeoutMs
      ) {
        throw new IntronProtocolError({
          message: 'Timed out waiting for Intron STT transcription.',
          operation: 'stt.waitForTranscription',
        });
      }

      const status = await this.getFileStatus(options.fileId, {
        ...(options.structuredPostProcessing === undefined
          ? {}
          : { structuredPostProcessing: options.structuredPostProcessing }),
        ...(options.signal === undefined ? {} : { signal: options.signal }),
        ...(options.retry === undefined ? {} : { retry: options.retry }),
      });
      options.onStatus?.(status);

      if (isTerminalSttStatus(status.status)) {
        return toSttResult(status);
      }

      await waitForDelay(this.clock, pollingIntervalMs, options.signal);
    }
  }

  private async requestJsonResponse<ResponseBody>(
    options: IntronJsonRequestOptions,
  ): Promise<IntronParsedHttpResponse<ResponseBody>> {
    const body =
      options.json === undefined
        ? undefined
        : new TextEncoder().encode(JSON.stringify(options.json));
    const response = await this.sendHttpRequest({
      options,
      accept: 'application/json',
      ...(body === undefined ? {} : { body, contentType: JSON_CONTENT_TYPE }),
    });

    if (response.body.length === 0) {
      return {
        status: response.status,
        headers: response.headers,
        body: undefined as ResponseBody,
      };
    }

    if (!isJsonContentType(response.headers.get('content-type'))) {
      throw new IntronProtocolError({
        message: 'Expected JSON response from Intron API.',
        status: response.status,
        ...(options.operation === undefined
          ? {}
          : { operation: options.operation }),
      });
    }

    try {
      return {
        status: response.status,
        headers: response.headers,
        body: JSON.parse(
          new TextDecoder().decode(response.body),
        ) as ResponseBody,
      };
    } catch (cause) {
      throw createIntronHttpError({
        status: response.status,
        message: 'Malformed JSON response.',
        headers: response.headers,
        cause,
        ...(options.operation === undefined
          ? {}
          : { operation: options.operation }),
      });
    }
  }

  private async requestMultipartResponse<ResponseBody>(
    options: IntronMultipartRequestOptions,
  ): Promise<IntronParsedHttpResponse<ResponseBody>> {
    const response = await this.sendHttpRequest({
      options,
      body: options.formData,
      accept: 'application/json',
    });

    if (response.body.length === 0) {
      return {
        status: response.status,
        headers: response.headers,
        body: undefined as ResponseBody,
      };
    }

    if (!isJsonContentType(response.headers.get('content-type'))) {
      throw new IntronProtocolError({
        message: 'Expected JSON response from Intron API.',
        status: response.status,
        ...(options.operation === undefined
          ? {}
          : { operation: options.operation }),
      });
    }

    try {
      return {
        status: response.status,
        headers: response.headers,
        body: JSON.parse(
          new TextDecoder().decode(response.body),
        ) as ResponseBody,
      };
    } catch (cause) {
      throw createIntronHttpError({
        status: response.status,
        message: 'Malformed JSON response.',
        headers: response.headers,
        cause,
        ...(options.operation === undefined
          ? {}
          : { operation: options.operation }),
      });
    }
  }

  /**
   * Releases resources owned by the configured transports.
   */
  public async close(): Promise<void> {
    await this.httpTransport.close();
  }

  /**
   * Returns a secret-free string representation of the client.
   */
  public toString(): string {
    return 'IntronClient { credentials: [REDACTED] }';
  }

  /**
   * Returns a secret-free JSON representation of the client.
   */
  public toJSON(): {
    readonly name: 'IntronClient';
    readonly config: IntronResolvedClientConfig;
  } {
    return {
      name: 'IntronClient',
      config: this.config,
    };
  }

  /**
   * Returns a secret-free object inspection representation of the client.
   */
  public [inspect.custom](): string {
    return this.toString();
  }

  private async resolveProviderToken(
    options: IntronAuthOptions,
  ): Promise<string> {
    const token = await this.secrets.tokenProvider?.resolveToken(
      options.signal,
    );
    const trimmedToken = token?.trim();

    if (trimmedToken === undefined || trimmedToken.length === 0) {
      throw new IntronAuthenticationError({
        message: 'Token provider returned an empty token.',
        operation: 'auth.resolveToken',
      });
    }

    return trimmedToken;
  }

  private async sendHttpRequest(options: {
    readonly options: IntronJsonRequestOptions | IntronMultipartRequestOptions;
    readonly body?: IntronHttpRequest['body'];
    readonly contentType?: string;
    readonly accept?: string;
  }) {
    const method = options.options.method ?? 'GET';
    const retryOptions = normalizeRequestRetry(method, options.options.retry);
    const maxRetries = Math.min(
      retryOptions.maxRetries,
      this.config.retryPolicy.maxRetries,
    );
    let attempt = 0;

    for (;;) {
      try {
        const response = await this.sendHttpAttempt({
          ...options,
          method,
        });

        if (response.status >= 200 && response.status < 300) {
          return response;
        }

        const httpError = this.createHttpErrorFromResponse(
          response,
          options.options.operation,
        );

        if (
          !canRetryError(httpError, retryOptions.enabled, attempt, maxRetries)
        ) {
          throw httpError;
        }

        await this.waitForRetry(
          httpError.retryAfter,
          attempt,
          options.options.signal,
        );
      } catch (cause) {
        const error =
          cause instanceof IntronApiError
            ? cause
            : createIntronTransportError(cause, options.options.operation);

        if (!canRetryError(error, retryOptions.enabled, attempt, maxRetries)) {
          throw error;
        }

        await this.waitForRetry(
          error.retryAfter,
          attempt,
          options.options.signal,
        );
      }

      attempt += 1;
    }
  }

  private async sendHttpAttempt(options: {
    readonly options: IntronJsonRequestOptions | IntronMultipartRequestOptions;
    readonly method: string;
    readonly body?: IntronHttpRequest['body'];
    readonly contentType?: string;
    readonly accept?: string;
  }) {
    const timeoutMs = this.config.receiveTimeout ?? this.config.requestTimeout;
    const signal = createTimeoutSignal({
      clock: this.clock,
      ...(options.options.signal === undefined
        ? {}
        : { signal: options.options.signal }),
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
    });

    try {
      const authorization = await this.resolveAuthorizationHeader({
        signal: signal.signal,
      });
      const headers = {
        ...(options.accept === undefined ? {} : { accept: options.accept }),
        ...(options.contentType === undefined
          ? {}
          : { 'content-type': options.contentType }),
        ...options.options.headers,
        authorization,
      };
      const request: IntronHttpRequest = {
        method: options.method,
        url: buildRequestUrl(this.config.apiBaseUrl, options.options),
        headers,
        ...(options.body === undefined ? {} : { body: options.body }),
        signal: signal.signal,
      };

      return await this.httpTransport.send(request);
    } finally {
      signal.dispose();
    }
  }

  private createHttpErrorFromResponse(
    response: {
      readonly status: number;
      readonly headers: Headers;
      readonly body: Uint8Array;
    },
    operation: string | undefined,
  ) {
    const body = response.body.length === 0 ? undefined : response.body;
    const metadata =
      body === undefined ||
      !isJsonContentType(response.headers.get('content-type'))
        ? undefined
        : parseSafeErrorMetadata(body);

    return createIntronHttpError({
      status: response.status,
      headers: response.headers,
      ...(metadata?.message === undefined ? {} : { message: metadata.message }),
      ...(metadata?.code === undefined ? {} : { code: metadata.code }),
      ...(operation === undefined ? {} : { operation }),
    });
  }

  private async waitForRetry(
    retryAfter: number | undefined,
    attempt: number,
    signal: AbortSignal | undefined,
  ): Promise<void> {
    const delayMs =
      retryAfter === undefined
        ? computeBackoffDelay(this.config.retryPolicy, attempt)
        : Math.min(retryAfter * 1000, this.config.retryPolicy.maxDelayMs);

    await waitForDelay(this.clock, delayMs, signal);
  }
}

interface ParsedErrorMetadata {
  readonly message?: string;
  readonly code?: string;
}

function normalizeBaseUrl(value: URL | string): URL {
  const url = new URL(value.toString());

  if (url.pathname.length > 1) {
    url.pathname = url.pathname.replace(/\/+$/u, '');
  }

  url.search = '';
  url.hash = '';

  return url;
}

function buildRequestUrl(
  baseUrl: URL,
  options: Pick<IntronJsonRequestOptions, 'path' | 'query'>,
): URL {
  const url = new URL(baseUrl.toString());
  const basePath = url.pathname.endsWith('/')
    ? url.pathname
    : `${url.pathname}/`;
  const requestPath = options.path.replace(/^\/+/u, '');

  url.pathname = `${basePath}${requestPath}`;

  for (const [key, value] of Object.entries(options.query ?? {})) {
    url.searchParams.set(key, String(value));
  }

  return url;
}

function isJsonContentType(contentType: string | null): boolean {
  if (contentType === null) {
    return false;
  }

  const mediaType = contentType.split(';', 1)[0]?.trim().toLowerCase();

  return (
    mediaType === 'application/json' || mediaType?.endsWith('+json') === true
  );
}

function parseSafeErrorMetadata(body: Uint8Array): ParsedErrorMetadata {
  try {
    const value = JSON.parse(new TextDecoder().decode(body)) as unknown;

    if (value === null || typeof value !== 'object') {
      return {};
    }

    const fields = value as Record<string, unknown>;
    const message =
      typeof fields.message === 'string'
        ? fields.message
        : typeof fields.error === 'string'
          ? fields.error
          : undefined;
    const code = typeof fields.code === 'string' ? fields.code : undefined;

    return {
      ...(message === undefined ? {} : { message }),
      ...(code === undefined ? {} : { code }),
    };
  } catch {
    return {};
  }
}

function normalizeRequestRetry(
  method: string,
  retry:
    | boolean
    | { readonly enabled?: boolean; readonly maxRetries?: number }
    | undefined,
): { readonly enabled: boolean; readonly maxRetries: number } {
  const methodAllowsRetry =
    method.toUpperCase() === 'GET' || method.toUpperCase() === 'HEAD';

  if (retry === undefined) {
    return { enabled: methodAllowsRetry, maxRetries: Number.POSITIVE_INFINITY };
  }

  if (typeof retry === 'boolean') {
    return { enabled: retry, maxRetries: Number.POSITIVE_INFINITY };
  }

  return {
    enabled: retry.enabled ?? methodAllowsRetry,
    maxRetries: retry.maxRetries ?? Number.POSITIVE_INFINITY,
  };
}

function canRetryError(
  error: IntronApiError,
  enabled: boolean,
  attempt: number,
  maxRetries: number,
): boolean {
  return enabled && error.retryable && attempt < maxRetries;
}

function computeBackoffDelay(
  policy: IntronResolvedClientConfig['retryPolicy'],
  attempt: number,
): number {
  const exponentialDelay = Math.min(
    policy.initialDelayMs * policy.backoffMultiplier ** attempt,
    policy.maxDelayMs,
  );
  const jitterSpan = exponentialDelay * policy.jitterRatio;
  const jitterOffset = (policy.random() * 2 - 1) * jitterSpan;

  return Math.max(
    0,
    Math.min(policy.maxDelayMs, Math.round(exponentialDelay + jitterOffset)),
  );
}

function createTimeoutSignal(options: {
  readonly clock: IntronClock;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}): { readonly signal: AbortSignal; readonly dispose: () => void } {
  const controller = new AbortController();
  const parentAbortListener = () => {
    controller.abort(
      options.signal?.reason ??
        new DOMException('Intron request was cancelled.', 'AbortError'),
    );
  };
  const timeout =
    options.timeoutMs === undefined
      ? undefined
      : options.clock.setTimeout(() => {
          controller.abort(
            new DOMException('Intron request timed out.', 'TimeoutError'),
          );
        }, options.timeoutMs);

  if (options.signal?.aborted === true) {
    parentAbortListener();
  } else {
    options.signal?.addEventListener('abort', parentAbortListener, {
      once: true,
    });
  }

  return {
    signal: controller.signal,
    dispose: () => {
      timeout?.clear();
      options.signal?.removeEventListener('abort', parentAbortListener);
    },
  };
}

function waitForDelay(
  clock: IntronClock,
  delayMs: number,
  signal: AbortSignal | undefined,
): Promise<void> {
  if (signal?.aborted === true) {
    return Promise.reject(
      createIntronTransportError(
        signal.reason ??
          new DOMException('Intron request was cancelled.', 'AbortError'),
      ),
    );
  }

  return new Promise<void>((resolve, reject) => {
    const abortListener = () => {
      timeout.clear();
      signal?.removeEventListener('abort', abortListener);
      reject(
        createIntronTransportError(
          signal?.reason ??
            new DOMException('Intron request was cancelled.', 'AbortError'),
        ),
      );
    };
    const timeout = clock.setTimeout(() => {
      signal?.removeEventListener('abort', abortListener);
      resolve();
    }, delayMs);

    signal?.addEventListener('abort', abortListener, { once: true });
  });
}

function createRequestMetadata(response: {
  readonly status: number;
  readonly headers: Headers;
}): SttRequestMetadata {
  const requestId =
    response.headers.get('x-request-id') ??
    response.headers.get('request-id') ??
    undefined;

  return {
    status: response.status,
    ...(requestId === undefined ? {} : { requestId }),
  };
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    throw createIntronTransportError(
      signal.reason ??
        new DOMException('Intron request was cancelled.', 'AbortError'),
      'stt.waitForTranscription',
    );
  }
}

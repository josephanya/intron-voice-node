/**
 * Metadata for SDK errors returned by the Intron Voice API or transport layer.
 */
export interface IntronApiErrorOptions {
  /** Human-readable error message. */
  readonly message: string;
  /** HTTP status code when the error originated from an HTTP response. */
  readonly status?: number;
  /** Service-defined error code when available. */
  readonly code?: string;
  /** Service request identifier when available. */
  readonly requestId?: string;
  /** Retry delay in seconds when provided by the service. */
  readonly retryAfter?: number;
  /** Whether retrying the operation may be safe. */
  readonly retryable?: boolean;
  /** SDK operation name associated with the error. */
  readonly operation?: string;
  /** Original error that caused this SDK error. */
  readonly cause?: unknown;
}

/**
 * Base error for failures reported by the Intron Voice SDK.
 */
export class IntronApiError extends Error {
  /** HTTP status code when the error originated from an HTTP response. */
  public readonly status: number | undefined;
  /** Service-defined error code when available. */
  public readonly code: string | undefined;
  /** Service request identifier when available. */
  public readonly requestId: string | undefined;
  /** Retry delay in seconds when provided by the service. */
  public readonly retryAfter: number | undefined;
  /** Whether retrying the operation may be safe. */
  public readonly retryable: boolean;
  /** SDK operation name associated with the error. */
  public readonly operation: string | undefined;

  /**
   * Creates an SDK API error.
   *
   * @param options - Error metadata.
   */
  public constructor(options: IntronApiErrorOptions) {
    super(redactSensitiveText(options.message), { cause: options.cause });
    this.name = new.target.name;
    this.status = options.status;
    this.code =
      options.code === undefined
        ? undefined
        : redactSensitiveText(options.code);
    this.requestId =
      options.requestId === undefined
        ? undefined
        : redactSensitiveText(options.requestId);
    this.retryAfter = options.retryAfter;
    this.retryable = options.retryable ?? false;
    this.operation = options.operation;
  }

  /**
   * Returns a secret-free JSON representation of the error.
   */
  public toJSON(): {
    readonly name: string;
    readonly message: string;
    readonly status: number | undefined;
    readonly code: string | undefined;
    readonly requestId: string | undefined;
    readonly retryAfter: number | undefined;
    readonly retryable: boolean;
    readonly operation: string | undefined;
  } {
    return {
      name: this.name,
      message: this.message,
      status: this.status,
      code: this.code,
      requestId: this.requestId,
      retryAfter: this.retryAfter,
      retryable: this.retryable,
      operation: this.operation,
    };
  }
}

/**
 * Error raised when authentication fails or credentials are missing.
 */
export class IntronAuthenticationError extends IntronApiError {}

/**
 * Error raised when the service returns a rate limit response.
 */
export class IntronRateLimitError extends IntronApiError {}

/**
 * Error raised when a service response violates the expected protocol.
 */
export class IntronProtocolError extends IntronApiError {}

/**
 * Error raised when an SDK transport cannot complete a request.
 */
export class IntronTransportError extends IntronApiError {}

/**
 * Error raised when an SDK operation is cancelled through an AbortSignal.
 */
export class IntronRequestCancelledError extends IntronApiError {}

/**
 * Error raised when an SDK request times out.
 */
export class IntronTimeoutError extends IntronTransportError {}

/**
 * Maps an HTTP response and safe parsed metadata to a typed SDK error.
 *
 * @param options - HTTP error metadata.
 */
export function createIntronHttpError(options: {
  readonly status: number;
  readonly message?: string;
  readonly code?: string;
  readonly headers?: Headers;
  readonly operation?: string;
  readonly cause?: unknown;
}): IntronApiError {
  const retryAfter = parseRetryAfter(
    options.headers?.get('retry-after') ?? null,
  );
  const requestId =
    options.headers?.get('x-request-id') ??
    options.headers?.get('request-id') ??
    undefined;
  const message =
    options.message ??
    `Intron API request failed with status ${String(options.status)}.`;
  const errorOptions: IntronApiErrorOptions = {
    message,
    status: options.status,
    retryable: isRetryableStatus(options.status),
    ...(options.code === undefined ? {} : { code: options.code }),
    ...(retryAfter === undefined ? {} : { retryAfter }),
    ...(requestId === undefined ? {} : { requestId }),
    ...(options.operation === undefined
      ? {}
      : { operation: options.operation }),
    ...(options.cause === undefined ? {} : { cause: options.cause }),
  };

  if (options.message === 'Malformed JSON response.') {
    return new IntronProtocolError(errorOptions);
  }

  if (options.status === 401 || options.status === 403) {
    return new IntronAuthenticationError(errorOptions);
  }

  if (options.status === 408) {
    return new IntronTimeoutError(errorOptions);
  }

  if (options.status === 429) {
    return new IntronRateLimitError({ ...errorOptions, retryable: true });
  }

  if (options.status >= 400 && options.status < 500) {
    return new IntronProtocolError(errorOptions);
  }

  if (options.status >= 500) {
    return new IntronTransportError({ ...errorOptions, retryable: true });
  }

  return new IntronApiError(errorOptions);
}

/**
 * Parses a Retry-After header value into seconds.
 *
 * @param value - Retry-After header value.
 */
export function parseRetryAfter(value: string | null): number | undefined {
  if (value === null || value.trim().length === 0) {
    return undefined;
  }

  const seconds = Number(value);

  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds;
  }

  const retryDate = Date.parse(value);

  if (Number.isNaN(retryDate)) {
    return undefined;
  }

  return Math.max(0, Math.ceil((retryDate - Date.now()) / 1000));
}

/**
 * Maps unknown thrown values to typed SDK errors.
 *
 * @param cause - Unknown thrown value.
 * @param operation - Optional SDK operation name.
 */
export function createIntronTransportError(
  cause: unknown,
  operation?: string,
): IntronApiError {
  if (isAbortError(cause)) {
    return new IntronRequestCancelledError({
      message: 'Intron request was cancelled.',
      cause,
      ...(operation === undefined ? {} : { operation }),
    });
  }

  if (isTimeoutError(cause)) {
    return new IntronTimeoutError({
      message: 'Intron request timed out.',
      retryable: true,
      cause,
      ...(operation === undefined ? {} : { operation }),
    });
  }

  return new IntronTransportError({
    message: 'Intron transport request failed.',
    retryable: true,
    cause,
    ...(operation === undefined ? {} : { operation }),
  });
}

function redactSensitiveText(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/giu, 'Bearer [REDACTED]')
    .replace(
      /(api[-_ ]?key|token|secret|password)(\s*[=:]\s*)\S+/giu,
      '$1$2[REDACTED]',
    );
}

function isRetryableStatus(status: number): boolean {
  return (
    status === 408 ||
    status === 429 ||
    status === 502 ||
    status === 503 ||
    status === 504
  );
}

function isAbortError(cause: unknown): boolean {
  return cause instanceof DOMException && cause.name === 'AbortError';
}

function isTimeoutError(cause: unknown): boolean {
  return cause instanceof DOMException && cause.name === 'TimeoutError';
}

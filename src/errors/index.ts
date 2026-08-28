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

  /**
   * Creates an SDK API error.
   *
   * @param options - Error metadata.
   */
  public constructor(options: IntronApiErrorOptions) {
    super(options.message, { cause: options.cause });
    this.name = new.target.name;
    this.status = options.status;
    this.code = options.code;
    this.requestId = options.requestId;
    this.retryAfter = options.retryAfter;
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

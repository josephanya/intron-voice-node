import type { IntronLogger } from '../logging/types.js';
import type {
  IntronClock,
  IntronHttpRequestRetryOptions,
  IntronHttpRetryPolicy,
  IntronHttpTransport,
  IntronWebSocketTransport,
} from '../transport/index.js';

/**
 * Supplies bearer tokens for Intron Voice API requests.
 */
export interface IntronTokenProvider {
  /**
   * Resolves an access token for an SDK operation.
   *
   * @param signal - Optional cancellation signal for token acquisition.
   */
  resolveToken(signal?: AbortSignal): Promise<string>;
}

/**
 * Configuration for constructing an {@link IntronClient}.
 */
export interface IntronClientConfig {
  /** API key used to authenticate service requests. */
  readonly apiKey?: string;
  /** Token provider used when credentials are resolved dynamically. */
  readonly tokenProvider?: IntronTokenProvider;
  /** Base URL for REST API calls. */
  readonly apiBaseUrl?: URL | string;
  /** Base URL for WebSocket API calls. */
  readonly websocketBaseUrl?: URL | string;
  /** Connection timeout in milliseconds. */
  readonly connectTimeout?: number;
  /** Request timeout in milliseconds. */
  readonly requestTimeout?: number;
  /** Receive timeout in milliseconds. */
  readonly receiveTimeout?: number;
  /** Retry policy used by REST requests. */
  readonly retryPolicy?: Partial<IntronHttpRetryPolicy>;
  /** Injectable HTTP transport. */
  readonly httpTransport?: IntronHttpTransport;
  /** Injectable WebSocket transport. */
  readonly websocketTransport?: IntronWebSocketTransport;
  /** Injectable clock and timer scheduler. */
  readonly clock?: IntronClock;
  /** Optional logger used by the SDK. */
  readonly logger?: IntronLogger;
}

/**
 * Secret-free client configuration normalized by the SDK.
 */
export interface IntronResolvedClientConfig {
  /** Base URL for REST API calls. */
  readonly apiBaseUrl: URL;
  /** Base URL for WebSocket API calls. */
  readonly websocketBaseUrl: URL;
  /** Connection timeout in milliseconds when configured. */
  readonly connectTimeout?: number;
  /** Request timeout in milliseconds when configured. */
  readonly requestTimeout?: number;
  /** Receive timeout in milliseconds when configured. */
  readonly receiveTimeout?: number;
  /** Retry policy used by REST requests. */
  readonly retryPolicy: IntronHttpRetryPolicy;
}

/**
 * Options used when resolving authentication metadata.
 */
export interface IntronAuthOptions {
  /** Optional cancellation signal. */
  readonly signal?: AbortSignal;
}

/**
 * Common options for REST requests made by the SDK.
 */
export interface IntronRequestOptions {
  /** HTTP method for the request. */
  readonly method?: string;
  /** Endpoint path resolved against the configured REST base URL. */
  readonly path: string;
  /** Optional query parameters appended to the request URL. */
  readonly query?: Readonly<Record<string, string | number | boolean>>;
  /** Additional request headers. */
  readonly headers?: Readonly<Record<string, string>>;
  /** Optional cancellation signal. */
  readonly signal?: AbortSignal;
  /** Retry behavior for this operation. */
  readonly retry?: boolean | IntronHttpRequestRetryOptions;
  /** SDK operation name used in errors. */
  readonly operation?: string;
}

/**
 * Options for JSON REST requests.
 */
export interface IntronJsonRequestOptions extends IntronRequestOptions {
  /** JSON-serializable request body. */
  readonly json?: unknown;
}

/**
 * Options for multipart REST requests.
 */
export interface IntronMultipartRequestOptions extends IntronRequestOptions {
  /** Multipart form body. Boundary handling is left to the HTTP implementation. */
  readonly formData: FormData;
}

import type { IntronLogger } from '../logging/types.js';
import type {
  IntronClock,
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
}

/**
 * Options used when resolving authentication metadata.
 */
export interface IntronAuthOptions {
  /** Optional cancellation signal. */
  readonly signal?: AbortSignal;
}

import { inspect } from 'node:util';

import { IntronAuthenticationError } from '../errors/index.js';
import type {
  IntronAuthOptions,
  IntronClientConfig,
  IntronResolvedClientConfig,
  IntronTokenProvider,
} from './types.js';

const DEFAULT_API_BASE_URL = 'https://infer.voice.intron.io';
const DEFAULT_WEBSOCKET_BASE_URL = 'wss://infer.voice.intron.io';

interface IntronClientSecrets {
  readonly apiKey?: string;
  readonly tokenProvider?: IntronTokenProvider;
}

/**
 * Root SDK client for Intron Voice API workflows.
 *
 * Phase 0 establishes construction and public contracts only; protocol-specific
 * methods are introduced in later phases.
 */
export class IntronClient {
  private readonly config: IntronResolvedClientConfig;
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
    });
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

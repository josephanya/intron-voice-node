import type { IntronClientConfig } from './types.js';

/**
 * Root SDK client for Intron Voice API workflows.
 *
 * Phase 0 establishes construction and public contracts only; protocol-specific
 * methods are introduced in later phases.
 */
export class IntronClient {
  private readonly config: Readonly<IntronClientConfig>;

  /**
   * Creates a client instance without contacting the Intron service.
   *
   * @param config - Client configuration and injectable dependencies.
   */
  public constructor(config: IntronClientConfig = {}) {
    this.config = Object.freeze({ ...config });
  }

  /**
   * Returns the immutable configuration supplied to the client.
   */
  public getConfig(): Readonly<IntronClientConfig> {
    return this.config;
  }
}

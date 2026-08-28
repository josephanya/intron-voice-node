/**
 * Structured log fields accepted by the SDK logger.
 */
export type IntronLogFields = Readonly<Record<string, unknown>>;

/**
 * Optional logger contract for SDK diagnostics.
 */
export interface IntronLogger {
  /** Records detailed diagnostic information. */
  debug(message: string, fields?: IntronLogFields): void;
  /** Records informational diagnostic information. */
  info(message: string, fields?: IntronLogFields): void;
  /** Records warning diagnostic information. */
  warn(message: string, fields?: IntronLogFields): void;
  /** Records error diagnostic information. */
  error(message: string, fields?: IntronLogFields): void;
}

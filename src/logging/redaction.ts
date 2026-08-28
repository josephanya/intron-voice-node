import type { IntronLogFields } from './types.js';

const REDACTED = '[REDACTED]';
const SENSITIVE_FIELD_PATTERN =
  /authorization|api[-_]?key|token|secret|password|audio|transcript|patient|identifier/i;

/**
 * Returns a shallow copy of log fields with sensitive values redacted.
 *
 * @param fields - Structured log fields supplied to a logger.
 */
export function redactLogFields(fields: IntronLogFields): IntronLogFields {
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [
      key,
      SENSITIVE_FIELD_PATTERN.test(key) ? REDACTED : value,
    ]),
  );
}

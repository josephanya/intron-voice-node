import { describe, expect, it, vi } from 'vitest';

import {
  IntronAuthenticationError,
  IntronProtocolError,
  IntronRateLimitError,
  IntronRequestCancelledError,
  IntronTimeoutError,
  IntronTransportError,
  createIntronHttpError,
  createIntronTransportError,
  parseRetryAfter,
} from '../src/index.js';

describe('typed errors', () => {
  it('parses retry-after seconds and HTTP dates', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-28T00:00:00.000Z'));

    expect(parseRetryAfter('12')).toBe(12);
    expect(parseRetryAfter('Fri, 28 Aug 2026 00:00:05 GMT')).toBe(5);
    expect(parseRetryAfter('not-a-date')).toBeUndefined();

    vi.useRealTimers();
  });

  it('maps HTTP statuses to error subclasses and retry metadata', () => {
    const requestHeaders = new Headers({
      'retry-after': '3',
      'x-request-id': 'request-1',
    });

    expect(createIntronHttpError({ status: 400 })).toBeInstanceOf(
      IntronProtocolError,
    );
    expect(createIntronHttpError({ status: 401 })).toBeInstanceOf(
      IntronAuthenticationError,
    );
    expect(createIntronHttpError({ status: 403 })).toBeInstanceOf(
      IntronAuthenticationError,
    );
    expect(createIntronHttpError({ status: 408 })).toBeInstanceOf(
      IntronTimeoutError,
    );

    const rateLimitError = createIntronHttpError({
      status: 429,
      headers: requestHeaders,
      operation: 'test.operation',
    });
    expect(rateLimitError).toBeInstanceOf(IntronRateLimitError);
    expect(rateLimitError.retryAfter).toBe(3);
    expect(rateLimitError.requestId).toBe('request-1');
    expect(rateLimitError.retryable).toBe(true);
    expect(rateLimitError.operation).toBe('test.operation');

    expect(createIntronHttpError({ status: 503 }).retryable).toBe(true);
  });

  it('redacts credentials from error message and serialized output', () => {
    const error = createIntronHttpError({
      status: 401,
      message:
        'Authorization failed for Bearer api-key-value and token=secret-value',
      code: 'token=secret-value',
    });
    const rendered = [String(error), JSON.stringify(error)].join('\n');

    expect(rendered).not.toContain('api-key-value');
    expect(rendered).not.toContain('secret-value');
    expect(rendered).toContain('[REDACTED]');
  });

  it('maps malformed JSON, socket failures, and aborts to typed errors', () => {
    const malformedJsonError = createIntronHttpError({
      status: 200,
      message: 'Malformed JSON response.',
    });
    const socketError = createIntronTransportError(new Error('ECONNRESET'));
    const abortError = createIntronTransportError(
      new DOMException('The operation was aborted.', 'AbortError'),
    );

    expect(malformedJsonError).toBeInstanceOf(IntronProtocolError);
    expect(socketError).toBeInstanceOf(IntronTransportError);
    expect(abortError).toBeInstanceOf(IntronRequestCancelledError);
  });
});

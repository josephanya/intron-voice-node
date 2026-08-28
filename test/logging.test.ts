import { describe, expect, it } from 'vitest';

import { redactLogFields } from '../src/index.js';

describe('logger redaction', () => {
  it('redacts credentials and sensitive speech fields', () => {
    expect(
      redactLogFields({
        authorization: 'authorization-header-value',
        apiKey: 'api-key-value',
        transcript: 'full transcript text',
        patientIdentifier: 'person-123',
        audioBytes: new Uint8Array([1, 2, 3]),
        requestId: 'request-1',
      }),
    ).toEqual({
      authorization: '[REDACTED]',
      apiKey: '[REDACTED]',
      transcript: '[REDACTED]',
      patientIdentifier: '[REDACTED]',
      audioBytes: '[REDACTED]',
      requestId: 'request-1',
    });
  });
});

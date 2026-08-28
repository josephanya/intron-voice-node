import { describe, expect, it } from 'vitest';

import { IntronClient } from '../src/index.js';
import { FakeHttpTransport } from './fakes/fake-http-transport.js';

describe('IntronClient', () => {
  it('can be constructed without contacting the service', () => {
    const httpTransport = new FakeHttpTransport();
    const client = new IntronClient({ httpTransport });

    expect(client.getConfig().httpTransport).toBe(httpTransport);
    expect(httpTransport.requests).toHaveLength(0);
  });
});

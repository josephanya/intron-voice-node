import { describe, expect, it } from 'vitest';

import { inspect } from 'node:util';

import { IntronAuthenticationError, IntronClient } from '../src/index.js';
import { FakeHttpTransport } from './fakes/fake-http-transport.js';

describe('IntronClient', () => {
  it('requires credentials without contacting the service', () => {
    expect(() => new IntronClient()).toThrow(IntronAuthenticationError);
  });

  it('can be constructed with credentials without contacting the service', () => {
    const httpTransport = new FakeHttpTransport();
    const client = new IntronClient({ apiKey: 'api-key-value', httpTransport });

    expect(client.getConfig().apiBaseUrl.toString()).toBe(
      'https://infer.voice.intron.io/',
    );
    expect(httpTransport.requests).toHaveLength(0);
  });

  it('normalizes configured base URLs without mutating caller config', () => {
    const config = {
      apiKey: ' api-key-value ',
      apiBaseUrl: new URL('https://example.test/api///?ignored=true'),
      websocketBaseUrl: 'wss://example.test/socket///#ignored',
    };

    const client = new IntronClient(config);

    expect(client.getConfig().apiBaseUrl.toString()).toBe(
      'https://example.test/api',
    );
    expect(client.getConfig().websocketBaseUrl.toString()).toBe(
      'wss://example.test/socket',
    );
    expect(config.apiKey).toBe(' api-key-value ');
    expect(config.apiBaseUrl.toString()).toBe(
      'https://example.test/api///?ignored=true',
    );
  });

  it('rejects empty and ambiguous credentials', () => {
    expect(() => new IntronClient({ apiKey: '   ' })).toThrow(
      IntronAuthenticationError,
    );
    expect(
      () =>
        new IntronClient({
          apiKey: 'api-key-value',
          tokenProvider: { resolveToken: () => Promise.resolve('token-value') },
        }),
    ).toThrow(IntronAuthenticationError);
  });

  it('resolves exact bearer authentication from a trimmed static key', async () => {
    const client = new IntronClient({ apiKey: ' api-key-value ' });

    await expect(client.resolveAuthorizationHeader()).resolves.toBe(
      'Bearer api-key-value',
    );
  });

  it('resolves a fresh provider token with the provided signal', async () => {
    const controller = new AbortController();
    const signals: AbortSignal[] = [];
    const client = new IntronClient({
      tokenProvider: {
        resolveToken: (signal) => {
          if (signal !== undefined) {
            signals.push(signal);
          }

          return Promise.resolve(` token-${String(signals.length)} `);
        },
      },
    });

    await expect(
      client.resolveAuthorizationHeader({ signal: controller.signal }),
    ).resolves.toBe('Bearer token-1');
    await expect(
      client.resolveAuthorizationHeader({ signal: controller.signal }),
    ).resolves.toBe('Bearer token-2');
    expect(signals).toEqual([controller.signal, controller.signal]);
  });

  it('does not expose credentials through string, JSON, or inspection output', () => {
    const client = new IntronClient({ apiKey: 'api-key-value' });
    const outputs = [String(client), JSON.stringify(client), inspect(client)];

    expect(outputs.join('\n')).not.toContain('api-key-value');
  });
});

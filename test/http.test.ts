import { describe, expect, it } from 'vitest';

import {
  IntronClient,
  IntronProtocolError,
  IntronRequestCancelledError,
  IntronTransportError,
  type IntronClock,
  type IntronTimerHandle,
} from '../src/index.js';
import { FakeHttpTransport } from './fakes/fake-http-transport.js';

class ImmediateClock implements IntronClock {
  public readonly delays: number[] = [];

  public now(): number {
    return 0;
  }

  public setTimeout(callback: () => void, delayMs: number): IntronTimerHandle {
    let cleared = false;
    this.delays.push(delayMs);
    queueMicrotask(() => {
      if (!cleared) {
        callback();
      }
    });

    return {
      clear: () => {
        cleared = true;
      },
    };
  }
}

class ManualClock implements IntronClock {
  public readonly delays: number[] = [];
  private callback: (() => void) | undefined;

  public now(): number {
    return 0;
  }

  public setTimeout(callback: () => void, delayMs: number): IntronTimerHandle {
    let cleared = false;
    this.delays.push(delayMs);
    this.callback = () => {
      if (!cleared) {
        callback();
      }
    };

    return {
      clear: () => {
        cleared = true;
      },
    };
  }

  public runNext(): void {
    this.callback?.();
  }
}

describe('HTTP transport layer', () => {
  it('builds authenticated JSON requests with deterministic UTF-8 bodies', async () => {
    const httpTransport = new FakeHttpTransport();
    httpTransport.enqueueResponse(jsonResponse({ ok: true }));
    const client = new IntronClient({
      apiKey: ' server-key ',
      apiBaseUrl: 'https://example.test/api',
      httpTransport,
    });

    await expect(
      client.requestJson<{ readonly ok: boolean }>({
        method: 'POST',
        path: '/jobs',
        query: { page: 1, active: true },
        headers: { 'x-client': 'test' },
        json: { text: 'hello' },
      }),
    ).resolves.toEqual({ ok: true });

    expect(httpTransport.requests).toHaveLength(1);
    const request = httpTransport.requests[0];
    expect(request?.method).toBe('POST');
    expect(request?.url.toString()).toBe(
      'https://example.test/api/jobs?page=1&active=true',
    );
    expect(request?.headers).toMatchObject({
      accept: 'application/json',
      authorization: 'Bearer server-key',
      'content-type': 'application/json; charset=utf-8',
      'x-client': 'test',
    });
    expect(new TextDecoder().decode(request?.body as Uint8Array)).toBe(
      '{"text":"hello"}',
    );
  });

  it('sends multipart bodies without overriding form-data boundaries', async () => {
    const httpTransport = new FakeHttpTransport();
    const formData = new FormData();
    formData.set('audio_file_name', 'sample.wav');
    formData.set('audio_file_blob', new Blob([new Uint8Array([1, 2, 3])]));
    httpTransport.enqueueResponse(jsonResponse({ id: 'file-1' }));
    const client = new IntronClient({ apiKey: 'server-key', httpTransport });

    await expect(
      client.requestMultipart<{ readonly id: string }>({
        method: 'POST',
        path: '/file/v1/upload',
        formData,
      }),
    ).resolves.toEqual({ id: 'file-1' });

    expect(httpTransport.requests[0]?.body).toBe(formData);
    expect(httpTransport.requests[0]?.headers['content-type']).toBeUndefined();
    expect(httpTransport.requests[0]?.headers.accept).toBe('application/json');
  });

  it('honors retry-after and resolves authorization for each attempt', async () => {
    const httpTransport = new FakeHttpTransport();
    const clock = new ImmediateClock();
    let tokenCount = 0;
    httpTransport.enqueueResponse({
      status: 429,
      headers: new Headers({ 'retry-after': '2' }),
    });
    httpTransport.enqueueResponse(jsonResponse({ ok: true }));
    const client = new IntronClient({
      tokenProvider: {
        resolveToken: () => {
          tokenCount += 1;

          return Promise.resolve(`credential-${String(tokenCount)}`);
        },
      },
      httpTransport,
      clock,
      retryPolicy: { maxRetries: 2, random: () => 0.5 },
    });

    await expect(
      client.requestJson<{ readonly ok: boolean }>({ path: '/status/file-1' }),
    ).resolves.toEqual({ ok: true });

    expect(clock.delays).toEqual([2000]);
    expect(
      httpTransport.requests.map((request) => request.headers.authorization),
    ).toEqual(['Bearer credential-1', 'Bearer credential-2']);
  });

  it('bounds retries and uses deterministic exponential backoff', async () => {
    const httpTransport = new FakeHttpTransport();
    const clock = new ImmediateClock();
    httpTransport.enqueueError(new Error('temporary connection failure'));
    httpTransport.enqueueError(new Error('temporary connection failure'));
    const client = new IntronClient({
      apiKey: 'server-key',
      httpTransport,
      clock,
      retryPolicy: {
        maxRetries: 1,
        initialDelayMs: 100,
        maxDelayMs: 500,
        backoffMultiplier: 2,
        jitterRatio: 0,
        random: () => 0.5,
      },
    });

    await expect(
      client.requestJson({ path: '/temporary' }),
    ).rejects.toBeInstanceOf(IntronTransportError);

    expect(httpTransport.requests).toHaveLength(2);
    expect(clock.delays).toEqual([100]);
  });

  it('does not retry protocol failures or non-opted-in non-idempotent requests', async () => {
    const validationFailureTransport = new FakeHttpTransport();
    validationFailureTransport.enqueueResponse({ status: 400 });
    const validationClient = new IntronClient({
      apiKey: 'server-key',
      httpTransport: validationFailureTransport,
      retryPolicy: { maxRetries: 2 },
    });

    await expect(
      validationClient.requestJson({ path: '/bad-request' }),
    ).rejects.toBeInstanceOf(IntronProtocolError);
    expect(validationFailureTransport.requests).toHaveLength(1);

    const serverFailureTransport = new FakeHttpTransport();
    serverFailureTransport.enqueueResponse({ status: 503 });
    const serverClient = new IntronClient({
      apiKey: 'server-key',
      httpTransport: serverFailureTransport,
      retryPolicy: { maxRetries: 2 },
    });

    await expect(
      serverClient.requestJson({
        method: 'POST',
        path: '/non-idempotent',
        json: {},
      }),
    ).rejects.toBeInstanceOf(IntronTransportError);
    expect(serverFailureTransport.requests).toHaveLength(1);
  });

  it('stops retry waits when cancelled', async () => {
    const httpTransport = new FakeHttpTransport();
    const clock = new ManualClock();
    const controller = new AbortController();
    httpTransport.enqueueResponse({ status: 503 });
    const client = new IntronClient({
      apiKey: 'server-key',
      httpTransport,
      clock,
      retryPolicy: { maxRetries: 2, jitterRatio: 0 },
    });
    const request = client.requestJson({
      path: '/status/file-1',
      signal: controller.signal,
    });

    await Promise.resolve();
    controller.abort();

    await expect(request).rejects.toBeInstanceOf(IntronRequestCancelledError);
    expect(httpTransport.requests).toHaveLength(1);
    clock.runNext();
    expect(httpTransport.requests).toHaveLength(1);
  });

  it('disposes the configured HTTP transport', async () => {
    const httpTransport = new FakeHttpTransport();
    const client = new IntronClient({ apiKey: 'server-key', httpTransport });

    await client.close();

    expect(httpTransport.isClosed()).toBe(true);
  });
});

function jsonResponse(value: unknown): {
  readonly status: number;
  readonly headers: Headers;
  readonly body: Uint8Array;
} {
  return {
    status: 200,
    headers: new Headers({ 'content-type': 'application/json' }),
    body: new TextEncoder().encode(JSON.stringify(value)),
  };
}

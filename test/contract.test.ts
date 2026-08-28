import { createRequire } from 'node:module';

import { describe, expect, it } from 'vitest';

import {
  IntronClient,
  IntronRateLimitError,
  IntronRequestCancelledError,
  SttSessionState,
  type IntronClock,
  type IntronTimerHandle,
} from '../src/index.js';
import { FakeHttpTransport } from './fakes/fake-http-transport.js';
import { FakeWebSocketTransport } from './fakes/fake-websocket-transport.js';

const AUDIO_CHUNK = new Uint8Array(1024).fill(7);
const RUNTIME_EXPORTS = [
  'INTRON_STT_LANGUAGES',
  'INTRON_STT_SUPPORTED_LANGUAGES_URL',
  'INTRON_TTS_LANGUAGES',
  'INTRON_TTS_SUPPORTED_LANGUAGES_URL',
  'IntronApiError',
  'IntronAuthenticationError',
  'IntronClient',
  'IntronFetchHttpTransport',
  'IntronProtocolError',
  'IntronRateLimitError',
  'IntronRequestCancelledError',
  'IntronSystemClock',
  'IntronTimeoutError',
  'IntronTransportError',
  'SttSessionState',
  'SttSyncTranscriptionUnavailableError',
  'TtsSessionState',
  'createIntronHttpError',
  'createIntronTransportError',
  'createSttStreamingSession',
  'createSttStreamingUrl',
  'createSttUploadFormData',
  'createTtsStreamingSession',
  'createTtsStreamingUrl',
  'createTtsSynthesisJson',
  'isKnownIntronSttLanguageCode',
  'isKnownIntronTtsLanguageCode',
  'isTerminalSttStatus',
  'isTerminalTtsStatus',
  'parseRetryAfter',
  'parseSttJob',
  'parseSttJobStatus',
  'parseTtsJob',
  'parseTtsJobStatus',
  'redactLogFields',
  'toSttResult',
  'toTtsResult',
  'validateAudioFilename',
  'validateSttStreamingOptions',
  'validateSyncUploadOptions',
  'validateTtsGenerateOptions',
  'validateTtsQueueOptions',
  'validateTtsStreamingOptions',
  'withTtsAudio',
] as const;

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

describe('Intron Voice API wire contracts', () => {
  it('sends documented STT streaming payload field names and sequential ack IDs', async () => {
    const websocketTransport = new FakeWebSocketTransport();
    const client = new IntronClient({
      apiKey: 'server-key',
      websocketTransport,
    });

    await client.startStreamingTranscription({
      audio: asyncIterable([AUDIO_CHUNK, new Uint8Array(2048).fill(9)]),
    });
    await settle();

    websocketTransport.connection.emit(
      'message',
      JSON.stringify({ message_type: 'SESSION_CREATED', session_id: 'stt-1' }),
    );
    await settle();

    expect(websocketTransport.connection.sent.map(parseSentJson)).toEqual([
      {
        message_type: 'INPUT_AUDIO_CHUNK',
        audio_base_64: Buffer.from(AUDIO_CHUNK).toString('base64'),
        ack_id: 1,
      },
      {
        message_type: 'INPUT_AUDIO_CHUNK',
        audio_base_64: Buffer.from(new Uint8Array(2048).fill(9)).toString(
          'base64',
        ),
        ack_id: 2,
      },
      { message_type: 'COMMIT' },
    ]);
  });

  it('sends documented TTS streaming payload field names and commit messages', async () => {
    const websocketTransport = new FakeWebSocketTransport();
    const client = new IntronClient({
      apiKey: 'server-key',
      websocketTransport,
    });
    const session = await client.startStreamingSpeech({
      voiceLanguage: 'en',
      voiceAccent: 'nigerian',
      voiceGender: 'female',
    });

    websocketTransport.connection.emit(
      'message',
      JSON.stringify({ message_type: 'SESSION_CREATED', session_id: 'tts-1' }),
    );
    await session.sendText('Hello there');
    await session.fetchAudioChunk();
    await session.commit();

    expect(websocketTransport.connection.sent.map(parseSentJson)).toEqual([
      { message_type: 'INPUT_TEXT_CHUNK', text: 'Hello there', ack_id: 1 },
      { message_type: 'FETCH_AUDIO_CHUNK', chunk_id: 1 },
      { message_type: 'COMMIT' },
    ]);
  });

  it('uses documented file upload form fields and Bearer authorization', async () => {
    const httpTransport = new FakeHttpTransport();
    httpTransport.enqueueResponse(
      jsonResponse({ file_id: 'file-1', processing_status: 'FILE_QUEUED' }),
    );
    const client = new IntronClient({ apiKey: 'server-key', httpTransport });

    await client.uploadAudioFile({
      source: {
        kind: 'buffer',
        filename: 'consult.wav',
        data: new Uint8Array([1, 2, 3]),
      },
    });

    const request = httpTransport.requests[0];
    const body = request?.body as FormData;
    expect(request?.headers.authorization).toBe('Bearer server-key');
    expect(body.get('audio_file_name')).toBe('consult.wav');
    expect(body.get('audio_file_blob')).toBeInstanceOf(File);
  });

  it('preserves rate-limit metadata and respects retry-after delays', async () => {
    const rateLimitTransport = new FakeHttpTransport();
    rateLimitTransport.enqueueResponse({
      status: 429,
      headers: new Headers({
        'retry-after': '3',
        'x-request-id': 'request-rate-limit',
      }),
    });
    const rateLimitedClient = new IntronClient({
      apiKey: 'server-key',
      httpTransport: rateLimitTransport,
      retryPolicy: { maxRetries: 0 },
    });

    const rateLimitRequest = rateLimitedClient.requestJson({
      path: '/file/v1/status/file-1',
    });
    await expect(rateLimitRequest).rejects.toBeInstanceOf(IntronRateLimitError);
    await expect(rateLimitRequest).rejects.toMatchObject({
      retryAfter: 3,
      requestId: 'request-rate-limit',
      retryable: true,
    });

    const retryTransport = new FakeHttpTransport();
    const clock = new ImmediateClock();
    retryTransport.enqueueResponse({
      status: 429,
      headers: new Headers({ 'retry-after': '2' }),
    });
    retryTransport.enqueueResponse(jsonResponse({ ok: true }));
    const retryingClient = new IntronClient({
      apiKey: 'server-key',
      httpTransport: retryTransport,
      clock,
      retryPolicy: { maxRetries: 1 },
    });

    await expect(
      retryingClient.requestJson<{ readonly ok: boolean }>({
        path: '/file/v1/status/file-1',
      }),
    ).resolves.toEqual({ ok: true });
    expect(clock.delays).toEqual([2000]);
  });

  it('uses abort signals to terminate REST requests and streaming sessions', async () => {
    const httpTransport = new FakeHttpTransport();
    const requestController = new AbortController();
    const requestClient = new IntronClient({
      apiKey: 'server-key',
      httpTransport,
    });
    requestController.abort();

    await expect(
      requestClient.requestJson({
        path: '/file/v1/status/file-1',
        signal: requestController.signal,
      }),
    ).rejects.toBeInstanceOf(IntronRequestCancelledError);

    const websocketTransport = new FakeWebSocketTransport();
    const sessionController = new AbortController();
    const sessionClient = new IntronClient({
      apiKey: 'server-key',
      websocketTransport,
    });
    const session = await sessionClient.startStreamingTranscription({
      audio: asyncIterable([AUDIO_CHUNK]),
      signal: sessionController.signal,
    });

    sessionController.abort();
    await settle();

    expect(session.state).toBe(SttSessionState.Cancelled);
    expect(websocketTransport.connection.state).toBe('closed');
  });

  it('exposes the same runtime public API from ESM and CommonJS entry points', async () => {
    const packageName = 'intron-voice-node';
    const esmSdk = (await import(packageName)) as Record<string, unknown>;
    const require = createRequire(import.meta.url);
    const cjsSdk = require(packageName) as Record<string, unknown>;

    expect(Object.keys(esmSdk).sort()).toEqual([...RUNTIME_EXPORTS].sort());
    expect(Object.keys(cjsSdk).sort()).toEqual([...RUNTIME_EXPORTS].sort());

    for (const exportName of RUNTIME_EXPORTS) {
      expect(typeof cjsSdk[exportName]).toBe(typeof esmSdk[exportName]);
    }
  });
});

async function* asyncIterable(
  chunks: readonly Uint8Array[],
): AsyncIterable<Uint8Array> {
  for (const chunk of chunks) {
    await Promise.resolve();
    yield chunk;
  }
}

function parseSentJson(data: string | Uint8Array): unknown {
  const text = typeof data === 'string' ? data : new TextDecoder().decode(data);

  return JSON.parse(text) as unknown;
}

function jsonResponse(
  value: unknown,
  status = 200,
): {
  readonly status: number;
  readonly headers: Headers;
  readonly body: Uint8Array;
} {
  return {
    status,
    headers: new Headers({ 'content-type': 'application/json' }),
    body: new TextEncoder().encode(JSON.stringify(value)),
  };
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

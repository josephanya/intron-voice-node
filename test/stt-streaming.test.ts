import { Readable } from 'node:stream';

import { describe, expect, it } from 'vitest';

import {
  IntronProtocolError,
  IntronClient,
  SttSessionState,
  type SttStreamingEvent,
} from '../src/index.js';
import { FakeWebSocketTransport } from './fakes/fake-websocket-transport.js';

const CHUNK = new Uint8Array(1024).fill(7);

describe('STT websocket streaming transcription', () => {
  it('connects to the documented endpoint with query defaults and auth', async () => {
    const websocketTransport = new FakeWebSocketTransport();
    const client = new IntronClient({
      apiKey: 'server-key',
      websocketTransport,
    });

    await client.startStreamingTranscription({
      audio: asyncIterable([CHUNK]),
    });
    await settle();

    expect(websocketTransport.connects).toHaveLength(1);
    const connect = websocketTransport.connects[0];
    expect(connect?.url.toString()).toBe(
      'wss://infer.voice.intron.io/stt/v1/stream?sample_rate=16000&bit_rate=16&num_channels=1&use_language_asr_input=en',
    );
    expect(connect?.headers?.authorization).toBe('Bearer server-key');
    expect(websocketTransport.connection.sent).toEqual([]);
  });

  it('waits for SESSION_CREATED before sending audio chunks and commit', async () => {
    const websocketTransport = new FakeWebSocketTransport();
    const client = new IntronClient({
      apiKey: 'server-key',
      websocketTransport,
    });

    const session = await client.startStreamingTranscription({
      audio: asyncIterable([CHUNK, new Uint8Array(2048).fill(9)]),
      sampleRate: 8000,
      bitRate: 16,
      channels: 1,
      language: 'yo',
    });
    await settle();
    expect(websocketTransport.connection.sent).toEqual([]);

    websocketTransport.connection.emit(
      'message',
      JSON.stringify({ message_type: 'SESSION_CREATED', session_id: 's-1' }),
    );
    await settle();

    expect(session.state).toBe(SttSessionState.Committing);
    const sent = websocketTransport.connection.sent.map(parseSentJson);
    expect(sent).toEqual([
      {
        message_type: 'INPUT_AUDIO_CHUNK',
        audio_base_64: Buffer.from(CHUNK).toString('base64'),
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
    expect(websocketTransport.connects[0]?.url.toString()).toBe(
      'wss://infer.voice.intron.io/stt/v1/stream?sample_rate=8000&bit_rate=16&num_channels=1&use_language_asr_input=yo',
    );
  });

  it('parses session, ack, partial, and committed transcript events', async () => {
    const websocketTransport = new FakeWebSocketTransport();
    const client = new IntronClient({
      apiKey: 'server-key',
      websocketTransport,
    });
    const session = await client.startStreamingTranscription({
      audio: asyncIterable([]),
    });
    const events = session.events[Symbol.asyncIterator]();
    const transcripts = session.transcriptEvents[Symbol.asyncIterator]();

    websocketTransport.connection.emit(
      'message',
      JSON.stringify({ message_type: 'SESSION_CREATED', session_id: 's-1' }),
    );
    websocketTransport.connection.emit(
      'message',
      JSON.stringify({ message_type: 'AUDIO_CHUCK_ACK', ack_id: 1 }),
    );
    websocketTransport.connection.emit(
      'message',
      JSON.stringify({ message_type: 'PARTIAL_TRANSCRIPT', transcript: 'hel' }),
    );
    websocketTransport.connection.emit(
      'message',
      JSON.stringify({
        message_type: 'COMMITTED_TRANSCRIPT',
        transcript: 'hello',
      }),
    );

    await expect(events.next()).resolves.toMatchObject({
      done: false,
      value: { type: 'session_created', sessionId: 's-1' },
    });
    await expect(events.next()).resolves.toMatchObject({
      done: false,
      value: { type: 'audio_chunk_ack', ackId: 1 },
    });
    await expect(events.next()).resolves.toMatchObject({
      done: false,
      value: { type: 'partial_transcript', transcript: 'hel' },
    });
    await expect(events.next()).resolves.toMatchObject({
      done: false,
      value: { type: 'committed_transcript', transcript: 'hello' },
    });
    await expect(transcripts.next()).resolves.toMatchObject({
      done: false,
      value: { type: 'partial_transcript', transcript: 'hel' },
    });
    await expect(transcripts.next()).resolves.toMatchObject({
      done: false,
      value: { type: 'committed_transcript', transcript: 'hello' },
    });
  });

  it('emits typed protocol events for invalid messages and documented errors', async () => {
    const websocketTransport = new FakeWebSocketTransport();
    const client = new IntronClient({
      apiKey: 'server-key',
      websocketTransport,
    });
    const session = await client.startStreamingTranscription({
      audio: asyncIterable([]),
    });
    const events = session.events[Symbol.asyncIterator]();

    websocketTransport.connection.emit('message', '{');
    websocketTransport.connection.emit(
      'message',
      JSON.stringify({
        message_type: 'CHUNCK_SIZE_TOO_SMALL',
        message: 'chunk too small',
      }),
    );

    await expect(events.next()).resolves.toMatchObject({
      done: false,
      value: { type: 'protocol_error' },
    });
    const serverError = (await events.next()).value as SttStreamingEvent;
    expect(serverError).toMatchObject({
      type: 'server_error',
      messageType: 'CHUNCK_SIZE_TOO_SMALL',
    });
    expect(
      serverError.type === 'server_error' && serverError.error,
    ).toBeInstanceOf(IntronProtocolError);
  });

  it('closes the socket and does not duplicate source or socket subscriptions', async () => {
    const websocketTransport = new FakeWebSocketTransport();
    const source = trackedAsyncIterable([CHUNK]);
    const client = new IntronClient({
      apiKey: 'server-key',
      websocketTransport,
    });

    const session = await client.startStreamingTranscription({ audio: source });
    session.events[Symbol.asyncIterator]();
    session.transcriptEvents[Symbol.asyncIterator]();
    await settle();

    expect(source.subscriptionCount()).toBe(1);
    expect(websocketTransport.connection.handlerCounts.get('message')).toBe(1);
    await session.close();

    expect(websocketTransport.connection.state).toBe('closed');
    expect(websocketTransport.connection.handlerCounts.get('message')).toBe(0);
    expect(parseSentJson(websocketTransport.connection.sent[0])).toEqual({
      message_type: 'COMMIT',
    });
  });

  it('supports Node Readable and Web ReadableStream audio sources', async () => {
    const readableTransport = new FakeWebSocketTransport();
    const readableClient = new IntronClient({
      apiKey: 'server-key',
      websocketTransport: readableTransport,
    });
    await readableClient.startStreamingTranscription({
      audio: Readable.from([CHUNK]),
    });
    readableTransport.connection.emit(
      'message',
      JSON.stringify({ message_type: 'SESSION_CREATED' }),
    );
    await settle();
    expect(parseSentJson(readableTransport.connection.sent[0])).toMatchObject({
      message_type: 'INPUT_AUDIO_CHUNK',
      ack_id: 1,
    });

    const webTransport = new FakeWebSocketTransport();
    const webClient = new IntronClient({
      apiKey: 'server-key',
      websocketTransport: webTransport,
    });
    await webClient.startStreamingTranscription({
      audio: new ReadableStream<Uint8Array>({
        start: (controller) => {
          controller.enqueue(CHUNK);
          controller.close();
        },
      }),
    });
    webTransport.connection.emit(
      'message',
      JSON.stringify({ message_type: 'SESSION_CREATED' }),
    );
    await settle();
    expect(parseSentJson(webTransport.connection.sent[0])).toMatchObject({
      message_type: 'INPUT_AUDIO_CHUNK',
      ack_id: 1,
    });
  });

  it('cancels the session and closes the socket when aborted', async () => {
    const websocketTransport = new FakeWebSocketTransport();
    const controller = new AbortController();
    const client = new IntronClient({
      apiKey: 'server-key',
      websocketTransport,
    });
    const session = await client.startStreamingTranscription({
      audio: asyncIterable([CHUNK]),
      signal: controller.signal,
    });

    controller.abort();
    await settle();

    expect(session.state).toBe(SttSessionState.Cancelled);
    expect(websocketTransport.connection.state).toBe('closed');
    await expect(
      session.events[Symbol.asyncIterator]().next(),
    ).resolves.toMatchObject({
      done: false,
      value: { type: 'transport_error' },
    });
  });

  it('rejects invalid chunk sizes without sending audio', async () => {
    const websocketTransport = new FakeWebSocketTransport();
    const client = new IntronClient({
      apiKey: 'server-key',
      websocketTransport,
    });
    const session = await client.startStreamingTranscription({
      audio: asyncIterable([new Uint8Array(2)]),
    });
    const events = session.events[Symbol.asyncIterator]();

    websocketTransport.connection.emit(
      'message',
      JSON.stringify({ message_type: 'SESSION_CREATED' }),
    );
    await settle();

    await expect(events.next()).resolves.toMatchObject({
      done: false,
      value: { type: 'session_created' },
    });
    await expect(events.next()).resolves.toMatchObject({
      done: false,
      value: { type: 'transport_error' },
    });
    expect(websocketTransport.connection.sent).toEqual([]);
  });
});

function parseSentJson(value: string | Uint8Array | undefined): unknown {
  if (value === undefined) {
    return undefined;
  }

  return JSON.parse(
    typeof value === 'string' ? value : new TextDecoder().decode(value),
  ) as unknown;
}

async function settle(): Promise<void> {
  for (let index = 0; index < 20; index += 1) {
    await Promise.resolve();
  }
}

function asyncIterable(
  chunks: readonly Uint8Array[],
): AsyncIterable<Uint8Array> {
  return trackedAsyncIterable(chunks);
}

function trackedAsyncIterable(
  chunks: readonly Uint8Array[],
): AsyncIterable<Uint8Array> & { readonly subscriptionCount: () => number } {
  let subscriptions = 0;

  return {
    subscriptionCount: () => subscriptions,
    [Symbol.asyncIterator]: () => {
      subscriptions += 1;
      let index = 0;

      return {
        next: () => {
          const value = chunks.at(index);

          if (value === undefined) {
            return Promise.resolve({ done: true, value });
          }

          index += 1;

          return Promise.resolve({ done: false, value });
        },
      };
    },
  };
}

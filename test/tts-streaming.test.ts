import { describe, expect, it } from 'vitest';

import {
  IntronClient,
  IntronProtocolError,
  TtsSessionState,
} from '../src/index.js';
import { FakeWebSocketTransport } from './fakes/fake-websocket-transport.js';

const STREAMING_OPTIONS = {
  voiceLanguage: 'en',
  voiceAccent: 'hausa',
  voiceGender: 'female',
} as const;

describe('TTS websocket streaming synthesis', () => {
  it('connects to the documented endpoint with query fields and auth', async () => {
    const websocketTransport = new FakeWebSocketTransport();
    const client = new IntronClient({
      apiKey: 'server-key',
      websocketTransport,
    });

    const session = await client.startStreamingSpeech(STREAMING_OPTIONS);

    expect(websocketTransport.connects).toHaveLength(1);
    const connect = websocketTransport.connects[0];
    expect(connect?.url.toString()).toBe(
      'wss://infer.voice.intron.io/tts/v1/stream?voice_accent=hausa&voice_gender=female&voice_language=en&output_audio_format=wav',
    );
    expect(connect?.headers?.authorization).toBe('Bearer server-key');
    expect(websocketTransport.connection.sent).toEqual([]);
    expect(session.state).toBe(TtsSessionState.Connecting);
  });

  it('waits for SESSION_CREATED before sending text chunks', async () => {
    const websocketTransport = new FakeWebSocketTransport();
    const client = new IntronClient({
      apiKey: 'server-key',
      websocketTransport,
    });
    const session = await client.startStreamingSpeech(STREAMING_OPTIONS);
    const sendPromise = session.sendText('Hello there');
    await settle();

    expect(websocketTransport.connection.sent).toEqual([]);

    websocketTransport.connection.emit(
      'message',
      JSON.stringify({ message_type: 'SESSION_CREATED', session_id: 'tts-1' }),
    );
    await sendPromise;

    expect(session.state).toBe(TtsSessionState.Active);
    expect(websocketTransport.connection.sent.map(parseSentJson)).toEqual([
      {
        message_type: 'INPUT_TEXT_CHUNK',
        text: 'Hello there',
        ack_id: 1,
      },
    ]);
  });

  it('sends fetch payloads with explicit and sequential chunk IDs', async () => {
    const websocketTransport = new FakeWebSocketTransport();
    const client = new IntronClient({
      apiKey: 'server-key',
      websocketTransport,
    });
    const session = await readyTtsSession(client, websocketTransport);

    await session.fetchAudioChunk();
    await session.fetchAudioChunk(7);
    await session.fetchAudioChunk();

    expect(websocketTransport.connection.sent.map(parseSentJson)).toEqual([
      { message_type: 'FETCH_AUDIO_CHUNK', chunk_id: 1 },
      { message_type: 'FETCH_AUDIO_CHUNK', chunk_id: 7 },
      { message_type: 'FETCH_AUDIO_CHUNK', chunk_id: 8 },
    ]);
  });

  it('validates streaming text chunk length', async () => {
    const websocketTransport = new FakeWebSocketTransport();
    const client = new IntronClient({
      apiKey: 'server-key',
      websocketTransport,
    });
    const session = await client.startStreamingSpeech(STREAMING_OPTIONS);

    await expect(session.sendText('too short')).rejects.toBeInstanceOf(
      IntronProtocolError,
    );
    await expect(session.sendText('a'.repeat(101))).rejects.toBeInstanceOf(
      IntronProtocolError,
    );
  });

  it('decodes audio chunk responses into the audio iterable', async () => {
    const websocketTransport = new FakeWebSocketTransport();
    const client = new IntronClient({
      apiKey: 'server-key',
      websocketTransport,
    });
    const session = await readyTtsSession(client, websocketTransport);
    const audioChunks = session.audioChunks[Symbol.asyncIterator]();
    const events = session.events[Symbol.asyncIterator]();

    websocketTransport.connection.emit(
      'message',
      JSON.stringify({
        message_type: 'FETCH_AUDIO_CHUNK',
        chunk_id: 2,
        audio_base_64: Buffer.from([1, 2, 3]).toString('base64'),
      }),
    );

    await expect(audioChunks.next()).resolves.toMatchObject({
      done: false,
      value: { chunkId: 2, audio: Buffer.from([1, 2, 3]) },
    });
    await expect(events.next()).resolves.toMatchObject({
      done: false,
      value: { type: 'session_created' },
    });
    await expect(events.next()).resolves.toMatchObject({
      done: false,
      value: { type: 'audio_chunk', chunk: { chunkId: 2 } },
    });
  });

  it('sends commit during commit and close lifecycle', async () => {
    const websocketTransport = new FakeWebSocketTransport();
    const client = new IntronClient({
      apiKey: 'server-key',
      websocketTransport,
    });
    const session = await readyTtsSession(client, websocketTransport);

    await session.commit();
    await session.close();

    expect(websocketTransport.connection.sent.map(parseSentJson)).toEqual([
      { message_type: 'COMMIT' },
    ]);
    expect(websocketTransport.connection.state).toBe('closed');
    expect(websocketTransport.connection.handlerCounts.get('message')).toBe(0);
    expect(session.state).toBe(TtsSessionState.Completed);
  });

  it('cancels the socket and closes iterables when aborted', async () => {
    const websocketTransport = new FakeWebSocketTransport();
    const abortController = new AbortController();
    const client = new IntronClient({
      apiKey: 'server-key',
      websocketTransport,
    });
    const session = await client.startStreamingSpeech({
      ...STREAMING_OPTIONS,
      signal: abortController.signal,
    });
    const events = session.events[Symbol.asyncIterator]();

    abortController.abort(new Error('stop now'));
    await settle();

    expect(websocketTransport.connection.state).toBe('closed');
    expect(session.state).toBe(TtsSessionState.Cancelled);
    await expect(events.next()).resolves.toMatchObject({
      done: false,
      value: { type: 'transport_error' },
    });
    await expect(events.next()).resolves.toEqual({
      done: true,
      value: undefined,
    });
  });

  it('reconnects after session time limit and replays buffered text', async () => {
    const websocketTransport = new FakeWebSocketTransport();
    websocketTransport.createConnection();
    const client = new IntronClient({
      apiKey: 'server-key',
      websocketTransport,
    });
    const session = await readyTtsSession(client, websocketTransport);
    const events = session.events[Symbol.asyncIterator]();

    websocketTransport.connection.emit(
      'message',
      JSON.stringify({ message_type: 'SESSION_TIME_LIMIT_EXCEEDED' }),
    );
    await settle();
    const nextConnection = websocketTransport.connections[1];
    expect(nextConnection).toBeDefined();
    const sendPromise = session.sendText('Buffered hello');
    await settle();
    expect(nextConnection?.sent).toEqual([]);

    nextConnection?.emit(
      'message',
      JSON.stringify({ message_type: 'SESSION_CREATED', session_id: 'tts-2' }),
    );
    await sendPromise;

    await expect(events.next()).resolves.toMatchObject({
      done: false,
      value: { type: 'session_created', sessionIndex: 0 },
    });
    await expect(events.next()).resolves.toMatchObject({
      done: false,
      value: {
        type: 'server_error',
        messageType: 'SESSION_TIME_LIMIT_EXCEEDED',
      },
    });
    await expect(events.next()).resolves.toMatchObject({
      done: false,
      value: { type: 'reconnecting', reason: 'session_time_limit' },
    });
    await expect(events.next()).resolves.toMatchObject({
      done: false,
      value: { type: 'session_created', sessionIndex: 1 },
    });
    expect(websocketTransport.connects).toHaveLength(2);
    expect(nextConnection?.sent.map(parseSentJson)).toEqual([
      {
        message_type: 'INPUT_TEXT_CHUNK',
        text: 'Buffered hello',
        ack_id: 1,
      },
    ]);
  });

  it('bounds buffered text while reconnecting', async () => {
    const websocketTransport = new FakeWebSocketTransport();
    websocketTransport.createConnection();
    const client = new IntronClient({
      apiKey: 'server-key',
      websocketTransport,
    });
    const session = await client.startStreamingSpeech({
      ...STREAMING_OPTIONS,
      maxBufferedTextCharacters: 20,
    });

    const firstSend = session.sendText('Hello you!');
    const secondSend = session.sendText('Another hi');
    await expect(session.sendText('Overflow!!')).rejects.toBeInstanceOf(
      IntronProtocolError,
    );

    websocketTransport.connection.emit(
      'message',
      JSON.stringify({ message_type: 'SESSION_CREATED', session_id: 'tts-1' }),
    );
    await firstSend;
    await secondSend;

    expect(websocketTransport.connection.sent.map(parseSentJson)).toEqual([
      {
        message_type: 'INPUT_TEXT_CHUNK',
        text: 'Hello you!',
        ack_id: 1,
      },
      {
        message_type: 'INPUT_TEXT_CHUNK',
        text: 'Another hi',
        ack_id: 2,
      },
    ]);
  });
});

async function readyTtsSession(
  client: IntronClient,
  websocketTransport: FakeWebSocketTransport,
) {
  const session = await client.startStreamingSpeech(STREAMING_OPTIONS);
  websocketTransport.connection.emit(
    'message',
    JSON.stringify({ message_type: 'SESSION_CREATED', session_id: 'tts-1' }),
  );
  await settle();

  return session;
}

function parseSentJson(data: string | Uint8Array): unknown {
  const text = typeof data === 'string' ? data : new TextDecoder().decode(data);

  return JSON.parse(text) as unknown;
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

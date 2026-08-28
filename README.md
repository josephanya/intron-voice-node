# Intron Voice Node.js SDK

TypeScript SDK for server-side integrations with the Intron Voice API.

This package is in early SDK implementation. It exposes the public client,
error, logging, transport, scheduler, and file upload contracts that
speech-to-text, text-to-speech, and streaming workflows build on.

Phase 1 adds credential validation, base URL normalization, token provider
support, and typed SDK error mapping utilities.

Phase 2 adds the shared authenticated HTTP layer, JSON and multipart request
helpers, configurable retry policy, timeout propagation, and a default
`fetch`-based transport.

Phase 3 adds asynchronous file transcription helpers for upload, status checks,
and polling until a transcription reaches a terminal state.

Phase 4 adds synchronous file transcription for audio clips supported by the
sync endpoint.

Phase 5 adds WebSocket streaming transcription for PCM16 little-endian audio.

Phase 6 adds streaming rollover and reconnect lifecycle handling for long-lived
audio streams.

Phase 7 adds synchronous and queued text-to-speech generation over REST.

## Requirements

- Node.js 20 or newer
- npm 10 or newer

## Installation

```sh
npm install @intron-voice-node
```

## Usage

```ts
import { IntronClient } from '@intron-voice-node';

const client = new IntronClient({
  apiKey: process.env.INTRON_API_KEY,
  retryPolicy: {
    maxRetries: 2,
  },
});
```

For production services that broker short-lived tokens, use a token provider:

```ts
const client = new IntronClient({
  tokenProvider: {
    resolveToken: async (signal) => {
      return fetchShortLivedToken({ signal });
    },
  },
});
```

Keep API keys on trusted servers. Do not ship long-lived credentials to browser
applications.

Upload an audio file for asynchronous speech-to-text transcription and poll for
the result:

```ts
const job = await client.uploadAudioFile({
  source: { kind: 'path', path: './consultation.wav' },
  language: 'en',
  diarization: true,
});

const result = await client.waitForTranscription({
  fileId: job.fileId,
  pollingIntervalMs: 2000,
  timeoutMs: 15 * 60 * 1000,
  structuredPostProcessing: true,
});

console.log(result.transcript);
```

For short audio, submit a synchronous transcription request:

```ts
const result = await client.transcribeAudioFileSync({
  source: { kind: 'path', path: './brief-note.wav' },
  audioDurationSeconds: 45,
  language: 'en',
  diarization: true,
});

console.log(result.transcript);
```

The synchronous endpoint supports audio up to 120 seconds. When
`audioDurationSeconds` is provided, the SDK validates that metadata before
uploading; it does not measure the file duration.

Stream PCM16 little-endian audio over WebSocket:

```ts
const session = await client.startStreamingTranscription({
  audio: pcm16Chunks,
  sampleRate: 16000,
  bitRate: 16,
  channels: 1,
  language: 'en',
});

for await (const event of session.transcriptEvents) {
  if (event.type === 'partial_transcript') {
    console.log('partial', event.transcript);
  }

  if (event.type === 'committed_transcript') {
    console.log('final', event.transcript);
  }
}
```

Streaming audio can be an `AsyncIterable<Uint8Array>`, Node.js `Readable`, or
Web `ReadableStream<Uint8Array>`. Chunks must contain complete PCM16 sample
frames and be between 1 KB and 32 KB. Audio read before `SESSION_CREATED` is
held at the current chunk boundary, so the SDK never sends early audio or keeps
an unbounded pre-session buffer.

Streaming sessions automatically roll over before the service's 300 second
session limit. The default rollover interval is 270 seconds: the SDK commits the
current session, opens the next WebSocket, increments `session.sessionIndex`, and
continues sending audio. Lifecycle events include the zero-based `sessionIndex`,
and reconnect attempts emit `reconnecting` with the current and next session
indexes. If the service closes an idle stream after the documented 60 second
audio gap, the SDK treats that close as reconnectable rather than terminal.

Audio produced while a rollover or reconnect is in progress is kept in a bounded
buffer. Defaults are 1 MiB of queued audio, 3 reconnect attempts, 250 ms initial
backoff, and 5 seconds maximum backoff. Override these with
`maxReconnectBufferBytes`, `maxReconnectAttempts`, `reconnectInitialDelayMs`,
and `reconnectMaxDelayMs` when your audio producer needs different failure or
latency tradeoffs.

Generate speech from text synchronously:

```ts
const speech = await client.generateSpeech({
  text: 'Your appointment is confirmed for 10 AM.',
  voiceLanguage: 'en',
  voiceAccent: 'gh',
  voiceGender: 'female',
  outputAudioFormat: 'wav',
  downloadAudio: true,
});

console.log(speech.audioPath, speech.audioDurationSeconds);
console.log(speech.audio); // Uint8Array when downloadAudio is true
```

Queue longer-running speech synthesis and poll for completion:

```ts
const job = await client.enqueueSpeech({
  text: 'Please collect your medication after the consultation.',
  voiceLanguage: 'en',
  voiceAccent: 'gh',
  voiceGender: 'male',
  outputAudioFormat: 'opus',
});

const speech = await client.waitForSpeech({
  textId: job.textId,
  pollingIntervalMs: 2000,
  timeoutMs: 2 * 60 * 1000,
});

console.log(speech.audioPath);
```

TTS text is validated locally at the documented 4096 character limit. The SDK
sends `voice_language`, `voice_accent`, `voice_gender`, and
`output_audio_format` using the service's JSON field names, and currently
accepts WAV and OPUS output formats. Remote `audioPath` values should be treated
as ephemeral service paths; set `downloadAudio: true` when you want the SDK to
fetch the bytes immediately as a `Uint8Array`.

Supported upload sources include local paths, `Uint8Array` buffers, Node.js
`Readable` streams, and `AsyncIterable<Uint8Array>` chunks. Supported file
extensions are WAV, MP3, MP4, M4A, OGG, WebM, and FLAC.

The low-level request helpers are intended for SDK operations and advanced
server integrations:

```ts
const response = await client.requestJson<{ readonly id: string }>({
  method: 'POST',
  path: '/file/v1/status',
  json: { file_id: 'file-id' },
  retry: true,
});
```

## Development

```sh
npm run format:check
npm run lint
npm run typecheck
npm test
```

Normal tests use fake transports and do not contact the live service.

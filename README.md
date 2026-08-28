# Intron Voice Node.js SDK

TypeScript SDK for trusted server-side integrations with the Intron Voice API.
It supports speech-to-text (STT), text-to-speech (TTS), WebSocket streaming,
typed errors, retry metadata, injectable transports, and fake-transport testing
without calling the live service.

This package is intended for Node.js backends, workers, CLIs, and other trusted
server environments. Do not embed long-lived Intron API keys in browsers,
mobile apps, desktop clients, or other untrusted runtimes.

## Requirements

- Node.js 20 or newer
- npm 10 or newer

## Installation

```sh
npm install intron-voice-node
```

## Imports

ESM:

```ts
import { IntronClient } from 'intron-voice-node';
```

CommonJS:

```js
const { IntronClient } = require('intron-voice-node');
```

## Authentication

Use an API key only from a trusted server process:

```ts
import { IntronClient } from 'intron-voice-node';

const client = new IntronClient({
  apiKey: requiredEnv('INTRON_API_KEY'),
  retryPolicy: {
    maxRetries: 2,
  },
});
```

For production systems, prefer a server-side token broker that exchanges your
own application credentials for short-lived Intron tokens. Then provide tokens
to the SDK lazily:

```ts
const client = new IntronClient({
  tokenProvider: {
    resolveToken: async (signal) => {
      return fetchShortLivedToken({ signal });
    },
  },
});
```

The SDK passes the operation `AbortSignal` to the token provider so token
requests can be cancelled with the parent SDK request.

## Language And Voice Catalogs

The SDK exports convenience catalogs for the currently documented language
codes:

```ts
import {
  INTRON_STT_LANGUAGES,
  INTRON_TTS_LANGUAGES,
  isKnownIntronSttLanguageCode,
  type IntronTtsVoiceConfiguration,
} from 'intron-voice-node';
```

The official documentation remains the source of truth:

- STT supported languages: https://docs.voice.intron.io/docs/stt/supported-languages
- TTS supported languages and accents: https://docs.voice.intron.io/docs/tts/supported-languages-and-accents

Catalog types include known values for editor help and still allow raw string
values because the service can add languages or accents before the SDK is
updated. TTS accent values are intentionally modeled as strings; check the
official TTS language/accent page for the current accent values for each
language.

## Speech To Text

### Synchronous File Transcription

Use synchronous transcription for short audio supported by the sync endpoint:

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

### Asynchronous File Transcription

Upload an audio file and poll until it reaches a terminal state:

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

### Streaming STT

Stream PCM16 little-endian audio over WebSocket:

```ts
const session = await client.startStreamingTranscription({
  audio: pcm16Chunks,
  sampleRate: 16000,
  bitRate: 16,
  channels: 1,
  language: 'en',
});

try {
  for await (const event of session.transcriptEvents) {
    if (event.type === 'partial_transcript') {
      console.log('partial', event.transcript);
    }

    if (event.type === 'committed_transcript') {
      console.log('final', event.transcript);
    }
  }
} finally {
  await session.close();
}
```

Streaming audio can be an `AsyncIterable<Uint8Array>`, Node.js `Readable`, or
Web `ReadableStream<Uint8Array>`. Chunks must contain complete PCM16 sample
frames and be between 1 KB and 32 KB. Audio read before `SESSION_CREATED` is
held at the current chunk boundary, so the SDK never sends early audio or keeps
an unbounded pre-session buffer.

## Text To Speech

### Synchronous TTS

Generate speech from text synchronously:

```ts
const speech = await client.generateSpeech({
  text: 'Your appointment is confirmed for 10 AM.',
  voiceLanguage: 'en',
  voiceAccent: 'ghanaian',
  voiceGender: 'female',
  outputAudioFormat: 'wav',
  downloadAudio: true,
});

console.log(speech.audioPath, speech.audioDurationSeconds);
console.log(speech.audio); // Uint8Array when downloadAudio is true
```

### Queued TTS

Queue speech synthesis and poll for completion:

```ts
const job = await client.enqueueSpeech({
  text: 'Please collect your medication after the consultation.',
  voiceLanguage: 'en',
  voiceAccent: 'nigerian',
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
`output_audio_format` using the service's JSON field names. Remote `audioPath`
values should be treated as ephemeral service paths; set `downloadAudio: true`
when you want the SDK to fetch the bytes immediately as a `Uint8Array`.

### Streaming TTS

Stream text-to-speech audio over WebSocket without adding a playback dependency:

```ts
const session = await client.startStreamingSpeech({
  voiceLanguage: 'en',
  voiceAccent: 'nigerian',
  voiceGender: 'female',
  outputAudioFormat: 'wav',
});

try {
  await session.sendText('Please take your medication after breakfast.');
  await session.fetchAudioChunk();
  await session.commit();

  for await (const chunk of session.audioChunks) {
    await writeAudioBytes(chunk.audio);
  }
} finally {
  await session.close();
}
```

Streaming TTS sends the documented `INPUT_TEXT_CHUNK`, `FETCH_AUDIO_CHUNK`, and
`COMMIT` messages. Text chunks are validated locally at the documented 10 to 100
character range, and audio responses are decoded into `Uint8Array` values. The
SDK exposes `session.events` for acknowledgements, reconnect lifecycle events,
server errors, and committed audio messages.

## Streaming Lifecycle And Reconnection

STT and TTS streaming sessions expose typed lifecycle events and implement
`AsyncDisposable`. Always call `close()` in a `finally` block when you stop
reading from a stream.

Streaming sessions automatically roll over before the service's 300 second
session limit. The default rollover interval is 270 seconds: the SDK commits the
current session, opens the next WebSocket, increments `session.sessionIndex`, and
continues streaming. Lifecycle events include the zero-based `sessionIndex`, and
reconnect attempts emit `reconnecting` with the current and next session indexes.

If the service closes an idle STT stream after the documented 60 second audio
gap, or sends a documented session time-limit message, the SDK treats that as
reconnectable rather than terminal. Audio or text produced while a rollover or
reconnect is in progress is kept in bounded memory. Defaults are 1 MiB of queued
STT audio, 4096 queued TTS text characters, 3 reconnect attempts, 250 ms initial
backoff, and 5 seconds maximum backoff.

Tune buffering and reconnect behavior with `maxReconnectBufferBytes`,
`maxBufferedTextCharacters`, `maxReconnectAttempts`, `reconnectInitialDelayMs`,
and `reconnectMaxDelayMs`.

## Supported Formats And Limits

Supported file upload extensions are WAV, MP3, MP4, M4A, OGG, WebM, and FLAC.
Streaming STT currently sends PCM16 little-endian audio with configurable sample
rate, bit depth, and channels. TTS output formats are `wav` and `opus`.

The SDK validates documented local limits where possible:

- Sync STT duration metadata must be 120 seconds or less when provided.
- Streaming STT chunks must be between 1 KB and 32 KB.
- TTS REST text must be 1 to 4096 characters.
- Streaming TTS text chunks must be 10 to 100 characters.

Service rate limits can change by account and workload. SDK errors preserve
safe retry metadata: `IntronRateLimitError` exposes `status`, `requestId`,
`retryAfter`, and `retryable`. REST operations support the shared `retryPolicy`
and per-request `retry` options.

## Cancellation And Disposal

Pass an `AbortSignal` to cancel REST calls, polling waits, token acquisition,
and streaming sessions:

```ts
const abortController = new AbortController();

const upload = client.uploadAudioFile({
  source: { kind: 'path', path: './consultation.wav' },
  language: 'en',
  signal: abortController.signal,
});

abortController.abort(new Error('request exceeded local budget'));
await upload;
```

When a streaming signal aborts, the SDK closes the WebSocket and completes the
async iterables. Calling `close()` on a streaming session is idempotent.

## File Source Ownership And Memory

For `source: { kind: 'path' }`, the SDK opens and reads the file during the
request; keep the path stable until the operation has started. For
`Uint8Array` buffer sources, the caller owns the original buffer and should not
mutate it while the request is in progress. For Node `Readable` streams and
`AsyncIterable<Uint8Array>` sources, the SDK consumes the stream once.

Multipart stream and async-iterable sources are buffered up to
`maxStreamBufferBytes` so the request can be retried safely. Choose a limit that
matches your deployment memory budget and expected audio size.

## Privacy

Audio, transcript text, post-processing output, and generated speech can contain
sensitive information. Keep credentials server-side, avoid logging payloads,
store returned audio/transcripts according to your retention policy, and send
only the minimum data needed for the workflow. SDK errors and logs are designed
to preserve request metadata without exposing bearer tokens.

## Testing Without The Live Service

Inject `httpTransport`, `websocketTransport`, and `clock` to test integrations
without network calls. The SDK's own tests use fake transports for normal test
runs.

```ts
const client = new IntronClient({
  apiKey: 'test-key',
  httpTransport: fakeTransport,
});
```

See `examples/fake-transport-testing.ts` for a complete fake HTTP transport
example.

## Contract And Live Smoke Tests

The SDK keeps explicit contract tests for the service wire format, package entry
points, retry metadata, and cancellation behavior:

```sh
npm run test:contract
```

Live smoke tests are opt-in and are skipped by default. They require an API key,
an explicit enable flag, and use only synthetic test text/audio:

```sh
INTRON_API_KEY=... INTRON_RUN_LIVE_TESTS=true npm run test:live
```

Do not use patient audio, personal data, bearer tokens in fixtures, or committed
`.env` files for live testing.

## Examples

- `examples/sync-file-transcription.ts` - synchronous file transcription from a filesystem path.
- `examples/async-file-transcription.ts` - asynchronous file transcription with polling.
- `examples/streaming-stt-readable.ts` - streaming STT from a Node.js `Readable`.
- `examples/sync-tts.ts` - synchronous TTS with optional audio download.
- `examples/queued-tts.ts` - queued TTS with polling.
- `examples/streaming-tts.ts` - streaming TTS lifecycle.
- `examples/abort-controller-cancellation.ts` - `AbortController` cancellation.
- `examples/error-handling-rate-limit.ts` - typed error handling and rate-limit metadata.
- `examples/short-lived-token-provider.ts` - short-lived token provider usage.
- `examples/fake-transport-testing.ts` - fake transport testing.
- `examples/esm-import.ts` - ESM import.
- `examples/commonjs-require.cjs` - CommonJS require.

## Advanced Requests

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
npm run release:check
```

Normal tests use fake transports and do not contact the live service. Before
publishing, run `npm pack --dry-run` or `npm run release:check` to inspect the
package artifact contents.

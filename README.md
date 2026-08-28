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

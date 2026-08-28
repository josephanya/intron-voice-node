# Changelog

All notable changes to this package will be documented in this file.

## 0.0.0

- Added release-preparation coverage with explicit API contract tests, guarded
  live smoke tests, package entry-point parity checks, and release validation
  scripts.
- Added language and voice catalog models, expanded server-side README guidance,
  and runnable Node.js examples for STT, TTS, cancellation, error handling,
  token providers, fake transport testing, ESM, and CommonJS usage.
- Added WebSocket streaming TTS synthesis with typed session events, text chunk
  validation, fetch/commit payloads, decoded audio chunks, cancellation,
  reconnect lifecycle handling, and bounded text buffering.
- Added synchronous and queued TTS generation with typed status polling,
  validation for documented voice fields and output formats, 4096 character text
  limit checks, and optional `Uint8Array` audio downloads.
- Added streaming STT rollover and reconnect lifecycle handling with bounded
  audio buffering, backoff limits, reconnect events, and session indexes.
- Added WebSocket STT streaming with typed events, transcript iterators,
  sequential audio acknowledgements, chunk validation, cancellation, and a
  default `ws` transport.
- Added synchronous STT file upload and transcription with duration metadata
  validation and typed 503 fallback errors that preserve the file ID.
- Added asynchronous STT file upload, status polling, typed result parsing, and
  documented audio format validation.
- Added authenticated JSON and multipart HTTP request helpers, default
  `fetch` transport, timeout propagation, and bounded retry policy support.
- Added configuration validation, token provider authentication, base URL
  normalization, and typed error metadata.
- Scaffolded the standalone TypeScript SDK package.

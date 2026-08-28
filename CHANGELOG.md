# Changelog

All notable changes to this package will be documented in this file.

## 0.0.0

- Added synchronous STT file upload and transcription with duration metadata
  validation and typed 503 fallback errors that preserve the file ID.
- Added asynchronous STT file upload, status polling, typed result parsing, and
  documented audio format validation.
- Added authenticated JSON and multipart HTTP request helpers, default
  `fetch` transport, timeout propagation, and bounded retry policy support.
- Added configuration validation, token provider authentication, base URL
  normalization, and typed error metadata.
- Scaffolded the standalone TypeScript SDK package.

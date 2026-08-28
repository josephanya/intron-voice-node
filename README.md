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

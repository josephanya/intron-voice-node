# Intron Voice Node.js SDK

TypeScript SDK for server-side integrations with the Intron Voice API.

This package is in the Phase 0 scaffold stage. It exposes the public client,
error, logging, transport, scheduler, and file upload contracts that later
speech-to-text, text-to-speech, and streaming workflows will build on.

Phase 1 adds credential validation, base URL normalization, token provider
support, and typed SDK error mapping utilities.

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

## Development

```sh
npm run format:check
npm run lint
npm run typecheck
npm test
```

Normal tests use fake transports and do not contact the live service.

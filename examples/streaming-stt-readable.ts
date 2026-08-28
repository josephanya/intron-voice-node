import { createReadStream } from 'node:fs';

import { IntronClient } from 'intron-voice-node';

import { requiredEnv } from './env.js';

const client = new IntronClient({
  apiKey: requiredEnv('INTRON_API_KEY'),
});

const session = await client.startStreamingTranscription({
  audio: createReadStream('./audio/pcm16-16khz-mono.raw'),
  sampleRate: 16_000,
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

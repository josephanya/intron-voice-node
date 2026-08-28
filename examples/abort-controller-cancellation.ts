import { setTimeout as delay } from 'node:timers/promises';

import { IntronClient, IntronRequestCancelledError } from '@intron-voice-node';

import { requiredEnv } from './env.js';

const abortController = new AbortController();
const client = new IntronClient({
  apiKey: requiredEnv('INTRON_API_KEY'),
});

const transcription = client.uploadAudioFile({
  source: { kind: 'path', path: './audio/consultation.wav' },
  language: 'en',
  signal: abortController.signal,
});

await delay(500);
abortController.abort(new Error('request exceeded local budget'));

try {
  await transcription;
} catch (error) {
  if (error instanceof IntronRequestCancelledError) {
    console.log('cancelled locally');
  } else {
    throw error;
  }
}

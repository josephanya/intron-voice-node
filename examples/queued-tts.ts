import { IntronClient } from '@intron-voice-node';

import { requiredEnv } from './env.js';

const client = new IntronClient({
  apiKey: requiredEnv('INTRON_API_KEY'),
});

const job = await client.enqueueSpeech({
  text: 'Please collect your medication after the consultation.',
  voiceLanguage: 'en',
  voiceAccent: 'nigerian',
  voiceGender: 'male',
  outputAudioFormat: 'opus',
});

const speech = await client.waitForSpeech({
  textId: job.textId,
  pollingIntervalMs: 2_000,
  timeoutMs: 2 * 60 * 1_000,
  downloadAudio: true,
  onStatus: (status) => {
    console.log('status', status.status);
  },
});

console.log(speech.audioPath, speech.audio?.byteLength);

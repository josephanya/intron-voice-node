import { IntronClient } from '@intron-voice-node';

import { requiredEnv } from './env.js';

const client = new IntronClient({
  apiKey: requiredEnv('INTRON_API_KEY'),
});

const result = await client.transcribeAudioFileSync({
  source: { kind: 'path', path: './audio/short-note.wav' },
  audioDurationSeconds: 45,
  language: 'en',
  diarization: true,
});

console.log(result.transcript);

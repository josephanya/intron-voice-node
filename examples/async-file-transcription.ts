import { IntronClient } from 'intron-voice-node';

import { requiredEnv } from './env.js';

const client = new IntronClient({
  apiKey: requiredEnv('INTRON_API_KEY'),
});

const job = await client.uploadAudioFile({
  source: { kind: 'path', path: './audio/consultation.wav' },
  language: 'yo',
  diarization: true,
  postProcessing: {
    summary: true,
  },
});

const result = await client.waitForTranscription({
  fileId: job.fileId,
  pollingIntervalMs: 2_000,
  timeoutMs: 15 * 60 * 1_000,
  structuredPostProcessing: true,
  onStatus: (status) => {
    console.log('status', status.status);
  },
});

console.log(result.transcript);
